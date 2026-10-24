import { workStatusRank, workPriorityRank } from "@pkm/contracts";
import { useStoredViewState } from "./stored-view-state.js";
import { EntityRelationReason } from "./entity-relation-reason.js";
import { ResourcePropertyCell } from "./resource-properties.js";
import { SourceLink, sourceWebUrl } from "./source-link.js";
import { isComposingKey } from "./input-keyboard.js";
import { EntitySelect } from "./entity-query-context.js";
import { TaskDeadlineInput } from "./task-deadline-input.js";
import { formatDeadline, deadlineInputValue } from "./task-deadline.js";
import {
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  RESOURCE_TYPE_OPTIONS,
} from "./entity-options.js";
import {
  ActionIcon,
  SegmentedControl,
  Group,
  Menu,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { EntityTopicsCell } from "./entity-topics-cell.js";
import { useMobileLayout } from "./device-local-ui.js";
import { EntityIcon } from "./entity-icon.js";
import { EntityStatusLight, EntityStatusLabel } from "./entity-status.js";
import { EntityDeleteConfirmation } from "./entity-delete.js";
import { entityUiTitle, entryBodyPreview } from "./entity-label.js";
import type { HierarchyEntityPatch } from "./entity-actions.js";
import type { PkmEntitySummary } from "@pkm/contracts";

export type EntityTableColumnKind =
  | "workflow"
  | "resourceType"
  | "pin"
  | "name"
  | "status"
  | "priority"
  | "dueAt"
  | "project"
  | "area"
  | "topics"
  | "origin"
  | "authors"
  | "relatedEntities"
  | "relation"
  | "canonicalIdentifier"
  | "sourceUri"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "actions";

export interface EntityTableColumnDefinition {
  readonly kind: EntityTableColumnKind;
  readonly label: string;
  readonly editable?: boolean;
  readonly showEntityType?: boolean;
  readonly width?: number;
}

const COLUMN_WIDTHS: Readonly<Record<EntityTableColumnKind, number>> = {
  workflow: 120,
  resourceType: 130,
  pin: 42,
  name: 280,
  status: 120,
  priority: 100,
  dueAt: 175,
  project: 170,
  area: 160,
  topics: 220,
  origin: 100,
  authors: 200,
  relatedEntities: 240,
  relation: 230,
  canonicalIdentifier: 200,
  sourceUri: 220,
  createdAt: 125,
  updatedAt: 125,
  deletedAt: 125,
  actions: 100,
};

export interface EntityDataTableProps {
  readonly storageKey?: string | undefined;
  readonly remoteSort?:
    | {
        readonly key: EntityTableColumnKind;
        readonly direction: "asc" | "desc";
        readonly onChange: (
          key: EntityTableColumnKind,
          direction: "asc" | "desc",
        ) => void;
      }
    | undefined;
  readonly initialView?: "list" | "table" | undefined;
  readonly showViewControl?: boolean | undefined;
  readonly entities: readonly PkmEntitySummary[];
  readonly allEntities: readonly PkmEntitySummary[];
  readonly columns: readonly EntityTableColumnDefinition[];
  readonly pinnedIds?: ReadonlySet<string> | undefined;
  readonly readOnly?: boolean | undefined;
  readonly emptyMessage?: string | undefined;
  readonly initialSort?:
    | {
        readonly key: EntityTableColumnKind;
        readonly direction: "asc" | "desc";
      }
    | undefined;
  readonly onOpenEntity?: ((entityId: string) => void) | undefined;
  readonly renderRowActions?:
    ((entity: PkmEntitySummary) => ReactNode) | undefined;
  readonly onTogglePinned?: ((entityId: string) => void) | undefined;
  readonly onUpdateEntity?:
    | ((entityId: string, patch: HierarchyEntityPatch) => Promise<void>)
    | undefined;
  readonly onUpdateTopics?:
    | ((entityId: string, topicNames: readonly string[]) => Promise<void>)
    | undefined;
  readonly onDeleteEntity?: ((entityId: string) => Promise<void>) | undefined;
  readonly onUpdateError?: ((reason: unknown) => void) | undefined;
}

const optionLabel = (
  options: readonly { readonly value: string; readonly label: string }[],
  value: string | null,
): string =>
  value === null
    ? "—"
    : (options.find((option) => option.value === value)?.label ?? value);

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

const textValue = (value: string | null | undefined): string => value ?? "";

const optionsFor = (
  entities: readonly PkmEntitySummary[],
  type: string,
): readonly { readonly value: string; readonly label: string }[] =>
  entities
    .filter((entity) => entity.type === type)
    .map((entity) => ({
      value: entity.id,
      label: entity.displayName ?? entity.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ja"));

const effectiveAreaId = (
  entity: PkmEntitySummary,
  byId: ReadonlyMap<string, PkmEntitySummary>,
): string | null =>
  entity.areaId ??
  (entity.projectId === null
    ? null
    : (byId.get(entity.projectId)?.areaId ?? null));

const sortValue = (
  entity: PkmEntitySummary,
  column: EntityTableColumnKind,
  byId: ReadonlyMap<string, PkmEntitySummary>,
): string => {
  switch (column) {
    case "pin":
    case "relation":
      return "";
    case "name":
      return entity.type === "entry" && entity.displayName === null
        ? entity.createdAt
        : (entity.displayName ?? entity.id);
    case "workflow":
      return `${workStatusRank(entity.status)}:${workPriorityRank(entity.priority)}`;
    case "resourceType":
      return entity.resourceType ?? "";
    case "status":
      return String(workStatusRank(entity.status));
    case "priority":
      return String(workPriorityRank(entity.priority));
    case "dueAt":
      return deadlineInputValue(entity.dueAt);
    case "project":
      return textValue(
        entity.projectId === null
          ? null
          : byId.get(entity.projectId)?.displayName,
      );
    case "area": {
      const areaId = effectiveAreaId(entity, byId);
      return textValue(areaId === null ? null : byId.get(areaId)?.displayName);
    }
    case "topics":
      return entity.topicIds
        .map((id) => byId.get(id)?.displayName ?? id)
        .join(" ");
    case "origin":
      return textValue(entity.origin);
    case "authors":
      return (entity.authors ?? []).join(" ");
    case "relatedEntities":
      return (entity.relatedEntityIds ?? [])
        .map((id) => byId.get(id)?.displayName ?? id)
        .join(" ");
    case "canonicalIdentifier":
      return textValue(entity.canonicalIdentifier);
    case "sourceUri":
      return textValue(entity.sourceUri);
    case "createdAt":
      return entity.createdAt;
    case "updatedAt":
      return entity.updatedAt;
    case "deletedAt":
      return entity.deletedAt ?? "";
    case "actions":
      return "";
  }
};

interface EditableTextCellProps {
  readonly ariaLabel: string;
  readonly value: string | null;
  readonly placeholder?: string;
  readonly link?: boolean;
  readonly disabled: boolean;
  readonly onCommit: (value: string | null) => void;
}

const EditableTextCell = ({
  ariaLabel,
  value,
  placeholder = "—",
  link = false,
  disabled,
  onCommit,
}: EditableTextCellProps): React.JSX.Element => {
  const [draft, setDraft] = useState(value ?? "");
  const cancelBlur = useRef(false);
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = (): void => {
    if (cancelBlur.current) {
      cancelBlur.current = false;
      return;
    }
    const next = draft.trim();
    const normalized = next.length === 0 ? null : next;
    if (normalized !== value) onCommit(normalized);
  };
  return (
    <TextInput
      aria-label={ariaLabel}
      className="entity-collection-cell-control"
      disabled={disabled}
      placeholder={placeholder}
      rightSection={link ? <SourceLink value={draft} /> : undefined}
      rightSectionPointerEvents="all"
      variant="unstyled"
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (isComposingKey(event.nativeEvent)) return;
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelBlur.current = true;
          setDraft(value ?? "");
          event.currentTarget.blur();
        }
      }}
    />
  );
};

interface EntityNameCellProps {
  readonly entity: PkmEntitySummary;
  readonly editable: boolean;
  readonly showEntityType: boolean;
  readonly onOpen?: (() => void) | undefined;
  readonly onCommit: (value: string) => void;
  readonly onRequestDelete?: (() => void) | undefined;
}

const EntityNameCell = ({
  entity,
  editable,
  showEntityType,
  onOpen,
  onCommit,
  onRequestDelete,
}: EntityNameCellProps): React.JSX.Element => {
  const currentName = entityUiTitle(entity);
  const preview = entryBodyPreview(entity);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentName);
  const [contextMenuOpened, setContextMenuOpened] = useState(false);
  useEffect(() => setDraft(currentName), [currentName]);

  const finishEditing = (save: boolean): void => {
    const next = draft.trim();
    setEditing(false);
    if (save && next.length > 0 && next !== currentName) onCommit(next);
    else setDraft(currentName);
  };

  if (editing) {
    return (
      <TextInput
        aria-label={`${currentName}の名前`}
        autoFocus
        className="entity-collection-cell-control entity-collection-name-editor"
        value={draft}
        variant="unstyled"
        onBlur={() => finishEditing(true)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (isComposingKey(event.nativeEvent)) return;
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") finishEditing(false);
        }}
      />
    );
  }

  return (
    <Menu
      opened={contextMenuOpened}
      position="bottom-start"
      shadow="md"
      withinPortal
      onChange={setContextMenuOpened}
    >
      <Menu.Target>
        <Group
          className="entity-collection-name-cell"
          gap={4}
          wrap="nowrap"
          onContextMenu={(event) => {
            if (onRequestDelete === undefined) return;
            event.preventDefault();
            setContextMenuOpened(true);
          }}
        >
          {showEntityType && (
            <EntityIcon type={entity.type} status={entity.status} />
          )}
          <Stack gap={0}>
            {onOpen === undefined ? (
              <Text
                className="entity-collection-title"
                component="span"
                title={currentName}
              >
                {currentName}
              </Text>
            ) : (
              <button
                className="entity-collection-title"
                title={currentName}
                type="button"
                data-open-entity={entity.id}
                onClick={onOpen}
              >
                {currentName}
              </button>
            )}
            {preview !== null && (
              <Text c="dimmed" size="xs" lineClamp={1}>
                {preview}
              </Text>
            )}
          </Stack>
          {editable && (
            <ActionIcon
              aria-label={`${currentName}の名前を編集`}
              className="entity-collection-name-edit"
              size="sm"
              variant="subtle"
              onClick={() => setEditing(true)}
            >
              ✎
            </ActionIcon>
          )}
        </Group>
      </Menu.Target>
      {onRequestDelete !== undefined && (
        <Menu.Dropdown>
          <Menu.Item
            color="red"
            onClick={() => {
              setContextMenuOpened(false);
              onRequestDelete();
            }}
          >
            削除…
          </Menu.Item>
        </Menu.Dropdown>
      )}
    </Menu>
  );
};

export const EntityDataTable = ({
  storageKey,
  remoteSort,
  initialView = "table",
  showViewControl = true,
  entities,
  allEntities,
  columns,
  pinnedIds = new Set(),
  readOnly = false,
  emptyMessage = "該当するEntityはありません。",
  initialSort,
  onOpenEntity,
  renderRowActions,
  onTogglePinned,
  onUpdateEntity,
  onUpdateTopics,
  onDeleteEntity,
  onUpdateError,
}: EntityDataTableProps): React.JSX.Element => {
  const [view, setView] = useStoredViewState<"list" | "table">(
    storageKey,
    "layout",
    initialView,
    (v) => v === "list" || v === "table",
  );
  const mobile = useMobileLayout();
  const effectiveView = mobile && initialView === "list" ? "list" : view;
  const initialSortKey =
    initialSort !== undefined &&
    (initialSort.key === "workflow" ||
      columns.some((column) => column.kind === initialSort.key))
      ? initialSort.key
      : columns.find((column) => column.kind === "name")?.kind;
  const [sortKey, setSortKey] =
    useStoredViewState<EntityTableColumnKind | null>(
      storageKey,
      "sort",
      initialSortKey ?? null,
      (v) => v === null || (typeof v === "string" && v in COLUMN_WIDTHS),
    );
  const [sortDirection, setSortDirection] = useStoredViewState<"asc" | "desc">(
    storageKey,
    "direction",
    initialSort?.direction ?? "asc",
    (v) => v === "asc" || v === "desc",
  );
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<PkmEntitySummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const byId = useMemo(
    () => new Map(allEntities.map((entity) => [entity.id, entity])),
    [allEntities],
  );
  const areas = useMemo(() => optionsFor(allEntities, "area"), [allEntities]);
  const projects = useMemo(
    () => optionsFor(allEntities, "project"),
    [allEntities],
  );
  const topics = useMemo(() => optionsFor(allEntities, "topic"), [allEntities]);
  const sortedEntities = useMemo(() => {
    if (remoteSort !== undefined) return [...entities];
    if (sortKey === null || sortKey === "pin") return [...entities];
    return [...entities].sort((a, b) => {
      const compared = sortValue(a, sortKey, byId).localeCompare(
        sortValue(b, sortKey, byId),
        "ja",
      );
      return sortDirection === "asc" ? compared : -compared;
    });
  }, [byId, entities, sortDirection, sortKey, remoteSort]);

  useEffect(() => {
    if (
      sortKey !== null &&
      (sortKey === "workflow" ||
        columns.some((column) => column.kind === (remoteSort?.key ?? sortKey)))
    ) {
      return;
    }
    setSortKey(columns.find((column) => column.kind === "name")?.kind ?? null);
    setSortDirection("asc");
  }, [columns, sortKey]);

  const changeSort = (key: EntityTableColumnKind): void => {
    if (key === "pin" || key === "actions" || key === "relatedEntities") return;
    if (remoteSort !== undefined) {
      remoteSort.onChange(
        key,
        key === remoteSort.key && remoteSort.direction === "asc"
          ? "desc"
          : "asc",
      );
      return;
    }
    if (key === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const patchEntity = (
    entity: PkmEntitySummary,
    patch: HierarchyEntityPatch,
  ): void => {
    if (onUpdateEntity === undefined) return;
    setSavingIds((current) => new Set(current).add(entity.id));
    void onUpdateEntity(entity.id, patch)
      .catch((reason: unknown) => onUpdateError?.(reason))
      .finally(() =>
        setSavingIds((current) => {
          const next = new Set(current);
          next.delete(entity.id);
          return next;
        }),
      );
  };

  const patchTopics = (
    entity: PkmEntitySummary,
    topicNames: readonly string[],
  ): void => {
    if (onUpdateTopics === undefined) return;
    setSavingIds((current) => new Set(current).add(entity.id));
    void onUpdateTopics(entity.id, topicNames)
      .catch((reason: unknown) => onUpdateError?.(reason))
      .finally(() =>
        setSavingIds((current) => {
          const next = new Set(current);
          next.delete(entity.id);
          return next;
        }),
      );
  };

  const renderCell = (
    entity: PkmEntitySummary,
    column: EntityTableColumnDefinition,
  ): React.JSX.Element | string => {
    const saving = savingIds.has(entity.id);
    const editable =
      column.editable === true &&
      !readOnly &&
      !saving &&
      onUpdateEntity !== undefined;
    const name = entityUiTitle(entity);
    const project =
      entity.projectId === null ? null : byId.get(entity.projectId);
    const areaId = effectiveAreaId(entity, byId);
    switch (column.kind) {
      case "pin":
        return (
          <ActionIcon
            aria-label={`${name}のピンを切り替え`}
            color={pinnedIds.has(entity.id) ? "yellow" : "gray"}
            disabled={onTogglePinned === undefined}
            variant="subtle"
            onClick={() => onTogglePinned?.(entity.id)}
          >
            {pinnedIds.has(entity.id) ? "★" : "☆"}
          </ActionIcon>
        );
      case "name":
        return (
          <EntityNameCell
            entity={entity}
            editable={editable && entity.type !== "entry"}
            showEntityType={column.showEntityType !== false}
            onOpen={
              onOpenEntity === undefined
                ? undefined
                : () => onOpenEntity(entity.id)
            }
            onCommit={(value) => patchEntity(entity, { displayName: value })}
            onRequestDelete={
              readOnly || onDeleteEntity === undefined
                ? undefined
                : () => setDeleteTarget(entity)
            }
          />
        );
      case "workflow":
        return "";
      case "resourceType":
        return editable ? (
          <Select
            aria-label={`${name}の資料種別`}
            className="entity-collection-cell-control"
            data={RESOURCE_TYPE_OPTIONS}
            variant="unstyled"
            clearable
            placeholder="—"
            value={entity.resourceType ?? null}
            onChange={(value) =>
              patchEntity(entity, {
                resourceType: value,
              })
            }
          />
        ) : (
          optionLabel(RESOURCE_TYPE_OPTIONS, entity.resourceType ?? null)
        );
      case "status":
        return editable ? (
          <Select
            aria-label={`${name}のステータス`}
            leftSection={
              entity.status === "in_progress" ? (
                <EntityStatusLight status={entity.status} />
              ) : undefined
            }
            leftSectionWidth={18}
            className="entity-collection-cell-control"
            data={[...STATUS_OPTIONS]}
            variant="unstyled"
            value={entity.status}
            allowDeselect={false}
            onChange={(value) => {
              if (value !== null) patchEntity(entity, { status: value });
            }}
          />
        ) : (
          <EntityStatusLabel status={entity.status} />
        );
      case "priority":
        return editable ? (
          <Select
            aria-label={`${name}の優先度`}
            className="entity-collection-cell-control"
            data={[...PRIORITY_OPTIONS]}
            variant="unstyled"
            value={entity.priority}
            clearable
            placeholder="—"
            onChange={(value) => patchEntity(entity, { priority: value })}
          />
        ) : (
          optionLabel(PRIORITY_OPTIONS, entity.priority)
        );
      case "dueAt":
        return editable && entity.type === "task" ? (
          <TaskDeadlineInput
            compact
            ariaLabel={`${name}の期限`}
            value={entity.dueAt}
            onError={onUpdateError}
            onCommit={async (value) => {
              setSavingIds((current) => new Set(current).add(entity.id));
              try {
                await onUpdateEntity?.(entity.id, { dueAt: value });
              } finally {
                setSavingIds((current) => {
                  const next = new Set(current);
                  next.delete(entity.id);
                  return next;
                });
              }
            }}
          />
        ) : (
          formatDeadline(entity.dueAt)
        );
      case "project":
        return editable ? (
          <EntitySelect
            entityType="project"
            aria-label={`${name}のProject`}
            className="entity-collection-cell-control"
            data={projects}
            variant="unstyled"
            value={entity.projectId}
            clearable
            searchable
            placeholder="—"
            onChange={(value) => patchEntity(entity, { projectId: value })}
          />
        ) : (
          (project?.displayName ?? "—")
        );
      case "area": {
        const area = areaId === null ? null : byId.get(areaId);
        return editable && entity.projectId === null ? (
          <EntitySelect
            entityType="area"
            aria-label={`${name}のArea`}
            className="entity-collection-cell-control"
            data={areas}
            variant="unstyled"
            value={areaId}
            clearable
            searchable
            placeholder="—"
            onChange={(value) => patchEntity(entity, { areaId: value })}
          />
        ) : (
          <Text
            size="sm"
            title={
              entity.projectId === null
                ? undefined
                : `${project?.displayName ?? "Project"}のAreaを継承しています`
            }
          >
            {area?.displayName ?? "—"}
          </Text>
        );
      }
      case "topics":
        return (
          <EntityTopicsCell
            label={`${name}のTopics`}
            options={topics.map((topic) => topic.label)}
            value={entity.topicIds.map(
              (topicId) => byId.get(topicId)?.displayName ?? topicId,
            )}
            readOnly={
              column.editable !== true ||
              readOnly ||
              onUpdateTopics === undefined
            }
            disabled={saving}
            onChange={(value) => patchTopics(entity, value)}
          />
        );
      case "relation":
        return (
          <EntityRelationReason
            entity={entity}
            onOpenEntity={onOpenEntity ?? (() => undefined)}
          />
        );
      case "origin":
        return entity.origin ?? "—";
      case "authors":
      case "relatedEntities":
        return (
          <ResourcePropertyCell
            kind={column.kind}
            entity={entity}
            entities={allEntities}
            readOnly={!editable}
            disabled={saving}
            onCommit={(values) =>
              patchEntity(
                entity,
                column.kind === "authors"
                  ? { authors: values }
                  : { relatedEntityIds: values },
              )
            }
          />
        );
      case "canonicalIdentifier":
        return editable ? (
          <EditableTextCell
            ariaLabel={`${name}のCanonical ID`}
            value={entity.canonicalIdentifier}
            disabled={false}
            onCommit={(value) =>
              patchEntity(entity, { canonicalIdentifier: value })
            }
          />
        ) : (
          (entity.canonicalIdentifier ?? "—")
        );
      case "sourceUri":
        return editable ? (
          <EditableTextCell
            ariaLabel={`${name}のSource URI`}
            value={entity.sourceUri}
            link
            disabled={false}
            placeholder="https://…"
            onCommit={(value) => patchEntity(entity, { sourceUri: value })}
          />
        ) : entity.sourceUri === null ? (
          "—"
        ) : sourceWebUrl(entity.sourceUri) === null ? (
          entity.sourceUri
        ) : (
          <a href={entity.sourceUri} rel="noreferrer" target="_blank">
            {entity.sourceUri}
          </a>
        );
      case "createdAt":
        return formatDateTime(entity.createdAt);
      case "updatedAt":
        return formatDateTime(entity.updatedAt);
      case "deletedAt":
        return entity.deletedAt === null
          ? "—"
          : formatDateTime(entity.deletedAt);
      case "actions":
        return <>{renderRowActions?.(entity)}</>;
    }
  };

  const confirmDelete = (): void => {
    if (deleteTarget === null || onDeleteEntity === undefined) return;
    setDeleting(true);
    void onDeleteEntity(deleteTarget.id)
      .then(() => setDeleteTarget(null))
      .catch((reason: unknown) => onUpdateError?.(reason))
      .finally(() => setDeleting(false));
  };

  return (
    <>
      {initialView === "list" && showViewControl && (
        <Group justify="flex-end" className="entity-list-tools" gap="xs">
          <Menu withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label="一覧の並び順">
                ↕
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {columns
                .filter(
                  (column) =>
                    !["pin", "actions", "relatedEntities", "relation"].includes(
                      column.kind,
                    ),
                )
                .map((column) => (
                  <Menu.Item
                    key={column.kind}
                    onClick={() => changeSort(column.kind)}
                  >
                    {column.label}
                    {(remoteSort?.key ?? sortKey) === column.kind
                      ? (remoteSort?.direction ?? sortDirection) === "asc"
                        ? " ↑"
                        : " ↓"
                      : ""}
                  </Menu.Item>
                ))}
            </Menu.Dropdown>
          </Menu>
          <SegmentedControl
            aria-label="一覧の表示形式"
            value={view}
            onChange={(value) => setView(value)}
            data={[
              { value: "list", label: "一覧" },
              { value: "table", label: "表" },
            ]}
          />
        </Group>
      )}
      {effectiveView === "list" ? (
        <div className="entity-record-list">
          {sortedEntities.map((entity) => {
            const title = entityUiTitle(entity);
            const caption = [
              entity.status ? optionLabel(STATUS_OPTIONS, entity.status) : null,
              entity.dueAt ? formatDeadline(entity.dueAt) : null,
              entity.type === "entry"
                ? (entryBodyPreview(entity) ?? formatDateTime(entity.createdAt))
                : null,
              entity.type === "resource"
                ? (entity.canonicalIdentifier ?? entity.sourceUri)
                : null,
              entity.type === "topic"
                ? null
                : entity.status === null &&
                    entity.type !== "entry" &&
                    entity.type !== "resource"
                  ? entity.topicIds
                      .map((id) => byId.get(id)?.displayName)
                      .filter(Boolean)
                      .join(" · ")
                  : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={entity.id}
                className="entity-record"
                data-saving={savingIds.has(entity.id) || undefined}
                data-entity-status={entity.status ?? undefined}
              >
                <button
                  type="button"
                  className="entity-record-row"
                  data-open-entity={entity.id}
                  aria-label={title}
                  title={title}
                  disabled={onOpenEntity === undefined}
                  onClick={() => onOpenEntity?.(entity.id)}
                >
                  <EntityIcon type={entity.type} status={entity.status} />
                  <span className="entity-record-main">
                    <span className="entity-record-title">{title}</span>
                    {caption && (
                      <span className="entity-record-caption">
                        <EntityStatusLight status={entity.status} />
                        {caption}
                      </span>
                    )}
                  </span>
                  <span className="entity-record-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
                {renderRowActions && (
                  <div className="entity-record-actions">
                    {renderRowActions(entity)}
                  </div>
                )}
              </div>
            );
          })}
          {sortedEntities.length === 0 && (
            <Text c="dimmed" size="sm" px="md" py="lg">
              {emptyMessage}
            </Text>
          )}
        </div>
      ) : (
        <div className="entity-data-table-wrap">
          <Table
            highlightOnHover
            verticalSpacing={4}
            style={{
              minWidth: columns.reduce(
                (width, column) =>
                  width + (column.width ?? COLUMN_WIDTHS[column.kind]),
                0,
              ),
            }}
          >
            <Table.Thead>
              <Table.Tr>
                {columns.map((column) => (
                  <Table.Th
                    key={column.kind}
                    w={column.width ?? COLUMN_WIDTHS[column.kind]}
                    data-column={column.kind}
                  >
                    {column.kind === "pin" ||
                    column.kind === "actions" ||
                    column.kind === "relatedEntities" ||
                    column.kind === "relation" ? (
                      column.label
                    ) : (
                      <button
                        className="entity-collection-sort"
                        type="button"
                        onClick={() => changeSort(column.kind)}
                      >
                        {column.label}
                        {(remoteSort?.key ?? sortKey) === column.kind
                          ? (remoteSort?.direction ?? sortDirection) === "asc"
                            ? " ↑"
                            : " ↓"
                          : ""}
                      </button>
                    )}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sortedEntities.map((entity) => (
                <Table.Tr
                  key={entity.id}
                  data-saving={savingIds.has(entity.id) || undefined}
                  data-entity-status={entity.status ?? undefined}
                >
                  {columns.map((column) => (
                    <Table.Td
                      key={column.kind}
                      data-column={column.kind}
                      title={sortValue(entity, column.kind, byId)}
                    >
                      {renderCell(entity, column)}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {sortedEntities.length === 0 && (
            <Text c="dimmed" ta="center" py="xl">
              {emptyMessage}
            </Text>
          )}
        </div>
      )}
      <EntityDeleteConfirmation
        deleting={deleting}
        entityName={deleteTarget?.displayName ?? deleteTarget?.id ?? "Entity"}
        opened={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        onConfirm={confirmDelete}
      />
    </>
  );
};
