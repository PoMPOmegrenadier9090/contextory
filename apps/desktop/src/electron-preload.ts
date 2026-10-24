import type { PkmLinkPreview } from "@pkm/contracts";
import type { PkmUnresolvedReference, BacklinkPage } from "@pkm/contracts";
import type { EntityPage, EntityCounts, CalendarCount } from "@pkm/contracts";
import { contextBridge, ipcRenderer } from "electron";
import type { PkmQuickOpenResult, TodoPage } from "@pkm/contracts";
import type {
  CreateEntityRequest,
  CreateVaultAssetRequest,
  EntityDocument,
  IndexedEntity,
  IndexedConflict,
  IndexedReference,
  IndexedSearchResult,
  IndexSyncResult,
  OrphanAsset,
  OrphanAssetCleanupResult,
  ResolveEntityConflictRequest,
  ResolveEntityConflictResult,
  ResolveSyncthingConflictRequest,
  ResolveSyncthingConflictResult,
  SaveEntityDocumentRequest,
  SaveEntityDraftRequest,
  SaveSyncthingConflictDraftRequest,
  WriteVaultFileResult,
  SyncthingConflictDocument,
  VaultAssetInfo,
  SyncthingStatus,
  BootstrapSyncthingFolderResult,
} from "@pkm/storage-node";

import type { DesktopApi, OpenDesktopVault } from "./desktop-api.js";
import { DESKTOP_IPC_CHANNELS } from "./ipc-contract.js";

const invoke = <T>(channel: string, ...args: readonly unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

let vaultChangedListener:
  ((event: Electron.IpcRendererEvent, result: IndexSyncResult) => void) | null =
  null;

const api: DesktopApi = {
  linkPreview: (url) =>
    invoke<PkmLinkPreview | null>(DESKTOP_IPC_CHANNELS.linkPreview, url),
  refreshVault: () => invoke<void>(DESKTOP_IPC_CHANNELS.refreshVault),
  restoreVault: () =>
    invoke<OpenDesktopVault | null>(DESKTOP_IPC_CHANNELS.restoreVault),
  syncStatus: (request) =>
    invoke<SyncthingStatus>(DESKTOP_IPC_CHANNELS.syncStatus, request),
  setupSync: (request) =>
    invoke<BootstrapSyncthingFolderResult>(
      DESKTOP_IPC_CHANNELS.setupSync,
      request,
    ),
  chooseVault: () =>
    invoke<OpenDesktopVault | null>(DESKTOP_IPC_CHANNELS.chooseVault),
  closeVault: () => invoke<void>(DESKTOP_IPC_CHANNELS.closeVault),
  queryEntities: (query = {}) =>
    invoke<EntityPage>(DESKTOP_IPC_CHANNELS.queryEntities, query),
  entityCounts: () => invoke<EntityCounts>(DESKTOP_IPC_CHANNELS.entityCounts),
  calendarCounts: (from, to) =>
    invoke<readonly CalendarCount[]>(
      DESKTOP_IPC_CHANNELS.calendarCounts,
      from,
      to,
    ),
  listEntities: () =>
    invoke<readonly IndexedEntity[]>(DESKTOP_IPC_CHANNELS.listEntities),
  listTodos: (query = {}) =>
    invoke<TodoPage>(DESKTOP_IPC_CHANNELS.listTodos, query),
  toggleTodo: (request) =>
    invoke<void>(DESKTOP_IPC_CHANNELS.toggleTodo, request),
  listJournalEntries: (date) =>
    invoke<readonly IndexedEntity[]>(
      DESKTOP_IPC_CHANNELS.listJournalEntries,
      date,
    ),
  listDeletedEntities: () =>
    invoke<readonly IndexedEntity[]>(DESKTOP_IPC_CHANNELS.listDeletedEntities),
  quickOpen: (query) =>
    invoke<readonly PkmQuickOpenResult[]>(
      DESKTOP_IPC_CHANNELS.quickOpen,
      query,
    ),
  searchEntities: (query) =>
    invoke<readonly IndexedSearchResult[]>(
      DESKTOP_IPC_CHANNELS.searchEntities,
      query,
    ),
  createEntity: (request: CreateEntityRequest) =>
    invoke<EntityDocument>(DESKTOP_IPC_CHANNELS.createEntity, request),
  createAsset: (request: CreateVaultAssetRequest) =>
    invoke<VaultAssetInfo>(DESKTOP_IPC_CHANNELS.createAsset, request),
  openAsset: (path) => invoke<void>(DESKTOP_IPC_CHANNELS.openAsset, path),
  readImage: (path) =>
    invoke<{ mimeType: string; dataBase64: string }>(
      DESKTOP_IPC_CHANNELS.readImage,
      path,
    ),
  listUnresolvedReferences: () =>
    invoke<readonly PkmUnresolvedReference[]>(
      DESKTOP_IPC_CHANNELS.listUnresolvedReferences,
    ),
  listOrphanAssets: () =>
    invoke<readonly OrphanAsset[]>(DESKTOP_IPC_CHANNELS.listOrphanAssets),
  deleteOrphanAssets: (assets) =>
    invoke<OrphanAssetCleanupResult>(
      DESKTOP_IPC_CHANNELS.deleteOrphanAssets,
      assets,
    ),
  loadEntity: (entityId) =>
    invoke<EntityDocument>(DESKTOP_IPC_CHANNELS.loadEntity, entityId),
  queryBacklinks: (id, query) =>
    invoke<BacklinkPage>(DESKTOP_IPC_CHANNELS.queryBacklinks, id, query ?? {}),
  getBacklinks: (entityId) =>
    invoke<readonly IndexedReference[]>(
      DESKTOP_IPC_CHANNELS.getBacklinks,
      entityId,
    ),
  listSyncthingConflicts: () =>
    invoke<readonly IndexedConflict[]>(
      DESKTOP_IPC_CHANNELS.listSyncthingConflicts,
    ),
  loadSyncthingConflict: (path) =>
    invoke<SyncthingConflictDocument>(
      DESKTOP_IPC_CHANNELS.loadSyncthingConflict,
      path,
    ),
  saveSyncthingConflictDraft: (request: SaveSyncthingConflictDraftRequest) =>
    invoke<void>(DESKTOP_IPC_CHANNELS.saveSyncthingConflictDraft, request),
  discardSyncthingConflictDraft: (conflictPath) =>
    invoke<void>(
      DESKTOP_IPC_CHANNELS.discardSyncthingConflictDraft,
      conflictPath,
    ),
  saveDraft: (request: SaveEntityDraftRequest) =>
    invoke<void>(DESKTOP_IPC_CHANNELS.saveDraft, request),
  discardDraft: (entityId) =>
    invoke<void>(DESKTOP_IPC_CHANNELS.discardDraft, entityId),
  permanentlyDeleteEntity: (request) =>
    invoke<void>(DESKTOP_IPC_CHANNELS.permanentlyDeleteEntity, request),
  saveEntity: (request: SaveEntityDocumentRequest) =>
    invoke<WriteVaultFileResult>(DESKTOP_IPC_CHANNELS.saveEntity, request),
  resolveEntityConflict: (request: ResolveEntityConflictRequest) =>
    invoke<ResolveEntityConflictResult>(
      DESKTOP_IPC_CHANNELS.resolveEntityConflict,
      request,
    ),
  resolveSyncthingConflict: (request: ResolveSyncthingConflictRequest) =>
    invoke<ResolveSyncthingConflictResult>(
      DESKTOP_IPC_CHANNELS.resolveSyncthingConflict,
      request,
    ),
  onVaultChanged: (listener) => {
    if (vaultChangedListener !== null) {
      ipcRenderer.removeListener(
        DESKTOP_IPC_CHANNELS.vaultChanged,
        vaultChangedListener,
      );
    }
    vaultChangedListener = (_event, result) => listener(result);
    ipcRenderer.on(DESKTOP_IPC_CHANNELS.vaultChanged, vaultChangedListener);
  },
  clearVaultChangedListener: () => {
    if (vaultChangedListener === null) return;
    ipcRenderer.removeListener(
      DESKTOP_IPC_CHANNELS.vaultChanged,
      vaultChangedListener,
    );
    vaultChangedListener = null;
  },
};

contextBridge.exposeInMainWorld("pkm", api);
