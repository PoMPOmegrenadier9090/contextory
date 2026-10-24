import {
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useContext, useEffect, useState } from "react";
import type {
  ResourceType,
  EntityPageQuery,
  EntitySort,
  EntityType,
  PkmEntitySummary,
} from "@pkm/contracts";
import { useStoredViewState } from "./stored-view-state.js";
import {
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  RESOURCE_TYPE_OPTIONS,
} from "./entity-options.js";
import {
  EntityQueryContext,
  EntitySelect,
  EntityMultiSelect,
} from "./entity-query-context.js";
import {
  EntityDataTable,
  type EntityDataTableProps,
  type EntityTableColumnDefinition,
} from "./entity-data-table.js";
import {
  useEntityPage,
  EntityPageFooter as PageFooter,
} from "./use-entity-page.js";
const typeLabels: Record<EntityType, string> = {
  entry: "Entries",
  area: "Areas",
  project: "Projects",
  task: "Tasks",
  topic: "Topics",
  resource: "Resources",
};
const columnsFor = (
  type: EntityType | undefined,
): readonly EntityTableColumnDefinition[] => [
  { kind: "pin", label: "Pin", width: 42 },
  {
    kind: "name",
    label: "名前",
    editable: type !== "entry",
    showEntityType: type === undefined,
  },
  ...(type === "project" || type === "task"
    ? [
        { kind: "status" as const, label: "ステータス", editable: true },
        { kind: "priority" as const, label: "優先度", editable: true },
        { kind: "area" as const, label: "Area", editable: true },
      ]
    : []),
  ...(type === "task"
    ? [
        { kind: "dueAt" as const, label: "期限", editable: true },
        { kind: "project" as const, label: "Project", editable: true },
      ]
    : []),
  ...(type === "resource"
    ? [
        { kind: "resourceType" as const, label: "資料種別", editable: true },
        {
          kind: "canonicalIdentifier" as const,
          label: "Canonical ID",
          editable: true,
        },
        { kind: "sourceUri" as const, label: "Source URI", editable: true },
      ]
    : []),
  ...(type !== "topic"
    ? [{ kind: "topics" as const, label: "Topics", editable: true }]
    : []),
  ...(type === "entry"
    ? [{ kind: "createdAt" as const, label: "記録日時" }]
    : []),
];
type TableActions = Omit<
  EntityDataTableProps,
  "entities" | "allEntities" | "columns" | "remoteSort"
>;
export interface PagedCollectionProps extends TableActions {
  readonly className?: string;
  readonly type?: EntityType | undefined;
  readonly resourceScope?: ResourceType | undefined;
  readonly title?: string | undefined;
  readonly baseQuery?: EntityPageQuery | undefined;
  readonly entities: readonly PkmEntitySummary[];
  readonly onCreate?: ((type: EntityType) => void) | undefined;
  readonly expandable?: boolean | undefined;
  readonly compact?: boolean | undefined;
  readonly groupBy?: "area" | "project" | "topic" | undefined;
}
export const PagedCollection = ({
  className,
  type,
  storageKey: suppliedStorageKey,
  resourceScope,
  title,
  baseQuery = {},
  entities,
  onCreate,
  expandable = false,
  compact = false,
  groupBy,
  ...actions
}: PagedCollectionProps) => {
  const source = useContext(EntityQueryContext);
  const storageKey =
    suppliedStorageKey ??
    (source?.vaultId === undefined
      ? undefined
      : `pkm:web:${source.vaultId}:collection:${type ?? "all"}:${JSON.stringify(baseQuery)}${resourceScope ? `:${resourceScope}` : ""}`);
  const [text, setText] = useStoredViewState<string>(storageKey, "text", "");
  const [composing, setComposing] = useState(false);
  const [q, setQ] = useState(text);
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
  const [deadline, setDeadline] = useStoredViewState<NonNullable<
    EntityPageQuery["deadline"]
  > | null>(storageKey, "deadline", null);
  const [resourceType, setResourceType] =
    useStoredViewState<ResourceType | null>(storageKey, "resourceType", null);
  const [sort, setSort] = useStoredViewState<
    Exclude<EntitySort, "description">
  >(
    storageKey,
    "sort",
    type === "entry"
      ? "createdAt"
      : type === "project" || type === "task"
        ? "workflow"
        : "name",
    (v) =>
      v === "workflow" || columnsFor(type).some((column) => column.kind === v),
  );
  const [direction, setDirection] = useStoredViewState<"asc" | "desc">(
    storageKey,
    "direction",
    type === "entry" ? "desc" : "asc",
    (v) => v === "asc" || v === "desc",
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useStoredViewState<boolean>(
    storageKey,
    "filtersOpen",
    false,
  );
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => setQ(text), 150);
    return () => clearTimeout(timer);
  }, [text, composing]);
  const selectedResourceType = resourceScope ?? resourceType;
  const query: EntityPageQuery = {
    ...baseQuery,
    ...(type ? { type } : {}),
    q,
    sort,
    direction,
    ...(status ? { status } : {}),
    ...(selectedResourceType ? { resourceType: selectedResourceType } : {}),
    ...(priority ? { priority } : {}),
    ...(areaId ? { areaId } : {}),
    ...(projectId ? { projectId } : {}),
    ...(topicIds.length ? { topicIds } : {}),
    ...(origin ? { origin } : {}),
    ...(deadline ? { deadline } : {}),
  };
  const page = useEntityPage(query);
  const options = (kind: string) =>
    entities
      .filter((e) => e.type === kind)
      .map((e) => ({ value: e.id, label: e.displayName ?? e.id }));
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const grouped = new Map<string, PkmEntitySummary[]>();
  for (const item of page.items) {
    const ids =
      groupBy === "topic"
        ? item.topicIds.length
          ? item.topicIds
          : [""]
        : [
            groupBy === "project"
              ? (item.projectId ?? "")
              : groupBy === "area"
                ? (item.areaId ??
                  (item.projectId ? byId.get(item.projectId)?.areaId : null) ??
                  "")
                : "all",
          ];
    for (const id of ids) {
      const items = grouped.get(id) ?? [];
      items.push(item);
      grouped.set(id, items);
    }
  }
  if (!page.items.length) grouped.set("all", []);
  return (
    <Stack
      gap="md"
      className={
        className ??
        (title === "Workspace" || title === "子Entity"
          ? "workspace-list"
          : undefined)
      }
    >
      {!compact && (
        <Group justify="space-between">
          <Group>
            <Title order={2}>
              {title ?? (type ? typeLabels[type] : "Entity")}
              {resourceScope &&
                ` / ${RESOURCE_TYPE_OPTIONS.find((option) => option.value === resourceScope)!.label}`}
            </Title>
            <Badge>
              {page.items.length}
              {page.cursor ? "+" : ""}
            </Badge>
          </Group>
          <Group>
            {type && onCreate && (
              <Button
                disabled={actions.readOnly ?? false}
                onClick={() => onCreate(type)}
              >
                追加
              </Button>
            )}
            <Button variant="default" onClick={() => setFiltersOpen((v) => !v)}>
              絞り込み
            </Button>
          </Group>
        </Group>
      )}
      {filtersOpen && (
        <Paper withBorder p="sm">
          <div className="entity-filter-grid">
            <TextInput
              label="検索"
              placeholder="名前・本文"
              value={text}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onChange={(e) => setText(e.currentTarget.value)}
            />
            {(type === "project" || type === "task") && (
              <>
                <Select
                  label="ステータス"
                  clearable
                  data={STATUS_OPTIONS}
                  value={status}
                  onChange={setStatus}
                />
                <Select
                  label="優先度"
                  clearable
                  data={PRIORITY_OPTIONS}
                  value={priority}
                  onChange={setPriority}
                />
              </>
            )}
            <EntitySelect
              entityType="area"
              label="Area"
              clearable
              data={options("area")}
              value={areaId}
              onChange={setAreaId}
            />
            <EntitySelect
              entityType="project"
              label="Project"
              clearable
              data={options("project")}
              value={projectId}
              onChange={setProjectId}
            />
            <EntityMultiSelect
              entityType="topic"
              label="Topics"
              data={options("topic")}
              value={topicIds}
              onChange={setTopicIds}
            />
            {type === "resource" && resourceScope === undefined && (
              <Select
                label="資料種別"
                clearable
                data={RESOURCE_TYPE_OPTIONS}
                value={resourceType}
                onChange={(value) => setResourceType(value)}
              />
            )}
            {type === "entry" && (
              <Select
                label="Origin"
                clearable
                data={["human", "ai", "system"]}
                value={origin}
                onChange={setOrigin}
              />
            )}
            {type === "task" && (
              <Select
                label="期限"
                clearable
                value={deadline ?? null}
                data={[
                  { value: "overdue", label: "期限切れ（未完了）" },
                  { value: "today", label: "今日" },
                  { value: "next7days", label: "今日から7日間" },
                  { value: "scheduled", label: "期限あり" },
                  { value: "unscheduled", label: "期限なし" },
                ]}
                onChange={(v) => setDeadline(v)}
              />
            )}
          </div>
        </Paper>
      )}
      {[...grouped].map(([groupId, items]) => (
        <Paper key={groupId} withBorder className="workspace-group">
          {groupBy && items.length > 0 && (
            <Text p="xs" fw={600} className="workspace-group-heading">
              {groupId === ""
                ? `${groupBy}未設定`
                : (byId.get(groupId)?.displayName ?? groupId)}
            </Text>
          )}
          <EntityDataTable
            {...actions}
            initialView={actions.initialView ?? (compact ? "list" : "table")}
            storageKey={storageKey}
            showViewControl={actions.showViewControl ?? false}
            allEntities={entities}
            entities={items}
            columns={[
              ...columnsFor(type),
              ...(expandable
                ? [{ kind: "actions" as const, label: "子Entity" }]
                : []),
            ]}
            remoteSort={{
              key: sort,
              direction,
              onChange: (key, dir) => {
                setSort(key as Exclude<EntitySort, "description">);
                setDirection(dir);
              },
            }}
            renderRowActions={
              expandable
                ? (entity) => (
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() =>
                        setExpanded((id) =>
                          id === entity.id ? null : entity.id,
                        )
                      }
                    >
                      {expanded === entity.id ? "閉じる" : "開く"}
                    </Button>
                  )
                : actions.renderRowActions
            }
          />
        </Paper>
      ))}
      <PageFooter page={page} />
      {type && onCreate && (
        <Button
          fullWidth
          variant="subtle"
          color="gray"
          className="entity-table-create"
          disabled={actions.readOnly ?? false}
          onClick={() => onCreate(type)}
        >
          ＋ 新規{type[0]!.toUpperCase()}
          {type.slice(1)}
        </Button>
      )}
      {expanded && (
        <Paper withBorder p="md">
          <PagedCollection
            key={expanded}
            {...actions}
            type={type === "project" ? "task" : undefined}
            title="子Entity"
            entities={entities}
            baseQuery={{
              ...(baseQuery.activeOnly ? { activeOnly: true } : {}),
              scopeType: type as "area" | "project",
              scopeId: expanded,
              types: type === "area" ? ["project", "task"] : ["task"],
            }}
          />
        </Paper>
      )}
    </Stack>
  );
};
