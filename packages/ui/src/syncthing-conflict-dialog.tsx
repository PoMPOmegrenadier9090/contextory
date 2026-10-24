import {
  Alert,
  Button,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import type {
  PkmClient,
  PkmFileHash,
  PkmResolvedSyncthingConflict,
  PkmSyncthingConflictDocument,
  PkmSyncthingConflictSummary,
} from "@pkm/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

type Resolution = PkmResolvedSyncthingConflict["resolution"];
type DraftState = "idle" | "dirty" | "saving" | "saved";

interface DraftBase {
  readonly canonicalHash: PkmFileHash | null;
  readonly conflictHash: PkmFileHash;
}

export interface SyncthingConflictDialogProps {
  readonly client: Pick<
    PkmClient,
    | "loadSyncthingConflict"
    | "saveSyncthingConflictDraft"
    | "discardSyncthingConflictDraft"
    | "resolveSyncthingConflict"
  >;
  readonly conflicts: readonly PkmSyncthingConflictSummary[];
  readonly opened: boolean;
  readonly readOnly: boolean;
  readonly onClose: () => void;
  readonly onResolved: (result: PkmResolvedSyncthingConflict) => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onError: (message: string) => void;
}

const messageForError = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

export const SyncthingConflictDialog = ({
  client,
  conflicts,
  opened,
  readOnly,
  onClose,
  onResolved,
  onRefresh,
  onError,
}: SyncthingConflictDialogProps): React.JSX.Element => {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [document, setDocument] = useState<PkmSyncthingConflictDocument | null>(
    null,
  );
  const [manualContent, setManualContent] = useState("");
  const [manualBase, setManualBase] = useState<DraftBase | null>(null);
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const [resolving, setResolving] = useState<Resolution | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editVersion = useRef(0);

  const load = useCallback(
    async (path: string): Promise<void> => {
      try {
        const next = await client.loadSyncthingConflict(path);
        setDocument(next);
        setManualContent(
          next.draft?.content ??
            next.canonical?.content ??
            next.conflicting.content,
        );
        setManualBase({
          canonicalHash:
            next.draft === null
              ? (next.canonical?.hash ?? null)
              : next.draft.canonicalHash,
          conflictHash:
            next.draft === null
              ? next.conflicting.hash
              : next.draft.conflictHash,
        });
        setDraftState(next.draft === null ? "idle" : "saved");
        editVersion.current += 1;
        setNotice(null);
      } catch (reason) {
        onError(messageForError(reason));
      }
    },
    [client, onError],
  );

  const persistManualDraft = useCallback(async (): Promise<boolean> => {
    if (document === null || manualBase === null || draftState !== "dirty") {
      return true;
    }
    const version = editVersion.current;
    setDraftState("saving");
    try {
      await client.saveSyncthingConflictDraft({
        conflictPath: document.conflict.path,
        canonicalHash: manualBase.canonicalHash,
        conflictHash: manualBase.conflictHash,
        content: manualContent,
      });
      if (editVersion.current === version) setDraftState("saved");
      return true;
    } catch (reason) {
      if (editVersion.current === version) setDraftState("dirty");
      onError(messageForError(reason));
      return false;
    }
  }, [client, document, draftState, manualBase, manualContent, onError]);

  useEffect(() => {
    if (draftState !== "dirty" || resolving !== null) return;
    const timeout = window.setTimeout(() => {
      void persistManualDraft();
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [draftState, manualContent, persistManualDraft, resolving]);

  useEffect(() => {
    if (!opened || resolving !== null) return;
    const available = new Set(conflicts.map((conflict) => conflict.path));
    const nextPath =
      selectedPath !== null && available.has(selectedPath)
        ? selectedPath
        : (conflicts[0]?.path ?? null);
    setSelectedPath(nextPath);
    if (nextPath === null) {
      setDocument(null);
      return;
    }
    if (document?.conflict.path !== nextPath) void load(nextPath);
  }, [
    conflicts,
    document?.conflict.path,
    load,
    opened,
    resolving,
    selectedPath,
  ]);

  const select = async (path: string): Promise<void> => {
    if (!(await persistManualDraft())) return;
    setSelectedPath(path);
    setDocument(null);
  };

  const close = async (): Promise<void> => {
    if (!(await persistManualDraft())) return;
    onClose();
  };

  const discardManualDraft = async (): Promise<void> => {
    if (document === null) return;
    try {
      await client.discardSyncthingConflictDraft(document.conflict.path);
      editVersion.current += 1;
      setManualContent(
        document.canonical?.content ?? document.conflicting.content,
      );
      setManualBase({
        canonicalHash: document.canonical?.hash ?? null,
        conflictHash: document.conflicting.hash,
      });
      setDocument({ ...document, draft: null });
      setDraftState("idle");
      setNotice("手動マージの下書きを破棄しました。");
    } catch (reason) {
      onError(messageForError(reason));
    }
  };

  const resolve = async (resolution: Resolution): Promise<void> => {
    if (document === null) return;
    setResolving(resolution);
    setNotice(null);
    try {
      const result = await client.resolveSyncthingConflict({
        conflictPath: document.conflict.path,
        resolution,
        expectedCanonicalHash: document.canonical?.hash ?? null,
        expectedConflictHash: document.conflicting.hash,
        ...(resolution === "manual" ? { content: manualContent } : {}),
      });
      if (!result.ok) {
        if (result.current === null) {
          setDocument(null);
          setSelectedPath(null);
          setNotice("競合コピーは別の操作で解決されました。");
          await onRefresh();
        } else {
          setDocument(result.current);
          setNotice(
            "比較中にファイルが変更されました。手動マージの下書きは保持しています。最新の両版を確認してください。",
          );
        }
        return;
      }
      setDocument(null);
      setSelectedPath(null);
      setDraftState("idle");
      await onResolved(result);
    } catch (reason) {
      onError(messageForError(reason));
    } finally {
      setResolving(null);
    }
  };

  const actionsDisabled =
    readOnly || resolving !== null || draftState === "saving";

  return (
    <Modal
      opened={opened}
      onClose={() => void close()}
      size="min(1320px, 96vw)"
      title={`同期競合を解決 (${conflicts.length})`}
    >
      <Stack>
        {readOnly && (
          <Alert color="yellow">
            このVaultは読み取り専用のため、競合を解決できません。
          </Alert>
        )}
        {notice !== null && <Alert color="orange">{notice}</Alert>}
        {conflicts.length === 0 ? (
          <Text c="dimmed">未解決の同期競合はありません。</Text>
        ) : (
          <Group align="flex-start" wrap="nowrap">
            <ScrollArea h={560} w={260} type="auto">
              <Stack gap={4} pr="sm">
                {conflicts.map((conflict) => (
                  <button
                    className="sync-conflict-list-item"
                    data-active={selectedPath === conflict.path || undefined}
                    key={conflict.path}
                    onClick={() => void select(conflict.path)}
                    type="button"
                  >
                    <span>
                      {conflict.canonicalDisplayName ??
                        conflict.canonicalEntityId ??
                        conflict.canonicalEntityPath}
                    </span>
                    <small>{conflict.path}</small>
                  </button>
                ))}
              </Stack>
            </ScrollArea>
            <Stack className="sync-conflict-detail" flex={1}>
              {document === null ? (
                <Text c="dimmed">競合内容を読み込んでいます。</Text>
              ) : (
                <>
                  <div className="conflict-grid">
                    <section className="conflict-version">
                      <Text fw={600} mb="xs">
                        正本（現在のVault）
                      </Text>
                      <ScrollArea h={260} type="always" offsetScrollbars>
                        <pre>
                          {document.canonical?.content ??
                            "（正本は削除されています）"}
                        </pre>
                      </ScrollArea>
                    </section>
                    <section className="conflict-version">
                      <Text fw={600} mb="xs">
                        Syncthing競合版
                      </Text>
                      <ScrollArea h={260} type="always" offsetScrollbars>
                        <pre>{document.conflicting.content}</pre>
                      </ScrollArea>
                    </section>
                  </div>
                  <Textarea
                    label="手動マージ版"
                    description={
                      draftState === "saving"
                        ? "下書きを保存しています…"
                        : draftState === "saved"
                          ? "下書きはこの端末に保存されています。"
                          : "入力内容はこの端末へ自動保存されます。"
                    }
                    value={manualContent}
                    onChange={(event) => {
                      editVersion.current += 1;
                      setManualContent(event.currentTarget.value);
                      setDraftState("dirty");
                    }}
                    disabled={actionsDisabled}
                    autosize
                    minRows={8}
                    maxRows={16}
                    styles={{
                      input: {
                        fontFamily: "var(--mantine-font-family-monospace)",
                      },
                    }}
                  />
                  {manualBase !== null &&
                    (manualBase.canonicalHash !==
                      (document.canonical?.hash ?? null) ||
                      manualBase.conflictHash !==
                        document.conflicting.hash) && (
                      <Alert color="orange">
                        この下書きは変更前の版を基にしています。最新の両版との差分を確認してから保存してください。
                      </Alert>
                    )}
                  <Group justify="flex-end">
                    <Button
                      variant="subtle"
                      color="gray"
                      disabled={
                        actionsDisabled ||
                        (draftState === "idle" && document.draft === null)
                      }
                      onClick={() => void discardManualDraft()}
                    >
                      下書きを破棄
                    </Button>
                    <Button
                      color="red"
                      variant="light"
                      disabled={actionsDisabled}
                      loading={resolving === "keep-canonical"}
                      onClick={() => void resolve("keep-canonical")}
                    >
                      正本を採用
                    </Button>
                    <Button
                      variant="light"
                      disabled={actionsDisabled}
                      loading={resolving === "keep-conflict"}
                      onClick={() => void resolve("keep-conflict")}
                    >
                      競合版を採用
                    </Button>
                    <Button
                      disabled={actionsDisabled}
                      loading={resolving === "manual"}
                      onClick={() => void resolve("manual")}
                    >
                      手動マージ版を保存
                    </Button>
                  </Group>
                </>
              )}
            </Stack>
          </Group>
        )}
      </Stack>
    </Modal>
  );
};
