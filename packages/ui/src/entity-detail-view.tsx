import { EntityQueryContext } from "./entity-query-context.js";
import { EntitySystemInfo } from "./entity-system-info.js";
import type { AssetUploader } from "./asset-links.js";
import { EntityRelatedEntries } from "./entity-entry-view.js";
import {
  ResourceAuthorsInput,
  ResourceRelationsInput,
} from "./resource-properties.js";
import { SourceLink } from "./source-link.js";
import { blurOnInputExit } from "./input-keyboard.js";
import { EntitySelect, EntityTagsInput } from "./entity-query-context.js";
import { formatDeadline } from "./task-deadline.js";
import { TaskDeadlineInput } from "./task-deadline-input.js";
import {
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  RESOURCE_TYPE_OPTIONS,
} from "./entity-options.js";
import {
  canCreateInContext,
  type HierarchyEntityPatch,
} from "./entity-actions.js";
import type { EntityType, EntryRelationMode } from "@pkm/contracts";
import {
  Accordion,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useContext, useEffect, useState } from "react";

import {
  EntityDataTable,
  type EntityTableColumnDefinition,
  type EntityDataTableProps,
} from "./entity-data-table.js";
import { EntityIcon } from "./entity-icon.js";
import { EntityStatusLight } from "./entity-status.js";
import type { PkmBacklink, PkmEntitySummary } from "@pkm/contracts";

const displayNameFor = (
  entityId: string,
  entities: readonly PkmEntitySummary[],
): string =>
  entities.find((candidate) => candidate.id === entityId)?.displayName ??
  entityId;

export interface EntryPropertiesPanelProps {
  readonly entity: PkmEntitySummary;
  readonly entities: readonly PkmEntitySummary[];
  readonly readOnly?: boolean;
  readonly onUpdateJournalDate?: (value: string | null) => Promise<void>;
  readonly onUpdateOccurredAt?: (value: string | null) => Promise<void>;
  readonly onUpdateTopics?: (topicNames: readonly string[]) => Promise<void>;
  readonly onUpdateError?: (reason: unknown) => void;
}

export const EntryPropertiesPanel = ({
  entity,
  entities,
  readOnly = false,
  onUpdateJournalDate,
  onUpdateOccurredAt,
  onUpdateTopics,
  onUpdateError,
}: EntryPropertiesPanelProps): React.JSX.Element => {
  const [journalDate, setJournalDate] = useState(entity.journalDate ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(
    () => setJournalDate(entity.journalDate ?? ""),
    [entity.id, entity.journalDate],
  );
  const saveJournalDate = (): void => {
    if (onUpdateJournalDate === undefined) return;
    const next = journalDate || null;
    if (next === entity.journalDate) return;
    setSaving(true);
    void Promise.resolve()
      .then(() => onUpdateJournalDate(next))
      .catch((reason: unknown) => {
        setJournalDate(entity.journalDate ?? "");
        onUpdateError?.(reason);
      })
      .finally(() => setSaving(false));
  };
  const updateTopics = (topicNames: readonly string[]): void => {
    if (onUpdateTopics === undefined) return;
    setSaving(true);
    void Promise.resolve()
      .then(() => onUpdateTopics(topicNames))
      .catch((reason: unknown) => onUpdateError?.(reason))
      .finally(() => setSaving(false));
  };
  return (
    <Accordion key={entity.id} variant="contained">
      <Accordion.Item value="properties">
        <Accordion.Control>プロパティ</Accordion.Control>
        <Accordion.Panel>
          <Table>
            <Table.Tbody>
              <Table.Tr>
                <Table.Th>日時</Table.Th>
                <Table.Td>
                  {onUpdateOccurredAt === undefined ? (
                    formatDeadline(entity.occurredAt)
                  ) : (
                    <TaskDeadlineInput
                      ariaLabel="Entryの日時"
                      compact
                      value={entity.occurredAt}
                      disabled={readOnly || saving}
                      onCommit={onUpdateOccurredAt}
                      onError={onUpdateError}
                    />
                  )}
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Daily日付</Table.Th>
                <Table.Td>
                  {onUpdateJournalDate === undefined ? (
                    (entity.journalDate ?? "—")
                  ) : (
                    <TextInput
                      aria-label="Daily日付"
                      type="date"
                      value={journalDate}
                      disabled={readOnly || saving}
                      onChange={(event) =>
                        setJournalDate(event.currentTarget.value)
                      }
                      onBlur={saveJournalDate}
                      onKeyDown={blurOnInputExit}
                    />
                  )}
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Topics</Table.Th>
                <Table.Td>
                  {onUpdateTopics !== undefined ? (
                    <EntityTagsInput
                      aria-label="EntryのTopics"
                      data={entities
                        .filter((candidate) => candidate.type === "topic")
                        .map(
                          (candidate) => candidate.displayName ?? candidate.id,
                        )}
                      value={entity.topicIds.map((topicId) =>
                        displayNameFor(topicId, entities),
                      )}
                      disabled={readOnly || saving}
                      clearable
                      splitChars={[",", "、"]}
                      onChange={updateTopics}
                    />
                  ) : entity.topicIds.length === 0 ? (
                    "—"
                  ) : (
                    entity.topicIds
                      .map((topicId) => displayNameFor(topicId, entities))
                      .join(", ")
                  )}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Accordion.Panel>
      </Accordion.Item>
      <EntitySystemInfo entity={entity} />
    </Accordion>
  );
};

export interface EntityPropertiesPanelProps {
  readonly entity: PkmEntitySummary;
  readonly entities: readonly PkmEntitySummary[];
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
  readonly onUpdate: (patch: HierarchyEntityPatch) => Promise<void>;
  readonly onUpdateTopics?:
    ((topicNames: readonly string[]) => Promise<void>) | undefined;
  readonly onUpdateError?: (reason: unknown) => void;
  readonly onUploadAsset?: AssetUploader | undefined;
  readonly onOpenAsset?:
    ((path: string, fileName?: string) => void) | undefined;
  readonly assetActionLabel?: string;
}

export const EntityPropertiesPanel = ({
  entity,
  entities,
  readOnly = false,
  disabled: temporarilyDisabled = false,
  onUpdate,
  onUpdateTopics,
  onUpdateError,
  onUploadAsset,
  onOpenAsset,
  assetActionLabel = "ファイルを開く",
}: EntityPropertiesPanelProps): React.JSX.Element => {
  const [description, setDescription] = useState(entity.description ?? "");
  useEffect(
    () => setDescription(entity.description ?? ""),
    [entity.id, entity.description],
  );
  const [displayName, setDisplayName] = useState(entity.displayName ?? "");
  const [canonicalIdentifier, setCanonicalIdentifier] = useState(
    entity.canonicalIdentifier ?? "",
  );
  const [sourceUri, setSourceUri] = useState(entity.sourceUri ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const optionsFor = (type: string) =>
    entities
      .filter((candidate) => candidate.type === type)
      .map((candidate) => ({
        value: candidate.id,
        label: candidate.displayName ?? candidate.id,
      }));
  const inheritedAreaId =
    entity.type === "task" && entity.projectId !== null
      ? (entities.find((candidate) => candidate.id === entity.projectId)
          ?.areaId ?? null)
      : entity.areaId;

  useEffect(
    () => setDisplayName(entity.displayName ?? ""),
    [entity.id, entity.displayName],
  );
  useEffect(
    () => setCanonicalIdentifier(entity.canonicalIdentifier ?? ""),
    [entity.id, entity.canonicalIdentifier],
  );
  useEffect(
    () => setSourceUri(entity.sourceUri ?? ""),
    [entity.id, entity.sourceUri],
  );

  const update = (patch: HierarchyEntityPatch): void => {
    setSaving(true);
    void onUpdate(patch)
      .catch((reason: unknown) => onUpdateError?.(reason))
      .finally(() => setSaving(false));
  };

  const commitDisplayName = (): void => {
    if (displayName.trim().length === 0 || displayName === entity.displayName) {
      setDisplayName(entity.displayName ?? "");
      return;
    }
    update({ displayName });
  };

  const disabled = readOnly || saving || temporarilyDisabled;
  const updateTopics = (topicNames: readonly string[]): void => {
    if (onUpdateTopics === undefined) return;
    setSaving(true);
    void onUpdateTopics(topicNames)
      .catch((reason: unknown) => onUpdateError?.(reason))
      .finally(() => setSaving(false));
  };
  return (
    <Accordion key={entity.id} variant="contained">
      <Accordion.Item value="properties">
        <Accordion.Control>プロパティ</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <TextInput
              label={
                entity.type === "topic" || entity.type === "area"
                  ? "名前"
                  : "タイトル"
              }
              value={displayName}
              disabled={disabled}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              onBlur={commitDisplayName}
              onKeyDown={blurOnInputExit}
            />
            {entity.type !== "entry" && (
              <TextInput
                label="説明"
                value={description}
                disabled={disabled}
                onChange={(event) => setDescription(event.currentTarget.value)}
                onBlur={() => {
                  const next = description.trim() || null;
                  if (next !== (entity.description ?? null))
                    update({ description: next });
                }}
                onKeyDown={blurOnInputExit}
              />
            )}
            {(entity.type === "project" || entity.type === "task") && (
              <Group grow align="start">
                <Select
                  allowDeselect={false}
                  data={[...STATUS_OPTIONS]}
                  label="ステータス"
                  leftSection={
                    entity.status === "in_progress" ? (
                      <EntityStatusLight status={entity.status} />
                    ) : undefined
                  }
                  leftSectionWidth={22}
                  value={entity.status}
                  disabled={disabled}
                  onChange={(value) => {
                    if (value !== null) update({ status: value });
                  }}
                />
                <Select
                  clearable
                  data={[...PRIORITY_OPTIONS]}
                  label="優先度"
                  placeholder="未設定"
                  value={entity.priority}
                  disabled={disabled}
                  onChange={(value) => update({ priority: value })}
                />
              </Group>
            )}
            {entity.type === "task" && (
              <TaskDeadlineInput
                key={entity.id}
                label="期限"
                value={entity.dueAt}
                disabled={disabled}
                onCommit={async (value) => {
                  setSaving(true);
                  try {
                    await onUpdate({ dueAt: value });
                  } finally {
                    setSaving(false);
                  }
                }}
                onError={onUpdateError}
              />
            )}
            {entity.type === "project" && (
              <EntitySelect
                entityType="area"
                clearable
                searchable
                data={optionsFor("area")}
                label="Area"
                value={entity.areaId}
                disabled={disabled}
                onChange={(value) => update({ areaId: value })}
              />
            )}
            {entity.type === "task" && (
              <Group grow align="start">
                <EntitySelect
                  entityType="project"
                  clearable
                  searchable
                  data={optionsFor("project")}
                  label="Project"
                  value={entity.projectId}
                  disabled={disabled}
                  onChange={(value) => update({ projectId: value })}
                />
                <EntitySelect
                  entityType="area"
                  clearable
                  searchable
                  data={optionsFor("area")}
                  label="Area"
                  value={inheritedAreaId}
                  disabled={disabled || entity.projectId !== null}
                  onChange={(value) => update({ areaId: value })}
                />
              </Group>
            )}
            {entity.type !== "topic" && (
              <EntityTagsInput
                clearable
                data={optionsFor("topic").map((topic) => topic.label)}
                label="Topics"
                value={entity.topicIds.map((topicId) =>
                  displayNameFor(topicId, entities),
                )}
                disabled={disabled || onUpdateTopics === undefined}
                splitChars={[",", "、"]}
                onChange={updateTopics}
              />
            )}
            {entity.type === "resource" && (
              <>
                <ResourceAuthorsInput
                  value={entity.authors ?? []}
                  disabled={disabled}
                  onChange={(authors) => update({ authors })}
                />
                <ResourceRelationsInput
                  entityId={entity.id}
                  value={entity.relatedEntityIds ?? []}
                  entities={entities}
                  disabled={disabled}
                  onChange={(relatedEntityIds) => update({ relatedEntityIds })}
                />
              </>
            )}
            {entity.type === "resource" && (
              <Select
                label="資料種別"
                clearable
                data={RESOURCE_TYPE_OPTIONS}
                value={entity.resourceType ?? null}
                disabled={disabled}
                onChange={(value) => update({ resourceType: value })}
              />
            )}
            {entity.type === "resource" && (
              <Group grow align="start">
                <TextInput
                  label="Canonical ID"
                  placeholder="例: 10.1145/…"
                  value={canonicalIdentifier}
                  disabled={disabled}
                  onChange={(event) =>
                    setCanonicalIdentifier(event.currentTarget.value)
                  }
                  onBlur={() => {
                    const next = canonicalIdentifier.trim() || null;
                    if (next !== entity.canonicalIdentifier)
                      update({ canonicalIdentifier: next });
                  }}
                  onKeyDown={blurOnInputExit}
                />
                <TextInput
                  label="Source URI"
                  placeholder="https://…"
                  value={sourceUri}
                  rightSection={<SourceLink value={sourceUri} />}
                  rightSectionPointerEvents="all"
                  disabled={disabled}
                  onChange={(event) => setSourceUri(event.currentTarget.value)}
                  onBlur={() => {
                    const next = sourceUri.trim() || null;
                    if (next !== entity.sourceUri) update({ sourceUri: next });
                  }}
                  onKeyDown={blurOnInputExit}
                />
              </Group>
            )}
            {entity.type === "resource" && (
              <Group gap="xs">
                <Text size="sm">添付ファイル</Text>
                {entity.assetPath !== null && (
                  <Button
                    variant="subtle"
                    size="xs"
                    onClick={() => onOpenAsset?.(entity.assetPath as string)}
                    disabled={onOpenAsset === undefined}
                  >
                    {assetActionLabel} (
                    {entity.assetPath.split(".").at(-1)?.toUpperCase()})
                  </Button>
                )}
                {onUploadAsset !== undefined && !readOnly && (
                  <Button
                    component="label"
                    size="xs"
                    variant="light"
                    disabled={disabled}
                    loading={uploading}
                  >
                    {entity.assetPath === null
                      ? "ファイルを添付"
                      : "置き換える"}
                    <input
                      type="file"
                      disabled={disabled || uploading}
                      hidden
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (file === undefined) return;
                        setUploading(true);
                        void onUploadAsset(file)
                          .then((asset) => onUpdate({ assetPath: asset.path }))
                          .catch((reason: unknown) => onUpdateError?.(reason))
                          .finally(() => setUploading(false));
                      }}
                    />
                  </Button>
                )}
                {entity.assetPath !== null && !readOnly && (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    disabled={disabled}
                    onClick={() => update({ assetPath: null })}
                  >
                    解除
                  </Button>
                )}
              </Group>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
      <EntitySystemInfo entity={entity} />
    </Accordion>
  );
};

export interface EntityRelationTableProps {
  readonly storageKey?: string | undefined;
  readonly onCreate?: (() => void) | undefined;
  readonly createLabel?: string | undefined;
  readonly remoteSort?: EntityDataTableProps["remoteSort"];
  readonly footer?: React.ReactNode;
  readonly loading?: boolean;
  readonly hasMore?: boolean;
  readonly title: string;
  readonly entities: readonly PkmEntitySummary[];
  readonly allEntities: readonly PkmEntitySummary[];
  readonly columns: readonly EntityTableColumnDefinition[];
  readonly pinnedIds?: ReadonlySet<string> | undefined;
  readonly readOnly?: boolean | undefined;
  readonly onOpenEntity: (entityId: string) => void;
  readonly onTogglePinned?: ((entityId: string) => void) | undefined;
  readonly onUpdateEntity?:
    | ((entityId: string, patch: HierarchyEntityPatch) => Promise<void>)
    | undefined;
  readonly onDeleteEntity?: ((entityId: string) => Promise<void>) | undefined;
  readonly onUpdateTopics?:
    | ((entityId: string, topicNames: readonly string[]) => Promise<void>)
    | undefined;
  readonly onUpdateError?: ((reason: unknown) => void) | undefined;
}

export const EntityRelationTable = ({
  storageKey,
  onCreate,
  createLabel = "新規追加",
  remoteSort,
  footer,
  loading = false,
  hasMore = false,
  title,
  entities,
  allEntities,
  columns,
  pinnedIds,
  readOnly,
  onOpenEntity,
  onTogglePinned,
  onUpdateEntity,
  onUpdateTopics,
  onDeleteEntity,
  onUpdateError,
}: EntityRelationTableProps): React.JSX.Element => {
  if (entities.length === 0 && !loading) {
    return (
      <Paper withBorder className="detail-table-paper">
        <Group justify="space-between" p="sm">
          <Group gap="xs">
            <Title order={4}>{title}</Title>
            <Text c="dimmed" size="xs">
              0
            </Text>
          </Group>
          {onCreate && (
            <Button
              variant="subtle"
              color="gray"
              size="compact-xs"
              disabled={readOnly ?? false}
              onClick={onCreate}
            >
              ＋ {createLabel}
            </Button>
          )}
        </Group>
        {footer && <Stack p="sm">{footer}</Stack>}
      </Paper>
    );
  }
  return (
    <Paper withBorder className="detail-table-paper">
      <Group justify="space-between" p="sm" pb={0}>
        <Title order={4}>{title}</Title>
        <Badge variant="light">
          {loading && entities.length === 0
            ? "…"
            : `${entities.length}${hasMore ? "+" : ""}`}
        </Badge>
      </Group>
      <EntityDataTable
        storageKey={storageKey}
        initialView="table"
        initialSort={
          entities.some(
            (entity) => entity.type === "project" || entity.type === "task",
          )
            ? { key: "workflow", direction: "asc" }
            : undefined
        }
        showViewControl={false}
        remoteSort={remoteSort}
        emptyMessage={loading ? "読み込み中…" : "該当するEntityはありません。"}
        allEntities={allEntities}
        columns={columns}
        entities={entities}
        pinnedIds={pinnedIds}
        readOnly={readOnly}
        onOpenEntity={onOpenEntity}
        onTogglePinned={onTogglePinned}
        onUpdateEntity={onUpdateEntity}
        onUpdateTopics={onUpdateTopics}
        onDeleteEntity={onDeleteEntity}
        onUpdateError={onUpdateError}
      />
      {footer && <Stack p="sm">{footer}</Stack>}
      {onCreate !== undefined && (
        <Button
          fullWidth
          variant="subtle"
          color="gray"
          className="entity-table-create"
          disabled={readOnly ?? false}
          onClick={onCreate}
        >
          ＋ {createLabel}
        </Button>
      )}
    </Paper>
  );
};

export const entityRelationTables = (
  entity: Pick<PkmEntitySummary, "type">,
) => {
  const sharedColumns: readonly EntityTableColumnDefinition[] = [
    { kind: "pin", label: "Pin", width: 42 },
    { kind: "name", label: "名前", editable: true, showEntityType: true },
  ];
  const projectColumns: readonly EntityTableColumnDefinition[] = [
    ...sharedColumns,
    { kind: "status", label: "ステータス", editable: true },
    { kind: "priority", label: "優先度", editable: true },
    ...(entity.type === "area"
      ? []
      : ([{ kind: "area", label: "Area", editable: true }] as const)),
    { kind: "topics", label: "Topics", editable: true },
  ];
  const taskColumns: readonly EntityTableColumnDefinition[] = [
    ...sharedColumns,
    { kind: "dueAt", label: "期限", editable: true },
    { kind: "status", label: "ステータス", editable: true },
    { kind: "priority", label: "優先度", editable: true },
    ...(entity.type === "project"
      ? []
      : ([{ kind: "project", label: "Project", editable: true }] as const)),
    ...(entity.type === "area"
      ? []
      : ([{ kind: "area", label: "Area", editable: true }] as const)),
    { kind: "topics", label: "Topics", editable: true },
  ];
  const resourceColumns: readonly EntityTableColumnDefinition[] = [
    ...sharedColumns,
    { kind: "resourceType", label: "資料種別", editable: true },
    { kind: "authors", label: "著者", editable: true },
    { kind: "relatedEntities", label: "関連", editable: true },
    { kind: "canonicalIdentifier", label: "Canonical ID", editable: true },
    { kind: "sourceUri", label: "Source URI", editable: true },
    { kind: "topics", label: "Topics", editable: true },
  ];
  const entryColumns: readonly EntityTableColumnDefinition[] = [
    { kind: "pin", label: "Pin", width: 42 },
    { kind: "name", label: "名前", showEntityType: true },
    { kind: "createdAt", label: "記録日時" },
    { kind: "topics", label: "Topics", editable: true },
  ];
  return [
    ...(entity.type === "resource"
      ? [
          {
            type: "area" as const,
            title: "Areas",
            columns: [
              ...sharedColumns,
              { kind: "topics" as const, label: "Topics", editable: true },
            ],
          },
        ]
      : []),
    ...(entity.type === "area" ||
    entity.type === "topic" ||
    entity.type === "resource"
      ? [
          {
            type: "project" as const,
            title: "Projects",
            columns: projectColumns,
          },
        ]
      : []),
    ...(entity.type === "area" ||
    entity.type === "project" ||
    entity.type === "topic" ||
    entity.type === "resource"
      ? [{ type: "task" as const, title: "Tasks", columns: taskColumns }]
      : []),
    { type: "entry" as const, title: "Entries", columns: entryColumns },
    ...(["area", "project", "task", "topic", "resource"].includes(entity.type)
      ? [
          {
            type: "resource" as const,
            title: "Resources",
            columns: resourceColumns,
          },
        ]
      : []),
  ];
};

export interface EntityRelationsViewProps {
  readonly entryRelationMode?: EntryRelationMode;
  readonly entriesEnabled?: boolean;

  readonly onCreate?:
    ((type: EntityType, context: PkmEntitySummary) => void) | undefined;
  readonly entity: PkmEntitySummary;
  readonly entities: readonly PkmEntitySummary[];
  readonly backlinks: readonly PkmBacklink[];
  readonly pinnedIds?: ReadonlySet<string> | undefined;
  readonly readOnly?: boolean | undefined;
  readonly onOpenEntity: (entityId: string) => void;
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

export const EntityRelationsView = ({
  entryRelationMode = "direct",
  entriesEnabled = true,
  onCreate,
  entity,
  entities,
  pinnedIds,
  readOnly,
  onOpenEntity,
  onTogglePinned,
  onUpdateEntity,
  onUpdateTopics,
  onDeleteEntity,
  onUpdateError,
}: EntityRelationsViewProps): React.JSX.Element => {
  const source = useContext(EntityQueryContext);
  const projects = entities.filter((candidate) => candidate.type === "project");
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const effectiveAreaId = (candidate: PkmEntitySummary): string | null =>
    candidate.areaId ??
    (candidate.projectId === null
      ? null
      : (projectById.get(candidate.projectId)?.areaId ?? null));
  const explicitlyRelated = (candidate: PkmEntitySummary): boolean =>
    candidate.id !== entity.id &&
    ((entity.type === "resource" &&
      (entity.relatedEntityIds ?? []).includes(candidate.id)) ||
      (candidate.type === "resource" &&
        (candidate.relatedEntityIds ?? []).includes(entity.id)));
  const relatedAreas = entities.filter(
    (candidate) => candidate.type === "area" && explicitlyRelated(candidate),
  );
  const relatedProjects = projects.filter(
    (project) =>
      explicitlyRelated(project) ||
      (entity.type === "area" && project.areaId === entity.id) ||
      (entity.type === "topic" && project.topicIds.includes(entity.id)),
  );
  const relatedTasks = entities.filter(
    (candidate) =>
      candidate.type === "task" &&
      (explicitlyRelated(candidate) ||
        (entity.type === "area" && effectiveAreaId(candidate) === entity.id) ||
        (entity.type === "project" && candidate.projectId === entity.id) ||
        (entity.type === "topic" && candidate.topicIds.includes(entity.id))),
  );
  const relatedResources = entities.filter(
    (candidate) =>
      candidate.type === "resource" &&
      (explicitlyRelated(candidate) ||
        (entity.type === "topic" && candidate.topicIds.includes(entity.id))),
  );
  const relationProps = {
    allEntities: entities,
    pinnedIds,
    readOnly,
    onOpenEntity,
    onTogglePinned,
    onUpdateEntity,
    onUpdateTopics,
    onDeleteEntity,
    onUpdateError,
  };

  return (
    <Stack gap="md">
      {entityRelationTables(entity).map((table) =>
        table.type === "entry" ? (
          <EntityRelatedEntries
            key="entry"
            {...relationProps}
            entity={entity}
            relationMode={entryRelationMode}
            enabled={entriesEnabled}
            onCreate={
              onCreate && canCreateInContext("entry", entity)
                ? () => onCreate("entry", entity)
                : undefined
            }
            createLabel="メモを追加"
          />
        ) : (
          <EntityRelationTable
            storageKey={
              source?.vaultId
                ? `pkm:${source.vaultId}:relation:${entity.id}:${table.type}`
                : undefined
            }
            key={table.type}
            {...relationProps}
            title={table.title}
            entities={
              table.type === "area"
                ? relatedAreas
                : table.type === "project"
                  ? relatedProjects
                  : table.type === "task"
                    ? relatedTasks
                    : table.type === "resource"
                      ? relatedResources
                      : []
            }
            columns={table.columns}
            createLabel={`新規${table.type[0]!.toUpperCase()}${table.type.slice(1)}`}
            onCreate={
              onCreate !== undefined && canCreateInContext(table.type, entity)
                ? () => onCreate(table.type, entity)
                : undefined
            }
          />
        ),
      )}
    </Stack>
  );
};

export interface BacklinksTableProps {
  readonly groups?: readonly BacklinkGroup[] | undefined;
  readonly onExpandedChange?: ((expanded: boolean) => void) | undefined;
  readonly footer?: React.ReactNode;
  readonly countKnown?: boolean;
  readonly backlinks: readonly PkmBacklink[];
  readonly onOpenEntity: (entityId: string) => void;
}

interface BacklinkGroup {
  readonly sourceId: string;
  readonly sourceType: string;
  readonly sourceDisplayName: string | null;
  readonly kinds: readonly string[];
  readonly labels: readonly string[];
  readonly count: number;
}

const groupBacklinks = (
  backlinks: readonly PkmBacklink[],
): readonly BacklinkGroup[] => {
  const groups = new Map<
    string,
    Omit<BacklinkGroup, "kinds" | "labels" | "count"> & {
      readonly kinds: Set<string>;
      readonly labels: Set<string>;
      count: number;
    }
  >();
  for (const backlink of backlinks) {
    const current = groups.get(backlink.sourceId);
    if (current === undefined) {
      groups.set(backlink.sourceId, {
        sourceId: backlink.sourceId,
        sourceType: backlink.sourceType,
        sourceDisplayName: backlink.sourceDisplayName,
        kinds: new Set([backlink.kind]),
        labels: new Set(backlink.label === null ? [] : [backlink.label]),
        count: 1,
      });
    } else {
      current.kinds.add(backlink.kind);
      if (backlink.label !== null) current.labels.add(backlink.label);
      current.count += 1;
    }
  }
  return [...groups.values()].map((group) => ({
    ...group,
    kinds: [...group.kinds],
    labels: [...group.labels],
  }));
};

export const BacklinksTable = ({
  groups: providedGroups,
  onExpandedChange,
  footer,
  countKnown = true,
  backlinks,
  onOpenEntity,
}: BacklinksTableProps): React.JSX.Element => {
  const groups = providedGroups ?? groupBacklinks(backlinks);
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="detail-table-paper backlinks-panel"
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setExpanded(open);
        onExpandedChange?.(open);
      }}
    >
      <summary>
        Backlinks {countKnown && <Badge variant="light">{groups.length}</Badge>}
      </summary>
      {expanded && (
        <>
          {groups.length === 0 ? (
            countKnown && (
              <Text c="dimmed" size="sm" p="sm">
                このEntityへの参照はありません。
              </Text>
            )
          ) : (
            <div className="detail-table-scroll">
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>参照元</Table.Th>
                    <Table.Th>種別</Table.Th>
                    <Table.Th>関係</Table.Th>
                    <Table.Th>ラベル</Table.Th>
                    <Table.Th>件数</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {groups.map((backlink) => (
                    <Table.Tr key={backlink.sourceId}>
                      <Table.Td>
                        <button
                          className="detail-entity-link"
                          type="button"
                          data-open-entity={backlink.sourceId}
                          onClick={() => onOpenEntity(backlink.sourceId)}
                        >
                          {backlink.sourceDisplayName ?? backlink.sourceId}
                        </button>
                      </Table.Td>
                      <Table.Td>
                        <EntityIcon type={backlink.sourceType} />
                      </Table.Td>
                      <Table.Td>{backlink.kinds.join(" / ")}</Table.Td>
                      <Table.Td>
                        {backlink.labels.length === 0
                          ? "—"
                          : backlink.labels.join(" / ")}
                      </Table.Td>
                      <Table.Td>{backlink.count}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          )}
          {footer}
        </>
      )}
    </details>
  );
};
