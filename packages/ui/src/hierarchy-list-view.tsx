import { compareWork, isActiveWork } from "@pkm/contracts";
import { useStoredViewState } from "./stored-view-state.js";
import { EntitySelect } from "./entity-query-context.js";
import { TaskDeadlineInput } from "./task-deadline-input.js";
import { matchesDeadlineFilter, type DeadlineFilter } from "./task-deadline.js";
import { STATUS_OPTIONS, PRIORITY_OPTIONS } from "./entity-options.js";
import type { HierarchyEntityPatch } from "./entity-actions.js";
import {
  Badge,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useState } from "react";
import { EntityTopicsCell } from "./entity-topics-cell.js";
import { useMobileLayout } from "./device-local-ui.js";
import { EntityIcon } from "./entity-icon.js";
import { EntityStatusLight } from "./entity-status.js";
import type { PkmEntitySummary } from "@pkm/contracts";

export type HierarchyView = "area" | "project" | "task";
export type HierarchyGroupMode = "none" | "area" | "topic" | "project";

export interface HierarchyListViewProps {
  readonly storageKey?: string | undefined;
  readonly entities: readonly PkmEntitySummary[];
  readonly view: HierarchyView;
  readonly groupMode: HierarchyGroupMode;
  readonly readOnly?: boolean;
  readonly onOpenEntity: (entityId: string) => void;
  readonly onUpdateEntity?: (
    entityId: string,
    patch: HierarchyEntityPatch,
  ) => Promise<void>;
  readonly onUpdateTopics?: (
    entityId: string,
    topicNames: readonly string[],
  ) => Promise<void>;
  readonly onUpdateError?: (reason: unknown) => void;
  readonly onViewChange: (view: HierarchyView) => void;
  readonly onGroupModeChange: (mode: HierarchyGroupMode) => void;
}

interface EntityGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly PkmEntitySummary[];
}

const compareEntities = (a: PkmEntitySummary, b: PkmEntitySummary): number =>
  (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id, "ja");

interface EntityTableProps {
  readonly kind: "project" | "task";
  readonly items: readonly PkmEntitySummary[];
  readonly byId: ReadonlyMap<string, PkmEntitySummary>;
  readonly projects: readonly PkmEntitySummary[];
  readonly areas: readonly PkmEntitySummary[];
  readonly topics: readonly PkmEntitySummary[];
  readonly tasksForProject: (projectId: string) => readonly PkmEntitySummary[];
  readonly effectiveAreaId: (entity: PkmEntitySummary) => string | null;
  readonly readOnly: boolean;
  readonly savingIds: ReadonlySet<string>;
  readonly expandedProjects: ReadonlySet<string>;
  readonly onToggleProject: (projectId: string) => void;
  readonly onOpenEntity: (entityId: string) => void;
  readonly onPatch: (
    entity: PkmEntitySummary,
    patch: HierarchyEntityPatch,
  ) => void;
  readonly onPatchDeadline: (
    entity: PkmEntitySummary,
    value: string | null,
  ) => Promise<void>;
  readonly onDeadlineError?: ((reason: unknown) => void) | undefined;
  readonly onPatchTopics: (
    entity: PkmEntitySummary,
    topicNames: readonly string[],
  ) => void;
}

const EntityTable = ({
  kind,
  items,
  byId,
  projects,
  areas,
  topics,
  tasksForProject,
  effectiveAreaId,
  readOnly,
  savingIds,
  expandedProjects,
  onToggleProject,
  onOpenEntity,
  onPatch,
  onPatchTopics,
  onPatchDeadline,
  onDeadlineError,
}: EntityTableProps): React.JSX.Element => {
  const areaOptions = areas.map((area) => ({
    value: area.id,
    label: area.displayName ?? area.id,
  }));
  const projectOptions = projects.map((project) => ({
    value: project.id,
    label: project.displayName ?? project.id,
  }));
  const topicOptions = topics.map((topic) => topic.displayName ?? topic.id);
  const columns = [
    { key: "name", label: "タイトル", width: 260 },
    { key: "status", label: "ステータス", width: 110 },
    { key: "priority", label: "優先度", width: 100 },
    ...(kind === "task"
      ? [
          { key: "dueAt", label: "期限", width: 235 },
          { key: "project", label: "Project", width: 140 },
        ]
      : []),
    { key: "area", label: "Area", width: 130 },
    { key: "topics", label: "Topics", width: 160 },
    ...(kind === "project"
      ? [{ key: "tasks", label: "Tasks", width: 54 }]
      : []),
  ];

  const rows = items.flatMap((entity) => {
    const isProject = entity.type === "project";
    const saving = savingIds.has(entity.id);
    const project =
      entity.projectId === null ? null : (byId.get(entity.projectId) ?? null);
    const inheritedAreaId = effectiveAreaId(entity);
    const expanded = isProject && expandedProjects.has(entity.id);
    const projectTasks = isProject ? tasksForProject(entity.id) : [];
    const controlsDisabled = readOnly || saving;

    const row = (
      <Table.Tr
        key={entity.id}
        data-saving={saving || undefined}
        data-entity-status={entity.status ?? undefined}
      >
        <Table.Td className="hierarchy-title-cell">
          <Group gap={6} wrap="nowrap">
            {isProject && (
              <button
                aria-expanded={expanded}
                aria-label={`${entity.displayName ?? entity.id}のTaskを${expanded ? "閉じる" : "開く"}`}
                className="hierarchy-expand-button"
                type="button"
                onClick={() => onToggleProject(entity.id)}
              >
                ›
              </button>
            )}
            <EntityIcon type={entity.type} status={entity.status} />
            <button
              className="hierarchy-title-button"
              title={entity.displayName ?? entity.id}
              aria-label={entity.displayName ?? entity.id}
              type="button"
              data-open-entity={entity.id}
              onClick={() => onOpenEntity(entity.id)}
            >
              <span>{entity.displayName ?? entity.id}</span>
              <span className="hierarchy-row-caption">
                <EntityStatusLight status={entity.status} />
                {STATUS_OPTIONS.find((option) => option.value === entity.status)
                  ?.label ?? ""}
                {isProject ? ` · ${projectTasks.length} tasks` : ""}
              </span>
            </button>
          </Group>
        </Table.Td>
        <Table.Td data-column="status">
          <Select
            aria-label={`${entity.displayName ?? entity.id}のステータス`}
            className="hierarchy-cell-control"
            leftSection={
              entity.status === "in_progress" ? (
                <EntityStatusLight status={entity.status} />
              ) : undefined
            }
            leftSectionWidth={18}
            data={[...STATUS_OPTIONS]}
            value={entity.status}
            disabled={controlsDisabled}
            allowDeselect={false}
            onChange={(value) => {
              if (value !== null) onPatch(entity, { status: value });
            }}
          />
        </Table.Td>
        <Table.Td data-column="priority">
          <Select
            aria-label={`${entity.displayName ?? entity.id}の優先度`}
            className="hierarchy-cell-control"
            data={[...PRIORITY_OPTIONS]}
            value={entity.priority}
            placeholder="—"
            clearable
            disabled={controlsDisabled}
            onChange={(value) => onPatch(entity, { priority: value })}
          />
        </Table.Td>
        {kind === "task" && (
          <Table.Td data-column="dueAt">
            <TaskDeadlineInput
              compact
              value={entity.dueAt}
              ariaLabel={`${entity.displayName ?? entity.id}の期限`}
              disabled={controlsDisabled}
              onCommit={(value) => onPatchDeadline(entity, value)}
              onError={onDeadlineError}
            />
          </Table.Td>
        )}
        {kind === "task" && (
          <Table.Td data-column="project">
            <EntitySelect
              entityType="project"
              aria-label={`${entity.displayName ?? entity.id}のProject`}
              className="hierarchy-cell-control hierarchy-relation-control"
              data={projectOptions}
              value={entity.projectId}
              placeholder="—"
              searchable
              clearable
              disabled={controlsDisabled}
              onChange={(value) => onPatch(entity, { projectId: value })}
            />
          </Table.Td>
        )}
        <Table.Td data-column="area">
          <EntitySelect
            entityType="area"
            aria-label={`${entity.displayName ?? entity.id}のArea`}
            className="hierarchy-cell-control hierarchy-relation-control"
            data={areaOptions}
            value={inheritedAreaId}
            placeholder="—"
            searchable
            clearable
            disabled={controlsDisabled || entity.projectId !== null}
            title={
              entity.projectId === null
                ? undefined
                : `${project?.displayName ?? "Project"}のAreaを継承しています`
            }
            onChange={(value) => onPatch(entity, { areaId: value })}
          />
        </Table.Td>
        <Table.Td data-column="topics">
          <EntityTopicsCell
            label={`${entity.displayName ?? entity.id}のTopics`}
            options={topicOptions}
            value={entity.topicIds.map(
              (topicId) => byId.get(topicId)?.displayName ?? topicId,
            )}
            readOnly={readOnly}
            disabled={saving}
            onChange={(value) => onPatchTopics(entity, value)}
          />
        </Table.Td>
        {kind === "project" && (
          <>
            <Table.Td className="hierarchy-count-cell" data-column="tasks">
              <button
                className="hierarchy-count-button"
                type="button"
                onClick={() => onToggleProject(entity.id)}
              >
                {projectTasks.length}
              </button>
            </Table.Td>
          </>
        )}
      </Table.Tr>
    );

    if (!expanded) return [row];
    return [
      row,
      <Table.Tr key={`${entity.id}:tasks`} className="hierarchy-detail-row">
        <Table.Td colSpan={columns.length}>
          {projectTasks.length === 0 ? (
            <Text c="dimmed" size="sm" py="xs">
              このProjectに紐づくTaskはありません。
            </Text>
          ) : (
            <EntityTable
              kind="task"
              items={projectTasks}
              byId={byId}
              projects={projects}
              areas={areas}
              topics={topics}
              tasksForProject={tasksForProject}
              effectiveAreaId={effectiveAreaId}
              readOnly={readOnly}
              savingIds={savingIds}
              expandedProjects={expandedProjects}
              onToggleProject={onToggleProject}
              onOpenEntity={onOpenEntity}
              onPatch={onPatch}
              onPatchTopics={onPatchTopics}
              onPatchDeadline={onPatchDeadline}
              onDeadlineError={onDeadlineError}
            />
          )}
        </Table.Td>
      </Table.Tr>,
    ];
  });

  return (
    <div className="hierarchy-table-scroll">
      <Table
        className="hierarchy-table"
        highlightOnHover
        horizontalSpacing="sm"
        verticalSpacing={6}
        style={{
          minWidth: columns.reduce((total, column) => total + column.width, 0),
        }}
      >
        <Table.Thead>
          <Table.Tr>
            {columns.map((column) => (
              <Table.Th
                key={column.key}
                w={column.width}
                data-column={column.key}
              >
                {column.label}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
    </div>
  );
};

export const HierarchyListView = ({
  storageKey,
  entities,
  view,
  groupMode,
  readOnly = false,
  onOpenEntity,
  onUpdateEntity,
  onUpdateTopics,
  onUpdateError,
  onViewChange,
  onGroupModeChange,
}: HierarchyListViewProps): React.JSX.Element => {
  const [layout, setLayout] = useStoredViewState<"list" | "table">(
    storageKey,
    "layout",
    "list",
    (v) => v === "list" || v === "table",
  );
  const mobile = useMobileLayout();
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const [deadline, setDeadline] = useStoredViewState<DeadlineFilter | null>(
    storageKey,
    "deadline",
    null,
  );
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const areas = entities
    .filter((entity) => entity.type === "area")
    .sort(compareEntities);
  const topics = entities
    .filter((entity) => entity.type === "topic")
    .sort(compareEntities);
  const projects = entities
    .filter((entity) => entity.type === "project" && isActiveWork(entity))
    .sort((a, b) => compareWork(a, b) || compareEntities(a, b));
  const tasks = entities
    .filter((entity) => entity.type === "task" && isActiveWork(entity))
    .filter(
      (entity) => view !== "task" || matchesDeadlineFilter(entity, deadline),
    )
    .sort((a, b) => compareWork(a, b) || compareEntities(a, b));
  const projectsById = new Map(
    entities
      .filter((entity) => entity.type === "project")
      .map((project) => [project.id, project]),
  );
  const effectiveAreaId = (entity: PkmEntitySummary): string | null =>
    entity.areaId ??
    (entity.projectId === null
      ? null
      : (projectsById.get(entity.projectId)?.areaId ?? null));
  const projectTasks = new Map<string, PkmEntitySummary[]>();
  for (const task of tasks) {
    if (task.projectId === null) continue;
    const grouped = projectTasks.get(task.projectId) ?? [];
    grouped.push(task);
    projectTasks.set(task.projectId, grouped);
  }
  const tasksForProject = (projectId: string): readonly PkmEntitySummary[] =>
    projectTasks.get(projectId) ?? [];

  const toggleProject = (projectId: string): void => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const patchEntity = (
    entity: PkmEntitySummary,
    patch: HierarchyEntityPatch,
  ): void => {
    if (onUpdateEntity === undefined) return;
    setSavingIds((current) => new Set(current).add(entity.id));
    void onUpdateEntity(entity.id, patch)
      .catch((reason: unknown) => onUpdateError?.(reason))
      .finally(() => {
        setSavingIds((current) => {
          const next = new Set(current);
          next.delete(entity.id);
          return next;
        });
      });
  };

  const patchTopics = (
    entity: PkmEntitySummary,
    topicNames: readonly string[],
  ): void => {
    if (onUpdateTopics === undefined) return;
    setSavingIds((current) => new Set(current).add(entity.id));
    void onUpdateTopics(entity.id, topicNames)
      .catch((reason: unknown) => onUpdateError?.(reason))
      .finally(() => {
        setSavingIds((current) => {
          const next = new Set(current);
          next.delete(entity.id);
          return next;
        });
      });
  };

  const groupsFor = (
    items: readonly PkmEntitySummary[],
    mode: HierarchyGroupMode,
  ): readonly EntityGroup[] => {
    if (mode === "none") return [{ id: "all", label: "すべて", items }];
    const groups = new Map<string, PkmEntitySummary[]>();
    const add = (id: string, item: PkmEntitySummary): void => {
      const grouped = groups.get(id) ?? [];
      grouped.push(item);
      groups.set(id, grouped);
    };
    for (const item of items) {
      if (mode === "area") {
        add(effectiveAreaId(item) ?? "unassigned", item);
      } else if (mode === "project") {
        add(item.projectId ?? "unassigned", item);
      } else if (item.topicIds.length === 0) {
        add("unassigned", item);
      } else {
        for (const topicId of item.topicIds) add(topicId, item);
      }
    }
    const labelFor = (id: string): string =>
      id === "unassigned"
        ? mode === "topic"
          ? "Topic未設定"
          : mode === "project"
            ? "Project未設定"
            : "Area未設定"
        : (byId.get(id)?.displayName ?? id);
    return [...groups.entries()]
      .map(([id, grouped]) => ({ id, label: labelFor(id), items: grouped }))
      .sort((a, b) => a.label.localeCompare(b.label, "ja"));
  };

  const tableProps = {
    byId,
    projects,
    areas,
    topics,
    tasksForProject,
    effectiveAreaId,
    readOnly: readOnly || onUpdateEntity === undefined,
    savingIds,
    expandedProjects,
    onToggleProject: toggleProject,
    onOpenEntity,
    onPatch: patchEntity,
    onDeadlineError: onUpdateError,
    onPatchDeadline: async (
      entity: PkmEntitySummary,
      value: string | null,
    ): Promise<void> => {
      if (onUpdateEntity === undefined) return;
      setSavingIds((current) => new Set(current).add(entity.id));
      try {
        await onUpdateEntity(entity.id, { dueAt: value });
      } finally {
        setSavingIds((current) => {
          const next = new Set(current);
          next.delete(entity.id);
          return next;
        });
      }
    },
    onPatchTopics: patchTopics,
  } as const;

  const renderGroups = (
    items: readonly PkmEntitySummary[],
    kind: "project" | "task",
  ): React.JSX.Element => (
    <Stack gap="md">
      {groupsFor(items, groupMode).map((group) => (
        <section key={group.id}>
          {groupMode !== "none" && (
            <Group mb="xs">
              <EntityIcon type={groupMode} />
              <Title order={4}>{group.label}</Title>
              <Badge variant="light">{group.items.length}</Badge>
            </Group>
          )}
          <Paper withBorder className="hierarchy-table-paper">
            <EntityTable kind={kind} items={group.items} {...tableProps} />
          </Paper>
        </section>
      ))}
    </Stack>
  );

  const areaGroups = [
    ...areas.map((area) => ({
      id: area.id,
      label: area.displayName ?? area.id,
      area,
    })),
    { id: "unassigned", label: "Area未設定", area: null },
  ].filter(
    ({ area }) =>
      projects.some((project) => project.areaId === (area?.id ?? null)) ||
      tasks.some(
        (task) =>
          task.projectId === null &&
          effectiveAreaId(task) === (area?.id ?? null),
      ),
  );

  return (
    <Stack
      className="hierarchy-view"
      data-layout={mobile ? "list" : layout}
      gap="lg"
    >
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Workspace</Title>
        </div>
        <Group align="flex-end">
          <SegmentedControl
            visibleFrom="sm"
            aria-label="一覧の表示形式"
            value={layout}
            onChange={(value) => setLayout(value)}
            data={[
              { value: "list", label: "一覧" },
              { value: "table", label: "表" },
            ]}
          />
          {view === "task" && (
            <Select
              label="期限"
              clearable
              value={deadline}
              onChange={(value) => setDeadline(value)}
              data={[
                { value: "overdue", label: "期限切れ（未完了）" },
                { value: "today", label: "今日" },
                { value: "next7days", label: "今日から7日間" },
                { value: "scheduled", label: "期限あり" },
                { value: "unscheduled", label: "期限なし" },
              ]}
            />
          )}

          {view !== "area" && (
            <Select
              label="グループ"
              value={groupMode}
              onChange={(value) => {
                if (
                  value === "none" ||
                  value === "area" ||
                  value === "topic" ||
                  value === "project"
                ) {
                  onGroupModeChange(value);
                }
              }}
              data={[
                { value: "none", label: "グループなし" },
                { value: "area", label: "Area" },
                { value: "topic", label: "Topic" },
                ...(view === "task"
                  ? [{ value: "project", label: "Project" }]
                  : []),
              ]}
              allowDeselect={false}
              w={170}
            />
          )}
          <SegmentedControl
            aria-label="階層表示"
            value={view}
            onChange={(value) => {
              if (value === "area" || value === "project" || value === "task") {
                onViewChange(value);
                if (value === "project" && groupMode === "project") {
                  onGroupModeChange("area");
                }
              }
            }}
            data={[
              { value: "area", label: "Area" },
              { value: "project", label: "Project" },
              { value: "task", label: "Task" },
            ]}
          />
        </Group>
      </Group>

      {view === "area" && (
        <Stack gap="md">
          {areaGroups.map(({ id, label, area }) => {
            const areaProjects = projects.filter(
              (project) => project.areaId === (area?.id ?? null),
            );
            const directTasks = tasks.filter(
              (task) =>
                task.projectId === null &&
                effectiveAreaId(task) === (area?.id ?? null),
            );
            return (
              <Paper
                key={id}
                withBorder
                p="md"
                className="hierarchy-area-group"
              >
                <Group justify="space-between" mb="sm">
                  <Group>
                    {area !== null && <EntityIcon type="area" />}
                    {area === null ? (
                      <Title order={3}>{label}</Title>
                    ) : (
                      <button
                        className="area-title-button"
                        type="button"
                        data-open-entity={area.id}
                        onClick={() => onOpenEntity(area.id)}
                      >
                        {label}
                      </button>
                    )}
                    <Badge variant="light">Project {areaProjects.length}</Badge>
                  </Group>
                </Group>
                {area !== null && (
                  <Group className="area-property-summary" gap="lg" mb="md">
                    <Group gap="xs">
                      <Text c="dimmed" size="xs" fw={650}>
                        Topics
                      </Text>
                      {area.topicIds.length === 0 ? (
                        <Text c="dimmed" size="sm">
                          —
                        </Text>
                      ) : (
                        area.topicIds.map((topicId) => (
                          <Badge color="grape" key={topicId} variant="light">
                            {byId.get(topicId)?.displayName ?? topicId}
                          </Badge>
                        ))
                      )}
                    </Group>
                  </Group>
                )}
                <Stack gap="sm">
                  {areaProjects.length > 0 && (
                    <EntityTable
                      kind="project"
                      items={areaProjects}
                      {...tableProps}
                    />
                  )}
                  {directTasks.length > 0 && (
                    <EntityTable
                      kind="task"
                      items={directTasks}
                      {...tableProps}
                    />
                  )}
                  {areaProjects.length === 0 && directTasks.length === 0 && (
                    <Text c="dimmed" size="sm">
                      このAreaにProjectやTaskはありません。
                    </Text>
                  )}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
      {view === "project" && renderGroups(projects, "project")}
      {view === "task" && renderGroups(tasks, "task")}
      {view === "project" && projects.length === 0 && (
        <Text c="dimmed">Projectはまだありません。</Text>
      )}
      {view === "task" && tasks.length === 0 && (
        <Text c="dimmed">Taskはまだありません。</Text>
      )}
      <Text c="dimmed" size="xs">
        Area {areaGroups.filter((group) => group.area !== null).length} ·
        Project {projects.length} · Task {tasks.length} · Topic {topics.length}
      </Text>
    </Stack>
  );
};
