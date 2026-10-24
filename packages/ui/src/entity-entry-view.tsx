import { useStoredViewState } from "./stored-view-state.js";
import { Button, Group, SegmentedControl, Stack, Text } from "@mantine/core";
import { useContext, useState } from "react";
import type {
  EntryRelationMode,
  PkmEntitySummary,
  PkmAsset,
} from "@pkm/contracts";
import {
  QuickCaptureComposer,
  captureContextForEntity,
  type QuickCaptureInput,
} from "./quick-capture.js";
import { EntityQueryContext } from "./entity-query-context.js";
import { useEntityPage, EntityPageFooter } from "./use-entity-page.js";
import {
  EntryTimelineGroups,
  type EntryTimelineGroupsProps,
} from "./entry-timeline-groups.js";
import { groupTimelineEntries } from "./entry-timeline-view.js";
import {
  EntityRelationTable,
  entityRelationTables,
  type EntityRelationTableProps,
} from "./entity-detail-view.js";

export type EntityEntryDisplayMode = "detail" | "timeline";
export interface EntityEntryViewState {
  readonly mode: EntityEntryDisplayMode;
  readonly relationMode: EntryRelationMode;
}
// UI state belongs to this running app, never to a Vault's canonical Markdown.
export class EntityEntryViewMemory {
  private readonly states = new Map<string, EntityEntryViewState>();
  read(vaultId: string, entityId: string): EntityEntryViewState {
    return (
      this.states.get(JSON.stringify([vaultId, entityId])) ?? {
        mode: "detail",
        relationMode: "direct",
      }
    );
  }
  write(vaultId: string, entityId: string, state: EntityEntryViewState): void {
    this.states.set(JSON.stringify([vaultId, entityId]), state);
  }
}
const memory = new EntityEntryViewMemory();
export const useEntityEntryViewState = (
  vaultId: string | null,
  entityId: string | null,
  entityType?: string,
) => {
  const [, changed] = useState(0);
  const state = memory.read(vaultId ?? "", entityId ?? "");
  const update = (patch: Partial<EntityEntryViewState>) => {
    memory.write(vaultId ?? "", entityId ?? "", { ...state, ...patch });
    changed((n) => n + 1);
  };
  return {
    ...state,
    relationMode:
      entityType && entityType !== "area" && entityType !== "project"
        ? ("direct" as const)
        : state.relationMode,
    // Entry pages always open their editor, including any old in-memory selection.
    mode: entityType === "entry" ? ("detail" as const) : state.mode,
    setMode: (mode: EntityEntryDisplayMode) =>
      update({ mode: entityType === "entry" ? "detail" : mode }),
    setRelationMode: (relationMode: EntryRelationMode) =>
      update({ relationMode }),
  };
};

export const EntityEntryViewControls = ({
  entityType,
  mode,
  relationMode,
  onModeChange,
  onRelationModeChange,
}: {
  entityType: string;
  mode: EntityEntryDisplayMode;
  relationMode: EntryRelationMode;
  onModeChange: (mode: EntityEntryDisplayMode) => void;
  onRelationModeChange: (mode: EntryRelationMode) => void;
}) => {
  if (entityType === "entry") return null;
  const hasDescendants = entityType === "area" || entityType === "project";
  return (
    <Group gap="sm" wrap="wrap">
      <SegmentedControl
        aria-label="Entity表示モード"
        value={mode}
        onChange={(value) => {
          if (value === "detail" || value === "timeline") onModeChange(value);
        }}
        data={[
          { value: "detail", label: "詳細" },
          { value: "timeline", label: "Timeline" },
        ]}
      />
      {hasDescendants && (
        <>
          <Text size="sm">関連Entry</Text>
          <SegmentedControl
            aria-label="Entryの関連範囲"
            value={relationMode}
            onChange={(value) => {
              if (value === "direct" || value === "scoped")
                onRelationModeChange(value);
            }}
            data={[
              { value: "direct", label: "直接のみ" },
              { value: "scoped", label: "配下も含む" },
            ]}
          />
        </>
      )}
    </Group>
  );
};

export const EntityEntryTimeline = ({
  entity,
  relationMode,
  onCreate,
  onCapture,
  captureStorageKey,
  contextEntities = [entity],
  onUploadAsset,
  enabled = true,
  ...props
}: Omit<EntryTimelineGroupsProps, "groups"> & {
  entity: PkmEntitySummary;
  relationMode: EntryRelationMode;
  onCreate?: (() => void) | undefined;
  onCapture?: ((input: QuickCaptureInput) => Promise<void>) | undefined;
  captureStorageKey?: string | undefined;
  contextEntities?: readonly PkmEntitySummary[];
  onUploadAsset?: ((file: File) => Promise<PkmAsset>) | undefined;
  enabled?: boolean;
}) => {
  const page = useEntityPage(
    {
      type: "entry",
      relatedTo: entity.id,
      entryRelationMode: relationMode,
      view: "timeline",
      sort: "createdAt",
      direction: "desc",
    },
    enabled,
  );
  return (
    <Stack className="entity-entry-timeline" gap="md">
      <Group justify="space-between">
        <Text fw={600}>
          Entries {page.items.length}
          {page.cursor ? "+" : ""}
        </Text>
        {onCreate && (
          <Button
            variant="default"
            disabled={props.readOnly ?? false}
            onClick={onCreate}
          >
            メモを追加
          </Button>
        )}
      </Group>
      {onCapture && !props.readOnly && entity.type !== "entry" && (
        <QuickCaptureComposer
          compact
          defaultCurrentContext
          onCapture={onCapture}
          currentContext={captureContextForEntity(entity, contextEntities)}
          contextEntities={contextEntities}
          storageKey={captureStorageKey}
          onUploadAsset={onUploadAsset}
          assetBaseUrl={props.assetBaseUrl}
          onOpenAsset={props.onOpenAsset}
        />
      )}
      {!page.loading && !page.error && page.items.length === 0 && (
        <Text c="dimmed">関連するEntryはありません。</Text>
      )}
      <EntryTimelineGroups
        {...props}
        groups={groupTimelineEntries(page.items)}
      />
      <EntityPageFooter page={page} />
    </Stack>
  );
};

export const EntityRelatedEntries = ({
  entity,
  relationMode,
  enabled = true,
  ...props
}: Omit<
  EntityRelationTableProps,
  | "entities"
  | "columns"
  | "title"
  | "remoteSort"
  | "footer"
  | "loading"
  | "hasMore"
> & {
  entity: PkmEntitySummary;
  relationMode: EntryRelationMode;
  enabled?: boolean;
}) => {
  const source = useContext(EntityQueryContext);
  const storageKey = source?.vaultId
    ? `pkm:${source.vaultId}:relation:${entity.id}:entry`
    : undefined;
  const [sort, setSort] = useStoredViewState<
    "name" | "createdAt" | "updatedAt" | "topics" | "origin"
  >(
    storageKey,
    "sort",
    "createdAt",
    (v) =>
      typeof v === "string" &&
      ["name", "createdAt", "updatedAt", "topics", "origin"].includes(v),
  );
  const [direction, setDirection] = useStoredViewState<"asc" | "desc">(
    storageKey,
    "direction",
    "desc",
    (v) => v === "asc" || v === "desc",
  );
  const page = useEntityPage(
    {
      type: "entry",
      relatedTo: entity.id,
      entryRelationMode: relationMode,
      sort,
      direction,
    },
    enabled,
  );
  const columns = entityRelationTables(entity).find(
    (table) => table.type === "entry",
  )!.columns;
  return (
    <EntityRelationTable
      {...props}
      title="Entries"
      columns={columns}
      entities={page.items}
      loading={page.loading}
      hasMore={page.cursor !== null}
      remoteSort={{
        key: sort,
        direction,
        onChange: (key, nextDirection) => {
          if (
            key === "name" ||
            key === "createdAt" ||
            key === "updatedAt" ||
            key === "topics" ||
            key === "origin"
          ) {
            setSort(key);
            setDirection(nextDirection);
          }
        },
      }}
      footer={<EntityPageFooter page={page} />}
    />
  );
};

export const useEntityEntryVaultId = () =>
  useContext(EntityQueryContext)?.vaultId ?? "";
