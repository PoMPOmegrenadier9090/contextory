import type { AssetUploader } from "@pkm/ui";
import { ResourceAuthorsInput, ResourceRelationsInput } from "@pkm/ui";
import { SourceLink } from "@pkm/ui";
import { blurOnInputExit, EntitySelect, EntityTagsInput } from "@pkm/ui";
import {
  TaskDeadlineInput,
  EntityStatusLight,
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  RESOURCE_TYPE_OPTIONS,
  EntitySystemInfo,
} from "@pkm/ui";
import {
  Accordion,
  Button,
  Checkbox,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  PRIORITIES,
  STATUSES,
  type AreaId,
  type EntryContexts,
  type Priority,
  type ProjectId,
  type ResourceId,
  type Status,
  type TaskId,
  type TopicId,
} from "@pkm/contracts";
import type { EntityMetadataPatch, ParsedEntity } from "@pkm/core";
import type { IndexedEntity } from "@pkm/storage-node";
import { useEffect, useState } from "react";

export interface EntityMetadataFormProps {
  readonly path?: string | undefined;
  readonly entity: ParsedEntity;
  readonly entities: readonly IndexedEntity[];
  readonly readOnly?: boolean;
  readonly onPatch: (patch: EntityMetadataPatch) => void;
  readonly onResolveTopics?:
    ((topicNames: readonly string[]) => Promise<readonly string[]>) | undefined;
  readonly onUploadAsset?: AssetUploader | undefined;
  readonly onOpenAsset?: ((path: string) => void) | undefined;
}

const entityDisplayName = (entity: ParsedEntity): string | null => {
  switch (entity.type) {
    case "entry":
      return entity.title ?? null;
    case "project":
    case "task":
    case "resource":
      return entity.title;
    case "topic":
    case "area":
      return entity.name;
  }
};

const isStatus = (value: string): value is Status =>
  STATUSES.some((status) => status === value);

const isPriority = (value: string): value is Priority =>
  PRIORITIES.some((priority) => priority === value);

export const EntityMetadataForm = ({
  path,
  entity,
  entities,
  readOnly = false,
  onPatch,
  onResolveTopics,
  onUploadAsset,
  onOpenAsset,
}: EntityMetadataFormProps): React.JSX.Element => {
  const [description, setDescription] = useState(
    entity.type === "entry" ? "" : (entity.description ?? ""),
  );
  useEffect(
    () =>
      setDescription(entity.type === "entry" ? "" : (entity.description ?? "")),
    [
      entity.id,
      entity.type,
      entity.type === "entry" ? null : entity.description,
    ],
  );
  const currentDisplayName = entityDisplayName(entity);
  const [displayName, setDisplayName] = useState(currentDisplayName ?? "");
  const [journalDate, setJournalDate] = useState(
    entity.type === "entry" ? (entity.journal_date ?? "") : "",
  );
  const [canonicalIdentifier, setCanonicalIdentifier] = useState(
    entity.type === "resource" ? (entity.canonical_identifier ?? "") : "",
  );
  const [sourceUri, setSourceUri] = useState(
    entity.type === "resource" ? (entity.source_uri ?? "") : "",
  );
  const [resolvingTopics, setResolvingTopics] = useState(false);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const optionsFor = (type: string) =>
    entities
      .filter((candidate) => candidate.type === type)
      .map((candidate) => ({
        value: candidate.id,
        label: candidate.displayName ?? candidate.id,
      }));
  const areaOptions = optionsFor("area");
  const projectOptions = optionsFor("project");
  const taskOptions = optionsFor("task");
  const resourceOptions = optionsFor("resource");
  const topicOptions = optionsFor("topic");
  const entryContexts: EntryContexts =
    entity.type === "entry"
      ? ((entity.contexts as EntryContexts | null) ?? {})
      : {};
  const inheritedTaskAreaId =
    entity.type === "task" && entity.project_id != null
      ? (entities.find((candidate) => candidate.id === entity.project_id)
          ?.areaId ?? null)
      : entity.type === "task"
        ? (entity.area_id ?? null)
        : null;

  useEffect(
    () => setDisplayName(currentDisplayName ?? ""),
    [entity.id, currentDisplayName],
  );
  const currentJournalDate =
    entity.type === "entry" ? (entity.journal_date ?? "") : "";
  const currentCanonicalIdentifier =
    entity.type === "resource" ? (entity.canonical_identifier ?? "") : "";
  const currentSourceUri =
    entity.type === "resource" ? (entity.source_uri ?? "") : "";
  useEffect(
    () => setJournalDate(currentJournalDate),
    [entity.id, currentJournalDate],
  );
  useEffect(
    () => setCanonicalIdentifier(currentCanonicalIdentifier),
    [entity.id, currentCanonicalIdentifier],
  );
  useEffect(
    () => setSourceUri(currentSourceUri),
    [entity.id, currentSourceUri],
  );

  const commitDisplayName = (): void => {
    if (entity.type === "entry") {
      if (displayName === (currentDisplayName ?? "")) return;
      onPatch({ displayName: displayName.trim() || null });
    } else if (displayName !== currentDisplayName) {
      onPatch({ displayName });
    }
  };

  return (
    <Accordion key={entity.id} variant="contained">
      <Accordion.Item value="properties">
        <Accordion.Control>プロパティを編集</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <TextInput
              label={
                entity.type === "topic" || entity.type === "area"
                  ? "名前"
                  : "タイトル"
              }
              value={displayName}
              disabled={readOnly}
              placeholder={
                entity.type === "entry" ? "タイトルを追加" : undefined
              }
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              onBlur={commitDisplayName}
              onKeyDown={blurOnInputExit}
            />
            {entity.type === "entry" && (
              <TaskDeadlineInput
                label="日時"
                value={entity.occurred_at ?? null}
                disabled={readOnly}
                onCommit={(value) => {
                  setDeadlineError(null);
                  onPatch({ occurredAt: value });
                  return Promise.resolve();
                }}
                onError={(reason) =>
                  setDeadlineError(
                    reason instanceof Error ? reason.message : String(reason),
                  )
                }
              />
            )}
            {entity.type === "entry" && deadlineError !== null && (
              <Text c="red" size="sm">
                {deadlineError}
              </Text>
            )}
            {entity.type === "entry" && (
              <TextInput
                label="Daily日付"
                type="date"
                value={journalDate}
                disabled={readOnly}
                onChange={(event) => setJournalDate(event.currentTarget.value)}
                onBlur={() => {
                  const next = journalDate || null;
                  if (next !== (entity.journal_date ?? null))
                    onPatch({ journalDate: next });
                }}
                onKeyDown={blurOnInputExit}
              />
            )}
            {entity.type !== "entry" && (
              <TextInput
                label="説明"
                value={description}
                disabled={readOnly}
                onChange={(event) => setDescription(event.currentTarget.value)}
                onBlur={() => {
                  const next = description.trim() || null;
                  if (next !== (entity.description ?? null))
                    onPatch({ description: next });
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
                  onChange={(value) => {
                    if (value !== null && isStatus(value))
                      onPatch({ status: value });
                  }}
                />
                <Select
                  clearable
                  data={[...PRIORITY_OPTIONS]}
                  label="優先度"
                  placeholder="未設定"
                  value={entity.priority ?? null}
                  onChange={(value) => {
                    if (value === null || isPriority(value)) {
                      onPatch({ priority: value });
                    }
                  }}
                />
              </Group>
            )}
            {entity.type === "entry" && (
              <>
                <Checkbox
                  checked={entity.exclude_from_ai}
                  label="AI処理から除外する"
                  onChange={(event) =>
                    onPatch({ excludeFromAi: event.currentTarget.checked })
                  }
                />
                <Group grow align="start">
                  <EntitySelect
                    entityType="area"
                    clearable
                    searchable
                    data={areaOptions}
                    label="Area"
                    value={entity.contexts?.area ?? null}
                    onChange={(value) =>
                      onPatch({
                        entryContexts: {
                          ...entryContexts,
                          area: value as AreaId | null,
                        },
                      })
                    }
                  />
                  <EntitySelect
                    entityType="project"
                    clearable
                    searchable
                    data={projectOptions}
                    label="Project"
                    value={entity.contexts?.project ?? null}
                    onChange={(value) =>
                      onPatch({
                        entryContexts: {
                          ...entryContexts,
                          project: value as ProjectId | null,
                        },
                      })
                    }
                  />
                </Group>
                <Group grow align="start">
                  <EntitySelect
                    entityType="task"
                    clearable
                    searchable
                    data={taskOptions}
                    label="Task"
                    value={entity.contexts?.task ?? null}
                    onChange={(value) =>
                      onPatch({
                        entryContexts: {
                          ...entryContexts,
                          task: value as TaskId | null,
                        },
                      })
                    }
                  />
                  <EntitySelect
                    entityType="resource"
                    clearable
                    searchable
                    data={resourceOptions}
                    label="Resource"
                    value={entity.contexts?.resource ?? null}
                    onChange={(value) =>
                      onPatch({
                        entryContexts: {
                          ...entryContexts,
                          resource: value as ResourceId | null,
                        },
                      })
                    }
                  />
                </Group>
              </>
            )}
            {entity.type === "task" && (
              <>
                <TaskDeadlineInput
                  key={entity.id}
                  label="期限"
                  value={entity.due_at ?? null}
                  disabled={readOnly}
                  onCommit={(value) => {
                    setDeadlineError(null);
                    onPatch({ dueAt: value });
                    return Promise.resolve();
                  }}
                  onError={(reason) =>
                    setDeadlineError(
                      reason instanceof Error ? reason.message : String(reason),
                    )
                  }
                />
                {deadlineError !== null && (
                  <Text c="red" size="xs">
                    {deadlineError}
                  </Text>
                )}
              </>
            )}
            {entity.type === "project" && (
              <EntitySelect
                entityType="area"
                clearable
                searchable
                data={areaOptions}
                label="Area"
                value={entity.area_id ?? null}
                onChange={(value) =>
                  onPatch({ areaId: value as AreaId | null })
                }
              />
            )}
            {entity.type === "task" && (
              <Group grow align="start">
                <EntitySelect
                  entityType="project"
                  clearable
                  searchable
                  data={projectOptions}
                  label="Project"
                  value={entity.project_id ?? null}
                  onChange={(value) =>
                    onPatch({ projectId: value as ProjectId | null })
                  }
                />
                <EntitySelect
                  entityType="area"
                  clearable
                  searchable
                  data={areaOptions}
                  disabled={entity.project_id != null}
                  label="Area"
                  value={inheritedTaskAreaId}
                  onChange={(value) =>
                    onPatch({ areaId: value as AreaId | null })
                  }
                />
              </Group>
            )}
            {entity.type !== "topic" && (
              <EntityTagsInput
                clearable
                data={topicOptions.map((topic) => topic.label)}
                label="Topics"
                value={(entity.topics ?? []).map(
                  (topicId) =>
                    entities.find((candidate) => candidate.id === topicId)
                      ?.displayName ?? topicId,
                )}
                disabled={resolvingTopics || onResolveTopics === undefined}
                splitChars={[",", "、"]}
                error={topicError}
                onChange={(value) => {
                  if (onResolveTopics === undefined) return;
                  setResolvingTopics(true);
                  setTopicError(null);
                  void onResolveTopics(value)
                    .then((topicIds) =>
                      onPatch({ topics: topicIds as TopicId[] }),
                    )
                    .catch((reason: unknown) =>
                      setTopicError(
                        reason instanceof Error
                          ? reason.message
                          : String(reason),
                      ),
                    )
                    .finally(() => setResolvingTopics(false));
                }}
              />
            )}
            {entity.type === "resource" && (
              <>
                <ResourceAuthorsInput
                  value={entity.authors ?? []}
                  disabled={readOnly}
                  onChange={(authors) => onPatch({ authors })}
                />
                <ResourceRelationsInput
                  entityId={entity.id}
                  value={entity.related_entity_ids ?? []}
                  entities={entities}
                  disabled={readOnly}
                  onChange={(relatedEntityIds) => onPatch({ relatedEntityIds })}
                />
              </>
            )}
            {entity.type === "resource" && (
              <Select
                label="資料種別"
                clearable
                data={RESOURCE_TYPE_OPTIONS}
                value={entity.resource_type ?? null}
                disabled={readOnly}
                onChange={(value) => onPatch({ resourceType: value })}
              />
            )}
            {entity.type === "resource" && (
              <Group grow align="start">
                <TextInput
                  label="Canonical ID"
                  placeholder="例: 10.1145/…"
                  value={canonicalIdentifier}
                  onChange={(event) =>
                    setCanonicalIdentifier(event.currentTarget.value)
                  }
                  onBlur={() => {
                    const next = canonicalIdentifier.trim() || null;
                    if (next !== (entity.canonical_identifier ?? null)) {
                      onPatch({ canonicalIdentifier: next });
                    }
                  }}
                  onKeyDown={blurOnInputExit}
                />
                <TextInput
                  label="Source URI"
                  placeholder="https://…"
                  value={sourceUri}
                  rightSection={<SourceLink value={sourceUri} />}
                  rightSectionPointerEvents="all"
                  onChange={(event) => setSourceUri(event.currentTarget.value)}
                  onBlur={() => {
                    const next = sourceUri.trim() || null;
                    if (next !== (entity.source_uri ?? null)) {
                      onPatch({ sourceUri: next });
                    }
                  }}
                  onKeyDown={blurOnInputExit}
                />
              </Group>
            )}
            {entity.type === "resource" && (
              <Group gap="xs">
                <Text size="sm">添付ファイル</Text>
                {entity.asset_path != null && (
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={onOpenAsset === undefined}
                    onClick={() => onOpenAsset?.(entity.asset_path as string)}
                  >
                    ファイルを開く (
                    {entity.asset_path.split(".").at(-1)?.toUpperCase()})
                  </Button>
                )}
                {onUploadAsset !== undefined && !readOnly && (
                  <Button
                    component="label"
                    size="xs"
                    variant="light"
                    loading={uploading}
                  >
                    {entity.asset_path == null
                      ? "ファイルを添付"
                      : "置き換える"}
                    <input
                      type="file"
                      hidden
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (file === undefined) return;
                        setUploading(true);
                        setUploadError(null);
                        void onUploadAsset(file)
                          .then((asset) => onPatch({ assetPath: asset.path }))
                          .catch((reason: unknown) =>
                            setUploadError(
                              reason instanceof Error
                                ? reason.message
                                : String(reason),
                            ),
                          )
                          .finally(() => setUploading(false));
                      }}
                    />
                  </Button>
                )}
                {entity.asset_path != null && !readOnly && (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    onClick={() => onPatch({ assetPath: null })}
                  >
                    解除
                  </Button>
                )}
                {uploadError !== null && (
                  <Text c="red" size="xs">
                    {uploadError}
                  </Text>
                )}
              </Group>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
      <EntitySystemInfo
        entity={{
          id: entity.id,
          type: entity.type,
          createdAt: entity.created_at,
          updatedAt: entity.updated_at,
          ...(path === undefined ? {} : { path }),
          ...(entity.type === "entry" ? { origin: entity.origin } : {}),
        }}
      />
    </Accordion>
  );
};
