import { LinkPreviews } from "./link-preview.js";
import type { AssetUploadSource } from "./image-upload.js";
import type { AssetUploader } from "./asset-links.js";
import { EntitySelect, EntityQueryContext } from "./entity-query-context.js";
import type { EntityType, PkmEntitySummary } from "@pkm/contracts";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  NativeSelect,
  Pill,
  SegmentedControl,
  Select,
  Popover,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  buildDirectReferenceCompletionOptions,
  type ReferenceCompletionEntity,
} from "./reference-completion.js";
import { MarkdownLiveEditor } from "./lazy-markdown-live-editor.js";
import {
  assetPathFromMarkdownUrl,
  markdownForAsset,
  type PkmAsset,
} from "./asset-links.js";
import { ENTITY_TYPE_OPTIONS, isEntityType } from "./entity-actions.js";
import { EntityIcon } from "./entity-icon.js";
import { useMobileLayout } from "./device-local-ui.js";
import { markdownTodos } from "./markdown-todos.js";
import type { MarkdownBodyEditorHandle } from "./markdown-live-editor.js";

export interface QuickCaptureInput {
  readonly title: string | null;
  readonly body: string;
  readonly contextId: string | null;
}

export type CaptureContextEntity = ReferenceCompletionEntity;

export const captureContextForEntity = (
  entity:
    | Pick<
        PkmEntitySummary,
        | "id"
        | "type"
        | "displayName"
        | "taskId"
        | "resourceId"
        | "projectId"
        | "areaId"
        | "topicIds"
      >
    | null
    | undefined,
  entities: readonly CaptureContextEntity[],
): CaptureContextEntity | null => {
  if (!entity) return null;
  if (entity.type !== "entry") return entity;
  const context = [
    { id: entity.taskId, type: "task" },
    { id: entity.resourceId, type: "resource" },
    { id: entity.projectId, type: "project" },
    { id: entity.areaId, type: "area" },
    { id: entity.topicIds[0] ?? null, type: "topic" },
  ].find((candidate) => candidate.id !== null);
  if (!context) return null;
  return (
    entities.find((candidate) => candidate.id === context.id) ?? {
      id: context.id!,
      type: context.type,
      displayName: null,
      taskId: null,
      resourceId: null,
      projectId: null,
      areaId: null,
    }
  );
};

export const captureContextOptions = (
  entities: readonly CaptureContextEntity[],
) =>
  buildDirectReferenceCompletionOptions(
    entities.filter((entity) =>
      ["area", "project", "task", "resource", "topic"].includes(entity.type),
    ),
  );

export const composeCaptureBody = (
  body: string,
  attachments: readonly PkmAsset[],
): string =>
  `${[
    removeTrailingEmptyTodoItem(body).trimEnd(),
    ...attachments.map(markdownForAsset),
  ]
    .filter((part) => part.length > 0)
    .join("\n")}\n`;

export interface QuickCaptureDialogProps {
  readonly defaultCurrentContext?: boolean | undefined;
  readonly currentContext?: CaptureContextEntity | null | undefined;
  readonly opened: boolean;
  readonly onClose: () => void;
  readonly onCapture: (input: QuickCaptureInput) => Promise<void>;
  readonly onUploadAsset?: AssetUploader | undefined;
  readonly assetBaseUrl?: string | undefined;
  readonly onOpenAsset?:
    ((path: string, fileName?: string) => void) | undefined;
  readonly contextEntities?: readonly CaptureContextEntity[] | undefined;
  readonly storageKey?: string | undefined;
}

export interface QuickCaptureComposerProps {
  readonly defaultCurrentContext?: boolean;
  readonly currentContext?: CaptureContextEntity | null | undefined;
  readonly onCapture: (input: QuickCaptureInput) => Promise<void>;
  readonly onSaved?: () => void;
  readonly autoFocus?: boolean;
  readonly compact?: boolean;
  readonly storageKey?: string | undefined;
  readonly onUploadAsset?: AssetUploader | undefined;
  readonly assetBaseUrl?: string | undefined;
  readonly onOpenAsset?:
    ((path: string, fileName?: string) => void) | undefined;
  readonly contextEntities?: readonly CaptureContextEntity[] | undefined;
}

type CaptureMode = "memo" | "todo";

interface CaptureDraft {
  readonly mode: CaptureMode;
  readonly title: string;
  readonly body: string;
  readonly contextId: string | null;
  readonly contextTargetId: string | null;
  readonly attachments: readonly PkmAsset[];
}

const isStoredAsset = (value: unknown): value is PkmAsset => {
  if (typeof value !== "object" || value === null) return false;
  const asset = value as Record<string, unknown>;
  return (
    typeof asset.path === "string" &&
    assetPathFromMarkdownUrl(asset.path) !== null &&
    typeof asset.fileName === "string" &&
    typeof asset.mimeType === "string" &&
    typeof asset.size === "number"
  );
};

const readCaptureDraft = (storageKey: string | undefined): CaptureDraft => {
  const empty: CaptureDraft = {
    mode: "memo",
    title: "",
    body: "",
    contextId: null,
    contextTargetId: null,
    attachments: [],
  };
  if (storageKey === undefined || typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return empty;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return empty;
    const draft = value as Record<string, unknown>;
    if (
      (draft.mode !== "memo" && draft.mode !== "todo") ||
      typeof draft.title !== "string" ||
      typeof draft.body !== "string"
    )
      return empty;
    return {
      mode: draft.mode,
      title: draft.title,
      body: draft.body,
      contextId: typeof draft.contextId === "string" ? draft.contextId : null,
      contextTargetId:
        typeof draft.contextTargetId === "string"
          ? draft.contextTargetId
          : null,
      attachments: Array.isArray(draft.attachments)
        ? (draft.attachments as unknown[]).filter(isStoredAsset)
        : [],
    };
  } catch {
    return empty;
  }
};

export const removeTrailingEmptyTodoItem = (body: string): string =>
  body.replace(/(?:\n)?- \[ \] $/, "");

export const hasCaptureContent = (body: string): boolean =>
  body.replace(/^\s*- \[ \]\s*/gm, "").trim().length > 0;

export const QuickCaptureComposer = ({
  onCapture,
  onSaved,
  autoFocus = false,
  compact = false,
  storageKey,
  onUploadAsset,
  assetBaseUrl,
  onOpenAsset,
  contextEntities = [],
  currentContext,
  defaultCurrentContext = false,
}: QuickCaptureComposerProps): React.JSX.Element => {
  const bodyEditor = useRef<MarkdownBodyEditorHandle | null>(null);
  const mobile = useMobileLayout();
  const querySource = useContext(EntityQueryContext);
  const [initialDraft] = useState(() => readCaptureDraft(storageKey));
  const [mode, setMode] = useState<CaptureMode>(
    markdownTodos(initialDraft.body).length > 0 ? "todo" : "memo",
  );
  const [title, setTitle] = useState(initialDraft.title);
  const [titleExpanded, setTitleExpanded] = useState(initialDraft.title !== "");
  const [body, setBody] = useState(initialDraft.body);
  const hasInitialContent =
    initialDraft.body !== "" ||
    initialDraft.title !== "" ||
    initialDraft.attachments.length > 0;
  const defaultContextId = defaultCurrentContext
    ? (currentContext?.id ?? null)
    : null;
  const [contextTargetId, setContextTargetId] = useState(
    initialDraft.contextTargetId ?? initialDraft.contextId ?? defaultContextId,
  );
  const [contextEnabled, setContextEnabled] = useState(
    hasInitialContent
      ? initialDraft.contextId !== null
      : defaultContextId !== null,
  );
  const contextId = contextEnabled ? contextTargetId : null;
  const [resolvedContext, setResolvedContext] =
    useState<CaptureContextEntity | null>(null);
  const [choosingContext, setChoosingContext] = useState(false);
  const [contextType, setContextType] = useState<EntityType | "all">("all");
  const [attachments, setAttachments] = useState(initialDraft.attachments);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusAtEndToken, setFocusAtEndToken] = useState<number>();
  useEffect(() => {
    if (
      !querySource ||
      !contextTargetId ||
      contextEntities.some(
        (entity) => entity.id === contextTargetId && entity.displayName?.trim(),
      ) ||
      (currentContext?.id === contextTargetId &&
        currentContext.displayName?.trim())
    )
      return;
    const controller = new AbortController();
    void querySource
      .query({ ids: [contextTargetId], limit: 1 }, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted)
          setResolvedContext(page.items[0] ?? null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [querySource, contextTargetId, contextEntities, currentContext]);
  const contexts = useMemo(
    () =>
      captureContextOptions(
        currentContext &&
          !contextEntities.some((entity) => entity.id === currentContext.id)
          ? [...contextEntities, currentContext]
          : contextEntities,
      ),
    [contextEntities, currentContext],
  );
  const contextById = useMemo(
    () => new Map(contexts.map((context) => [context.id, context])),
    [contexts],
  );

  useEffect(() => {
    if (!autoFocus) return;
    if (!hasCaptureContent(body) && title === "" && attachments.length === 0) {
      setContextTargetId(defaultContextId);
      setContextEnabled(defaultContextId !== null);
    }
    setFocusAtEndToken((current) => (current ?? 0) + 1);
  }, [autoFocus]);

  useEffect(() => {
    if (storageKey === undefined) return;
    try {
      if (
        mode === "memo" &&
        title === "" &&
        body === "" &&
        attachments.length === 0
      ) {
        window.localStorage.removeItem(storageKey);
      } else {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            mode,
            title,
            body,
            contextId,
            contextTargetId,
            attachments,
          }),
        );
      }
    } catch {
      // Capture remains usable even when browser storage is unavailable.
    }
  }, [attachments, body, contextId, contextTargetId, mode, storageKey, title]);

  const uploadAsset = async (
    file: File,
    source?: AssetUploadSource,
  ): Promise<PkmAsset> => {
    if (onUploadAsset === undefined)
      throw new Error("添付ファイルを保存できません。");
    setUploading(true);
    try {
      return await onUploadAsset(file, source);
    } finally {
      setUploading(false);
    }
  };

  const chooseFiles = async (files: readonly File[]): Promise<void> => {
    setError(null);
    try {
      for (const file of files) {
        const asset = await uploadAsset(file);
        setAttachments((current) => [...current, asset]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const focusBody = (): void => {
    if (mobile) return;
    setFocusAtEndToken((current) => (current ?? 0) + 1);
  };

  const changeMode = (value: string): void => {
    if (value !== "memo" && value !== "todo") return;
    if (!bodyEditor.current?.setChecklist(value === "todo")) return;
    setMode(value);
  };

  const submit = async (): Promise<void> => {
    if (saving || uploading) return;
    if (!title.trim() && !hasCaptureContent(body) && attachments.length === 0)
      return;
    if (
      querySource === null &&
      contextId !== null &&
      !contextById.has(contextId)
    ) {
      setError("選択したContextが見つかりません。候補を選び直してください。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCapture({
        title: title.trim() || null,
        body: composeCaptureBody(body, attachments),
        contextId,
      });
      setMode("memo");
      setTitle("");
      setTitleExpanded(false);
      setBody("");
      setContextTargetId(defaultContextId);
      setContextEnabled(defaultContextId !== null);
      setChoosingContext(false);
      setAttachments([]);
      if (storageKey !== undefined) {
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          // A completed capture must not be reported as failed for this.
        }
      }
      onSaved?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const toggleContextChooser = (): void => {
    if (!choosingContext) setContextType("all");
    if (mobile && document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    setChoosingContext((current) => !current);
  };
  const changeContextType = (value: string | null): void => {
    if (value === null || value === "all" || isEntityType(value))
      setContextType(value ?? "all");
  };
  const contextPicker = (
    <Stack gap="xs" className="quick-capture-context-picker">
      {mobile && (
        <Group justify="space-between">
          <Text size="sm">Context</Text>
          <Button
            type="button"
            size="xs"
            variant="subtle"
            onClick={() => setChoosingContext(false)}
          >
            記録に戻る
          </Button>
        </Group>
      )}
      {mobile ? (
        <NativeSelect
          aria-label="Contextの種別"
          size="xs"
          data={[
            { value: "all", label: "すべての種別" },
            ...ENTITY_TYPE_OPTIONS.filter((option) => option.value !== "entry"),
          ]}
          value={contextType}
          onChange={(event) => changeContextType(event.currentTarget.value)}
          disabled={saving}
        />
      ) : (
        <Select
          aria-label="Contextの種別"
          size="xs"
          data={[
            { value: "all", label: "すべての種別" },
            ...ENTITY_TYPE_OPTIONS.filter((option) => option.value !== "entry"),
          ]}
          value={contextType}
          onChange={changeContextType}
          comboboxProps={{ withinPortal: false }}
          disabled={saving}
        />
      )}
      <EntitySelect
        entityType={
          contextType === "all"
            ? ["area", "project", "task", "resource", "topic"]
            : contextType
        }
        aria-label="Contextを検索"
        placeholder={`${contextType === "all" ? "Context" : (ENTITY_TYPE_OPTIONS.find((option) => option.value === contextType)?.label ?? "Context")}を検索…`}
        searchable
        clearable
        openOnFocus={false}
        maxDropdownHeight={mobile ? "min(160px, 28svh)" : 250}
        styles={{ dropdown: { position: "static", width: "100%" } }}
        comboboxProps={{
          withinPortal: false,
          middlewares: { flip: false, shift: false, size: false },
        }}
        limit={10}
        data={contexts
          .filter(
            (context) => contextType === "all" || context.type === contextType,
          )
          .map((context) => ({
            value: context.id,
            label: context.displayName?.trim() || context.id,
          }))}
        value={
          contextType === "all" ||
          (contextById.get(contextTargetId ?? "")?.type ??
            resolvedContext?.type) === contextType
            ? contextTargetId
            : null
        }
        onChange={(value) => {
          setContextTargetId(value);
          setContextEnabled(value !== null);
          setChoosingContext(false);
          focusBody();
        }}
        nothingFoundMessage="候補がありません"
        disabled={saving}
        renderOption={({ option }) => {
          const context = contextById.get(option.value);
          return (
            <Group gap="xs" wrap="nowrap">
              <EntityIcon type={context?.type ?? ""} />
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text size="sm" truncate>
                  {option.label}
                </Text>
                {context?.hierarchy && (
                  <Text size="xs" c="dimmed" truncate>
                    {context.hierarchy}
                  </Text>
                )}
              </Stack>
            </Group>
          );
        }}
      />
    </Stack>
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
        event.preventDefault();
        void submit();
      }}
    >
      <Stack
        gap="sm"
        className="quick-capture-composer"
        data-choosing-context={(mobile && choosingContext) || undefined}
      >
        <MarkdownLiveEditor
          onReady={(editor) => {
            bodyEditor.current = editor;
          }}
          ariaLabel="Quick Capture本文エディタ"
          className={`quick-capture-body-editor${compact ? " compact" : ""}`}
          placeholder="ここに記録する（URLも貼り付けられます）"
          value={body}
          onChange={(nextBody) => {
            setBody(nextBody);
            setMode(markdownTodos(nextBody).length > 0 ? "todo" : "memo");
          }}
          readOnly={saving}
          focusAtEndToken={focusAtEndToken}
          onUploadAsset={onUploadAsset === undefined ? undefined : uploadAsset}
          onAssetUploaded={(asset) =>
            setAttachments((current) => [...current, asset])
          }
          assetBaseUrl={assetBaseUrl}
          onOpenAsset={onOpenAsset}
          hideAttachmentControls
          hideReferencedAssetList
          showImagePreview={false}
        />
        <LinkPreviews body={body} />
        <Group
          gap="xs"
          align="center"
          wrap="wrap"
          className="quick-capture-tools"
        >
          <SegmentedControl
            aria-label="入力種別"
            size="xs"
            data={[
              { value: "memo", label: "メモ" },
              { value: "todo", label: "チェックリスト" },
            ]}
            value={mode}
            onChange={changeMode}
          />
          {onUploadAsset !== undefined && (
            <>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                aria-label="添付ファイルを選択"
                onChange={(event) => {
                  const files = [...(event.currentTarget.files ?? [])];
                  event.currentTarget.value = "";
                  void chooseFiles(files);
                }}
              />
              <ActionIcon
                type="button"
                aria-label="ファイルを添付"
                title="ファイルを添付（貼り付け・ドロップにも対応）"
                size="sm"
                variant="subtle"
                color="gray"
                loading={uploading}
                disabled={saving}
                onClick={() => fileInput.current?.click()}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m21.4 11.6-8.6 8.6a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7L9.9 17.4a2 2 0 0 1-2.8-2.8l8.5-8.5" />
                </svg>
              </ActionIcon>
            </>
          )}
          {titleExpanded ? (
            <TextInput
              aria-label="タイトル（任意）"
              placeholder="タイトル"
              size="xs"
              autoFocus
              className="quick-capture-title"
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
              disabled={saving}
              onBlur={() => {
                if (title === "") setTitleExpanded(false);
              }}
            />
          ) : (
            <Button
              type="button"
              variant="subtle"
              color="gray"
              size="xs"
              disabled={saving}
              onClick={() => setTitleExpanded(true)}
            >
              ＋ タイトルを追加
            </Button>
          )}
        </Group>
        <Group gap={0} wrap="nowrap" className="quick-capture-context">
          <Button
            type="button"
            size="xs"
            variant={contextEnabled ? "light" : "subtle"}
            aria-label="Contextを切り替え"
            aria-pressed={contextEnabled}
            disabled={saving}
            onClick={() => {
              if (contextTargetId === null) {
                toggleContextChooser();
                return;
              }
              setContextEnabled((enabled) => !enabled);
              focusBody();
            }}
          >
            <Text size="xs" truncate>
              {contextEnabled ? "✓" : "○"}{" "}
              {contextTargetId === null
                ? "所属なし"
                : (contextById.get(contextTargetId)?.displayName ??
                  (resolvedContext?.id === contextTargetId
                    ? resolvedContext.displayName
                    : null) ??
                  "選択中のContext")}
            </Text>
          </Button>
          {mobile ? (
            <ActionIcon
              type="button"
              size="sm"
              variant="subtle"
              disabled={saving}
              aria-label="記録先を変更"
              aria-expanded={choosingContext}
              onClick={toggleContextChooser}
            >
              ⌄
            </ActionIcon>
          ) : (
            <Popover
              opened={choosingContext}
              onChange={setChoosingContext}
              position="bottom-start"
              width="min(360px, calc(100vw - 48px))"
              withinPortal={false}
            >
              <Popover.Target>
                <ActionIcon
                  type="button"
                  size="sm"
                  variant="subtle"
                  disabled={saving}
                  aria-label="記録先を変更"
                  aria-expanded={choosingContext}
                  onClick={toggleContextChooser}
                >
                  ⌄
                </ActionIcon>
              </Popover.Target>
              <Popover.Dropdown>{contextPicker}</Popover.Dropdown>
            </Popover>
          )}
        </Group>
        {mobile && choosingContext && contextPicker}
        {attachments.length > 0 && (
          <Pill.Group className="quick-capture-attachments">
            {attachments.map((asset) => (
              <Pill
                key={asset.path}
                size="sm"
                withRemoveButton={!saving}
                onRemove={() =>
                  setAttachments((current) =>
                    current.filter((item) => item.path !== asset.path),
                  )
                }
                title={asset.fileName}
              >
                {asset.fileName}
              </Pill>
            ))}
          </Pill.Group>
        )}
        {error !== null && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button
            type="submit"
            loading={saving}
            disabled={
              (!title.trim() &&
                !hasCaptureContent(body) &&
                attachments.length === 0) ||
              uploading
            }
          >
            保存
          </Button>
        </Group>
      </Stack>
    </form>
  );
};

export const QuickCaptureDialog = ({
  opened,
  onClose,
  onCapture,
  onUploadAsset,
  assetBaseUrl,
  onOpenAsset,
  contextEntities,
  currentContext,
  storageKey,
  defaultCurrentContext,
}: QuickCaptureDialogProps): React.JSX.Element => {
  const content = useRef<HTMLDivElement>(null);
  const mobile = useMobileLayout();
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      aria-label="クイックメモ"
      classNames={{
        content: "quick-capture-dialog",
        body: "quick-capture-dialog-body",
      }}
      onEnterTransitionEnd={() => {
        if (!mobile || document.activeElement === content.current)
          content.current
            ?.querySelector<HTMLElement>(".cm-content")
            ?.focus({ preventScroll: true });
      }}
      yOffset={mobile ? "8px" : "3dvh"}
      withCloseButton={false}
      size="min(1100px, 96vw)"
      closeOnClickOutside
      centered={!mobile}
      keepMounted
    >
      <div
        ref={content}
        className="quick-capture-dialog-content"
        tabIndex={mobile ? -1 : undefined}
        data-autofocus={mobile || undefined}
      >
        <QuickCaptureComposer
          key={storageKey}
          onCapture={onCapture}
          onUploadAsset={onUploadAsset}
          assetBaseUrl={assetBaseUrl}
          onOpenAsset={onOpenAsset}
          contextEntities={contextEntities}
          currentContext={currentContext}
          defaultCurrentContext={defaultCurrentContext ?? false}
          storageKey={storageKey}
          onSaved={onClose}
          autoFocus={opened}
        />
      </div>
    </Modal>
  );
};
