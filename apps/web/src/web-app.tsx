import { LinkPreviewContext } from "@pkm/ui";
import { useStoredViewState } from "@pkm/ui";
import { RESOURCE_TYPE_OPTIONS } from "@pkm/ui";
import { supportsMarkdownBody, type ResourceType } from "@pkm/contracts";
import type { PermanentlyDeleteEntityRequest } from "@pkm/contracts";
import type { AssetUploader } from "@pkm/ui";
import { downloadAsset } from "./asset-download.js";
import { entityFromUrl, urlForEntity } from "./entity-url.js";
import {
  AppSettingsDialog,
  UnresolvedReferencesPanel,
  useAppCommands,
  NotificationProvider,
  useNotification,
  usePersistentWarning,
} from "@pkm/ui";
import { blurOnInputExit } from "@pkm/ui";
import type { PkmRemoteClient, EntityPage } from "@pkm/contracts";
import { entityQueryAffected } from "./query-invalidation.js";
import { withBrowserDrafts } from "./browser-drafts.js";
import { EntityPageCache } from "./entity-page-cache.js";
import {
  PagedCollection,
  PagedWorkspace,
  PagedTrash,
  PagedTimeline,
  PagedBacklinks,
  PagedRelations,
} from "./remote-views.js";
import { editEntityTopics } from "./edit-entity-topics.js";
import { EntityQueryContext, EntityTagsInput } from "@pkm/ui";
import type { EntityPageQuery, EntityCounts } from "@pkm/contracts";
import {
  Alert,
  ActionIcon,
  AppShell,
  Badge,
  Button,
  Divider,
  Group,
  Loader,
  Paper,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import {
  getEntityDisplayName,
  parseMarkdownEntity,
  parseMetadataPatch,
  serializeMarkdownEntity,
  updateEntityMetadata,
  type EntityMetadataPatch,
} from "@pkm/core";
import {
  EntryPropertiesPanel,
  EntityBodySection,
  EntityEntryViewControls,
  EntityEntryTimeline,
  useEntityEntryViewState,
  type EntryTimelineViewMode,
  TodoListView,
  EntityDeleteButton,
  EntityParentLinks,
  EntityPropertiesPanel,
  EntitySidebar,
  PageTabs,
  PageScrollRestoration,
  usePageScrollRestoration,
  PageTabBar,
  NavigationIcon,
  captureEntityTabClick,
  type PageTabSnapshot,
  type PageTabOpenOptions,
  type PageTabAction,
  type PageLocation,
  FloatingActions,
  entityUiTitle,
  EntityIcon,
  EntityStatusLabel,
  EntityIdCopyButton,
  EntityPinButton,
  fileToAssetUpload,
  MarkdownLiveEditor,
  OrphanAssetDialog,
  QuickCaptureDialog,
  captureContextForEntity,
  QuickOpenDialog,
  useQuickOpenRecent,
  type QuickCaptureInput,
  type HierarchyEntityPatch,
  type HierarchyView,
  resolveTopicInputs,
  usePinnedEntities,
  useResizableSidebar,
} from "@pkm/ui";
import {
  type EntityType,
  type PkmEntityDocument,
  type PkmEntitySummary,
  type PkmFileHash,
  type PkmHealth,
  type PkmSaveConflict,
  type PkmSyncthingConflictSummary,
} from "@pkm/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  SyncthingConflictDialog,
  ENTITY_TYPE_OPTIONS,
  entryContextPatch,
  creationContextPatch,
  linkCreatedEntityToContext,
  canCreateInContext,
} from "@pkm/ui";

const errorMessage = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);
type MetadataTopicId = NonNullable<EntityMetadataPatch["topics"]>[number];

interface PendingDraft {
  readonly entityId: string;
  readonly content: string;
  readonly baseHash: PkmFileHash;
}

export interface WebAppProps {
  readonly client: PkmRemoteClient;
}

type EntryViewMode = "live" | "raw";

type PendingNavigation =
  | {
      readonly kind: "entity";
      readonly entityId: string;
      readonly recordHistory: boolean;
      readonly tabOptions?: PageTabOpenOptions;
    }
  | { readonly kind: "tab"; readonly action: PageTabAction }
  | { readonly kind: "hierarchy" }
  | Extract<PageLocation, { readonly kind: "collection" }>
  | { readonly kind: "timeline" }
  | { readonly kind: "todos" }
  | { readonly kind: "history"; readonly direction: "back" | "forward" };

type EntityReturnLocation = Exclude<PageLocation, { readonly kind: "entity" }>;

export const WebApp = (props: WebAppProps): React.JSX.Element => (
  <LinkPreviewContext.Provider value={props.client.linkPreview}>
    <NotificationProvider>
      <WebAppContent {...props} />
    </NotificationProvider>
  </LinkPreviewContext.Provider>
);

const WebAppContent = ({
  client: remoteClient,
}: WebAppProps): React.JSX.Element => {
  const client = useMemo(() => withBrowserDrafts(remoteClient), [remoteClient]);
  const listUnresolvedReferences = useCallback(
    () => client.listUnresolvedReferences(),
    [client],
  );
  const initialEntity = useRef(entityFromUrl(window.location.href));
  const initialEntityHandled = useRef(false);
  const [health, setHealth] = useState<PkmHealth | null>(null);
  const [allEntities, setAllEntities] = useState<readonly PkmEntitySummary[]>(
    [],
  );
  const [counts, setCounts] = useState<EntityCounts | null>(null);
  const cacheRevision = useRef(0);
  const countsRequest = useRef(0);
  const conflictsRequest = useRef(0);
  const bootstrapPage = useRef<EntityPage | null>(null);
  const [queryRevision, setQueryRevision] = useState(0);
  const [labelRevision, setLabelRevision] = useState(0);
  const [calendarRevision, setCalendarRevision] = useState(0);
  const [backlinkRevision, setBacklinkRevision] = useState(0);
  const [syncConflictCount, setSyncConflictCount] = useState(0);
  const validLookupIds = useRef(new Set<string>());
  const pageCache = useMemo(
    () =>
      health === null
        ? null
        : (() => {
            const cache = new EntityPageCache(
              health.vaultId,
              health.cacheVersion!,
              (query, signal) => client.queryEntities(query, signal),
            );
            if (bootstrapPage.current)
              cache.seed({ type: "area" }, bootstrapPage.current);
            return cache;
          })(),
    [client, health?.vaultId, health?.sessionId],
  );
  const pageCacheRef = useRef(pageCache);
  pageCacheRef.current = pageCache;
  const [collectionType, setCollectionType] = useState<EntityType | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineViewMode, setTimelineViewMode] =
    useState<EntryTimelineViewMode>("list");
  const [todosOpen, setTodosOpen] = useState(false);
  const [todoRevision, setTodoRevision] = useState(0);
  const [timelineDate, setTimelineDate] = useState<string | null>(null);
  const [hierarchyView, setHierarchyView] = useStoredViewState<HierarchyView>(
    health === null ? undefined : `pkm:web:${health.vaultId}:home`,
    "view",
    "area",
    (v) => ["area", "project", "task"].includes(String(v)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entityLoading, setEntityLoading] = useState(false);
  const [entityLoadError, setEntityLoadError] = useState<string | null>(null);
  const [navigationHistory, setNavigationHistory] = useState<readonly string[]>(
    [],
  );
  const [forwardNavigationHistory, setForwardNavigationHistory] = useState<
    readonly string[]
  >([]);
  const [entityReturnLocation, setEntityReturnLocation] =
    useState<EntityReturnLocation | null>(null);
  const [pageSnapshot, setPageSnapshot] = useState<PageTabSnapshot>(() =>
    new PageTabs(() => {}).snapshot(),
  );
  const activeLocation = pageSnapshot.tabs.find(
    (tab) => tab.id === pageSnapshot.activeId,
  )!.location;
  const collectionResourceType =
    activeLocation.kind === "collection"
      ? activeLocation.resourceType
      : undefined;
  const pageScroll = useRef(new PageScrollRestoration());
  const pages = useMemo(
    () =>
      new PageTabs((snapshot) => {
        pageScroll.current.prepare(snapshot);
        setPageSnapshot(snapshot);
      }),
    [],
  );
  const tabViews = useRef(
    new Map<
      string,
      {
        navigationHistory: readonly string[];
        forwardNavigationHistory: readonly string[];
        entityReturnLocation: EntityReturnLocation | null;
        hierarchyView: HierarchyView;
        timelineDate: string | null;
        timelineViewMode: EntryTimelineViewMode;
      }
    >(),
  );
  const tabViewRef = useRef({
    navigationHistory,
    forwardNavigationHistory,
    entityReturnLocation,
    hierarchyView,
    timelineDate,
    timelineViewMode,
  });
  tabViewRef.current = {
    navigationHistory,
    forwardNavigationHistory,
    entityReturnLocation,
    hierarchyView,
    timelineDate,
    timelineViewMode,
  };
  const rememberTabView = useCallback((): void => {
    tabViews.current.set(pages.snapshot().activeId, tabViewRef.current);
  }, [pages]);
  const restoreTabView = useCallback((): void => {
    const view = tabViews.current.get(pages.snapshot().activeId);
    setNavigationHistory(view?.navigationHistory ?? []);
    setForwardNavigationHistory(view?.forwardNavigationHistory ?? []);
    setEntityReturnLocation(view?.entityReturnLocation ?? null);
    if (view) setHierarchyView(view.hierarchyView);
    setTimelineDate(view?.timelineDate ?? null);
    setTimelineViewMode(view?.timelineViewMode ?? "list");
  }, [pages]);
  const [document, setDocument] = useState<PkmEntityDocument | null>(null);
  const entityEntryView = useEntityEntryViewState(
    health?.vaultId ?? null,
    document?.entity.id ?? null,
    document?.entity.type,
  );
  const [content, setContent] = useState("");
  const contentRef = useRef(content);
  contentRef.current = content;
  const [entryTitle, setEntryTitle] = useState("");
  const [editingEntryTitle, setEditingEntryTitle] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [entryViewMode, setEntryViewMode] = useState<EntryViewMode>("live");
  const [externalChangeDetected, setExternalChangeDetected] = useState(false);
  const [busy, setBusy] = useState(false);
  const notifyError = useNotification("error");
  const notifySuccess = useNotification("success");
  const [conflict, setConflict] = useState<PkmSaveConflict | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<
    readonly PkmSyncthingConflictSummary[]
  >([]);
  const [syncConflictsOpen, setSyncConflictsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [captureContext, setCaptureContext] =
    useState<ReturnType<typeof captureContextForEntity>>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [orphanAssetsOpen, setOrphanAssetsOpen] = useState(false);
  const [createType, setCreateType] = useState<EntityType>("project");
  const [createContext, setCreateContext] = useState<PkmEntitySummary | null>(
    null,
  );
  const [createName, setCreateName] = useState("");
  const [createTopics, setCreateTopics] = useState<string[]>([]);
  const [createCanonicalIdentifier, setCreateCanonicalIdentifier] =
    useState("");
  const [createSourceUri, setCreateSourceUri] = useState("");
  const [createResourceType, setCreateResourceType] =
    useState<ResourceType | null>(null);
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigation | null>(null);
  const selectionRequest = useRef(0);
  const selectionAbort = useRef<AbortController | null>(null);
  const createdDocuments = useRef(new Map<string, PkmEntityDocument>());
  const changeRequest = useRef(0);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraft = useRef<PendingDraft | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const documentRef = useRef<PkmEntityDocument | null>(null);
  const dirtyRef = useRef(false);
  const sidebar = useResizableSidebar("pkm:web:sidebar");
  usePageScrollRestoration(
    pageScroll.current,
    pageSnapshot,
    health?.vaultId ?? null,
    selectedId !== null
      ? { kind: "entity", entityId: selectedId }
      : todosOpen
        ? { kind: "todos" }
        : timelineOpen
          ? { kind: "timeline" }
          : collectionType !== null
            ? {
                kind: "collection",
                type: collectionType,
                ...(collectionResourceType
                  ? { resourceType: collectionResourceType }
                  : {}),
              }
            : { kind: "workspace" },
    health !== null && !entityLoading && entityLoadError === null,
  );
  const pins = usePinnedEntities(
    health === null ? null : `pkm:web:${health.vaultId}:pins`,
  );
  const recentIds = useQuickOpenRecent(
    health === null ? null : `pkm:web:${health.vaultId}:recent`,
    document?.entity.id ?? null,
  );
  const searchQuickOpen = useCallback(
    (query: string, signal?: AbortSignal) => client.quickOpen(query, signal),
    [client],
  );
  const topicNameOptions = useMemo(
    () =>
      [
        ...new Set(
          allEntities
            .filter(
              (entity) =>
                entity.type === "topic" && entity.displayName !== null,
            )
            .map((entity) => entity.displayName as string),
        ),
      ].sort((left, right) => left.localeCompare(right, "ja")),
    [allEntities],
  );

  const ingestEntities = useCallback((items: readonly PkmEntitySummary[]) => {
    items.forEach((entity) => validLookupIds.current.add(entity.id));
    setAllEntities((current) => {
      const next = [
        ...new Map(
          [
            ...current.filter(
              (entity) =>
                !items.some(
                  (updated) =>
                    updated.id === entity.id && updated.deletedAt !== null,
                ),
            ),
            ...items
              .filter((entity) => entity.deletedAt === null)
              .map((entity) => ({
                ...entity,
                body: entity.body.slice(0, 1200),
                bodyTruncated:
                  entity.bodyTruncated || entity.body.length > 1200,
              })),
          ].map((entity) => [entity.id, entity]),
        ).values(),
      ].slice(-1000);
      const visibleIds = new Set(next.map((entity) => entity.id));
      for (const entity of current)
        if (!visibleIds.has(entity.id))
          validLookupIds.current.delete(entity.id);
      while (validLookupIds.current.size > 2000)
        validLookupIds.current.delete(
          validLookupIds.current.values().next().value!,
        );
      return next;
    });
  }, []);
  const queryEntities = useCallback(
    async (query: EntityPageQuery, signal?: AbortSignal) => {
      const page = await (pageCache?.query(query, signal) ??
        client.queryEntities(query, signal));
      if (signal?.aborted) return page;
      ingestEntities([...page.items, ...(page.included ?? [])]);
      if (query.ids && page.nextCursor === null) {
        const found = new Set(page.items.map((entity) => entity.id));
        query.ids.forEach((id) => validLookupIds.current.add(id));
        const missing = new Set(query.ids.filter((id) => !found.has(id)));
        if (missing.size)
          setAllEntities((current) =>
            current.filter((entity) => !missing.has(entity.id)),
          );
      }
      return page;
    },
    [client, pageCache, ingestEntities],
  );
  const querySource = useMemo(
    () => ({
      vaultId: health?.vaultId,
      query: queryEntities,
      revision: queryRevision,
      labelRevision,
      calendarRevision,
      options: client.queryOptions,
      ready: health !== null,
      getCachedPage: (query: EntityPageQuery) => pageCache?.peek(query),
    }),
    [
      queryEntities,
      queryRevision,
      labelRevision,
      calendarRevision,
      health?.vaultId,
      pageCache,
      client,
    ],
  );
  const refreshEntities = useCallback(async (): Promise<void> => {
    cacheRevision.current++;
    pageCache?.invalidate();
    validLookupIds.current.clear();
    setTodoRevision((value) => value + 1);
    setQueryRevision((v) => v + 1);
    setLabelRevision((v) => v + 1);
    setCalendarRevision((v) => v + 1);
    setBacklinkRevision((v) => v + 1);
    const revision = cacheRevision.current;
    const request = ++countsRequest.current;
    const [result, nextHealth] = await Promise.all([
      client.entityCounts(),
      client.health(),
    ]);
    if (
      revision === cacheRevision.current &&
      request === countsRequest.current
    ) {
      setCounts(result);
      setHealth(nextHealth);
    }
  }, [client, pageCache]);
  const refreshSyncConflicts = useCallback(async (): Promise<void> => {
    const request = ++conflictsRequest.current;
    const nextConflicts = await client.listSyncthingConflicts();
    if (request !== conflictsRequest.current) return;
    setSyncConflicts(nextConflicts);
    setSyncConflictCount(nextConflicts.length);
    if (!nextConflicts.length) setSyncConflictsOpen(false);
  }, [client]);
  const syncConflictsOpenRef = useRef(syncConflictsOpen);
  syncConflictsOpenRef.current = syncConflictsOpen;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void client
      .bootstrap(controller.signal)
      .then((value) => {
        if (!active) return;
        bootstrapPage.current = value.page;
        setHealth(value.health);
        setCounts(value.counts);
        setSyncConflictCount(value.conflictsCount);
        ingestEntities([...value.page.items, ...(value.page.included ?? [])]);
      })
      .catch((reason) => {
        if (active) notifyError(errorMessage(reason));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [client, ingestEntities]);
  useEffect(() => {
    if (syncConflictsOpen)
      void refreshSyncConflicts().catch((reason) =>
        notifyError(errorMessage(reason)),
      );
  }, [syncConflictsOpen, refreshSyncConflicts]);
  const parsedEntryContent = parseMarkdownEntity(content);
  const navigationTask = allEntities.find(
    (entity) => entity.id === document?.entity.taskId,
  );
  const navigationProject = allEntities.find(
    (entity) =>
      entity.id === (document?.entity.projectId ?? navigationTask?.projectId),
  );
  const lookupIdsKey = JSON.stringify([
    ...new Set([
      ...pins.pinnedIds,
      ...pageSnapshot.tabs.flatMap((tab) =>
        tab.location.kind === "entity" ? [tab.location.entityId] : [],
      ),
      ...(quickOpen ? recentIds : []),
      ...(document
        ? [
            document.entity.id,
            document.entity.areaId,
            document.entity.projectId,
            document.entity.taskId,
            document.entity.resourceId,
            navigationTask?.projectId,
            navigationTask?.areaId,
            navigationProject?.areaId,
          ].filter((id): id is string => id != null)
        : []),
      ...(document &&
      parsedEntryContent.ok &&
      parsedEntryContent.value.entity.type === "entry"
        ? (parsedEntryContent.value.entity.topics ?? [])
        : []),
    ]),
  ]);
  useEffect(() => {
    const ids = (JSON.parse(lookupIdsKey) as string[]).filter(
      (id) => !validLookupIds.current.has(id),
    );
    if (!ids.length || !querySource.ready) return;
    const controller = new AbortController();
    void Promise.all(
      Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
        queryEntities(
          { ids: ids.slice(i * 100, (i + 1) * 100), limit: 100 },
          controller.signal,
        ),
      ),
    ).catch((reason: unknown) => {
      if (!controller.signal.aborted) notifyError(errorMessage(reason));
    });
    return () => controller.abort();
  }, [lookupIdsKey, queryEntities, queryRevision, querySource.ready]);
  const resolveTopics = async (names: readonly string[]) => {
    if (!names.length) return resolveTopicInputs([], []);
    const items = (
      await client.queryEntities({
        type: "topic",
        nameKeys: [
          ...new Set(
            names.map((name) =>
              name.normalize("NFKC").trim().toLocaleLowerCase("ja"),
            ),
          ),
        ],
        limit: 100,
      })
    ).items;
    ingestEntities(items);
    return resolveTopicInputs(names, items);
  };

  const flushDraft = useCallback(async (): Promise<void> => {
    if (draftTimer.current !== null) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
    const request = pendingDraft.current;
    if (request !== null) {
      await client.saveDraft(request);
      if (pendingDraft.current === request) pendingDraft.current = null;
    }
  }, [client]);

  useEffect(() => {
    return () => {
      if (draftTimer.current !== null) clearTimeout(draftTimer.current);
      const request = pendingDraft.current;
      if (request !== null) void client.saveDraft(request).catch(() => {});
    };
  }, [client]);

  useEffect(() => {
    const persist = () => {
      void flushDraft().catch((reason: unknown) =>
        notifyError(errorMessage(reason)),
      );
    };
    const hidden = () => {
      if (window.document.visibilityState === "hidden") persist();
    };
    const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
      persist();
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", persist);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [flushDraft]);

  const selectEntity = useCallback(
    async (
      entityId: string,
      recordHistory = true,
      bypassDirtyWarning = false,
      tabOptions: PageTabOpenOptions = {},
    ): Promise<boolean> => {
      if (
        !bypassDirtyWarning &&
        dirtyRef.current &&
        selectedIdRef.current !== entityId
      ) {
        setPendingNavigation({
          kind: "entity",
          entityId,
          recordHistory,
          tabOptions,
        });
        return false;
      }
      const request = ++selectionRequest.current;
      try {
        await flushDraft();
      } catch (reason) {
        notifyError(errorMessage(reason));
        return false;
      }
      if (request !== selectionRequest.current) return false;
      const previousId = selectedIdRef.current;
      const previousTabId = pages.snapshot().activeId;
      const previousView = tabViewRef.current;
      const previousLocation = pages
        .snapshot()
        .tabs.find((tab) => tab.id === previousTabId)!.location;
      rememberTabView();
      pages.navigate({ kind: "entity", entityId }, tabOptions);
      if (!sidebar.mobile && previousTabId !== pages.snapshot().activeId)
        restoreTabView();
      if (
        recordHistory &&
        tabOptions.newTab !== true &&
        previousId !== entityId
      ) {
        setNavigationHistory(
          previousId === null
            ? []
            : [...previousView.navigationHistory, previousId].slice(-20),
        );
        setEntityReturnLocation(
          previousId === null && previousLocation.kind !== "entity"
            ? previousLocation
            : previousView.entityReturnLocation,
        );
        setForwardNavigationHistory([]);
      }
      setSelectedId(entityId);
      selectedIdRef.current = entityId;
      setEntityLoading(true);
      setEntityLoadError(null);
      setCollectionType(null);
      setTimelineOpen(false);
      setTodosOpen(false);
      setConflict(null);
      setExternalChangeDetected(false);
      try {
        selectionAbort.current?.abort();
        const controller = new AbortController();
        selectionAbort.current = controller;
        const nextDocument =
          createdDocuments.current.get(entityId) ??
          (await client.loadEntity(entityId, controller.signal));
        createdDocuments.current.delete(entityId);
        if (request !== selectionRequest.current) return false;
        ingestEntities([nextDocument.entity]);
        setDocument(nextDocument);
        documentRef.current = nextDocument;
        setContent(nextDocument.draft?.content ?? nextDocument.content);
        const opened = parseMarkdownEntity(
          nextDocument.draft?.content ?? nextDocument.content,
        );
        setEntryTitle(
          opened.ok && opened.value.entity.type === "entry"
            ? (getEntityDisplayName(opened.value.entity) ?? "")
            : "",
        );
        setEditingEntryTitle(false);

        setDirty(nextDocument.draft !== null);
        dirtyRef.current = nextDocument.draft !== null;
        setExternalChangeDetected(nextDocument.hasExternalChange);
        return true;
      } catch (reason) {
        if (request === selectionRequest.current)
          setEntityLoadError(errorMessage(reason));
        return false;
      } finally {
        if (request === selectionRequest.current) setEntityLoading(false);
      }
    },
    [
      client,
      pages,
      collectionType,
      flushDraft,
      ingestEntities,
      rememberTabView,
      restoreTabView,
      sidebar.mobile,
      timelineOpen,
      todosOpen,
    ],
  );

  useEffect(() => {
    if (health === null || initialEntityHandled.current) return;
    initialEntityHandled.current = true;
    if (initialEntity.current !== null)
      void selectEntity(initialEntity.current, false);
  }, [health, selectEntity]);

  useEffect(() => {
    if (!initialEntityHandled.current) return;
    // Preserve a pending initial deep link until selection has started.
    if (selectedId === null && initialEntity.current !== null) return;
    initialEntity.current = null;
    window.history.replaceState(
      window.history.state,
      "",
      urlForEntity(window.location.href, selectedId),
    );
  }, [selectedId]);

  useEffect(() => {
    if (health === null) return;
    let detailController: AbortController | null = null;
    const unsubscribe = client.subscribeToChanges((event) => {
      void (async () => {
        const changes = event.sync.changes;
        cacheRevision.current++;
        pageCacheRef.current?.invalidate((query, page) =>
          entityQueryAffected(query, changes, page),
        );
        if (changes.reset) validLookupIds.current.clear();
        changes.entities.forEach((entity) =>
          validLookupIds.current.delete(entity.id),
        );
        setQueryRevision((v) => v + 1);
        if (changes.namesChanged || changes.reset)
          setLabelRevision((v) => v + 1);
        if (changes.reset || changes.types.includes("entry"))
          setTodoRevision((v) => v + 1);
        if (changes.calendarChanged) setCalendarRevision((v) => v + 1);
        if (changes.countsChanged || changes.reset) {
          const request = ++countsRequest.current;
          if (changes.reset) {
            void client
              .bootstrap()
              .then((result) => {
                if (request !== countsRequest.current) return;
                setHealth(result.health);
                setCounts(result.counts);
                setSyncConflictCount(result.conflictsCount);
              })
              .catch((reason) => notifyError(errorMessage(reason)));
          } else {
            void client
              .entityCounts()
              .then((result) => {
                if (request === countsRequest.current) setCounts(result);
              })
              .catch((reason) => notifyError(errorMessage(reason)));
          }
        }
        if (changes.conflictsChanged) {
          if (!changes.reset) setSyncConflictCount(event.sync.conflicts);
          if (syncConflictsOpenRef.current)
            void refreshSyncConflicts().catch((reason) =>
              notifyError(errorMessage(reason)),
            );
        }
        const entityId = selectedIdRef.current;
        if (
          changes.reset ||
          (entityId && changes.backlinkIds.includes(entityId))
        )
          setBacklinkRevision((v) => v + 1);
        if (entityId === null) return;
        const changed = changes.entities.find(
          (entity) => entity.id === entityId,
        );
        if (
          !changes.reset &&
          (!changed || changed.fileHash === documentRef.current?.fileHash)
        )
          return;
        if (dirtyRef.current) {
          setExternalChangeDetected(
            changes.reset ||
              changed?.fileHash !== documentRef.current?.fileHash,
          );
          return;
        }
        const request = ++changeRequest.current;
        detailController?.abort();
        const controller = new AbortController();
        detailController = controller;
        try {
          const nextDocument = await client.loadEntity(
            entityId,
            controller.signal,
          );
          if (
            request !== changeRequest.current ||
            controller.signal.aborted ||
            entityId !== selectedIdRef.current
          ) {
            return;
          }

          if (dirtyRef.current) {
            setExternalChangeDetected(
              documentRef.current?.fileHash !== nextDocument.fileHash,
            );
            return;
          }
          setDocument(nextDocument);
          documentRef.current = nextDocument;
          setContent(nextDocument.draft?.content ?? nextDocument.content);
          const opened = parseMarkdownEntity(
            nextDocument.draft?.content ?? nextDocument.content,
          );
          setEntryTitle(
            opened.ok && opened.value.entity.type === "entry"
              ? (getEntityDisplayName(opened.value.entity) ?? "")
              : "",
          );
          setEditingEntryTitle(false);
          setDirty(nextDocument.draft !== null);
          dirtyRef.current = nextDocument.draft !== null;
          setExternalChangeDetected(nextDocument.hasExternalChange);
        } catch (reason) {
          if (
            request !== changeRequest.current ||
            controller.signal.aborted ||
            entityId !== selectedIdRef.current
          )
            return;
          if (dirtyRef.current) {
            setExternalChangeDetected(true);
            return;
          }
          selectionRequest.current += 1;
          selectedIdRef.current = null;
          documentRef.current = null;
          setSelectedId(null);
          setEntityLoading(false);
          setEntityLoadError(null);
          setDocument(null);

          notifyError(errorMessage(reason));
        }
      })().catch((reason: unknown) => notifyError(errorMessage(reason)));
    });
    return () => {
      detailController?.abort();
      unsubscribe();
    };
  }, [client, refreshSyncConflicts, health?.sessionId]);

  const editContent = (nextContent: string): void => {
    if (document === null) return;
    contentRef.current = nextContent;
    setContent(nextContent);
    setDirty(true);
    dirtyRef.current = true;
    if (draftTimer.current !== null) clearTimeout(draftTimer.current);
    pendingDraft.current = {
      entityId: document.entity.id,
      content: nextContent,
      baseHash: document.fileHash,
    };
    draftTimer.current = setTimeout(() => {
      void flushDraft().catch((reason: unknown) =>
        notifyError(errorMessage(reason)),
      );
    }, 250);
  };

  const editEntryBody = (nextBody: string): void => {
    const parsed = parseMarkdownEntity(content);
    if (!parsed.ok) {
      notifyError(
        `本文を更新できません。Raw Markdownでfrontmatterを修正してください: ${parsed.error.message}`,
      );
      return;
    }
    editContent(serializeMarkdownEntity(parsed.value, { body: nextBody }));
  };

  const editDocumentTopics = (names: readonly string[]): Promise<void> =>
    editEntityTopics(names, {
      getDraft: () =>
        documentRef.current === null
          ? null
          : {
              entityId: documentRef.current.entity.id,
              content: contentRef.current,
              selection: selectionRequest.current,
            },
      resolveTopics,
      createTopic: async (displayName) => {
        const topic = await client.createEntity({
          type: "topic",
          displayName,
        });
        ingestEntities([topic.entity]);
        return topic.entity.id;
      },
      applyContent: editContent,
    });

  const editResourceMetadata = (patch: HierarchyEntityPatch): Promise<void> => {
    if (
      document?.entity.type !== "resource" ||
      documentRef.current?.entity.id !== document.entity.id
    )
      throw new Error(
        "Resourceが切り替わったため、プロパティの変更を中止しました。",
      );
    const { topicIds, ...metadata } = patch;
    editContent(
      updateEntityMetadata(
        contentRef.current,
        parseMetadataPatch({
          ...metadata,
          ...(topicIds ? { topics: topicIds } : {}),
        }),
      ).content,
    );
    return Promise.resolve();
  };

  const commitEntryTitle = (): void => {
    const parsed = parseMarkdownEntity(content);
    if (!parsed.ok || parsed.value.entity.type !== "entry") return;
    if (entryTitle.trim() === (getEntityDisplayName(parsed.value.entity) ?? ""))
      return;
    try {
      editContent(
        updateEntityMetadata(content, {
          displayName: entryTitle.trim() || null,
        }).content,
      );
    } catch (reason) {
      notifyError(errorMessage(reason));
    }
  };

  const changeEntryViewMode = (value: string): void => {
    if (value !== "live" && value !== "raw") {
      return;
    }
    if (value !== "raw") {
      const parsed = parseMarkdownEntity(content);
      if (!parsed.ok) {
        notifyError(
          `Live Previewへ切り替える前にRaw Markdownを修正してください: ${parsed.error.message}`,
        );
        return;
      }
    }
    setEntryViewMode(value);
  };

  const reloadSelection = async (entityId: string): Promise<void> => {
    await Promise.all([refreshEntities(), selectEntity(entityId)]);
  };

  const save = async (): Promise<boolean> => {
    if (document === null) return true;
    setBusy(true);
    if (draftTimer.current !== null) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
    }
    pendingDraft.current = {
      entityId: document.entity.id,
      content,
      baseHash: document.fileHash,
    };
    try {
      await flushDraft();
      const result = await client.saveEntity({
        entityId: document.entity.id,
        content,
        expectedFileHash: document.fileHash,
      });
      if (!result.ok) {
        setConflict(result);
        return false;
      }
      const unchanged = contentRef.current === content;
      setDirty(!unchanged);
      dirtyRef.current = !unchanged;
      if (pendingDraft.current)
        pendingDraft.current = {
          ...pendingDraft.current,
          baseHash: result.snapshot.hash,
        };
      if (!result.entity)
        throw new Error("Save response is missing Entity metadata");
      const nextDocument: PkmEntityDocument = {
        entity: result.entity,
        content: result.snapshot.content,
        fileHash: result.snapshot.hash,
        draft: null,
        hasExternalChange: false,
      };
      setDocument(nextDocument);
      documentRef.current = nextDocument;
      if (unchanged) {
        setContent(nextDocument.content);
        contentRef.current = nextDocument.content;
      }
      setExternalChangeDetected(false);
      ingestEntities([nextDocument.entity]);
      notifySuccess("保存しました。");
      return true;
    } catch (reason) {
      notifyError(errorMessage(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const discard = async (): Promise<void> => {
    if (document === null) return;
    setBusy(true);
    try {
      if (draftTimer.current !== null) clearTimeout(draftTimer.current);
      await client.discardDraft(document.entity.id);
      pendingDraft.current = null;
      setDirty(false);
      dirtyRef.current = false;
      setExternalChangeDetected(false);
      await reloadSelection(document.entity.id);
      notifySuccess("未保存の変更を破棄しました。");
    } catch (reason) {
      notifyError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const resolveConflict = async (
    resolution: "keep-external" | "keep-draft",
  ): Promise<void> => {
    if (document === null || conflict === null) return;
    setBusy(true);
    try {
      const result = await client.resolveConflict({
        entityId: document.entity.id,
        resolution,
        expectedExternalHash: conflict.actual?.hash ?? null,
      });
      if (!result.ok) {
        setConflict(result);
        notifyError(
          "比較中に外部版が変更されました。最新の内容へ更新しました。",
        );
        return;
      }
      setConflict(null);
      setDirty(false);
      dirtyRef.current = false;
      if (result.document === null) {
        selectionRequest.current += 1;
        setSelectedId(null);
        setEntityLoading(false);
        setEntityLoadError(null);
        selectedIdRef.current = null;
        setDocument(null);
        documentRef.current = null;

        setExternalChangeDetected(false);
        await refreshEntities();
      } else {
        createdDocuments.current.set(
          result.document.entity.id,
          result.document,
        );
        await selectEntity(result.document.entity.id);
      }
      notifySuccess(
        resolution === "keep-external"
          ? "外部版を採用しました。"
          : "Draft版を保存しました。",
      );
    } catch (reason) {
      notifyError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const createEntity = async (): Promise<void> => {
    setBusy(true);
    try {
      const contextEntity = createContext;
      const contextPatch = creationContextPatch(createType, contextEntity);
      const metadataPatch: EntityMetadataPatch = {
        ...(contextPatch ?? {}),
        ...(createType === "resource"
          ? {
              resourceType: createResourceType,
              canonicalIdentifier:
                createCanonicalIdentifier.trim().length === 0
                  ? null
                  : createCanonicalIdentifier.trim(),
              sourceUri:
                createSourceUri.trim().length === 0
                  ? null
                  : createSourceUri.trim(),
            }
          : {}),
      };
      const created = await client.createEntity({
        type: createType,
        displayName:
          createType === "entry" ? createName.trim() || null : createName,
        metadata: metadataPatch,
        ...(createType !== "topic" ? { topicNames: createTopics } : {}),
      });
      createdDocuments.current.set(created.entity.id, created);
      let contextError: string | null = null;
      try {
        await linkCreatedEntityToContext(
          client,
          createType,
          contextEntity,
          created.entity.id,
        );
      } catch (reason) {
        contextError = `Entityは作成しましたがContextへ関連付けできませんでした: ${errorMessage(reason)}`;
      }
      setCreateOpen(false);
      setCreateName("");
      setCreateTopics([]);
      setCreateCanonicalIdentifier("");
      setCreateSourceUri("");
      await selectEntity(created.entity.id);
      if (contextError !== null) notifyError(contextError);
    } catch (reason) {
      notifyError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const openCapture = (
    context: PkmEntitySummary | null = document?.entity ?? null,
  ): void => {
    setCaptureContext(captureContextForEntity(context, allEntities));
    setQuickCaptureOpen(true);
  };

  const openCreateEntity = (
    type: EntityType = "project",
    context: PkmEntitySummary | null = document?.entity ?? null,
  ): void => {
    if (type === "entry") {
      openCapture(context);
      return;
    }
    setCreateResourceType(
      type === "resource" ? (collectionResourceType ?? null) : null,
    );
    setCreateContext(context);
    setCreateType(type);
    setCreateName("");
    setCreateTopics([]);
    setCreateCanonicalIdentifier("");
    setCreateSourceUri("");
    setCreateOpen(true);
  };

  const saveCapturedEntry = async (
    input: QuickCaptureInput,
    journalDate?: string,
  ): Promise<void> => {
    const context =
      input.contextId === null
        ? null
        : (allEntities.find((e) => e.id === input.contextId) ??
          ({
            id: input.contextId,
            type: input.contextId.startsWith("area_")
              ? "area"
              : input.contextId.startsWith("prj_")
                ? "project"
                : input.contextId.startsWith("tsk_")
                  ? "task"
                  : input.contextId.startsWith("res_")
                    ? "resource"
                    : "topic",
          } as PkmEntitySummary));
    const created = await client.createEntity({
      type: "entry",
      displayName: input.title,
      body: input.body,
      ...(context ? { metadata: entryContextPatch(context) ?? {} } : {}),
      ...(journalDate === undefined ? {} : { journalDate }),
    });
    ingestEntities([created.entity]);
    notifySuccess(
      journalDate === undefined
        ? "保存しました。"
        : `${journalDate}のEntryを保存しました。`,
    );
  };

  const captureEntry = async (input: QuickCaptureInput): Promise<void> =>
    saveCapturedEntry(input);

  const captureTimelineEntry = async (
    input: QuickCaptureInput,
  ): Promise<void> => saveCapturedEntry(input, timelineDate ?? undefined);

  const uploadAsset: AssetUploader = async (file, source) =>
    client.createAsset(await fileToAssetUpload(file, source));

  const performShowHierarchy = async (): Promise<void> => {
    pageScroll.current.remember();
    rememberTabView();
    await flushDraft();
    selectionRequest.current += 1;
    setSelectedId(null);
    setEntityLoading(false);
    setEntityLoadError(null);
    selectedIdRef.current = null;
    setDocument(null);
    documentRef.current = null;

    setConflict(null);
    setExternalChangeDetected(false);
    setNavigationHistory([]);
    setForwardNavigationHistory([]);
    setEntityReturnLocation(null);
    setCollectionType(null);
    setTimelineOpen(false);
    setTodosOpen(false);
    setDirty(false);
    dirtyRef.current = false;
  };

  const showHierarchy = async (bypassDirtyWarning = false): Promise<void> => {
    if (!bypassDirtyWarning && dirtyRef.current) {
      setPendingNavigation({ kind: "hierarchy" });
      return;
    }
    await performShowHierarchy();
    pages.navigate(
      { kind: "workspace" },
      sidebar.mobile ? { newTab: false } : { newTab: true, reuse: true },
    );
    if (!sidebar.mobile) restoreTabView();
  };

  const showCollection = async (
    type: EntityType,
    bypassDirtyWarning = false,
    resourceType?: ResourceType,
  ): Promise<void> => {
    if (!bypassDirtyWarning && dirtyRef.current) {
      setPendingNavigation({
        kind: "collection",
        type,
        ...(resourceType ? { resourceType } : {}),
      });
      return;
    }
    await performShowHierarchy();
    setCollectionType(type);
    pages.navigate(
      { kind: "collection", type, ...(resourceType ? { resourceType } : {}) },
      sidebar.mobile ? { newTab: false } : { newTab: true, reuse: true },
    );
    if (!sidebar.mobile) restoreTabView();
  };

  const showTimeline = async (bypassDirtyWarning = false): Promise<void> => {
    if (!bypassDirtyWarning && dirtyRef.current) {
      setPendingNavigation({ kind: "timeline" });
      return;
    }
    await performShowHierarchy();
    setTimelineOpen(true);
    pages.navigate(
      { kind: "timeline" },
      sidebar.mobile ? { newTab: false } : { newTab: true, reuse: true },
    );
    if (!sidebar.mobile) restoreTabView();
  };

  const showTodos = async (bypassDirtyWarning = false): Promise<void> => {
    if (!bypassDirtyWarning && dirtyRef.current) {
      setPendingNavigation({ kind: "todos" });
      return;
    }
    await performShowHierarchy();
    setTodosOpen(true);
    pages.navigate(
      { kind: "todos" },
      sidebar.mobile ? { newTab: false } : { newTab: true, reuse: true },
    );
    if (!sidebar.mobile) restoreTabView();
  };

  const openBackgroundTab = (entityId: string): void => {
    if (
      busy ||
      health === null ||
      pendingNavigation !== null ||
      conflict !== null
    )
      return;
    pages.navigate(
      { kind: "entity", entityId },
      { newTab: true, activate: false },
    );
  };

  const performPageAction = async (
    action: PageTabAction,
    bypassDirtyWarning = false,
  ): Promise<void> => {
    const snapshot = pages.snapshot();
    if (
      action.kind === "close" &&
      !snapshot.tabs.some((tab) => tab.id === action.id)
    )
      return;
    if (action.kind === "close" && action.id !== snapshot.activeId) {
      pages.close(action.id);
      return;
    }
    if (action.kind === "select" && action.id === snapshot.activeId) return;
    if (!bypassDirtyWarning && dirtyRef.current) {
      setPendingNavigation({ kind: "tab", action });
      return;
    }
    const target =
      action.kind === "select"
        ? snapshot.tabs.find((tab) => tab.id === action.id)
        : action.kind === "close"
          ? pages.closeTarget(action.id)
          : undefined;
    if (action.kind === "select" && !target) return;
    const location: PageLocation = target?.location ?? { kind: "workspace" };
    const options = target
      ? { tabId: target.id }
      : action.kind === "new"
        ? { newTab: true }
        : {};
    rememberTabView();
    try {
      if (location.kind === "entity") {
        if (!(await selectEntity(location.entityId, false, true, options)))
          return;
      } else {
        await performShowHierarchy();
        pages.navigate(location, options);
        setCollectionType(
          location.kind === "collection" ? location.type : null,
        );
        setTimelineOpen(location.kind === "timeline");
        setTodosOpen(location.kind === "todos");
      }
      if (action.kind === "close") pages.close(action.id);
      restoreTabView();
      if (action.kind === "close") tabViews.current.delete(action.id);
      sidebar.closeOnNavigate();
    } catch (reason) {
      notifyError(errorMessage(reason));
    }
  };

  const continuePendingNavigation = async (
    saveChanges: boolean,
  ): Promise<void> => {
    const pending = pendingNavigation;
    if (pending === null) return;
    if (saveChanges && !(await save())) {
      setPendingNavigation(null);
      return;
    }
    setPendingNavigation(null);
    switch (pending.kind) {
      case "tab":
        await performPageAction(pending.action, true);
        break;
      case "entity":
        await selectEntity(
          pending.entityId,
          pending.recordHistory,
          true,
          pending.tabOptions,
        );
        break;
      case "hierarchy":
        await showHierarchy(true);
        break;
      case "collection":
        await showCollection(pending.type, true, pending.resourceType);
        break;
      case "timeline":
        await showTimeline(true);
        break;
      case "todos":
        await showTodos(true);
        break;
      case "history":
        await navigateHistory(pending.direction, true);
        break;
    }
  };

  const navigateHistory = useCallback(
    async (
      direction: "back" | "forward",
      bypassDirtyWarning = false,
    ): Promise<void> => {
      const source =
        direction === "back" ? navigationHistory : forwardNavigationHistory;
      const targetId = source.at(-1);
      const currentId = selectedIdRef.current;
      if (
        direction === "back" &&
        targetId === undefined &&
        currentId !== null &&
        entityReturnLocation !== null
      ) {
        if (!bypassDirtyWarning && dirtyRef.current) {
          setPendingNavigation({ kind: "history", direction });
          return;
        }
        await flushDraft();
        selectionRequest.current += 1;
        setSelectedId(null);
        setEntityLoading(false);
        setEntityLoadError(null);
        selectedIdRef.current = null;
        setDocument(null);
        documentRef.current = null;

        setConflict(null);
        setExternalChangeDetected(false);
        setDirty(false);
        dirtyRef.current = false;
        setCollectionType(
          entityReturnLocation.kind === "collection"
            ? entityReturnLocation.type
            : null,
        );
        setTimelineOpen(entityReturnLocation.kind === "timeline");
        setTodosOpen(entityReturnLocation.kind === "todos");
        pages.navigate(entityReturnLocation, { newTab: false });
        setForwardNavigationHistory((current) =>
          [...current, currentId].slice(-20),
        );
        return;
      }
      if (targetId === undefined) return;
      if (!bypassDirtyWarning && dirtyRef.current) {
        setPendingNavigation({ kind: "history", direction });
        return;
      }
      if (!(await selectEntity(targetId, false, true))) return;
      setEntityReturnLocation(entityReturnLocation);
      if (direction === "back") {
        setNavigationHistory(navigationHistory.slice(0, -1));
        if (currentId !== null) {
          setForwardNavigationHistory(
            [...forwardNavigationHistory, currentId].slice(-20),
          );
        }
      } else {
        setForwardNavigationHistory(forwardNavigationHistory.slice(0, -1));
        if (currentId !== null) {
          setNavigationHistory([...navigationHistory, currentId].slice(-20));
        }
      }
    },
    [
      entityReturnLocation,
      pages,
      flushDraft,
      forwardNavigationHistory,
      navigationHistory,
      selectEntity,
    ],
  );

  const commands = useAppCommands({
    enabled:
      health !== null &&
      !busy &&
      !appSettingsOpen &&
      !createOpen &&
      !quickCaptureOpen &&
      !quickOpen &&
      !syncConflictsOpen &&
      !orphanAssetsOpen &&
      pendingNavigation === null &&
      conflict === null,
    onError: (reason) =>
      notifyError(reason instanceof Error ? reason.message : String(reason)),
    handlers: {
      "document.save": {
        isEnabled: () => health?.accessMode === "read-write",
        run: () => {
          if (document && supportsMarkdownBody(document.entity.type))
            return save();
        },
      },
      "quickOpen.open": { run: () => setQuickOpen(true) },
      "capture.open": {
        isEnabled: () => health?.accessMode === "read-write",
        run: () => openCapture(),
      },
      "tab.new": {
        isEnabled: () => !sidebar.mobile,
        run: () => performPageAction({ kind: "new" }),
      },
      "tab.close": {
        isEnabled: () => !sidebar.mobile,
        run: () =>
          performPageAction({ kind: "close", id: pages.snapshot().activeId }),
      },
      "navigation.back": {
        isEnabled: () =>
          navigationHistory.length > 0 ||
          (document !== null && entityReturnLocation !== null),
        run: () => navigateHistory("back"),
      },
      "navigation.forward": {
        isEnabled: () => forwardNavigationHistory.length > 0,
        run: () => navigateHistory("forward"),
      },
      "settings.open": { run: () => setAppSettingsOpen(true) },
    },
  });

  const updateEntityFromTable = async (
    entityId: string,
    patch: HierarchyEntityPatch,
  ): Promise<void> => {
    const entity =
      allEntities.find((e) => e.id === entityId) ??
      (document?.entity.id === entityId ? document.entity : null);
    if (!entity?.fileHash)
      throw new Error("Entityの更新情報がありません。一覧を更新してください。");
    const { topicIds, ...metadata } = patch;
    const result = await client.patchMetadata(
      entityId,
      {
        ...metadata,
        ...(topicIds ? { topics: topicIds as MetadataTopicId[] } : {}),
      } as EntityMetadataPatch,
      entity.fileHash,
    );
    if (!result.ok)
      throw new Error("外部更新と競合しました。一覧を更新してください。");
    ingestEntities([result.entity]);
    notifySuccess("プロパティを保存しました。");
  };

  const updateTimelineBody = async (
    entityId: string,
    expectedBody: string,
    body: string,
  ): Promise<void> => {
    const current = await client.loadEntity(entityId);
    if (current.draft !== null || current.entity.body !== expectedBody)
      throw new Error("Entryに別の編集があります。一覧を更新してください。");
    const result = await client.patchBody(entityId, body, current.fileHash);
    if (!result.ok)
      throw new Error("外部更新と競合しました。一覧を更新してください。");
    ingestEntities([result.entity]);
  };

  const updateEntityTopics = async (
    entityId: string,
    topicNames: readonly string[],
  ): Promise<void> => {
    const resolution = await resolveTopics(topicNames);
    const topicIds = [...resolution.existingIds];
    for (const topicName of resolution.newNames) {
      const topic = await client.createEntity({
        type: "topic",
        displayName: topicName,
      });
      topicIds.push(topic.entity.id);
    }
    await updateEntityFromTable(entityId, { topicIds });
  };

  const deleteEntity = async (entityId: string): Promise<void> => {
    const deletingSelection = document?.entity.id === entityId;
    if (deletingSelection && dirtyRef.current && !(await save())) {
      throw new Error("未保存の変更を保存できなかったため削除を中止しました。");
    }
    await updateEntityFromTable(entityId, {
      deletedAt: new Date().toISOString(),
    });
    const page = pages
      .snapshot()
      .tabs.find(
        (tab) =>
          tab.location.kind === "entity" && tab.location.entityId === entityId,
      );
    if (page) await performPageAction({ kind: "close", id: page.id }, true);
  };

  const permanentlyDeleteEntity = async (
    request: PermanentlyDeleteEntityRequest,
  ): Promise<void> => {
    const page = pages
      .snapshot()
      .tabs.find(
        (tab) =>
          tab.location.kind === "entity" &&
          tab.location.entityId === request.entityId,
      );
    if (page) {
      await performPageAction({ kind: "close", id: page.id }, true);
      if (pages.snapshot().tabs.some((tab) => tab.id === page.id))
        throw new Error("対象のタブを閉じられませんでした。");
    }
    await client.permanentlyDeleteEntity(request);
    setAllEntities((current) =>
      current.filter((entity) => entity.id !== request.entityId),
    );
    await refreshEntities();
  };

  const restoreEntity = async (entityId: string): Promise<void> => {
    await updateEntityFromTable(entityId, { deletedAt: null });
    notifySuccess("Entityを復元しました。");
  };

  const writable = health?.accessMode === "read-write";
  const savedEntity =
    document === null
      ? null
      : (allEntities.find((entity) => entity.id === document.entity.id) ??
        document.entity);
  const resourceDraft =
    parsedEntryContent.ok && parsedEntryContent.value.entity.type === "resource"
      ? parsedEntryContent.value.entity
      : null;
  const selectedEntity =
    savedEntity && resourceDraft
      ? {
          ...savedEntity,
          displayName: resourceDraft.title,
          description: resourceDraft.description ?? null,
          authors: resourceDraft.authors ?? [],
          relatedEntityIds: resourceDraft.related_entity_ids ?? [],
          resourceType: resourceDraft.resource_type ?? null,
          canonicalIdentifier: resourceDraft.canonical_identifier ?? null,
          sourceUri: resourceDraft.source_uri ?? null,
          assetPath: resourceDraft.asset_path ?? null,
          topicIds: resourceDraft.topics ?? [],
        }
      : savedEntity;
  const entryBody = parsedEntryContent.ok ? parsedEntryContent.value.body : "";
  const bodyLabel =
    document === null
      ? ""
      : document.entity.type.charAt(0).toUpperCase() +
        document.entity.type.slice(1);

  usePersistentWarning(
    document !== null && (document.hasExternalChange || externalChangeDetected)
      ? "外部更新を検出しました。保存時に競合確認を行います。"
      : null,
  );
  usePersistentWarning(
    health !== null && !writable
      ? "読み取り専用: このVaultのschema versionには書き込めません。"
      : null,
  );
  usePersistentWarning(
    conflict !== null
      ? "外部更新と競合しました。内容を比較して採用する版を選んでください。"
      : null,
  );

  return (
    <EntityQueryContext.Provider value={querySource}>
      <AppShell
        header={{ height: 44 }}
        onClickCapture={(event) =>
          !sidebar.mobile && captureEntityTabClick(event, openBackgroundTab)
        }
        navbar={{
          width: sidebar.width,
          breakpoint: "sm",
          collapsed: { desktop: sidebar.collapsed, mobile: sidebar.collapsed },
        }}
        padding="md"
      >
        <AppSettingsDialog
          opened={appSettingsOpen}
          onClose={() => setAppSettingsOpen(false)}
          commands={commands}
          sections={[
            {
              id: "trash",
              label: "ゴミ箱",
              content: (
                <PagedTrash
                  entities={allEntities}
                  readOnly={!writable}
                  loadEntity={(id) => client.loadEntity(id)}
                  onPermanentlyDeleteEntity={permanentlyDeleteEntity}
                  onRestoreEntity={restoreEntity}
                />
              ),
            },
            {
              id: "references",
              label: "参照切れ",
              content: (
                <UnresolvedReferencesPanel
                  listReferences={listUnresolvedReferences}
                  onOpenEntity={(entityId) => {
                    setAppSettingsOpen(false);
                    sidebar.closeOnNavigate();
                    void selectEntity(entityId);
                  }}
                />
              ),
            },
          ]}
        />
        <QuickOpenDialog
          opened={quickOpen}
          onClose={() => setQuickOpen(false)}
          entities={allEntities}
          pinnedIds={pins.pinnedIds}
          recentIds={recentIds}
          search={searchQuickOpen}
          onOpenInNewTab={
            sidebar.mobile
              ? undefined
              : (entityId) => {
                  setQuickOpen(false);
                  sidebar.closeOnNavigate();
                  return selectEntity(entityId, true, false, { newTab: true });
                }
          }
          onOpenEntity={async (entityId) => {
            setQuickOpen(false);
            sidebar.closeOnNavigate();
            return selectEntity(entityId);
          }}
        />
        <AppShell.Header className="app-header">
          <Group
            className="app-header-content"
            h={44}
            px="sm"
            justify="space-between"
          >
            <Group className="app-navigation-actions" gap={4}>
              <ActionIcon
                aria-label={
                  sidebar.collapsed ? "サイドバーを開く" : "サイドバーを閉じる"
                }
                variant="subtle"
                onClick={sidebar.toggleCollapsed}
              >
                <NavigationIcon kind="menu" />
              </ActionIcon>
              <ActionIcon
                aria-label="前のEntityへ戻る"
                title={`戻る${commands.label("navigation.back") ? `（${commands.label("navigation.back")}）` : ""}`}
                variant="subtle"
                disabled={
                  navigationHistory.length === 0 &&
                  !(document !== null && entityReturnLocation !== null)
                }
                onClick={() => commands.execute("navigation.back")}
              >
                <NavigationIcon kind="back" />
              </ActionIcon>
              <ActionIcon
                aria-label="次のEntityへ進む"
                title={`進む${commands.label("navigation.forward") ? `（${commands.label("navigation.forward")}）` : ""}`}
                variant="subtle"
                disabled={forwardNavigationHistory.length === 0}
                onClick={() => commands.execute("navigation.forward")}
              >
                <NavigationIcon kind="forward" />
              </ActionIcon>
              <ActionIcon
                aria-label="Homeを開く"
                title="Home"
                variant="subtle"
                onClick={() => void showHierarchy()}
              >
                <NavigationIcon kind="home" />
              </ActionIcon>
              <ActionIcon
                aria-label="Vault全体を検索"
                title={`Quick Open${commands.label("quickOpen.open") ? `（${commands.label("quickOpen.open")}）` : ""}`}
                variant="subtle"
                onClick={() => commands.execute("quickOpen.open")}
              >
                <NavigationIcon kind="search" />
              </ActionIcon>
            </Group>
            <Group className="app-header-status" gap="xs">
              <ActionIcon
                aria-label="設定"
                title="設定"
                variant="subtle"
                onClick={() => commands.execute("settings.open")}
              >
                <NavigationIcon kind="settings" />
              </ActionIcon>
              {health !== null && !writable && (
                <Badge size="sm" color="yellow">
                  {health.accessMode === "migration-required"
                    ? "移行が必要"
                    : "読み取り専用"}
                </Badge>
              )}
            </Group>
          </Group>
          {!sidebar.mobile && (
            <PageTabBar
              snapshot={pageSnapshot}
              entities={allEntities}
              statuses={
                document
                  ? {
                      [document.entity.id]:
                        conflict || externalChangeDetected
                          ? "warning"
                          : busy
                            ? "saving"
                            : dirty
                              ? "dirty"
                              : "saved",
                    }
                  : {}
              }
              disabled={
                health === null ||
                busy ||
                pendingNavigation !== null ||
                conflict !== null
              }
              panelId={() => "active-page-panel"}
              onSelect={(id) => void performPageAction({ kind: "select", id })}
              onClose={(id) => void performPageAction({ kind: "close", id })}
              onNew={() => commands.execute("tab.new")}
              onMove={(id, beforeId) => pages.move(id, beforeId)}
            />
          )}
        </AppShell.Header>
        <AppShell.Navbar p="sm" className="entity-navbar">
          <EntitySidebar
            searchShortcut={commands.label("quickOpen.open")}
            onSearch={() => {
              sidebar.closeOnNavigate();
              commands.execute("quickOpen.open");
            }}
            entities={allEntities}
            counts={counts?.types}
            selectedId={selectedId}
            activeType={collectionType}
            activeResourceType={collectionResourceType}
            timelineActive={timelineOpen}
            todosActive={todosOpen}
            pinnedIds={pins.pinnedIds}
            onOpenWorkspace={() => {
              sidebar.closeOnNavigate();
              void showHierarchy();
            }}
            onOpenTimeline={() => {
              sidebar.closeOnNavigate();
              void showTimeline();
            }}
            onOpenTodos={() => {
              sidebar.closeOnNavigate();
              void showTodos();
            }}
            onOpenCollection={(type, resourceType) => {
              sidebar.closeOnNavigate();
              void showCollection(type, false, resourceType);
            }}
            onOpenEntity={(entityId) => {
              sidebar.closeOnNavigate();
              void selectEntity(entityId, true, false, {
                newTab: !sidebar.mobile,
              });
            }}
            onTogglePinned={pins.togglePinned}
            writable={writable}
            onCreateEntity={(type) => {
              sidebar.closeOnNavigate();
              openCreateEntity(type);
            }}
            onRefresh={() =>
              void refreshEntities().catch((reason: unknown) =>
                notifyError(errorMessage(reason)),
              )
            }
            onOpenAttachments={() => {
              sidebar.closeOnNavigate();
              setOrphanAssetsOpen(true);
            }}
            syncConflictCount={syncConflictCount}
            onOpenSyncConflicts={() => {
              sidebar.closeOnNavigate();
              setSyncConflictsOpen(true);
            }}
          />
          <div
            aria-label="サイドバーの幅を変更"
            className="sidebar-resize-handle"
            onPointerDown={sidebar.startResize}
            role="separator"
          />
        </AppShell.Navbar>
        <AppShell.Main>
          <Stack
            className="editor-shell"
            gap="sm"
            role={sidebar.mobile ? undefined : "tabpanel"}
            id="active-page-panel"
            aria-labelledby={
              sidebar.mobile ? undefined : `page-tab-${pageSnapshot.activeId}`
            }
            aria-label={
              sidebar.mobile
                ? selectedEntity
                  ? entityUiTitle(selectedEntity)
                  : "Workspace"
                : undefined
            }
          >
            {selectedId !== null &&
            (entityLoading || entityLoadError !== null) ? (
              <Paper withBorder p="xl" aria-busy={entityLoading}>
                <Stack gap="md">
                  <Group>
                    {entityLoading && <Loader size="sm" />}
                    <Text fw={650} size="lg" role="status" aria-live="polite">
                      {allEntities.find((entity) => entity.id === selectedId)
                        ?.displayName ?? "Entity詳細"}
                      {entityLoading
                        ? "を読み込み中…"
                        : "を読み込めませんでした"}
                    </Text>
                  </Group>
                  {entityLoadError !== null && (
                    <Alert color="red">{entityLoadError}</Alert>
                  )}
                  <Group>
                    {entityLoadError !== null && (
                      <Button
                        onClick={() =>
                          void selectEntity(selectedId, false, true)
                        }
                      >
                        再試行
                      </Button>
                    )}
                    <Button
                      variant="default"
                      onClick={() => commands.execute("navigation.back")}
                    >
                      戻る
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            ) : document === null && todosOpen ? (
              <TodoListView
                storageKey={
                  health === null
                    ? undefined
                    : `pkm:web:${health.vaultId}:checklist`
                }
                entities={allEntities}
                revision={todoRevision}
                readOnly={!writable}
                loadTodos={(query, signal) => client.listTodos(query, signal)}
                onToggleTodo={(request) => client.toggleTodo(request)}
                onChanged={async () => {}}
                onOpenEntity={(id) => void selectEntity(id)}
              />
            ) : document === null && timelineOpen ? (
              <PagedTimeline
                client={client}
                entities={allEntities}
                viewMode={timelineViewMode}
                onViewModeChange={setTimelineViewMode}
                selectedDate={timelineDate}
                onDateChange={(date) => {
                  if (date === timelineDate) return;
                  setTimelineDate(date);
                }}
                readOnly={!writable}
                draftStorageKey={
                  health === null
                    ? undefined
                    : timelineDate === null
                      ? `pkm:web:${health.vaultId}:timeline-draft`
                      : `pkm:web:${health.vaultId}:daily-draft:${timelineDate}`
                }
                onCapture={captureTimelineEntry}
                onUpdateEntryBody={updateTimelineBody}
                contextEntities={allEntities}
                onUploadAsset={uploadAsset}
                onOpenAsset={downloadAsset}
                onOpenEntity={(entityId) => void selectEntity(entityId)}
              />
            ) : document === null && collectionType !== null ? (
              <PagedCollection
                key={`${collectionType}:${collectionResourceType ?? "all"}`}
                type={collectionType}
                resourceScope={collectionResourceType}
                entities={allEntities}
                pinnedIds={pins.pinnedIds}
                readOnly={!writable}
                onOpenEntity={(entityId) => void selectEntity(entityId)}
                onCreate={openCreateEntity}
                onTogglePinned={pins.togglePinned}
                onDeleteEntity={deleteEntity}
                onUpdateEntity={updateEntityFromTable}
                onUpdateTopics={updateEntityTopics}
                onUpdateError={(reason) => notifyError(errorMessage(reason))}
              />
            ) : document === null ? (
              <PagedWorkspace
                entities={allEntities}
                pinnedIds={pins.pinnedIds}
                onTogglePinned={pins.togglePinned}
                view={hierarchyView}
                readOnly={!writable}
                onOpenEntity={(entityId) => void selectEntity(entityId)}
                onUpdateEntity={updateEntityFromTable}
                onUpdateTopics={updateEntityTopics}
                onUpdateError={(reason) => notifyError(errorMessage(reason))}
                onViewChange={setHierarchyView}
              />
            ) : (
              <>
                {selectedEntity !== null && (
                  <EntityParentLinks
                    entity={selectedEntity}
                    entities={allEntities}
                    onOpenEntity={(entityId) => void selectEntity(entityId)}
                  />
                )}
                <Group
                  className="entity-detail-heading"
                  justify="space-between"
                  align="flex-end"
                >
                  <Group>
                    <div>
                      <Group className="entity-detail-identity" gap="xs">
                        <EntityIcon
                          type={document.entity.type}
                          status={
                            selectedEntity?.status ?? document.entity.status
                          }
                        />
                        {document.entity.type === "entry" &&
                        (entryTitle !== "" || editingEntryTitle) ? (
                          <TextInput
                            aria-label="Entryタイトル"
                            placeholder="タイトルを追加"
                            variant="unstyled"
                            size="lg"
                            fw={650}
                            autoFocus={editingEntryTitle}
                            value={entryTitle}
                            onChange={(event) =>
                              setEntryTitle(event.currentTarget.value)
                            }
                            onBlur={() => {
                              commitEntryTitle();
                              setEditingEntryTitle(false);
                            }}
                            onKeyDown={blurOnInputExit}
                            disabled={!writable || busy}
                          />
                        ) : document.entity.type === "entry" ? (
                          writable && (
                            <Button
                              variant="subtle"
                              size="xs"
                              onClick={() => setEditingEntryTitle(true)}
                            >
                              + タイトルを追加
                            </Button>
                          )
                        ) : (
                          <Text
                            fw={650}
                            size="lg"
                            title={entityUiTitle(
                              selectedEntity ?? document.entity,
                            )}
                          >
                            {entityUiTitle(selectedEntity ?? document.entity)}
                          </Text>
                        )}
                        {(document.entity.type === "project" ||
                          document.entity.type === "task") && (
                          <EntityStatusLabel
                            status={
                              selectedEntity?.status ?? document.entity.status
                            }
                          />
                        )}
                      </Group>
                    </div>
                    <EntityIdCopyButton
                      entityId={document.entity.id}
                      entityType={document.entity.type}
                    />
                    <EntityPinButton
                      pinned={pins.pinnedIds.has(document.entity.id)}
                      onToggle={() => pins.togglePinned(document.entity.id)}
                    />
                    <EntityDeleteButton
                      disabled={!writable || busy}
                      entityName={
                        selectedEntity === null
                          ? entityUiTitle(document.entity)
                          : entityUiTitle(selectedEntity)
                      }
                      onDelete={() => deleteEntity(document.entity.id)}
                      onDeleteError={(reason) =>
                        notifyError(errorMessage(reason))
                      }
                    />
                  </Group>
                  {(supportsMarkdownBody(document.entity.type) || dirty) && (
                    <Group>
                      <Button
                        variant="default"
                        disabled={!dirty || busy}
                        onClick={() => void discard()}
                      >
                        変更を破棄
                      </Button>
                      <Button
                        disabled={!writable || !dirty}
                        loading={busy}
                        onClick={() => void save()}
                      >
                        保存
                      </Button>
                    </Group>
                  )}
                </Group>
                <EntityEntryViewControls
                  entityType={document.entity.type}
                  mode={entityEntryView.mode}
                  relationMode={entityEntryView.relationMode}
                  onModeChange={entityEntryView.setMode}
                  onRelationModeChange={entityEntryView.setRelationMode}
                />
                {entityEntryView.mode === "timeline" && (
                  <EntityEntryTimeline
                    key={document.entity.id}
                    entity={selectedEntity ?? document.entity}
                    onCapture={captureEntry}
                    captureStorageKey={
                      health
                        ? `pkm:web:${health.vaultId}:context-capture:${document.entity.id}`
                        : undefined
                    }
                    contextEntities={allEntities}
                    onUploadAsset={uploadAsset}
                    relationMode={entityEntryView.relationMode}
                    readOnly={!writable}
                    onOpenEntity={(id) => void selectEntity(id)}
                    onOpenAsset={downloadAsset}
                    onUpdateEntryBody={updateTimelineBody}
                    onCreate={
                      canCreateInContext("entry", document.entity)
                        ? () =>
                            openCreateEntity(
                              "entry",
                              selectedEntity ?? document.entity,
                            )
                        : undefined
                    }
                  />
                )}
                <div hidden={entityEntryView.mode !== "detail"}>
                  <Stack gap="sm">
                    {document.entity.type === "entry" ? (
                      <>
                        {selectedEntity !== null && (
                          <EntryPropertiesPanel
                            entity={{
                              ...selectedEntity,
                              topicIds:
                                parsedEntryContent.ok &&
                                parsedEntryContent.value.entity.type === "entry"
                                  ? (parsedEntryContent.value.entity.topics ??
                                    [])
                                  : selectedEntity.topicIds,
                              occurredAt:
                                parsedEntryContent.ok &&
                                parsedEntryContent.value.entity.type === "entry"
                                  ? (parsedEntryContent.value.entity
                                      .occurred_at ?? null)
                                  : selectedEntity.occurredAt,
                              journalDate:
                                parsedEntryContent.ok &&
                                parsedEntryContent.value.entity.type === "entry"
                                  ? (parsedEntryContent.value.entity
                                      .journal_date ?? null)
                                  : selectedEntity.journalDate,
                            }}
                            entities={allEntities}
                            readOnly={!writable || busy}
                            onUpdateTopics={(names) =>
                              editDocumentTopics(names)
                            }
                            onUpdateOccurredAt={(occurredAt) => {
                              editContent(
                                updateEntityMetadata(content, { occurredAt })
                                  .content,
                              );
                              return Promise.resolve();
                            }}
                            onUpdateJournalDate={(journalDate) => {
                              editContent(
                                updateEntityMetadata(content, { journalDate })
                                  .content,
                              );
                              return Promise.resolve();
                            }}
                            onUpdateError={(reason) =>
                              notifyError(errorMessage(reason))
                            }
                          />
                        )}
                      </>
                    ) : (
                      selectedEntity !== null && (
                        <EntityPropertiesPanel
                          entity={selectedEntity}
                          assetActionLabel="ダウンロード"
                          entities={allEntities}
                          readOnly={!writable}
                          disabled={busy}
                          onUpdate={(patch) =>
                            document.entity.type === "resource"
                              ? editResourceMetadata(patch)
                              : updateEntityFromTable(selectedEntity.id, patch)
                          }
                          onUpdateTopics={(topicNames) =>
                            document.entity.type === "resource"
                              ? editDocumentTopics(topicNames)
                              : updateEntityTopics(
                                  selectedEntity.id,
                                  topicNames,
                                )
                          }
                          onUploadAsset={uploadAsset}
                          onOpenAsset={downloadAsset}
                          onUpdateError={(reason) =>
                            notifyError(errorMessage(reason))
                          }
                        />
                      )
                    )}
                    {document.entity.type !== "entry" &&
                      selectedEntity !== null && (
                        <PagedRelations
                          key={`relations:${selectedEntity.id}`}
                          entity={selectedEntity}
                          entryRelationMode={entityEntryView.relationMode}
                          entriesEnabled={entityEntryView.mode === "detail"}
                          entities={allEntities}
                          pinnedIds={pins.pinnedIds}
                          readOnly={!writable}
                          onCreate={openCreateEntity}
                          onOpenEntity={(entityId) =>
                            void selectEntity(entityId)
                          }
                          onTogglePinned={pins.togglePinned}
                          onDeleteEntity={deleteEntity}
                          onUpdateEntity={updateEntityFromTable}
                          onUpdateTopics={updateEntityTopics}
                          onUpdateError={(reason) =>
                            notifyError(errorMessage(reason))
                          }
                        />
                      )}
                    {supportsMarkdownBody(document.entity.type) && (
                      <EntityBodySection
                        key={document.entity.id}
                        collapsible={document.entity.type !== "entry"}
                        headerActions={
                          document.entity.type !== "entry" ? (
                            <SegmentedControl
                              aria-label={`${bodyLabel}表示モード`}
                              data={[
                                { value: "live", label: "Live編集" },
                                { value: "raw", label: "Raw" },
                              ]}
                              value={entryViewMode}
                              onChange={changeEntryViewMode}
                            />
                          ) : undefined
                        }
                      >
                        {(bodyVisible) => (
                          <>
                            {document.entity.type === "entry" && (
                              <Group justify="flex-end">
                                <SegmentedControl
                                  aria-label="Entry表示モード"
                                  data={[
                                    { value: "live", label: "Live編集" },
                                    { value: "raw", label: "Raw" },
                                  ]}
                                  value={entryViewMode}
                                  onChange={changeEntryViewMode}
                                />
                              </Group>
                            )}
                            <div
                              className="markdown-workspace"
                              data-mode={entryViewMode}
                            >
                              {entryViewMode === "live" && (
                                <MarkdownLiveEditor
                                  key={document.entity.id}
                                  ariaLabel={`${bodyLabel} Markdown Live Previewエディタ`}
                                  className="markdown-live-editor"
                                  value={entryBody}
                                  readOnly={!writable}
                                  disabled={busy}
                                  searchShortcutEnabled={
                                    bodyVisible &&
                                    entityEntryView.mode === "detail"
                                  }
                                  onChange={editEntryBody}
                                  onUploadAsset={uploadAsset}
                                  onOpenAsset={downloadAsset}
                                  onOpenReference={(entityId) =>
                                    void selectEntity(entityId)
                                  }
                                />
                              )}
                              {entryViewMode === "raw" && (
                                <Textarea
                                  aria-label={`${bodyLabel} Raw Markdownエディタ`}
                                  className="markdown-editor"
                                  value={content}
                                  onChange={(event) =>
                                    editContent(event.currentTarget.value)
                                  }
                                  disabled={!writable || busy}
                                  autosize
                                  minRows={20}
                                  maxRows={34}
                                  styles={{
                                    input: {
                                      fontFamily:
                                        "var(--mantine-font-family-monospace)",
                                    },
                                  }}
                                />
                              )}
                            </div>
                          </>
                        )}
                      </EntityBodySection>
                    )}
                    <PagedBacklinks
                      key={`backlinks:${document.entity.id}`}
                      entityId={document.entity.id}
                      client={client}
                      revision={backlinkRevision}
                      onOpenEntity={(entityId) => void selectEntity(entityId)}
                    />
                  </Stack>
                </div>
              </>
            )}
          </Stack>
        </AppShell.Main>
        {writable && (
          <FloatingActions
            navigationKey={`${selectedId ?? ""}:${collectionType ?? ""}:${collectionResourceType ?? ""}:${timelineOpen}:${todosOpen}`}
            hidden={sidebar.overlayOpen || quickCaptureOpen || createOpen}
            onCapture={() => {
              commands.execute("capture.open");
            }}
            onCreate={(type) => openCreateEntity(type)}
          />
        )}
        <QuickCaptureDialog
          opened={quickCaptureOpen}
          onClose={() => setQuickCaptureOpen(false)}
          onCapture={captureEntry}
          contextEntities={allEntities}
          currentContext={captureContext}
          defaultCurrentContext={captureContext !== null}
          storageKey={
            health === null
              ? undefined
              : `pkm:web:${health.vaultId}:capture-draft${captureContext ? `:${captureContext.id}` : ""}`
          }
          onUploadAsset={uploadAsset}
          onOpenAsset={downloadAsset}
        />
        <OrphanAssetDialog
          opened={orphanAssetsOpen}
          onClose={() => setOrphanAssetsOpen(false)}
          readOnly={!writable}
          client={client}
        />
        <Modal
          opened={pendingNavigation !== null}
          onClose={() => setPendingNavigation(null)}
          title="未保存の変更があります"
          centered
        >
          <Stack>
            <Text size="sm">
              変更はこのブラウザー内の下書きとして保持されます。Vaultの正本にはまだ保存されていません。
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => setPendingNavigation(null)}
              >
                編集に戻る
              </Button>
              <Button
                variant="light"
                onClick={() => void continuePendingNavigation(false)}
              >
                Draftを残して移動
              </Button>
              <Button
                loading={busy}
                onClick={() => void continuePendingNavigation(true)}
              >
                保存して移動
              </Button>
            </Group>
          </Stack>
        </Modal>
        <Modal
          opened={createOpen}
          onClose={() => setCreateOpen(false)}
          title={`${ENTITY_TYPE_OPTIONS.find((option) => option.value === createType)?.label ?? "Entity"}を作成`}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createEntity();
            }}
          >
            <Stack>
              <TextInput
                autoFocus
                label={createType === "entry" ? "タイトル" : "名前"}
                value={createName}
                onChange={(event) => setCreateName(event.currentTarget.value)}
              />
              {createType !== "topic" && (
                <EntityTagsInput
                  label="Topics"
                  data={topicNameOptions}
                  value={createTopics}
                  onChange={setCreateTopics}
                  clearable
                  splitChars={[",", "、"]}
                />
              )}
              {createType === "resource" && (
                <>
                  <Select
                    label="資料種別"
                    clearable
                    data={RESOURCE_TYPE_OPTIONS}
                    value={createResourceType}
                    onChange={setCreateResourceType}
                  />
                  <TextInput
                    label="Canonical ID"
                    value={createCanonicalIdentifier}
                    onChange={(event) =>
                      setCreateCanonicalIdentifier(event.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="Source URI"
                    placeholder="https://…"
                    value={createSourceUri}
                    onChange={(event) =>
                      setCreateSourceUri(event.currentTarget.value)
                    }
                  />
                </>
              )}
              {createContext !== null &&
                canCreateInContext(createType, createContext) && (
                  <Text c="dimmed" size="sm">
                    Context: {createContext.displayName ?? createContext.id} (
                    {createContext.type})
                  </Text>
                )}
              <Group justify="flex-end">
                <Button variant="default" onClick={() => setCreateOpen(false)}>
                  キャンセル
                </Button>
                <Button type="submit" loading={busy}>
                  作成
                </Button>
              </Group>
            </Stack>
          </form>
        </Modal>
        <Modal
          opened={conflict !== null}
          onClose={() => setConflict(null)}
          title="外部更新との競合"
          size="xl"
        >
          {conflict !== null && (
            <Stack>
              <div className="conflict-grid">
                <div className="conflict-version">
                  <Text fw={600} mb="xs">
                    外部版
                  </Text>
                  <pre>
                    {conflict.actual?.content ??
                      "（ファイルは削除されています）"}
                  </pre>
                </div>
                <div className="conflict-version">
                  <Text fw={600} mb="xs">
                    Draft版
                  </Text>
                  <pre>{conflict.draftContent}</pre>
                </div>
              </div>
              <Divider />
              <Group justify="flex-end">
                <Button
                  variant="default"
                  loading={busy}
                  onClick={() => void resolveConflict("keep-external")}
                >
                  外部版を採用
                </Button>
                <Button
                  loading={busy}
                  onClick={() => void resolveConflict("keep-draft")}
                >
                  Draft版を保存
                </Button>
              </Group>
            </Stack>
          )}
        </Modal>
        <SyncthingConflictDialog
          client={client}
          conflicts={syncConflicts}
          opened={syncConflictsOpen}
          readOnly={!writable}
          onClose={() => setSyncConflictsOpen(false)}
          onError={notifyError}
          onRefresh={refreshSyncConflicts}
          onResolved={async (result) => {
            await Promise.all([refreshEntities(), refreshSyncConflicts()]);
            if (
              result.document !== null &&
              selectedIdRef.current === result.document.entity.id
            ) {
              await selectEntity(result.document.entity.id);
            }
            notifySuccess(
              result.resolution === "keep-canonical"
                ? "正本を採用して同期競合を解決しました。"
                : result.resolution === "keep-conflict"
                  ? "競合版を正本として保存しました。"
                  : "手動マージ版を保存しました。",
            );
          }}
        />
      </AppShell>
    </EntityQueryContext.Provider>
  );
};
