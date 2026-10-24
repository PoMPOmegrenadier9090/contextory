import {
  Alert,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useContext, useEffect, useRef, useState } from "react";
import type {
  EntityPageQuery,
  EntitySort,
  EntityType,
  PkmClient,
  PkmEntitySummary,
} from "@pkm/contracts";
import { EntityQueryContext } from "./entity-query-context.js";
import {
  entityRelationTables,
  EntityRelationTable,
} from "./entity-detail-view.js";
import type { EntityRelationsViewProps } from "./entity-detail-view.js";
import type { EntityTableColumnKind } from "./entity-data-table.js";
import { EntryTimelineFeed } from "./entry-timeline-feed.js";
import { groupTimelineEntries } from "./entry-timeline-view.js";
import { canCreateInContext } from "./entity-actions.js";
import {
  QuickCaptureComposer,
  captureContextForEntity,
} from "./quick-capture.js";
import type { QuickCaptureInput } from "./quick-capture.js";
import type { PkmAsset } from "./asset-links.js";

export type EntityActivityMode = "detail" | "timeline";
export type EntityRelationResolution = "direct" | "transitive";
export const EntityActivityControls = ({
  mode,
  onModeChange,
  resolution,
  onResolutionChange,
  type,
}: {
  readonly mode: EntityActivityMode;
  readonly onModeChange: (mode: EntityActivityMode) => void;
  readonly resolution: EntityRelationResolution;
  readonly onResolutionChange: (resolution: EntityRelationResolution) => void;
  readonly type: string;
}) => (
  <Group justify="space-between" wrap="wrap">
    <SegmentedControl
      aria-label="Entity表示モード"
      value={mode}
      onChange={(value) => {
        if (value === "detail" || value === "timeline") onModeChange(value);
      }}
      data={[
        { value: "detail", label: "詳細" },
        { value: "timeline", label: "Entry Timeline" },
      ]}
    />
    <Switch
      label={type === "entry" ? "このEntryへの直接参照" : "推移的に含める"}
      disabled={type === "entry"}
      checked={resolution === "transitive" && type !== "entry"}
      onChange={(event) =>
        onResolutionChange(
          event.currentTarget.checked ? "transitive" : "direct",
        )
      }
    />
  </Group>
);

interface ActivityProps extends Omit<EntityRelationsViewProps, "backlinks"> {
  readonly onCapture?:
    ((input: QuickCaptureInput) => Promise<void>) | undefined;
  readonly captureStorageKey?: string | undefined;
  readonly onUploadAsset?: ((file: File) => Promise<PkmAsset>) | undefined;
  readonly mode: EntityActivityMode;
  readonly resolution: EntityRelationResolution;
  readonly active?: boolean | undefined;
  readonly queryEntities?: PkmClient["queryEntities"] | undefined;
  readonly revision?: number | undefined;
  readonly loadEntity?: PkmClient["loadEntity"] | undefined;
  readonly assetBaseUrl?: string | undefined;
  readonly onOpenAsset?: ((path: string, name?: string) => void) | undefined;
  readonly onUpdateEntryBody?:
    | ((id: string, expectedBody: string, body: string) => Promise<void>)
    | undefined;
}
const useRelatedPage = (
  props: ActivityProps,
  query: EntityPageQuery,
  enabled: boolean,
) => {
  const source = useContext(EntityQueryContext);
  const fetcher = props.queryEntities ?? source?.query;
  const revision = props.revision ?? source?.revision ?? 0;
  const key = JSON.stringify(query);
  const sequence = useRef(0);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState<{
    key: string;
    items: readonly PkmEntitySummary[];
    cursor: string | null;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
  }>({
    key: "",
    items: [],
    cursor: null,
    loading: false,
    refreshing: false,
    error: null,
  });
  const current =
    page.key === key
      ? page
      : {
          key,
          items: [],
          cursor: null,
          loading: enabled,
          refreshing: false,
          error: null,
        };
  const moreController = useRef<AbortController | null>(null);
  const fulfilled = useRef<{
    key: string;
    revision: number;
    retry: number;
  } | null>(null);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  useEffect(() => {
    if (fulfilled.current?.key !== key) fulfilled.current = null;
    const request = ++sequence.current;
    moreController.current?.abort();
    if (!enabled || !fetchRef.current || source?.ready === false) {
      setPage((current) =>
        current.loading || current.refreshing
          ? { ...current, loading: false, refreshing: false }
          : current,
      );
      return;
    }
    if (
      fulfilled.current?.key === key &&
      fulfilled.current.revision === revision &&
      fulfilled.current.retry === retry
    )
      return;
    const controller = new AbortController();
    setPage((current) =>
      current.key === key
        ? {
            ...current,
            loading: fulfilled.current?.key !== key,
            refreshing: fulfilled.current?.key === key,
            error: null,
          }
        : {
            key,
            items: [],
            cursor: null,
            loading: true,
            refreshing: false,
            error: null,
          },
    );
    void fetchRef
      .current(JSON.parse(key) as EntityPageQuery, controller.signal)
      .then((next) => {
        if (request === sequence.current && !controller.signal.aborted) {
          fulfilled.current = { key, revision, retry };
          setPage({
            key,
            items: next.items,
            cursor: next.nextCursor,
            loading: false,
            refreshing: false,
            error: null,
          });
        }
      })
      .catch((reason: unknown) => {
        if (request === sequence.current && !controller.signal.aborted)
          setPage((current) => ({
            ...(current.key === key
              ? current
              : { key, items: [], cursor: null }),
            cursor: null,
            loading: false,
            refreshing: false,
            error: reason instanceof Error ? reason.message : String(reason),
          }));
      });
    return () => controller.abort();
  }, [key, revision, enabled, retry, source?.ready]);
  useEffect(
    () => () => {
      sequence.current++;
      moreController.current?.abort();
    },
    [],
  );
  const loadMore = async () => {
    if (
      !current.cursor ||
      current.loading ||
      current.refreshing ||
      !fetchRef.current
    )
      return;
    const request = sequence.current;
    const controller = new AbortController();
    moreController.current = controller;
    setPage((p) => ({ ...p, loading: true, error: null }));
    try {
      const next = await fetchRef.current(
        { ...query, cursor: current.cursor },
        controller.signal,
      );
      if (request === sequence.current && !controller.signal.aborted)
        setPage((p) => ({
          ...p,
          items: [
            ...new Map(
              [...p.items, ...next.items].map((e) => [e.id, e]),
            ).values(),
          ],
          cursor: next.nextCursor,
          loading: false,
        }));
    } catch (reason) {
      if (request === sequence.current && !controller.signal.aborted)
        setPage((p) => ({
          ...p,
          loading: false,
          error: reason instanceof Error ? reason.message : String(reason),
        }));
    }
  };
  return { ...current, loadMore, retry: () => setRetry((n) => n + 1) };
};
const RelatedPage = ({
  type,
  columns,
  title,
  ...props
}: ActivityProps & {
  readonly type: EntityType;
  readonly columns?:
    ReturnType<typeof entityRelationTables>[number]["columns"] | undefined;
  readonly title: string;
}) => {
  const [sort, setSort] = useState<EntitySort>("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const timeline = props.mode === "timeline";
  const page = useRelatedPage(
    props,
    {
      relatedTo: props.entity.id,
      relatedResolution: props.resolution,
      type,
      sort: timeline ? "createdAt" : sort,
      direction: timeline ? "desc" : direction,
      ...(timeline ? { view: "timeline" as const } : {}),
    },
    (props.active ?? true) && (timeline ? type === "entry" : true),
  );
  const footer = (
    <Stack gap="xs">
      {page.error && (
        <Alert color="red">
          {page.error}
          <Button
            ml="sm"
            size="xs"
            onClick={page.cursor ? () => void page.loadMore() : page.retry}
          >
            再試行
          </Button>
        </Alert>
      )}
      {page.loading && <Text c="dimmed">読み込み中…</Text>}
      {page.cursor && (
        <Button
          variant="default"
          loading={page.loading}
          onClick={() => void page.loadMore()}
        >
          さらに表示
        </Button>
      )}
    </Stack>
  );
  if (timeline)
    return (
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {page.items.length}件表示{page.cursor ? "・さらに表示可能" : ""}
        </Text>
        {!page.loading && !page.error && page.items.length === 0 && (
          <Text c="dimmed">関連Entryはありません。</Text>
        )}
        {props.onCapture &&
          !props.readOnly &&
          props.entity.type !== "entry" && (
            <QuickCaptureComposer
              compact
              defaultCurrentContext
              onCapture={props.onCapture}
              currentContext={captureContextForEntity(
                props.entity,
                props.entities,
              )}
              contextEntities={props.entities}
              storageKey={props.captureStorageKey}
              onUploadAsset={props.onUploadAsset}
              assetBaseUrl={props.assetBaseUrl}
              onOpenAsset={props.onOpenAsset}
            />
          )}
        <EntryTimelineFeed
          groups={groupTimelineEntries(page.items)}
          onOpenEntity={props.onOpenEntity}
          readOnly={props.readOnly}
          loadEntity={props.loadEntity}
          assetBaseUrl={props.assetBaseUrl}
          onOpenAsset={props.onOpenAsset}
          onUpdateEntryBody={props.onUpdateEntryBody}
        />
        {footer}
        {props.onCreate && canCreateInContext("entry", props.entity) && (
          <Button
            variant="subtle"
            disabled={props.readOnly ?? false}
            onClick={() => props.onCreate!("entry", props.entity)}
          >
            ＋ 新規Entry
          </Button>
        )}
      </Stack>
    );
  return (
    <EntityRelationTable
      {...props}
      title={title}
      columns={[...(columns ?? []), { kind: "relation", label: "関連" }]}
      entities={page.items}
      allEntities={props.entities}
      loading={page.loading}
      hasMore={page.cursor !== null}
      remoteSort={{
        key: sort as EntityTableColumnKind,
        direction,
        onChange: (key, next) => {
          setSort(key as EntitySort);
          setDirection(next);
        },
      }}
      onCreate={
        props.onCreate && canCreateInContext(type, props.entity)
          ? () => props.onCreate!(type, props.entity)
          : undefined
      }
      createLabel={`新規${type[0]!.toUpperCase()}${type.slice(1)}`}
      footer={footer}
    />
  );
};
export const EntityActivityView = (props: ActivityProps): React.JSX.Element => (
  <Stack gap="md">
    <div hidden={props.mode !== "timeline"}>
      <RelatedPage
        {...props}
        mode="timeline"
        active={(props.active ?? true) && props.mode === "timeline"}
        type="entry"
        title="Entries"
      />
    </div>
    <div hidden={props.mode !== "detail"}>
      <Stack gap="md">
        {props.entity.type !== "entry" &&
          entityRelationTables(props.entity).map((table) => (
            <RelatedPage
              key={table.type}
              {...props}
              {...table}
              mode="detail"
              active={(props.active ?? true) && props.mode === "detail"}
            />
          ))}
      </Stack>
    </div>
  </Stack>
);
