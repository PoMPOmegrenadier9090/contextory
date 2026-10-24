import { isActiveWork } from "@pkm/contracts";
import { useStoredViewState } from "@pkm/ui";
import {
  Alert,
  Button,
  Group,
  Select,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useContext, useEffect, useRef, useState } from "react";
import type {
  EntityPageQuery,
  EntitySort,
  PkmClient,
  BacklinkGroup,
  PkmEntitySummary,
} from "@pkm/contracts";
import {
  BacklinksTable,
  EntityIcon,
  EntityQueryContext,
  EntityDataTable,
  EntityRelationTable,
  EntityRelatedEntries,
  entityRelationTables,
  canCreateInContext,
  type EntityRelationsViewProps,
  type EntityTableColumnKind,
  EntityTrashView,
  type EntityTableColumnDefinition,
} from "@pkm/ui";

export { useEntityPage } from "@pkm/ui";
import { useEntityPage, EntityPageFooter as PageFooter } from "@pkm/ui";

import { PagedCollection, type PagedCollectionProps } from "@pkm/ui";
export { PagedCollection } from "@pkm/ui";

type PagedRelationsProps = Omit<EntityRelationsViewProps, "backlinks">;

const PagedRelation = ({
  table,
  entity,
  entities,
  onCreate,
  ...actions
}: PagedRelationsProps & {
  table: ReturnType<typeof entityRelationTables>[number];
}) => {
  const source = useContext(EntityQueryContext);
  const storageKey = source?.vaultId
    ? `pkm:web:${source.vaultId}:relation:${entity.id}:${table.type}`
    : undefined;
  const [sort, setSort] = useStoredViewState<EntityTableColumnKind>(
    storageKey,
    "sort",
    table.type === "project" || table.type === "task" ? "workflow" : "name",
    (v) =>
      v === "workflow" || table.columns.some((column) => column.kind === v),
  );
  const [direction, setDirection] = useStoredViewState<"asc" | "desc">(
    storageKey,
    "direction",
    "asc",
    (v) => v === "asc" || v === "desc",
  );
  const relation: EntityPageQuery =
    table.type === "entry" ||
    entity.type === "resource" ||
    table.type === "resource"
      ? { relatedTo: entity.id }
      : entity.type === "topic"
        ? { topicIds: [entity.id] }
        : entity.type === "project"
          ? { projectId: entity.id }
          : { scopeType: "area", scopeId: entity.id };
  const page = useEntityPage({
    ...relation,
    type: table.type,
    sort: sort as EntitySort,
    direction,
  });
  return (
    <EntityRelationTable
      {...actions}
      title={table.title}
      columns={table.columns}
      entities={page.items}
      allEntities={entities}
      createLabel={`新規${table.type[0]!.toUpperCase()}${table.type.slice(1)}`}
      onCreate={
        onCreate && canCreateInContext(table.type, entity)
          ? () => onCreate(table.type, entity)
          : undefined
      }
      loading={page.loading}
      hasMore={page.cursor !== null}
      remoteSort={{
        key: sort,
        direction,
        onChange: (key, nextDirection) => {
          setSort(key);
          setDirection(nextDirection);
        },
      }}
      footer={
        (page.cursor !== null || page.error !== null) && (
          <PageFooter page={page} />
        )
      }
    />
  );
};

export const PagedRelations = (props: PagedRelationsProps) => (
  <Stack gap="md">
    {entityRelationTables(props.entity).map((table) =>
      table.type === "entry" ? (
        <EntityRelatedEntries
          key="entry"
          entity={props.entity}
          relationMode={props.entryRelationMode ?? "direct"}
          enabled={props.entriesEnabled ?? true}
          allEntities={props.entities}
          pinnedIds={props.pinnedIds}
          readOnly={props.readOnly}
          onOpenEntity={props.onOpenEntity}
          onTogglePinned={props.onTogglePinned}
          onUpdateEntity={props.onUpdateEntity}
          onUpdateTopics={props.onUpdateTopics}
          onDeleteEntity={props.onDeleteEntity}
          onUpdateError={props.onUpdateError}
          createLabel="メモを追加"
          onCreate={
            props.onCreate && canCreateInContext("entry", props.entity)
              ? () => props.onCreate!("entry", props.entity)
              : undefined
          }
        />
      ) : (
        <PagedRelation key={table.type} {...props} table={table} />
      ),
    )}
  </Stack>
);

const PagedAreaWorkspace = ({ entities, ...actions }: PagedCollectionProps) => {
  const areasPage = useEntityPage({ type: "area" });
  const projectsPage = useEntityPage({
    type: "project",
    activeOnly: true,
    sort: "workflow",
  });
  const tasksPage = useEntityPage({
    type: "task",
    activeOnly: true,
    sort: "workflow",
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const areas = new Map(areasPage.items.map((area) => [area.id, area]));
  const projects = new Map(
    projectsPage.items.map((project) => [project.id, project]),
  );
  // Included parents keep later pages and direct links in their correct hierarchy.
  for (const task of tasksPage.items) {
    const project = task.projectId ? byId.get(task.projectId) : undefined;
    if (project && isActiveWork(project) && !projects.has(project.id))
      projects.set(project.id, project);
  }
  for (const item of [...projects.values(), ...tasksPage.items]) {
    const areaId =
      item.areaId ?? (item.projectId ? byId.get(item.projectId)?.areaId : null);
    const area = areaId ? byId.get(areaId) : undefined;
    if (area && !areas.has(area.id)) areas.set(area.id, area);
  }
  const groups: { id: string; label: string; area: PkmEntitySummary | null }[] =
    [...areas.values()]
      .filter(
        (area) =>
          [...projects.values()].some(
            (project) => project.areaId === area.id,
          ) ||
          tasksPage.items.some(
            (task) => task.projectId === null && task.areaId === area.id,
          ),
      )
      .map((area) => ({
        id: area.id,
        label: area.displayName ?? area.id,
        area,
      }));
  const hasUnassigned =
    [...projects.values()].some((project) => project.areaId === null) ||
    tasksPage.items.some(
      (task) => task.projectId === null && task.areaId === null,
    );
  if (hasUnassigned)
    groups.push({
      id: "unassigned",
      label: "Area未設定",
      area: null,
    });
  const columns: readonly EntityTableColumnDefinition[] = [
    { kind: "name", label: "名前", editable: true },
    { kind: "status", label: "状態", editable: true },
    { kind: "priority", label: "優先度", editable: true },
    { kind: "actions", label: "Tasks" },
  ];
  return (
    <Stack className="hierarchy-view" gap="lg">
      {groups.map(({ id, label, area }) => {
        const groupProjects = [...projects.values()].filter(
          (project) => project.areaId === (area?.id ?? null),
        );
        const directTasks = tasksPage.items.filter(
          (task) =>
            task.projectId === null && task.areaId === (area?.id ?? null),
        );
        const closed = collapsed.has(id);
        return (
          <section className="workspace-group" key={id}>
            <Group
              className="workspace-group-heading"
              justify="space-between"
              wrap="nowrap"
            >
              <Group gap="xs" wrap="nowrap">
                <button
                  className="hierarchy-expand-button"
                  aria-label={`${label}の一覧を${closed ? "開く" : "閉じる"}`}
                  aria-expanded={!closed}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (closed) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                >
                  ›
                </button>
                <EntityIcon type="area" />
                {area ? (
                  <button
                    className="area-title-button"
                    data-open-entity={area.id}
                    onClick={() => actions.onOpenEntity?.(area.id)}
                  >
                    {label}
                  </button>
                ) : (
                  <Text fw={500} size="sm">
                    {label}
                  </Text>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {groupProjects.length} Projects{projectsPage.cursor ? "+" : ""}
              </Text>
            </Group>
            {!closed && (
              <>
                {groupProjects.length === 0 && (
                  <Text size="sm" c="dimmed" px="md" py="lg">
                    {projectsPage.loading
                      ? "読み込み中…"
                      : "プロジェクトはまだありません"}
                  </Text>
                )}
                {groupProjects.map((groupProject) => (
                  <div
                    key={groupProject.id}
                    className="workspace-project-section"
                  >
                    <EntityDataTable
                      {...actions}
                      entities={[groupProject]}
                      allEntities={entities}
                      columns={columns}
                      initialView="list"
                      showViewControl={false}
                      emptyMessage={
                        projectsPage.loading
                          ? "読み込み中…"
                          : "プロジェクトはまだありません"
                      }
                      renderRowActions={(project) => (
                        <Button
                          variant="subtle"
                          aria-expanded={expanded === project.id}
                          onClick={() =>
                            setExpanded((current) =>
                              current === project.id ? null : project.id,
                            )
                          }
                        >
                          {expanded === project.id ? "⌄ Tasks" : "› Tasks"}
                        </Button>
                      )}
                    />
                    {expanded === groupProject.id && (
                      <div className="workspace-project-tasks">
                        <PagedCollection
                          {...actions}
                          key={expanded}
                          type="task"
                          title="子Entity"
                          compact
                          entities={entities}
                          baseQuery={{ projectId: expanded, activeOnly: true }}
                        />
                      </div>
                    )}
                  </div>
                ))}
                {directTasks.length > 0 && (
                  <>
                    <Text size="xs" c="dimmed" px="md" pt="sm">
                      Area直属のTasks
                    </Text>
                    <EntityDataTable
                      {...actions}
                      entities={directTasks}
                      allEntities={entities}
                      columns={[
                        ...columns.filter(
                          (column) => column.kind !== "actions",
                        ),
                        { kind: "dueAt", label: "期限", editable: true },
                      ]}
                      initialView="list"
                      showViewControl={false}
                    />
                  </>
                )}
              </>
            )}
          </section>
        );
      })}
      {groups.length === 0 && !areasPage.loading && !projectsPage.loading && (
        <Text c="dimmed">AreaやProjectを追加して整理できます。</Text>
      )}
      <PageFooter page={areasPage} />
      <PageFooter page={projectsPage} />
      <PageFooter page={tasksPage} />
    </Stack>
  );
};

export const PagedWorkspace = ({
  view,
  onViewChange,
  ...props
}: PagedCollectionProps & {
  view: "area" | "project" | "task";
  onViewChange: (v: "area" | "project" | "task") => void;
}) => {
  const source = useContext(EntityQueryContext);
  const [groupBy, setGroupBy] = useStoredViewState<
    "none" | "area" | "topic" | "project"
  >(
    source?.vaultId ? `pkm:web:${source.vaultId}:home` : undefined,
    "group",
    "area",
    (v) => ["none", "area", "topic", "project"].includes(String(v)),
  );
  const effectiveGroup =
    view === "area" || groupBy === "none"
      ? undefined
      : view === "project" && groupBy === "project"
        ? "area"
        : groupBy;
  return (
    <Stack>
      <Group
        align="center"
        justify="space-between"
        className="workspace-toolbar"
      >
        {view === "area" && <Title order={2}>Workspace</Title>}
        <Group gap="xs">
          <SegmentedControl
            value={view}
            onChange={(v) => onViewChange(v)}
            data={[
              { value: "area", label: "Areas" },
              { value: "project", label: "Projects" },
              { value: "task", label: "Tasks" },
            ]}
          />
          {view !== "area" && (
            <Select
              label="グループ"
              value={effectiveGroup ?? "none"}
              allowDeselect={false}
              data={[
                { value: "none", label: "グループなし" },
                { value: "area", label: "Area" },
                { value: "topic", label: "Topic" },
                ...(view === "task"
                  ? [{ value: "project", label: "Project" }]
                  : []),
              ]}
              onChange={(value) => setGroupBy(value as typeof groupBy)}
            />
          )}
          {view === "area" && props.onCreate && (
            <Button
              variant="default"
              disabled={props.readOnly ?? false}
              onClick={() => props.onCreate?.("project")}
            >
              ＋ 新規
            </Button>
          )}
        </Group>
      </Group>
      {view === "area" ? (
        <PagedAreaWorkspace {...props} />
      ) : (
        <PagedCollection
          key={view}
          {...props}
          type={view}
          title="Workspace"
          baseQuery={{ activeOnly: true }}
          initialView="list"
          groupBy={effectiveGroup}
          expandable={view !== "task"}
        />
      )}
    </Stack>
  );
};
export const PagedTrash = ({
  entities,
  ...props
}: Omit<
  React.ComponentProps<typeof EntityTrashView>,
  "entities" | "allEntities" | "remoteSort"
> & { entities: readonly PkmEntitySummary[] }) => {
  const [sort, setSort] =
    useState<Exclude<EntitySort, "description">>("deletedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const page = useEntityPage({
    deleted: "only",
    sort,
    direction,
  });
  return (
    <Stack>
      <EntityTrashView
        {...props}
        entities={page.items}
        allEntities={entities}
        remoteSort={{
          key: sort,
          direction,
          onChange: (key, nextDirection) => {
            setSort(key as Exclude<EntitySort, "description">);
            setDirection(nextDirection);
          },
        }}
      />
      <PageFooter page={page} />
    </Stack>
  );
};

export { PagedTimeline } from "@pkm/ui";

export const PagedBacklinks = ({
  client,
  entityId,
  revision,
  onOpenEntity,
}: {
  client: Pick<PkmClient, "queryBacklinks">;
  entityId: string;
  revision: number;
  onOpenEntity: (id: string) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [countKnown, setCountKnown] = useState(false);
  const [groups, setGroups] = useState<readonly BacklinkGroup[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const loadedEntity = useRef<string | null>(null);
  const loadingMore = useRef(false);
  const showLoading = loading && (!countKnown || loadingMore.current);
  useEffect(() => {
    const request = ++generation.current;
    if (!expanded) return;
    loadingMore.current = false;
    if (loadedEntity.current !== entityId) {
      setCountKnown(false);
      setGroups([]);
      setCursor(null);
    }
    setLoading(true);
    setError(null);
    void client
      .queryBacklinks(entityId)
      .then((page) => {
        if (request === generation.current) {
          loadedEntity.current = entityId;
          setGroups(page.items);
          setCountKnown(true);
          setCursor(page.nextCursor);
          setLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (request === generation.current) {
          setError(String(reason));
          setLoading(false);
        }
      });
    return () => {
      generation.current++;
    };
  }, [client, entityId, revision, expanded]);
  const more = async () => {
    if (!cursor || loading) return;
    const request = generation.current;
    loadingMore.current = true;
    setLoading(true);
    try {
      const page = await client.queryBacklinks(entityId, { cursor });
      if (request === generation.current) {
        setGroups((current) => [...current, ...page.items]);
        setCursor(page.nextCursor);
      }
    } catch (reason) {
      if (request === generation.current) setError(String(reason));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };
  return (
    <Stack>
      <BacklinksTable
        backlinks={[]}
        groups={groups}
        countKnown={countKnown}
        onExpandedChange={setExpanded}
        onOpenEntity={onOpenEntity}
        footer={
          <Stack p="sm">
            {error && <Alert color="red">{error}</Alert>}
            {showLoading && <Text>読み込み中…</Text>}
            {cursor && (
              <Button
                loading={showLoading}
                disabled={loading && !loadingMore.current}
                onClick={() => void more()}
              >
                参照元をさらに表示
              </Button>
            )}
          </Stack>
        }
      />
    </Stack>
  );
};
