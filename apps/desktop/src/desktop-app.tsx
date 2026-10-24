import { LinkPreviewContext } from "@pkm/ui";
import { useStoredViewState } from "@pkm/ui";
import { RESOURCE_TYPE_OPTIONS } from "@pkm/ui";
import type { ResourceType } from "@pkm/contracts";
import type { PermanentlyDeleteEntityRequest } from "@pkm/contracts";
import type { AssetUploader } from "@pkm/ui";
import {
  AppSettingsDialog,
  UnresolvedReferencesPanel,
  useAppCommands,
  NotificationProvider,
  useNotification,
} from "@pkm/ui";
import {
  ActionIcon,
  AppShell,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type EntityType,
  type TopicId,
  type EntityPageQuery,
  type EntityPage,
} from "@pkm/contracts";
import {
  updateEntityMetadata,
  entityQueryAffected,
  type EntityMetadataPatch,
} from "@pkm/core";
import {
  PagedCollection,
  EntityQueryContext,
  PagedTimeline,
  type EntryTimelineViewMode,
  TodoListView,
  fileToAssetUpload,
  EntitySidebar,
  PageTabs,
  PageScrollRestoration,
  usePageScrollRestoration,
  PageTabBar,
  NavigationIcon,
  captureEntityTabClick,
  type PageTabSnapshot,
  type PageTabOpenOptions,
  type PageLocation,
  type PageTabAction,
  FloatingActions,
  EntityTrashView,
  OrphanAssetDialog,
  HierarchyListView,
  QuickCaptureDialog,
  captureContextForEntity,
  QuickOpenDialog,
  useQuickOpenRecent,
  type QuickCaptureInput,
  type HierarchyEntityPatch,
  type HierarchyGroupMode,
  type HierarchyView,
  resolveTopicInputs,
  usePinnedEntities,
  useResizableSidebar,
} from "@pkm/ui";
import type {
  EntityDocument,
  IndexedConflict,
  IndexedEntity,
} from "@pkm/storage-node";

import type { OpenDesktopVault } from "./desktop-api.js";
import { VaultSettingsPanel } from "./vault-settings-panel.js";
import {
  DesktopEntityTabPanel,
  type DesktopTabStatus,
} from "./desktop-entity-tab.js";
import {
  DesktopTabs,
  updateDesktopTabChanges,
  type DesktopTabChange,
  type DesktopTabSnapshot,
} from "./desktop-tabs.js";
import {
  SyncthingConflictDialog,
  ENTITY_TYPE_OPTIONS,
  entryContextPatch,
  creationContextPatch,
  linkCreatedEntityToContext,
  canCreateInContext,
  createEntityActions,
} from "@pkm/ui";

type EntityReturnLocation = Exclude<PageLocation, { readonly kind: "entity" }>;

export const DesktopApp = (): React.JSX.Element => (
  <LinkPreviewContext.Provider value={window.pkm.linkPreview}>
    <NotificationProvider>
      <DesktopAppContent />
    </NotificationProvider>
  </LinkPreviewContext.Provider>
);

const DesktopAppContent = (): React.JSX.Element => {
  const entityActions = useMemo(() => createEntityActions(window.pkm), []);
  const [vault, setVault] = useState<OpenDesktopVault | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [allEntities, setAllEntities] = useState<readonly IndexedEntity[]>([]);
  const [deletedEntities, setDeletedEntities] = useState<
    readonly IndexedEntity[]
  >([]);
  const [collectionType, setCollectionType] = useState<EntityType | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineViewMode, setTimelineViewMode] =
    useState<EntryTimelineViewMode>("list");
  const [todosOpen, setTodosOpen] = useState(false);
  const [todoRevision, setTodoRevision] = useState(0);
  const [labelRevision, setLabelRevision] = useState(0);
  const [tabChanges, setTabChanges] = useState<
    ReadonlyMap<string, DesktopTabChange>
  >(new Map());
  const queryPages = useRef(
    new Map<string, { query: EntityPageQuery; page: EntityPage }>(),
  );
  const queryGeneration = useRef(0);
  const vaultGeneration = useRef(0);
  const changeQueue = useRef<Promise<void>>(Promise.resolve());
  const [timelineDate, setTimelineDate] = useState<string | null>(null);
  const [hierarchyView, setHierarchyView] = useStoredViewState<HierarchyView>(
    vault === null ? undefined : `pkm:desktop:${vault.vaultId}:home`,
    "view",
    "area",
    (v) => ["area", "project", "task"].includes(String(v)),
  );
  const [hierarchyGroupMode, setHierarchyGroupMode] =
    useStoredViewState<HierarchyGroupMode>(
      vault === null ? undefined : `pkm:desktop:${vault.vaultId}:home`,
      "group",
      "area",
      (v) => ["none", "area", "topic", "project"].includes(String(v)),
    );
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const [document, setDocument] = useState<EntityDocument | null>(null);
  const [tabSnapshot, setTabSnapshot] = useState<DesktopTabSnapshot>({
    tabs: [],
    activeId: null,
  });
  const [tabStatuses, setTabStatuses] = useState<
    Readonly<Record<string, DesktopTabStatus>>
  >({});
  const [changingVault, setChangingVault] = useState(true);
  const changingVaultRef = useRef(false);
  const notifyError = useNotification("error");
  const [syncConflicts, setSyncConflicts] = useState<
    readonly IndexedConflict[]
  >([]);
  const [syncConflictsOpen, setSyncConflictsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [captureContext, setCaptureContext] =
    useState<ReturnType<typeof captureContextForEntity>>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [orphanAssetsOpen, setOrphanAssetsOpen] = useState(false);
  const notifySuccess = useNotification("success");
  const [createType, setCreateType] = useState<EntityType>("project");
  const [createContext, setCreateContext] = useState<IndexedEntity | null>(
    null,
  );
  const [createName, setCreateName] = useState("");
  const [createTopics, setCreateTopics] = useState<string[]>([]);
  const [createCanonicalIdentifier, setCreateCanonicalIdentifier] =
    useState("");
  const [createSourceUri, setCreateSourceUri] = useState("");
  const [createResourceType, setCreateResourceType] =
    useState<ResourceType | null>(null);
  const [creating, setCreating] = useState(false);
  const selectedIdRef = useRef<string | null>(null);
  const tabsRef = useRef<DesktopTabs | null>(null);
  const tabs = useMemo(
    () =>
      new DesktopTabs(
        async (id) => {
          const [document, backlinks] = await Promise.all([
            window.pkm.loadEntity(id),
            window.pkm.getBacklinks(id),
          ]);
          return { id, document, backlinks };
        },
        (snapshot) => {
          setTabSnapshot(snapshot);
          selectedIdRef.current = snapshot.activeId;
          setSelectedId(snapshot.activeId);
          setDocument(tabsRef.current?.currentDocument() ?? null);
        },
      ),
    [],
  );
  tabsRef.current = tabs;
  const handleTabDocument = useCallback((next: EntityDocument): void => {
    if (selectedIdRef.current === next.entity.id) setDocument(next);
  }, []);
  const handleTabStatus = useCallback(
    (id: string, status: DesktopTabStatus): void => {
      setTabStatuses((current) =>
        current[id] === status ? current : { ...current, [id]: status },
      );
    },
    [],
  );
  const sidebar = useResizableSidebar("pkm:desktop:sidebar");
  usePageScrollRestoration(
    pageScroll.current,
    pageSnapshot,
    vault?.vaultId ?? null,
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
    vault !== null && !changingVault,
  );
  const pins = usePinnedEntities(
    vault === null ? null : `pkm:desktop:${vault.vaultId}:pins`,
    allEntities.map((entity) => entity.id),
  );
  const recentIds = useQuickOpenRecent(
    vault === null ? null : `pkm:desktop:${vault.vaultId}:recent`,
    document?.entity.id ?? null,
  );
  const searchQuickOpen = useCallback(
    (query: string) => window.pkm.quickOpen(query),
    [],
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

  const refreshEntities = useCallback(async (): Promise<void> => {
    const generation = vaultGeneration.current;
    const [active, deleted] = await Promise.all([
      window.pkm.listEntities(),
      window.pkm.listDeletedEntities(),
    ]);
    if (generation !== vaultGeneration.current) return;
    setAllEntities(active);
    setDeletedEntities(deleted);
    setTodoRevision((value) => value + 1);
    setLabelRevision((value) => value + 1);
    queryPages.current.clear();
    queryGeneration.current++;
  }, []);

  const refreshSyncConflicts = useCallback(async (): Promise<void> => {
    const conflicts = await window.pkm.listSyncthingConflicts();
    setSyncConflicts(conflicts);
    if (conflicts.length === 0) setSyncConflictsOpen(false);
  }, []);

  const saveBeforeLeave = useCallback(
    (): Promise<boolean> => tabs.saveActive(),
    [tabs],
  );

  useEffect(() => {
    window.pkm.onVaultChanged(({ changes }) => {
      const generation = vaultGeneration.current;
      changeQueue.current = changeQueue.current
        .then(async () => {
          if (generation !== vaultGeneration.current) return;
          queryGeneration.current++;
          for (const [key, cached] of queryPages.current)
            if (entityQueryAffected(cached.query, changes, cached.page))
              queryPages.current.delete(key);
          if (changes.reset) await refreshEntities();
          else if (changes.entities.length) {
            const ids = changes.entities.map(({ id }) => id);
            const batches = Array.from(
              { length: Math.ceil(ids.length / 100) },
              (_, index) => ids.slice(index * 100, (index + 1) * 100),
            );
            const [active, deleted] = await Promise.all([
              Promise.all(
                batches.map((ids) =>
                  window.pkm.queryEntities({ ids, limit: 100 }),
                ),
              ),
              Promise.all(
                batches.map((ids) =>
                  window.pkm.queryEntities({
                    ids,
                    deleted: "only",
                    limit: 100,
                  }),
                ),
              ),
            ]);
            if (generation !== vaultGeneration.current) return;
            const changedIds = new Set(ids);
            setAllEntities((current) => [
              ...current.filter(({ id }) => !changedIds.has(id)),
              ...active.flatMap(({ items }) => items),
            ]);
            setDeletedEntities((current) => [
              ...current.filter(({ id }) => !changedIds.has(id)),
              ...deleted.flatMap(({ items }) => items),
            ]);
            setTodoRevision((value) => value + 1);
          }
          if (generation !== vaultGeneration.current) return;
          setTabChanges((current) =>
            updateDesktopTabChanges(
              current,
              changes,
              tabs.snapshot().tabs.map(({ id }) => id),
            ),
          );
          if (changes.namesChanged || changes.reset)
            setLabelRevision((value) => value + 1);
          if (changes.conflictsChanged || changes.reset)
            await refreshSyncConflicts();
        })
        .catch((reason: unknown) => {
          notifyError(
            reason instanceof Error ? reason.message : String(reason),
          );
        });
    });
    return () => window.pkm.clearVaultChangedListener();
  }, [refreshEntities, refreshSyncConflicts, tabs]);

  useEffect(() => {
    if (vault === null) return;
    const refresh = (): void => {
      if (globalThis.document.visibilityState === "hidden") return;
      void window.pkm.refreshVault().catch((reason: unknown) => {
        notifyError(reason instanceof Error ? reason.message : String(reason));
      });
    };
    globalThis.document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      globalThis.document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [vault]);

  const releaseUnusedEditors = useCallback(async (): Promise<void> => {
    const ids = new Set(
      pages
        .snapshot()
        .tabs.flatMap((tab) =>
          tab.location.kind === "entity" ? [tab.location.entityId] : [],
        ),
    );
    for (const tab of tabs.snapshot().tabs)
      if (!ids.has(tab.id))
        await tabs.close(
          tab.id,
          () =>
            !pages
              .snapshot()
              .tabs.some(
                (page) =>
                  page.location.kind === "entity" &&
                  page.location.entityId === tab.id,
              ),
        );
  }, [pages, tabs]);

  const openBackgroundTab = async (entityId: string): Promise<void> => {
    if (changingVaultRef.current) return;
    try {
      await tabs.prepare(entityId, () =>
        pages.navigate(
          { kind: "entity", entityId },
          { newTab: true, activate: false },
        ),
      );
    } catch (reason) {
      notifyError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const selectEntity = useCallback(
    async (
      entityId: string,
      recordHistory = true,
      options: PageTabOpenOptions = {},
    ): Promise<boolean> => {
      const previousId = selectedIdRef.current;
      const previousTabId = pages.snapshot().activeId;
      const previousView = tabViewRef.current;
      const previousLocation = pages
        .snapshot()
        .tabs.find((tab) => tab.id === previousTabId)!.location;
      rememberTabView();
      try {
        if (
          !(await tabs.open(entityId, () =>
            pages.navigate({ kind: "entity", entityId }, options),
          ))
        ) {
          notifyError(
            "未保存の変更を保存できませんでした。現在のタブで保存または競合解決を行ってください。",
          );
          return false;
        }
        if (!sidebar.mobile && previousTabId !== pages.snapshot().activeId)
          restoreTabView();
        if (
          recordHistory &&
          options.newTab !== true &&
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
        await releaseUnusedEditors();
        return true;
      } catch (reason) {
        notifyError(reason instanceof Error ? reason.message : String(reason));
        return false;
      }
    },
    [
      collectionType,
      pages,
      tabs,
      releaseUnusedEditors,
      rememberTabView,
      restoreTabView,
      sidebar.mobile,
      timelineOpen,
      todosOpen,
    ],
  );

  const activateWorkspace = async (onOpened: () => void): Promise<boolean> => {
    if (!(await tabs.workspace(onOpened))) {
      notifyError("未保存の変更を保存できないため切替を中止しました。");
      return false;
    }
    return true;
  };

  const openEntity = useCallback(
    (entityId: string): void => {
      void selectEntity(entityId);
    },
    [selectEntity],
  );

  const showOpenedVault = useCallback(
    async (opened: OpenDesktopVault): Promise<void> => {
      vaultGeneration.current++;
      queryGeneration.current++;
      queryPages.current.clear();
      setTabChanges(new Map());
      tabs.reset();
      pages.reset();
      tabViews.current.clear();
      setTabStatuses({});
      setQuickCaptureOpen(false);
      setCaptureContext(null);
      setVault(opened);
      setSelectedId(null);
      selectedIdRef.current = null;
      setDocument(null);
      setNavigationHistory([]);
      setForwardNavigationHistory([]);
      setEntityReturnLocation(null);
      setCollectionType(null);
      setTimelineOpen(false);
      setTimelineDate(null);
      setTodosOpen(false);
      const [all, deleted, nextConflicts] = await Promise.all([
        window.pkm.listEntities(),
        window.pkm.listDeletedEntities(),
        window.pkm.listSyncthingConflicts(),
      ]);
      setAllEntities(all);
      setDeletedEntities(deleted);
      setSyncConflicts(nextConflicts);
      setSyncConflictsOpen(false);
    },
    [pages, tabs],
  );

  const restorePromise = useRef<Promise<OpenDesktopVault | null> | null>(null);
  useEffect(() => {
    let cancelled = false;
    restorePromise.current ??= window.pkm.restoreVault();
    void restorePromise.current
      .then(async (opened) => {
        if (!cancelled && opened) await showOpenedVault(opened);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          notifyError(
            reason instanceof Error ? reason.message : String(reason),
          );
      })
      .finally(() => {
        if (!cancelled) setChangingVault(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showOpenedVault]);

  const chooseVault = async (): Promise<void> => {
    if (changingVaultRef.current) return;
    changingVaultRef.current = true;
    setChangingVault(true);
    try {
      if (!(await tabs.saveAll())) {
        notifyError("未保存の変更を保存できないためVault切替を中止しました。");
        return;
      }
      const opened = await window.pkm.chooseVault();
      if (opened === null) return;
      await showOpenedVault(opened);
    } catch (reason) {
      notifyError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      changingVaultRef.current = false;
      setChangingVault(false);
    }
  };

  const createEntity = async (): Promise<void> => {
    if (!(await saveBeforeLeave())) return;
    setCreating(true);
    try {
      const contextEntity = createContext;
      let created = await window.pkm.createEntity({
        type: createType,
        displayName:
          createType === "entry" ? createName.trim() || null : createName,
      });
      const contextPatch = creationContextPatch(createType, contextEntity);
      const topicResolution = resolveTopicInputs(createTopics, allEntities);
      const topicIds = [...topicResolution.existingIds] as TopicId[];
      if (createType !== "topic") {
        for (const topicName of topicResolution.newNames) {
          const topic = await window.pkm.createEntity({
            type: "topic",
            displayName: topicName,
          });
          topicIds.push(topic.entity.id as TopicId);
        }
      }
      const combinedTopicIds = [
        ...(contextPatch?.topics ?? []),
        ...topicIds,
      ].filter((id, index, ids) => ids.indexOf(id) === index);
      const metadataPatch: EntityMetadataPatch = {
        ...(contextPatch ?? {}),
        ...(createType !== "topic" && combinedTopicIds.length > 0
          ? { topics: combinedTopicIds }
          : {}),
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
      if (Object.keys(metadataPatch).length > 0) {
        const updated = updateEntityMetadata(created.content, metadataPatch);
        const result = await window.pkm.saveEntity({
          entityId: created.entity.id,
          content: updated.content,
          expectedFileHash: created.fileHash,
        });
        if (!result.ok) {
          throw new Error(
            "作成したEntityへcontextまたはTopicsを保存できませんでした。",
          );
        }
        created = await window.pkm.loadEntity(created.entity.id);
      }
      let contextError: string | null = null;
      try {
        await linkCreatedEntityToContext(
          window.pkm,
          createType,
          contextEntity,
          created.entity.id,
        );
      } catch (reason) {
        contextError = `Entityは作成しましたがContextへ関連付けできませんでした: ${reason instanceof Error ? reason.message : String(reason)}`;
      }
      setCreateOpen(false);
      setCreateName("");
      setCreateTopics([]);
      setCreateCanonicalIdentifier("");
      setCreateSourceUri("");
      await refreshEntities();
      await selectEntity(created.entity.id);
      if (contextError !== null) notifyError(contextError);
    } catch (reason) {
      notifyError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  };

  const openCapture = (
    context: IndexedEntity | null = document?.entity ?? null,
  ): void => {
    setCaptureContext(captureContextForEntity(context, allEntities));
    setQuickCaptureOpen(true);
  };

  const openCreateEntity = (
    type: EntityType = "project",
    context: IndexedEntity | null = document?.entity ?? null,
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
        : (allEntities.find((entity) => entity.id === input.contextId) ?? null);
    if (input.contextId !== null && context === null) {
      throw new Error(
        "選択したContextが見つかりません。候補を選び直してください。",
      );
    }
    await window.pkm.createEntity({
      type: "entry",
      displayName: input.title,
      body: input.body,
      ...(context ? { metadata: entryContextPatch(context) ?? {} } : {}),
      ...(journalDate === undefined ? {} : { journalDate }),
    });
    try {
      await refreshEntities();
    } catch (reason) {
      notifyError(
        `保存しましたが一覧の更新に失敗しました: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    }
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
    window.pkm.createAsset(await fileToAssetUpload(file, source));

  const showHierarchy = async (
    location: PageLocation = { kind: "workspace" },
    options: PageTabOpenOptions = { newTab: !sidebar.mobile, reuse: true },
  ): Promise<boolean> => {
    const previousTabId = pages.snapshot().activeId;
    rememberTabView();
    if (
      !(await activateWorkspace(() =>
        pages.navigate(location, {
          ...(sidebar.mobile ? { newTab: false } : {}),
          ...options,
        }),
      ))
    )
      return false;
    setSelectedId(null);
    selectedIdRef.current = null;
    setDocument(null);
    setNavigationHistory([]);
    setForwardNavigationHistory([]);
    setEntityReturnLocation(null);
    setCollectionType(null);
    setTimelineOpen(false);
    setTodosOpen(false);
    if (!sidebar.mobile && previousTabId !== pages.snapshot().activeId)
      restoreTabView();
    await releaseUnusedEditors();
    return true;
  };

  const showCollection = async (
    type: EntityType,
    resourceType?: ResourceType,
  ): Promise<void> => {
    if (
      !(await showHierarchy({
        kind: "collection",
        type,
        ...(resourceType ? { resourceType } : {}),
      }))
    )
      return;
    setCollectionType(type);
  };

  const showTimeline = async (): Promise<void> => {
    if (!(await showHierarchy({ kind: "timeline" }))) return;
    setTimelineOpen(true);
  };
  const showTodos = async (): Promise<void> => {
    if (!(await showHierarchy({ kind: "todos" }))) return;
    setTodosOpen(true);
  };

  const performPageAction = async (action: PageTabAction): Promise<void> => {
    if (changingVaultRef.current) return;
    const snapshot = pages.snapshot();
    if (
      action.kind === "close" &&
      !snapshot.tabs.some((tab) => tab.id === action.id)
    )
      return;
    if (action.kind === "close" && action.id !== snapshot.activeId) {
      const tab = snapshot.tabs.find((tab) => tab.id === action.id);
      if (
        tab?.location.kind === "entity" &&
        !(await tabs.close(tab.location.entityId))
      ) {
        pages.activate(action.id);
        notifyError(
          "保存できなかったためタブを閉じませんでした。保存または競合解決を行ってください。",
        );
        return;
      }
      pages.close(action.id);
      return;
    }
    if (action.kind === "select" && action.id === snapshot.activeId) return;
    const target =
      action.kind === "select"
        ? snapshot.tabs.find((tab) => tab.id === action.id)
        : action.kind === "close"
          ? pages.closeTarget(action.id)
          : undefined;
    if (action.kind === "select" && !target) return;
    rememberTabView();
    try {
      const location = target?.location ?? { kind: "workspace" };
      const options = target
        ? { tabId: target.id }
        : action.kind === "new"
          ? { newTab: true }
          : {};
      const opened =
        location.kind === "entity"
          ? await selectEntity(location.entityId, false, options)
          : await showHierarchy(location, options);
      if (!opened) return;
      if (location.kind !== "entity") {
        setCollectionType(
          location.kind === "collection" ? location.type : null,
        );
        setTimelineOpen(location.kind === "timeline");
        setTodosOpen(location.kind === "todos");
      }
      if (action.kind === "close") {
        pages.close(action.id);
        await releaseUnusedEditors();
      }
      restoreTabView();
      if (action.kind === "close") tabViews.current.delete(action.id);
      sidebar.closeOnNavigate();
    } catch (reason) {
      notifyError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const navigateHistory = useCallback(
    async (direction: "back" | "forward"): Promise<void> => {
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
        if (
          !(await tabs.workspace(() =>
            pages.navigate(entityReturnLocation, { newTab: false }),
          ))
        )
          return;
        setSelectedId(null);
        selectedIdRef.current = null;
        setDocument(null);
        setCollectionType(
          entityReturnLocation.kind === "collection"
            ? entityReturnLocation.type
            : null,
        );
        setTimelineOpen(entityReturnLocation.kind === "timeline");
        setTodosOpen(entityReturnLocation.kind === "todos");
        await releaseUnusedEditors();
        setForwardNavigationHistory((current) =>
          [...current, currentId].slice(-20),
        );
        return;
      }
      if (targetId === undefined) return;
      if (!(await selectEntity(targetId, false))) return;
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
      forwardNavigationHistory,
      navigationHistory,
      tabs,
      pages,
      releaseUnusedEditors,
      selectEntity,
    ],
  );

  const commands = useAppCommands({
    enabled:
      vault !== null &&
      !changingVault &&
      !appSettingsOpen &&
      !createOpen &&
      !quickCaptureOpen &&
      !quickOpen &&
      !syncConflictsOpen &&
      !orphanAssetsOpen,
    onError: (reason) =>
      notifyError(reason instanceof Error ? reason.message : String(reason)),
    handlers: {
      "document.save": {
        isEnabled: () => vault?.accessMode === "read-write",
        run: saveBeforeLeave,
      },
      "quickOpen.open": { run: () => setQuickOpen(true) },
      "capture.open": {
        isEnabled: () => vault?.accessMode === "read-write",
        run: () => {
          openCapture();
        },
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
    await entityActions.updateMetadata(entityId, patch);
    await changeQueue.current;
  };

  const updateTimelineBody = async (
    entityId: string,
    expectedBody: string,
    body: string,
  ): Promise<void> => {
    await entityActions.updateEntryBody(entityId, expectedBody, body);
    await changeQueue.current;
  };

  const resolveTopicNames = async (
    topicNames: readonly string[],
  ): Promise<readonly string[]> => {
    const resolution = resolveTopicInputs(topicNames, allEntities);
    const topicIds = [...resolution.existingIds];
    for (const topicName of resolution.newNames) {
      const topic = await window.pkm.createEntity({
        type: "topic",
        displayName: topicName,
      });
      topicIds.push(topic.entity.id);
    }
    if (resolution.newNames.length > 0) await refreshEntities();
    return topicIds;
  };

  const updateEntityTopics = async (
    entityId: string,
    topicNames: readonly string[],
  ): Promise<void> => {
    const topicIds = await resolveTopicNames(topicNames);
    await updateEntityFromTable(entityId, { topicIds });
  };

  const deleteEntity = async (entityId: string): Promise<void> => {
    if (tabs.snapshot().tabs.some((tab) => tab.id === entityId)) {
      if (!(await tabs.close(entityId)))
        throw new Error(
          "未保存の変更を保存できなかったため削除を中止しました。",
        );
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
    if (page) await performPageAction({ kind: "close", id: page.id });
  };

  const permanentlyDeleteEntity = async (
    request: PermanentlyDeleteEntityRequest,
  ): Promise<void> => {
    if (!(await tabs.close(request.entityId)))
      throw new Error(
        "対象のタブを閉じられません。編集中の内容を確認してください。",
      );
    const page = pages
      .snapshot()
      .tabs.find(
        (tab) =>
          tab.location.kind === "entity" &&
          tab.location.entityId === request.entityId,
      );
    if (page) {
      await performPageAction({ kind: "close", id: page.id });
      if (pages.snapshot().tabs.some((tab) => tab.id === page.id))
        throw new Error("対象のタブを閉じられませんでした。");
    }
    await window.pkm.permanentlyDeleteEntity(request);
    await refreshEntities();
  };

  const restoreEntity = async (entityId: string): Promise<void> => {
    await updateEntityFromTable(entityId, { deletedAt: null });
  };

  const queryOptions = useCallback(
    async (query: EntityPageQuery) =>
      (await window.pkm.queryEntities({ ...query, nameOnly: true })).items.map(
        ({ id, type, displayName }) => ({ id, type, displayName }),
      ),
    [],
  );
  const querySource = useMemo(
    () => ({
      vaultId: vault?.vaultId,
      ready: vault !== null && !changingVault,
      query: async (query: EntityPageQuery) => {
        const key = JSON.stringify(query);
        const cached = queryPages.current.get(key);
        if (cached) return cached.page;
        const generation = queryGeneration.current;
        const page = await window.pkm.queryEntities(query);
        if (generation === queryGeneration.current) {
          queryPages.current.set(key, { query, page });
          if (queryPages.current.size > 64)
            queryPages.current.delete(queryPages.current.keys().next().value!);
        }
        return page;
      },
      getCachedPage: (query: EntityPageQuery) =>
        queryPages.current.get(JSON.stringify(query))?.page,
      options: queryOptions,
      labelRevision,
      revision: todoRevision,
      calendarRevision: todoRevision,
    }),
    [vault, changingVault, todoRevision, queryOptions, labelRevision],
  );

  if (vault === null) {
    return (
      <main className="welcome">
        <Stack align="center" gap="lg">
          <Title order={1}>Contextory</Title>
          <Text c="dimmed">
            既存のVault、または新しいVault用の空のフォルダを選択してください。
          </Text>
          <Text size="sm" c="dimmed">
            空のフォルダは自動で初期化します。
          </Text>
          <Button
            size="lg"
            loading={changingVault}
            disabled={changingVault}
            onClick={() => void chooseVault()}
          >
            Vaultを選択
          </Button>
        </Stack>
      </main>
    );
  }

  const allEntitiesIncludingDeleted = [...allEntities, ...deletedEntities];

  return (
    <AppShell
      inert={changingVault}
      onClickCapture={(event) =>
        !sidebar.mobile &&
        captureEntityTabClick(event, (id) => void openBackgroundTab(id))
      }
      header={{ height: 44 }}
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
        busy={settingsBusy}
        sections={[
          {
            id: "trash",
            label: "ゴミ箱",
            content: (
              <EntityTrashView
                allEntities={allEntitiesIncludingDeleted}
                entities={deletedEntities}
                readOnly={vault.accessMode !== "read-write"}
                loadEntity={window.pkm.loadEntity}
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
                listReferences={window.pkm.listUnresolvedReferences}
                onOpenEntity={(entityId) => {
                  setAppSettingsOpen(false);
                  sidebar.closeOnNavigate();
                  void selectEntity(entityId);
                }}
              />
            ),
          },
          {
            id: "vault",
            label: "Vault・同期",
            content: (
              <VaultSettingsPanel
                key={vault.vaultRoot}
                vault={vault}
                onBusyChange={setSettingsBusy}
                onChooseVault={async () => {
                  setAppSettingsOpen(false);
                  await chooseVault();
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
            : (entityId) => selectEntity(entityId, true, { newTab: true })
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
            {vault.accessMode !== "read-write" && (
              <Badge size="sm" color="yellow">
                {vault.accessMode === "migration-required"
                  ? "移行が必要"
                  : "読み取り専用"}
              </Badge>
            )}
          </Group>
        </Group>
        {!sidebar.mobile && (
          <PageTabBar
            snapshot={pageSnapshot}
            entities={[...allEntities, ...deletedEntities]}
            statuses={tabStatuses}
            disabled={changingVault}
            panelId={(tab) =>
              tab.location.kind === "entity"
                ? `entity-panel-${tab.location.entityId}`
                : "workspace-panel"
            }
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
          selectedId={selectedId}
          activeType={selectedId === null ? collectionType : null}
          activeResourceType={collectionResourceType}
          timelineActive={selectedId === null && timelineOpen}
          todosActive={selectedId === null && todosOpen}
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
            void showCollection(type, resourceType);
          }}
          onOpenEntity={(entityId) => {
            sidebar.closeOnNavigate();
            void selectEntity(entityId, true, { newTab: !sidebar.mobile });
          }}
          onTogglePinned={pins.togglePinned}
          writable={vault.accessMode === "read-write"}
          onCreateEntity={(type) => {
            sidebar.closeOnNavigate();
            openCreateEntity(type);
          }}
          onRefresh={() =>
            void refreshEntities().catch((reason: unknown) =>
              notifyError(
                reason instanceof Error ? reason.message : String(reason),
              ),
            )
          }
          onOpenAttachments={() => {
            sidebar.closeOnNavigate();
            setOrphanAssetsOpen(true);
          }}
          onChangeVault={() => {
            sidebar.closeOnNavigate();
            void chooseVault();
          }}
          syncConflictCount={syncConflicts.length}
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
        <EntityQueryContext.Provider value={querySource}>
          <section
            role={sidebar.mobile ? undefined : "tabpanel"}
            id="workspace-panel"
            aria-labelledby={
              sidebar.mobile ? undefined : `page-tab-${pageSnapshot.activeId}`
            }
            aria-label={sidebar.mobile ? "Workspace" : undefined}
            hidden={selectedId !== null}
          >
            {todosOpen ? (
              <TodoListView
                storageKey={
                  vault === null
                    ? undefined
                    : `pkm:desktop:${vault.vaultId}:checklist`
                }
                entities={allEntities}
                revision={todoRevision}
                readOnly={vault.accessMode !== "read-write"}
                loadTodos={window.pkm.listTodos}
                onToggleTodo={window.pkm.toggleTodo}
                onChanged={refreshEntities}
                onOpenEntity={openEntity}
              />
            ) : timelineOpen ? (
              <PagedTimeline
                enabled={selectedId === null}
                client={window.pkm}
                entities={allEntities}
                viewMode={timelineViewMode}
                onViewModeChange={setTimelineViewMode}
                selectedDate={timelineDate}
                onDateChange={(date) => {
                  if (date === timelineDate) return;
                  setTimelineDate(date);
                }}
                readOnly={vault.accessMode !== "read-write"}
                draftStorageKey={
                  timelineDate === null
                    ? `pkm:desktop:${vault.vaultId}:timeline-draft`
                    : `pkm:desktop:${vault.vaultId}:daily-draft:${timelineDate}`
                }
                onCapture={captureTimelineEntry}
                onUpdateEntryBody={updateTimelineBody}
                contextEntities={allEntities}
                onUploadAsset={uploadAsset}
                assetBaseUrl="pkm-asset://vault/"
                onOpenAsset={(path) => {
                  void window.pkm
                    .openAsset(path)
                    .catch((reason: unknown) =>
                      notifyError(
                        reason instanceof Error
                          ? reason.message
                          : String(reason),
                      ),
                    );
                }}
                onOpenEntity={openEntity}
              />
            ) : collectionType !== null ? (
              <PagedCollection
                className="entity-collection-view"
                showViewControl
                key={`${collectionType}:${collectionResourceType ?? "all"}`}
                storageKey={`pkm:desktop:${vault.vaultId}:collection:${collectionType}${collectionResourceType ? `:${collectionResourceType}` : ""}`}
                type={collectionType}
                resourceScope={collectionResourceType}
                entities={allEntities}
                pinnedIds={pins.pinnedIds}
                readOnly={vault.accessMode !== "read-write"}
                onOpenEntity={(entityId) => void selectEntity(entityId)}
                onCreate={openCreateEntity}
                onTogglePinned={pins.togglePinned}
                onDeleteEntity={deleteEntity}
                onUpdateEntity={updateEntityFromTable}
                onUpdateTopics={updateEntityTopics}
                onUpdateError={(reason) =>
                  notifyError(
                    reason instanceof Error ? reason.message : String(reason),
                  )
                }
              />
            ) : (
              <HierarchyListView
                storageKey={`pkm:desktop:${vault.vaultId}:home`}
                entities={allEntities}
                view={hierarchyView}
                groupMode={hierarchyGroupMode}
                readOnly={vault.accessMode !== "read-write"}
                onOpenEntity={(entityId) => void selectEntity(entityId)}
                onUpdateEntity={updateEntityFromTable}
                onUpdateTopics={updateEntityTopics}
                onUpdateError={(reason) =>
                  notifyError(
                    reason instanceof Error ? reason.message : String(reason),
                  )
                }
                onViewChange={setHierarchyView}
                onGroupModeChange={setHierarchyGroupMode}
              />
            )}
          </section>
          {tabSnapshot.tabs.map((tab) => (
            <DesktopEntityTabPanel
              key={tab.id}
              tab={tab}
              labelledBy={
                sidebar.mobile
                  ? undefined
                  : `page-tab-${pageSnapshot.tabs.find((page) => page.location.kind === "entity" && page.location.entityId === tab.id)?.id ?? ""}`
              }
              tabs={tabs}
              active={tabSnapshot.activeId === tab.id}
              revision={todoRevision}
              change={tabChanges.get(tab.id)}
              entities={allEntities}
              pinnedIds={pins.pinnedIds}
              readOnly={vault.accessMode !== "read-write"}
              onUploadAsset={uploadAsset}
              onOpenReference={openEntity}
              onDeleteEntity={deleteEntity}
              onCreate={openCreateEntity}
              onResolveTopics={resolveTopicNames}
              onTogglePinned={pins.togglePinned}
              onCapture={captureEntry}
              captureStorageKey={`pkm:desktop:${vault.vaultId}:context-capture:${tab.id}`}
              onUpdateEntity={updateEntityFromTable}
              onUpdateTopics={updateEntityTopics}
              onUpdateEntryBody={updateTimelineBody}
              onUpdateError={(reason) =>
                notifyError(
                  reason instanceof Error ? reason.message : String(reason),
                )
              }
              onDocumentChanged={handleTabDocument}
              onStatus={handleTabStatus}
              onRefresh={refreshEntities}
            />
          ))}
        </EntityQueryContext.Provider>
      </AppShell.Main>
      {vault.accessMode === "read-write" && (
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
          vault === null
            ? undefined
            : `pkm:desktop:${vault.vaultId}:capture-draft${captureContext ? `:${captureContext.id}` : ""}`
        }
        onUploadAsset={uploadAsset}
        assetBaseUrl="pkm-asset://vault/"
        onOpenAsset={(path) => {
          void window.pkm
            .openAsset(path)
            .catch((reason: unknown) =>
              notifyError(
                reason instanceof Error ? reason.message : String(reason),
              ),
            );
        }}
      />
      <OrphanAssetDialog
        opened={orphanAssetsOpen}
        onClose={() => setOrphanAssetsOpen(false)}
        readOnly={vault.accessMode !== "read-write"}
        client={window.pkm}
      />
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
              <TagsInput
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
              <Button type="submit" loading={creating}>
                作成
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
      <SyncthingConflictDialog
        client={window.pkm}
        conflicts={syncConflicts}
        opened={syncConflictsOpen}
        readOnly={vault.accessMode !== "read-write"}
        onClose={() => setSyncConflictsOpen(false)}
        onError={notifyError}
        onRefresh={refreshSyncConflicts}
        onResolved={async () => {
          await Promise.all([refreshEntities(), refreshSyncConflicts()]);
        }}
      />
    </AppShell>
  );
};
