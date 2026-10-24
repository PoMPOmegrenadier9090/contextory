import type { AssetUploader } from "@pkm/ui";
import { Group, SegmentedControl, Stack, Text, Textarea } from "@mantine/core";
import {
  parseMarkdownEntity,
  serializeMarkdownEntity,
  updateEntityMetadata,
  type EntityMetadataPatch,
  type ParsedEntity,
} from "@pkm/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BacklinksTable,
  useNotification,
  usePersistentWarning,
  EntityBodySection,
  EntryPropertiesPanel,
  EntityEntryViewControls,
  EntityEntryTimeline,
  useEntityEntryViewState,
  useEntityEntryVaultId,
  canCreateInContext,
  entityUiTitle,
  EntityRelationsView,
  EntityDeleteButton,
  EntityIcon,
  EntityIdCopyButton,
  EntityStatusLabel,
  EntityPinButton,
  MarkdownLiveEditor,
  type QuickCaptureInput,
  type HierarchyEntityPatch,
} from "@pkm/ui";
import {
  supportsMarkdownBody,
  type EntityType,
  type PkmEntitySummary,
} from "@pkm/contracts";
import type {
  EntityDocument,
  IndexedEntity,
  IndexedReference,
  ResolveEntityConflictRequest,
  WriteVaultFileConflict,
} from "@pkm/storage-node";

import { ConflictDialog } from "./conflict-dialog.js";
import { EntityMetadataForm } from "./entity-metadata-form.js";

type EditorMode = "form" | "raw";

const parsedEntity = (source: string): ParsedEntity | null => {
  const parsed = parseMarkdownEntity(source);
  return parsed.ok ? parsed.value.entity : null;
};

export interface EntityEditorProps {
  readonly onUpdateEntryBody?:
    | ((entityId: string, expectedBody: string, body: string) => Promise<void>)
    | undefined;

  readonly onCreate?:
    ((type: EntityType, context: PkmEntitySummary) => void) | undefined;
  readonly active?: boolean;
  readonly relationRevision?: number | undefined;
  readonly onCapture?:
    ((input: QuickCaptureInput) => Promise<void>) | undefined;
  readonly captureStorageKey?: string | undefined;
  readonly onStatusChange?: (
    status: "saved" | "dirty" | "saving" | "warning",
  ) => void;
  readonly document: EntityDocument;
  readonly readOnly: boolean;
  readonly onOpenReference: (entityId: string) => void;
  readonly onUploadAsset: AssetUploader;
  readonly onDeleteEntity: (entityId: string) => Promise<void>;
  readonly onSaved: (fileHash: EntityDocument["fileHash"]) => Promise<void>;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly externalChangeDetected: boolean;
  readonly backlinks: readonly IndexedReference[];
  readonly entities: readonly IndexedEntity[];
  readonly pinnedIds: ReadonlySet<string>;
  readonly onTogglePinned: (entityId: string) => void;
  readonly onResolveTopics: (
    topicNames: readonly string[],
  ) => Promise<readonly string[]>;
  readonly onUpdateEntity: (
    entityId: string,
    patch: HierarchyEntityPatch,
  ) => Promise<void>;
  readonly onUpdateTopics: (
    entityId: string,
    topicNames: readonly string[],
  ) => Promise<void>;
  readonly onUpdateError?: ((reason: unknown) => void) | undefined;
  readonly onConflictResolved: (
    document: EntityDocument | null,
  ) => Promise<void>;
  readonly saveBeforeLeaveRef: {
    current: (() => Promise<boolean>) | null;
  };
}

export const EntityEditor = ({
  onUpdateEntryBody,
  onCreate,
  active = true,
  onCapture,
  captureStorageKey,
  onStatusChange,
  document,
  readOnly,
  onOpenReference,
  onUploadAsset,
  onDeleteEntity,
  onSaved,
  onDirtyChange,
  externalChangeDetected,
  backlinks,
  entities,
  pinnedIds,
  onTogglePinned,
  onResolveTopics,
  onUpdateEntity,
  onUpdateTopics,
  onUpdateError,
  onConflictResolved,
  saveBeforeLeaveRef,
}: EntityEditorProps): React.JSX.Element => {
  const bodyEditable = supportsMarkdownBody(document.entity.type);
  const bodyLabel =
    document.entity.type.charAt(0).toUpperCase() +
    document.entity.type.slice(1);
  const vaultId = useEntityEntryVaultId();
  const entityEntryView = useEntityEntryViewState(
    vaultId,
    document.entity.id,
    document.entity.type,
  );
  const content = useRef(document.draft?.content ?? document.content);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef(false);
  const dirtyRef = useRef(document.draft !== null);
  const revisionRef = useRef(0);
  const baseHashRef = useRef(document.fileHash);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const initialEntity = parsedEntity(content.current);
  const [mode, setMode] = useState<EditorMode>(
    initialEntity === null ? "raw" : "form",
  );
  const [formEntity, setFormEntity] = useState<ParsedEntity | null>(
    initialEntity,
  );
  const [dirty, setDirty] = useState(document.draft !== null);
  const [saving, setSaving] = useState(false);
  const [message, setErrorMessage] = useState<string | null>(null);
  const notifyError = useNotification("error");
  const notifySuccess = useNotification("success");
  const setMessage = useCallback(
    (message: string | null): void => {
      setErrorMessage(message);
      if (message !== null) notifyError(message);
    },
    [notifyError],
  );
  const [conflict, setConflict] = useState<WriteVaultFileConflict | null>(null);
  const [resolving, setResolving] = useState<
    ResolveEntityConflictRequest["resolution"] | null
  >(null);

  useEffect(() => {
    onStatusChange?.(
      conflict !== null || (dirty && message !== null)
        ? "warning"
        : saving
          ? "saving"
          : dirty
            ? "dirty"
            : "saved",
    );
  }, [conflict, dirty, message, onStatusChange, saving]);

  const persistPendingDraft = useCallback(async (): Promise<void> => {
    if (!pendingDraft.current) return;
    pendingDraft.current = false;
    await window.pkm.saveDraft({
      entityId: document.entity.id,
      content: content.current,
      baseHash: baseHashRef.current,
    });
  }, [document.entity.id]);

  const scheduleAutoSave = useCallback((): void => {
    if (readOnly) return;
    if (autoSaveTimer.current !== null) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      autoSaveTimer.current = null;
      void saveBeforeLeaveRef.current?.();
    }, 1000);
  }, [readOnly, saveBeforeLeaveRef]);

  const updateDraft = useCallback(
    (nextContent: string): void => {
      content.current = nextContent;
      revisionRef.current += 1;
      pendingDraft.current = true;
      dirtyRef.current = true;
      setDirty(true);
      onDirtyChange(true);
      setMessage(null);
      if (draftTimer.current !== null) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => {
        void persistPendingDraft().catch((error: unknown) => {
          setMessage(error instanceof Error ? error.message : String(error));
        });
      }, 250);
      scheduleAutoSave();
    },
    [onDirtyChange, persistPendingDraft, scheduleAutoSave, setMessage],
  );

  useEffect(
    () => () => {
      if (draftTimer.current !== null) clearTimeout(draftTimer.current);
      if (autoSaveTimer.current !== null) clearTimeout(autoSaveTimer.current);
      if (pendingDraft.current) {
        void persistPendingDraft().catch(() => undefined);
      }
    },
    [persistPendingDraft],
  );

  useEffect(() => {
    const source = document.draft?.content ?? document.content;
    const entity = parsedEntity(source);
    content.current = source;
    revisionRef.current = 0;
    baseHashRef.current = document.fileHash;
    setFormEntity(entity);
    setMode((current) => (entity === null ? "raw" : current));
    dirtyRef.current = document.draft !== null;
    setDirty(document.draft !== null);
    onDirtyChange(document.draft !== null);
    if (document.draft !== null) scheduleAutoSave();
  }, [document, onDirtyChange, scheduleAutoSave]);

  const changeMode = (value: string): void => {
    if (value !== "form" && value !== "raw") return;
    if (value === "form") {
      const parsed = parseMarkdownEntity(content.current);
      if (!parsed.ok) {
        setMessage(
          `フォームへ切り替える前にRaw Markdownを修正してください: ${parsed.error.message}`,
        );
        return;
      }
      setFormEntity(parsed.value.entity);
    }
    setMessage(null);
    setMode(value);
  };

  const patchMetadata = (patch: EntityMetadataPatch): void => {
    try {
      const updated = updateEntityMetadata(content.current, patch);
      setFormEntity(updated.entity);
      updateDraft(updated.content);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const currentParsedEntity = parseMarkdownEntity(content.current);
  const editorDocument =
    mode === "form" && currentParsedEntity.ok
      ? currentParsedEntity.value.body
      : content.current;

  const editMarkdown = (value: string): void => {
    if (mode === "raw") {
      updateDraft(value);
      return;
    }
    const current = parseMarkdownEntity(content.current);
    if (!current.ok) {
      setMessage(`本文を更新できません: ${current.error.message}`);
      return;
    }
    updateDraft(serializeMarkdownEntity(current.value, { body: value }));
  };

  const performSave = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    setSaving(true);
    setMessage(null);
    try {
      if (draftTimer.current !== null) {
        clearTimeout(draftTimer.current);
        draftTimer.current = null;
      }
      if (autoSaveTimer.current !== null) {
        clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = null;
      }
      await persistPendingDraft();
      const revision = revisionRef.current;
      const contentToSave = content.current;
      const result = await window.pkm.saveEntity({
        entityId: document.entity.id,
        content: contentToSave,
        expectedFileHash: baseHashRef.current,
      });
      if (!result.ok) {
        setConflict(result);
        setErrorMessage(
          "外部更新と競合しました。draftと外部版を保持しています。",
        );
        return false;
      }
      baseHashRef.current = result.snapshot.hash;
      if (revisionRef.current !== revision) {
        pendingDraft.current = true;
        await persistPendingDraft();
        scheduleAutoSave();
        return true;
      }
      dirtyRef.current = false;
      setDirty(false);
      onDirtyChange(false);
      await onSaved(result.snapshot.hash);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    document.entity.id,
    onDirtyChange,
    onSaved,
    persistPendingDraft,
    scheduleAutoSave,
    setMessage,
  ]);

  const save = useCallback((): Promise<boolean> => {
    if (saveInFlightRef.current !== null) return saveInFlightRef.current;
    const operation = (async (): Promise<boolean> => {
      while (dirtyRef.current) {
        if (!(await performSave())) return false;
      }
      return true;
    })();
    saveInFlightRef.current = operation;
    void operation.finally(() => {
      if (saveInFlightRef.current === operation) {
        saveInFlightRef.current = null;
      }
    });
    return operation;
  }, [performSave]);

  useEffect(() => {
    saveBeforeLeaveRef.current = save;
    return () => {
      if (saveBeforeLeaveRef.current === save) {
        saveBeforeLeaveRef.current = null;
      }
    };
  }, [save, saveBeforeLeaveRef]);

  const resolveConflict = async (
    resolution: ResolveEntityConflictRequest["resolution"],
  ): Promise<void> => {
    if (conflict === null) return;
    setResolving(resolution);
    setMessage(null);
    try {
      const result = await window.pkm.resolveEntityConflict({
        entityId: document.entity.id,
        resolution,
        expectedExternalHash: conflict.actual?.hash ?? null,
      });
      if (!result.ok) {
        setConflict(result);
        setMessage(
          "比較中に外部版がもう一度変更されました。最新の内容で比較を更新しました。",
        );
        return;
      }
      setConflict(null);
      dirtyRef.current = false;
      setDirty(false);
      onDirtyChange(false);
      notifySuccess(
        resolution === "keep-external"
          ? "外部版を採用しました。"
          : "Draft版を保存しました。",
      );
      await onConflictResolved(result.document);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setResolving(null);
    }
  };

  usePersistentWarning(
    active && (document.hasExternalChange || externalChangeDetected)
      ? "外部更新を検出しました。保存すると競合確認が行われます。"
      : null,
  );
  usePersistentWarning(
    active && readOnly
      ? "読み取り専用: このVaultのschema versionには書き込めません。"
      : null,
  );
  usePersistentWarning(
    active && conflict !== null
      ? "外部更新と競合しました。draftと外部版を保持しています。"
      : null,
  );

  return (
    <Stack gap="sm" className="entity-editor-shell">
      <Group className="entity-detail-heading" justify="space-between">
        <div>
          <Group className="entity-detail-identity" gap="xs">
            <EntityIcon
              type={document.entity.type}
              status={
                formEntity?.type === "project" || formEntity?.type === "task"
                  ? formEntity.status
                  : document.entity.status
              }
            />
            {(document.entity.type !== "entry" ||
              document.entity.displayName !== null) && (
              <Text fw={600}>{entityUiTitle(document.entity)}</Text>
            )}
            {(document.entity.type === "project" ||
              document.entity.type === "task") && (
              <EntityStatusLabel
                status={
                  formEntity?.type === "project" || formEntity?.type === "task"
                    ? formEntity.status
                    : document.entity.status
                }
              />
            )}
          </Group>
        </div>
        <Group>
          <EntityIdCopyButton
            entityId={document.entity.id}
            entityType={document.entity.type}
          />
          <EntityPinButton
            pinned={pinnedIds.has(document.entity.id)}
            onToggle={() => onTogglePinned(document.entity.id)}
          />
          <Text
            aria-live="polite"
            c="dimmed"
            className="editor-save-status"
            size="xs"
          >
            {saving ? "保存中…" : dirty ? "自動保存待ち" : "保存済み"}
          </Text>
          <EntityDeleteButton
            disabled={readOnly || saving}
            entityName={document.entity.displayName ?? document.entity.id}
            onDelete={() => onDeleteEntity(document.entity.id)}
            onDeleteError={(reason) =>
              setMessage(
                reason instanceof Error ? reason.message : String(reason),
              )
            }
          />
          {document.entity.type === "entry" &&
            entityEntryView.mode === "detail" && (
              <SegmentedControl
                aria-label="Frontmatter編集モード"
                data={[
                  { value: "form", label: "フォーム" },
                  { value: "raw", label: "Raw Markdown" },
                ]}
                value={mode}
                onChange={changeMode}
              />
            )}
        </Group>
      </Group>
      <EntityEntryViewControls
        entityType={document.entity.type}
        mode={entityEntryView.mode}
        relationMode={entityEntryView.relationMode}
        onModeChange={entityEntryView.setMode}
        onRelationModeChange={entityEntryView.setRelationMode}
      />
      {entityEntryView.mode === "timeline" && (
        <EntityEntryTimeline
          entity={document.entity}
          onCapture={onCapture}
          captureStorageKey={captureStorageKey}
          contextEntities={entities}
          onUploadAsset={onUploadAsset}
          relationMode={entityEntryView.relationMode}
          enabled={active}
          readOnly={readOnly}
          assetBaseUrl="pkm-asset://vault/"
          onOpenEntity={onOpenReference}
          onOpenAsset={(path) => {
            void window.pkm.openAsset(path).catch(onUpdateError);
          }}
          onUpdateEntryBody={onUpdateEntryBody}
          onCreate={
            onCreate && canCreateInContext("entry", document.entity)
              ? () => onCreate("entry", document.entity)
              : undefined
          }
        />
      )}
      <div hidden={entityEntryView.mode !== "detail"}>
        <Stack gap="sm">
          {document.entity.type === "entry" && mode === "raw" && (
            <EntryPropertiesPanel
              entity={{
                ...document.entity,
                journalDate:
                  formEntity?.type === "entry"
                    ? (formEntity.journal_date ?? null)
                    : document.entity.journalDate,
              }}
              entities={entities}
              readOnly
            />
          )}
          {mode === "form" && formEntity !== null && (
            <EntityMetadataForm
              path={document.entity.path}
              entity={formEntity}
              entities={entities}
              readOnly={readOnly}
              onPatch={patchMetadata}
              onResolveTopics={onResolveTopics}
              onUploadAsset={onUploadAsset}
              onOpenAsset={(path) => {
                void window.pkm
                  .openAsset(path)
                  .catch((reason: unknown) =>
                    setMessage(
                      reason instanceof Error ? reason.message : String(reason),
                    ),
                  );
              }}
            />
          )}
          {document.entity.type !== "entry" && (
            <EntityRelationsView
              onCreate={onCreate}
              entity={document.entity}
              entryRelationMode={entityEntryView.relationMode}
              entriesEnabled={active && entityEntryView.mode === "detail"}
              entities={entities}
              backlinks={backlinks}
              pinnedIds={pinnedIds}
              readOnly={readOnly}
              onOpenEntity={onOpenReference}
              onTogglePinned={onTogglePinned}
              onDeleteEntity={onDeleteEntity}
              onUpdateEntity={onUpdateEntity}
              onUpdateTopics={onUpdateTopics}
              onUpdateError={onUpdateError}
            />
          )}
          {bodyEditable && (
            <EntityBodySection
              key={document.entity.id}
              collapsible={document.entity.type !== "entry"}
              headerActions={
                document.entity.type !== "entry" ? (
                  <SegmentedControl
                    aria-label="Frontmatter編集モード"
                    data={[
                      { value: "form", label: "フォーム" },
                      { value: "raw", label: "Raw Markdown" },
                    ]}
                    value={mode}
                    onChange={changeMode}
                  />
                ) : undefined
              }
            >
              {(bodyVisible) => (
                <>
                  {mode === "raw" ? (
                    <Textarea
                      aria-label={`${bodyLabel} Raw Markdownエディタ`}
                      className="entity-editor-raw"
                      value={editorDocument}
                      readOnly={readOnly}
                      onChange={(event) =>
                        editMarkdown(event.currentTarget.value)
                      }
                      autosize
                      minRows={20}
                    />
                  ) : (
                    <MarkdownLiveEditor
                      key={`${document.entity.id}:${mode}`}
                      className="entity-editor"
                      ariaLabel={`${bodyLabel}本文エディタ`}
                      searchShortcutEnabled={
                        active &&
                        bodyVisible &&
                        entityEntryView.mode === "detail"
                      }
                      value={editorDocument}
                      readOnly={readOnly}
                      onChange={editMarkdown}
                      onUploadAsset={onUploadAsset}
                      assetBaseUrl="pkm-asset://vault/"
                      onOpenAsset={(path) => {
                        void window.pkm
                          .openAsset(path)
                          .catch((error: unknown) =>
                            setMessage(
                              error instanceof Error
                                ? error.message
                                : String(error),
                            ),
                          );
                      }}
                      onOpenReference={onOpenReference}
                    />
                  )}
                </>
              )}
            </EntityBodySection>
          )}
          <BacklinksTable
            backlinks={backlinks}
            onOpenEntity={onOpenReference}
          />
        </Stack>
      </div>
      <ConflictDialog
        conflict={active ? conflict : null}
        resolving={resolving}
        onClose={() => setConflict(null)}
        onResolve={(resolution) => void resolveConflict(resolution)}
      />
    </Stack>
  );
};
