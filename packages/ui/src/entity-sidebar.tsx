import { EntityCreateMenu } from "./entity-create-menu.js";
import {
  ActionIcon,
  Badge,
  Collapse,
  Group,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { useId, useState } from "react";
import { RESOURCE_TYPE_OPTIONS } from "./entity-options.js";
import type { EntityType, ResourceType } from "@pkm/contracts";

import { EntityIcon } from "./entity-icon.js";
import { EntityStatusLight } from "./entity-status.js";
import { entityUiTitle } from "./entity-label.js";
import type { PkmEntitySummary } from "@pkm/contracts";

const TYPES: readonly EntityType[] = [
  "area",
  "project",
  "task",
  "entry",
  "topic",
  "resource",
];

const TYPE_LABELS: Readonly<Record<EntityType, string>> = {
  area: "Areas",
  project: "Projects",
  task: "Tasks",
  entry: "Entries",
  topic: "Topics",
  resource: "Resources",
};

export interface EntitySidebarProps {
  readonly counts?: Partial<Record<EntityType, number>> | undefined;
  readonly entities: readonly PkmEntitySummary[];
  readonly selectedId: string | null;
  readonly activeType: EntityType | null;
  readonly activeResourceType?: ResourceType | undefined;
  readonly timelineActive?: boolean | undefined;
  readonly todosActive?: boolean | undefined;
  readonly pinnedIds: ReadonlySet<string>;
  readonly searchShortcut?: string | undefined;
  readonly onSearch?: (() => void) | undefined;
  readonly onOpenWorkspace: () => void;
  readonly onOpenTimeline?: (() => void) | undefined;
  readonly onOpenTodos?: (() => void) | undefined;
  readonly onOpenCollection: (
    type: EntityType,
    resourceType?: ResourceType,
  ) => void;
  readonly onOpenEntity: (entityId: string) => void;
  readonly onTogglePinned: (entityId: string) => void;
  readonly writable?: boolean | undefined;
  readonly onCreateEntity?: ((type: EntityType) => void) | undefined;
  readonly onRefresh?: (() => void) | undefined;
  readonly onOpenAttachments?: (() => void) | undefined;
  readonly onChangeVault?: (() => void) | undefined;
  readonly syncConflictCount?: number | undefined;
  readonly onOpenSyncConflicts?: (() => void) | undefined;
}

const EntityRow = ({
  entity,
  selected,
  pinned,
  onOpen,
  onTogglePinned,
}: {
  readonly entity: PkmEntitySummary;
  readonly selected: boolean;
  readonly pinned: boolean;
  readonly onOpen: () => void;
  readonly onTogglePinned: () => void;
}): React.JSX.Element => (
  <div className="sidebar-entity-row" data-entity-type={entity.type}>
    <button
      className="sidebar-entity-link"
      title={entityUiTitle(entity)}
      data-active={selected || undefined}
      data-open-entity={entity.id}
      onClick={onOpen}
      type="button"
    >
      <EntityIcon type={entity.type} status={entity.status} />
      <span>{entityUiTitle(entity)}</span>
      {entity.type === "project" && (
        <EntityStatusLight status={entity.status} />
      )}
    </button>
    <ActionIcon
      aria-label={`${entityUiTitle(entity)}のピンを${pinned ? "外す" : "追加"}`}
      className="sidebar-pin-button"
      color={pinned ? "yellow" : "gray"}
      size="sm"
      variant="subtle"
      onClick={onTogglePinned}
    >
      {pinned ? "★" : "☆"}
    </ActionIcon>
  </div>
);

export const EntitySidebar = ({
  entities,
  counts,
  selectedId,
  activeType,
  activeResourceType,
  timelineActive = false,
  todosActive = false,
  pinnedIds,
  onOpenWorkspace,
  onSearch,
  searchShortcut,
  onOpenTimeline,
  onOpenTodos,
  onOpenCollection,
  onOpenEntity,
  onTogglePinned,
  writable = true,
  onCreateEntity,
  onRefresh,
  onOpenAttachments,
  onChangeVault,
  syncConflictCount = 0,
  onOpenSyncConflicts,
}: EntitySidebarProps): React.JSX.Element => {
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const resourceListId = useId();
  const pinned = entities
    .filter((entity) => pinnedIds.has(entity.id))
    .sort((a, b) => entityUiTitle(a).localeCompare(entityUiTitle(b), "ja"));

  return (
    <Stack h="100%" gap="xs">
      {onSearch && (
        <button
          type="button"
          className="sidebar-search"
          onClick={onSearch}
          aria-label="Vault内を検索"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
          <span>検索</span>
          {searchShortcut && <kbd>{searchShortcut}</kbd>}
        </button>
      )}
      <Group gap={4} wrap="nowrap" aria-label="Workspace操作">
        {onCreateEntity !== undefined && (
          <EntityCreateMenu onCreate={onCreateEntity}>
            <ActionIcon
              aria-label="新規作成"
              title="新規作成"
              variant="subtle"
              disabled={!writable}
            >
              ＋
            </ActionIcon>
          </EntityCreateMenu>
        )}
        {onRefresh !== undefined && (
          <ActionIcon
            aria-label="一覧を更新"
            title="一覧を更新"
            variant="subtle"
            onClick={onRefresh}
          >
            ↻
          </ActionIcon>
        )}
        {onOpenAttachments !== undefined && (
          <ActionIcon
            aria-label="添付ファイルを整理"
            title="添付ファイルを整理"
            variant="subtle"
            onClick={onOpenAttachments}
          >
            📎
          </ActionIcon>
        )}
        {onChangeVault !== undefined && (
          <ActionIcon
            aria-label="Vaultを変更"
            title="Vaultを変更"
            variant="subtle"
            onClick={onChangeVault}
          >
            ◇
          </ActionIcon>
        )}
        {onOpenSyncConflicts !== undefined && syncConflictCount > 0 && (
          <ActionIcon
            aria-label={`同期競合を開く（${syncConflictCount}件）`}
            title={`同期競合（${syncConflictCount}件）`}
            color="orange"
            variant="light"
            onClick={onOpenSyncConflicts}
          >
            !
          </ActionIcon>
        )}
      </Group>
      <button
        className="sidebar-workspace-button"
        data-active={
          activeType === null &&
          selectedId === null &&
          !timelineActive &&
          !todosActive
            ? true
            : undefined
        }
        onClick={onOpenWorkspace}
        type="button"
      >
        ⌂ Home
      </button>
      {onOpenTimeline !== undefined && (
        <button
          className="sidebar-workspace-button"
          data-active={timelineActive || undefined}
          onClick={onOpenTimeline}
          type="button"
        >
          Timeline
        </button>
      )}
      {onOpenTodos !== undefined && (
        <button
          className="sidebar-workspace-button"
          data-active={todosActive || undefined}
          onClick={onOpenTodos}
          type="button"
        >
          チェックリスト
        </button>
      )}
      <ScrollArea flex={1} offsetScrollbars>
        <Stack gap="sm" pb="md">
          {pinned.length > 0 && (
            <section>
              <Group gap="xs" mb={4} px={4}>
                <Text fw={650} size="xs" c="dimmed">
                  PINNED
                </Text>
                <Badge size="xs" variant="light" color="yellow">
                  {pinned.length}
                </Badge>
              </Group>
              <Stack gap={2}>
                {pinned.map((entity) => (
                  <EntityRow
                    entity={entity}
                    key={`pinned:${entity.id}`}
                    selected={selectedId === entity.id}
                    pinned
                    onOpen={() => onOpenEntity(entity.id)}
                    onTogglePinned={() => onTogglePinned(entity.id)}
                  />
                ))}
              </Stack>
            </section>
          )}
          <Stack gap={2}>
            <Text
              className="sidebar-section-label"
              size="xs"
              c="dimmed"
              px={8}
              mt="sm"
              mb={4}
            >
              ライブラリ
            </Text>
            {TYPES.map((type) => (
              <div key={type}>
                <div className="sidebar-collection-row">
                  <button
                    className="sidebar-collection-button"
                    data-active={
                      (activeType === type &&
                        (type !== "resource" ||
                          activeResourceType === undefined)) ||
                      undefined
                    }
                    onClick={() => onOpenCollection(type)}
                    type="button"
                  >
                    <EntityIcon type={type} />
                    <span>{TYPE_LABELS[type]}</span>
                    <span className="sidebar-count">
                      {counts?.[type] ??
                        entities.filter((entity) => entity.type === type)
                          .length}
                    </span>
                  </button>
                  {type === "resource" && (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label="Resourceの種別を選ぶ"
                      aria-expanded={resourcesOpen}
                      aria-controls={resourceListId}
                      onClick={() => setResourcesOpen((opened) => !opened)}
                    >
                      {resourcesOpen ? "⌄" : "›"}
                    </ActionIcon>
                  )}
                </div>
                {type === "resource" && (
                  <Collapse expanded={resourcesOpen} id={resourceListId}>
                    <Stack gap={2} pl={24}>
                      {RESOURCE_TYPE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className="sidebar-collection-button"
                          data-active={
                            (activeType === "resource" &&
                              activeResourceType === option.value) ||
                            undefined
                          }
                          onClick={() =>
                            onOpenCollection("resource", option.value)
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </Stack>
                  </Collapse>
                )}
              </div>
            ))}
          </Stack>
        </Stack>
      </ScrollArea>
    </Stack>
  );
};
