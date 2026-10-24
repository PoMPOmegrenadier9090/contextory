import { useStoredViewState } from "./stored-view-state.js";
import { EntitySelect } from "./entity-query-context.js";
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { TodoPage, TodoQuery, ToggleTodoRequest } from "@pkm/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PkmEntitySummary } from "@pkm/contracts";
import { entityUiTitle } from "./entity-label.js";
import { MarkdownBodyPreview } from "./markdown-body-preview.js";
import { buildDirectReferenceCompletionOptions } from "./reference-completion.js";

const PAGE_SIZE = 50;
const timestamp = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  dateStyle: "short",
  timeStyle: "short",
});

export interface TodoListViewProps {
  readonly storageKey?: string | undefined;
  readonly loadTodos: (
    query: TodoQuery,
    signal?: AbortSignal,
  ) => Promise<TodoPage>;
  readonly onToggleTodo: (request: ToggleTodoRequest) => Promise<void>;
  readonly onChanged: () => Promise<void>;
  readonly onOpenEntity: (id: string) => void;
  readonly entities: readonly PkmEntitySummary[];
  readonly revision: number;
  readonly readOnly?: boolean;
}

export const TodoListView = ({
  storageKey,
  loadTodos,
  onToggleTodo,
  onChanged,
  onOpenEntity,
  entities,
  revision,
  readOnly = false,
}: TodoListViewProps): React.JSX.Element => {
  const [state, setState] = useStoredViewState<NonNullable<TodoQuery["state"]>>(
    storageKey,
    "state",
    "unchecked",
    (v) => typeof v === "string" && ["unchecked", "checked", "all"].includes(v),
  );
  const [scopeId, setScopeId] = useStoredViewState<string | null>(
    storageKey,
    "scopeId",
    null,
  );
  const [scopeType, setScopeType] = useStoredViewState<NonNullable<
    TodoQuery["scopeType"]
  > | null>(
    storageKey,
    "scopeType",
    null,
    (v) =>
      v === null ||
      (typeof v === "string" &&
        ["area", "project", "task", "resource"].includes(v)),
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState<TodoPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const queryKey = JSON.stringify([
    state,
    cursors[pageIndex],
    scopeId,
    scopeType,
  ]);
  const loadedQuery = useRef<string | null>(null);
  const showLoading =
    loading && (page === null || loadedQuery.current !== queryKey);
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    setPageIndex(0);
    setCursors([undefined]);
    setReload((value) => value + 1);
  }, [revision]);
  const loadRef = useRef(loadTodos);
  loadRef.current = loadTodos;
  const scopes = entities.filter((entity) =>
    ["area", "project", "task", "resource"].includes(entity.type),
  );
  const scope = scopes.find((entity) => entity.id === scopeId);
  const referenceOptions = useMemo(
    () => buildDirectReferenceCompletionOptions(entities),
    [entities],
  );
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void loadRef
      .current(
        {
          state,
          limit: PAGE_SIZE,
          ...(cursors[pageIndex] ? { cursor: cursors[pageIndex] } : {}),
          ...(scopeId !== null && scopeType !== null
            ? { scopeId, scopeType }
            : {}),
        },
        controller.signal,
      )
      .then((result) => {
        if (!active) return;
        loadedQuery.current = queryKey;
        setPage(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          if (loadedQuery.current !== queryKey) setPage(null);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [state, pageIndex, cursors, scopeId, scopeType, reload, queryKey]);

  return (
    <Stack gap="md" pb={80} className="todo-list-view">
      <Group justify="space-between">
        <Group gap="sm">
          <Title order={2}>チェックリスト</Title>
          <Badge variant="light">
            {page ? `${page.items.length}${page.nextCursor ? "+" : ""}` : "…"}
          </Badge>
        </Group>
        <Button
          size="xs"
          variant="subtle"
          disabled={saving}
          onClick={() => {
            setError(null);
            setReload((value) => value + 1);
          }}
        >
          一覧を更新
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        Entry本文のチェックリストを一覧表示します。Task Entityとは別です。
      </Text>
      <Group gap="sm">
        <SegmentedControl
          aria-label="チェックリストの完了状態"
          disabled={saving}
          value={state}
          data={[
            { value: "unchecked", label: "未完了" },
            { value: "checked", label: "完了済み" },
            { value: "all", label: "すべて" },
          ]}
          onChange={(value) => {
            setState(value);
            setPageIndex(0);
            setCursors([undefined]);
            setError(null);
          }}
        />
        <EntitySelect
          entityType={["area", "project", "task", "resource"]}
          aria-label="チェックリストのContext"
          placeholder="すべてのContext"
          searchable
          clearable
          value={scopeId}
          disabled={saving}
          data={[
            ...(scopeId !== null && scope === undefined
              ? [{ value: scopeId, label: "削除されたContext" }]
              : []),
            ...scopes.map((entity) => ({
              value: entity.id,
              label: `${entity.type.toUpperCase()} · ${entityUiTitle(entity)}`,
            })),
          ]}
          onChange={(value) => {
            setScopeId(value);
            setScopeType(
              value === null
                ? null
                : value.startsWith("area_")
                  ? "area"
                  : value.startsWith("prj_")
                    ? "project"
                    : value.startsWith("tsk_")
                      ? "task"
                      : "resource",
            );
            setPageIndex(0);
            setCursors([undefined]);
            setError(null);
          }}
          style={{ minWidth: 240 }}
        />
      </Group>
      {error !== null && (
        <Text c="red" role="alert">
          {error}
        </Text>
      )}
      {showLoading && (
        <Text c="dimmed" role="status">
          読み込み中…
        </Text>
      )}
      {!showLoading && page?.items.length === 0 && (
        <Text c="dimmed">該当するチェックリストはありません。</Text>
      )}
      {page !== null && (
        <Stack gap="xs">
          {page.items.map((todo) => (
            <Paper withBorder p="sm" key={`${todo.entryId}:${todo.markerFrom}`}>
              <Group
                align="start"
                wrap="nowrap"
                style={{ paddingLeft: Math.min(todo.depth, 8) * 16 }}
              >
                <Checkbox
                  aria-label={`チェックリストを${todo.checked ? "未完了に戻す" : "完了にする"}`}
                  checked={todo.checked}
                  disabled={readOnly || saving || loading}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSaving(true);
                    setError(null);
                    void (async () => {
                      try {
                        await onToggleTodo({
                          entryId: todo.entryId,
                          markerFrom: todo.markerFrom,
                          expectedFileHash: todo.fileHash,
                          checked,
                        });
                        await onChanged();
                      } catch (reason) {
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : String(reason),
                        );
                      } finally {
                        setSaving(false);
                      }
                    })();
                  }}
                />
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      overflowWrap: "anywhere",
                      textDecoration: todo.checked ? "line-through" : undefined,
                      color: todo.checked
                        ? "var(--mantine-color-dimmed)"
                        : undefined,
                    }}
                  >
                    <MarkdownBodyPreview
                      body={todo.text || "（空の項目）"}
                      referenceOptions={referenceOptions}
                      onOpenEntity={onOpenEntity}
                    />
                  </div>
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    style={{ alignSelf: "flex-start", maxWidth: "100%" }}
                    disabled={saving}
                    data-open-entity={todo.entryId}
                    onClick={() => onOpenEntity(todo.entryId)}
                  >
                    {todo.entryTitle ??
                      timestamp.format(new Date(todo.createdAt))}
                  </Button>
                </Stack>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
      {page !== null && (page.items.length > 0 || pageIndex > 0) && (
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {pageIndex * PAGE_SIZE + 1}–
            {pageIndex * PAGE_SIZE + page.items.length}
          </Text>
          <Group>
            <Button
              size="xs"
              variant="default"
              disabled={loading || saving || pageIndex === 0}
              onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
            >
              前へ
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={loading || saving || page.nextCursor === null}
              onClick={() => {
                setCursors((current) => [
                  ...current.slice(0, pageIndex + 1),
                  page.nextCursor!,
                ]);
                setPageIndex(pageIndex + 1);
              }}
            >
              次へ
            </Button>
          </Group>
        </Group>
      )}
    </Stack>
  );
};
