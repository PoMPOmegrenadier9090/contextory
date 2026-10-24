import { useStoredViewState } from "./stored-view-state.js";
import type { ResourceType } from "@pkm/contracts";
import { matchesDeadlineFilter, type DeadlineFilter } from "./task-deadline.js";
import {
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  RESOURCE_TYPE_OPTIONS,
} from "./entity-options.js";
import {
  Badge,
  Button,
  Collapse,
  Group,
  MultiSelect,
  Paper,
  Select,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import type { EntityType } from "@pkm/contracts";
import { useMemo } from "react";

import {
  EntityDataTable,
  type EntityTableColumnDefinition,
} from "./entity-data-table.js";
import { EntityIcon } from "./entity-icon.js";
import type { HierarchyEntityPatch } from "./entity-actions.js";
import type { PkmEntitySummary } from "@pkm/contracts";

const TYPE_LABELS: Readonly<Record<EntityType, string>> = {
  area: "Areas",
  project: "Projects",
  task: "Tasks",
  entry: "Entries",
  topic: "Topics",
  resource: "Resources",
};

const TYPE_SINGULAR_LABELS: Readonly<Record<EntityType, string>> = {
  area: "Area",
  project: "Project",
  task: "Task",
  entry: "Entry",
  topic: "Topic",
  resource: "Resource",
};

const collectionColumns = (
  type: EntityType,
): readonly EntityTableColumnDefinition[] => {
  const columns: EntityTableColumnDefinition[] = [
    { kind: "pin", label: "Pin", width: 42 },
    {
      kind: "name",
      label: "名前",
      editable: type !== "entry",
      ...(type === "task" ? { width: 260 } : {}),
    },
  ];
  if (type === "project" || type === "task") {
    columns.push(
      { kind: "status", label: "ステータス", editable: true },
      { kind: "priority", label: "優先度", editable: true },
    );
  }
  if (type === "task") {
    columns.push(
      { kind: "dueAt", label: "期限", editable: true },
      { kind: "project", label: "Project", editable: true, width: 140 },
    );
  }
  if (type === "project" || type === "task") {
    columns.push({
      kind: "area",
      label: "Area",
      editable: true,
      ...(type === "task" ? { width: 130 } : {}),
    });
  }
  if (type === "resource") {
    columns.push(
      { kind: "resourceType", label: "資料種別", editable: true },
      { kind: "authors", label: "著者", editable: true },
      { kind: "relatedEntities", label: "関連", editable: true },
      { kind: "canonicalIdentifier", label: "Canonical ID", editable: true },
      { kind: "sourceUri", label: "Source URI", editable: true },
    );
  }
  if (type !== "topic") {
    columns.push({
      kind: "topics",
      label: "Topics",
      editable: true,
      ...(type === "task" ? { width: 160 } : {}),
    });
  }
  if (type === "entry") columns.push({ kind: "createdAt", label: "記録日時" });
  return columns;
};

export interface EntityCollectionViewProps {
  readonly storageKey?: string | undefined;
  readonly type: EntityType;
  readonly resourceScope?: ResourceType | undefined;
  readonly entities: readonly PkmEntitySummary[];
  readonly pinnedIds: ReadonlySet<string>;
  readonly readOnly?: boolean;
  readonly onOpenEntity: (entityId: string) => void;
  readonly onCreate?: (type: EntityType) => void;
  readonly onTogglePinned: (entityId: string) => void;
  readonly onUpdateEntity?: (
    entityId: string,
    patch: HierarchyEntityPatch,
  ) => Promise<void>;
  readonly onUpdateTopics?: (
    entityId: string,
    topicNames: readonly string[],
  ) => Promise<void>;
  readonly onDeleteEntity?: (entityId: string) => Promise<void>;
  readonly onUpdateError?: (reason: unknown) => void;
}

export const EntityCollectionView = ({
  storageKey,
  type,
  resourceScope,
  entities,
  pinnedIds,
  readOnly = false,
  onOpenEntity,
  onCreate,
  onTogglePinned,
  onUpdateEntity,
  onUpdateTopics,
  onDeleteEntity,
  onUpdateError,
}: EntityCollectionViewProps): React.JSX.Element => {
  const [query, setQuery] = useStoredViewState<string>(storageKey, "query", "");
  const [status, setStatus] = useStoredViewState<string | null>(
    storageKey,
    "status",
    null,
  );
  const [priority, setPriority] = useStoredViewState<string | null>(
    storageKey,
    "priority",
    null,
  );
  const [areaId, setAreaId] = useStoredViewState<string | null>(
    storageKey,
    "areaId",
    null,
  );
  const [projectId, setProjectId] = useStoredViewState<string | null>(
    storageKey,
    "projectId",
    null,
  );
  const [topicIds, setTopicIds] = useStoredViewState<string[]>(
    storageKey,
    "topicIds",
    [],
  );
  const [origin, setOrigin] = useStoredViewState<string | null>(
    storageKey,
    "origin",
    null,
  );
  const [deadline, setDeadline] = useStoredViewState<DeadlineFilter | null>(
    storageKey,
    "deadline",
    null,
  );
  const [resourceType, setResourceType] =
    useStoredViewState<ResourceType | null>(storageKey, "resourceType", null);
  const [filtersOpen, setFiltersOpen] = useStoredViewState<boolean>(
    storageKey,
    "filtersOpen",
    false,
  );

  const byId = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );
  const optionsFor = (candidateType: EntityType) =>
    entities
      .filter((entity) => entity.type === candidateType)
      .map((entity) => ({
        value: entity.id,
        label: entity.displayName ?? entity.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ja"));
  const areas = optionsFor("area");
  const projects = optionsFor("project");
  const topics = optionsFor("topic");
  const origins = [
    ...new Set(entities.map((entity) => entity.origin).filter(Boolean)),
  ]
    .map((value) => ({ value: value as string, label: value as string }))
    .sort((a, b) => a.label.localeCompare(b.label, "ja"));
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");
  const activeFilterCount = [
    query.trim().length > 0,
    status !== null,
    priority !== null,
    areaId !== null,
    projectId !== null,
    topicIds.length > 0,
    origin !== null,
    resourceType !== null,
    type === "task" && deadline !== null,
  ].filter(Boolean).length;
  const selectedResourceType = resourceScope ?? resourceType;
  const visible = entities
    .filter((entity) => entity.type === type)
    .filter((entity) =>
      normalizedQuery.length === 0
        ? true
        : `${entity.displayName ?? ""} ${entity.id} ${entity.body} ${entity.canonicalIdentifier ?? ""} ${entity.sourceUri ?? ""} ${(entity.authors ?? []).join(" ")}`
            .toLocaleLowerCase("ja")
            .includes(normalizedQuery),
    )
    .filter(
      (entity) =>
        selectedResourceType === null ||
        entity.resourceType === selectedResourceType,
    )
    .filter((entity) => status === null || entity.status === status)
    .filter((entity) => priority === null || entity.priority === priority)
    .filter((entity) => {
      if (areaId === null) return true;
      if (entity.areaId === areaId) return true;
      return entity.projectId === null
        ? false
        : byId.get(entity.projectId)?.areaId === areaId;
    })
    .filter((entity) => projectId === null || entity.projectId === projectId)
    .filter((entity) =>
      topicIds.length === 0
        ? true
        : topicIds.every((topicId) => entity.topicIds.includes(topicId)),
    )
    .filter((entity) => origin === null || entity.origin === origin)
    .filter(
      (entity) => type !== "task" || matchesDeadlineFilter(entity, deadline),
    );

  return (
    <Stack className="entity-collection-view" gap="md">
      <Group justify="space-between">
        <Group>
          <EntityIcon type={type} />
          <Title order={2}>
            {TYPE_LABELS[type]}
            {resourceScope &&
              ` / ${RESOURCE_TYPE_OPTIONS.find((option) => option.value === resourceScope)!.label}`}
          </Title>
          <Badge variant="light">{visible.length}</Badge>
        </Group>
        <Group>
          {onCreate !== undefined && (
            <Button disabled={readOnly} onClick={() => onCreate(type)}>
              {TYPE_SINGULAR_LABELS[type]}を追加
            </Button>
          )}
          <Button
            aria-expanded={filtersOpen}
            variant="default"
            onClick={() => setFiltersOpen((current) => !current)}
          >
            絞り込み
            {activeFilterCount > 0 && ` (${activeFilterCount})`}
          </Button>
        </Group>
      </Group>
      <Collapse expanded={filtersOpen}>
        <Paper withBorder p="sm">
          <div className="entity-filter-grid">
            <TextInput
              label="検索"
              placeholder="名前・ID・本文"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <Select
              label="ステータス"
              data={STATUS_OPTIONS}
              value={status}
              onChange={setStatus}
              clearable
              disabled={type !== "project" && type !== "task"}
            />
            <Select
              label="優先度"
              data={PRIORITY_OPTIONS}
              value={priority}
              onChange={setPriority}
              clearable
              disabled={type !== "project" && type !== "task"}
            />
            <Select
              label="Area"
              data={areas}
              value={areaId}
              onChange={setAreaId}
              clearable
              searchable
            />
            <Select
              label="Project"
              data={projects}
              value={projectId}
              onChange={setProjectId}
              clearable
              searchable
            />
            <MultiSelect
              label="Topics"
              data={topics}
              value={topicIds}
              onChange={setTopicIds}
              clearable
              searchable
            />
            {type === "task" && (
              <Select
                label="期限"
                data={[
                  { value: "overdue", label: "期限切れ（未完了）" },
                  { value: "today", label: "今日" },
                  { value: "next7days", label: "今日から7日間" },
                  { value: "scheduled", label: "期限あり" },
                  { value: "unscheduled", label: "期限なし" },
                ]}
                value={deadline}
                onChange={(value) => setDeadline(value)}
                clearable
              />
            )}
            {type === "resource" && resourceScope === undefined && (
              <Select
                label="資料種別"
                clearable
                data={RESOURCE_TYPE_OPTIONS}
                value={resourceType}
                onChange={(value) => setResourceType(value)}
              />
            )}
            <Select
              label="Origin"
              data={origins}
              value={origin}
              onChange={setOrigin}
              clearable
              searchable
            />
          </div>
        </Paper>
      </Collapse>
      <Paper withBorder className="entity-collection-table-wrap">
        <EntityDataTable
          storageKey={
            storageKey === undefined ? undefined : `${storageKey}:table`
          }
          initialView="table"
          showViewControl={false}
          allEntities={entities}
          columns={collectionColumns(type)}
          emptyMessage="条件に一致するEntityはありません。"
          entities={visible}
          initialSort={
            type === "entry"
              ? { key: "createdAt", direction: "desc" }
              : type === "project" || type === "task"
                ? { key: "workflow", direction: "asc" }
                : undefined
          }
          pinnedIds={pinnedIds}
          readOnly={readOnly}
          onOpenEntity={onOpenEntity}
          onTogglePinned={onTogglePinned}
          onUpdateEntity={onUpdateEntity}
          onUpdateTopics={onUpdateTopics}
          onDeleteEntity={onDeleteEntity}
          onUpdateError={onUpdateError}
        />
        {onCreate !== undefined && (
          <Button
            fullWidth
            variant="subtle"
            color="gray"
            className="entity-table-create"
            disabled={readOnly}
            onClick={() => onCreate(type)}
          >
            ＋ 新規{TYPE_SINGULAR_LABELS[type]}
          </Button>
        )}
      </Paper>
    </Stack>
  );
};
