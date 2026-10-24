export {
  createSearchSchema,
  searchDocuments,
  upsertSearchDocument,
} from "./search.js";
export type { SearchResult } from "./search.js";
export {
  INDEX_SCHEMA_VERSION,
  IndexDatabase,
  openVaultIndex,
} from "./index-database.js";
export { rebuildVaultIndex } from "./index-rebuild.js";
export { listIndexedTodos } from "./todo-index.js";
export type { IndexRebuildResult } from "./index-rebuild.js";
export { synchronizeVaultIndex } from "./index-sync.js";
export type { IndexSyncResult } from "./index-sync.js";
export {
  getBacklinks,
  getIndexedConflict,
  getIndexedEntity,
  listEntityScopes,
  listIndexedConflicts,
  listIndexedEntities,
  listIndexedEntitiesInScope,
  listIndexedJournalEntries,
  searchIndexedEntities,
} from "./index-query.js";
export type {
  EntityScopeRelation,
  EntityScopeType,
  IndexedEntityScope,
} from "./entity-scope.js";
export type {
  EntityQueryOptions,
  IndexedConflict,
  IndexedEntity,
  IndexedReference,
  IndexedSearchResult,
} from "./index-query.js";
export { startVaultIndexWatcher } from "./index-watcher.js";
export type {
  VaultIndexWatcher,
  VaultIndexWatcherOptions,
} from "./index-watcher.js";
export {
  LOCAL_STATE_SCHEMA_VERSION,
  LocalStateDatabase,
  openVaultLocalState,
} from "./local-state.js";
export type {
  DraftRecord,
  SyncthingConflictDraftRecord,
} from "./local-state.js";
export {
  LocalVaultError,
  LocalVaultService,
  openLocalVault,
} from "./local-vault-service.js";
export type {
  CreateEntityRequest,
  EntityDocument,
  LocalVaultErrorCode,
  OpenLocalVaultOptions,
  ResolvedEntityConflict,
  ResolveEntityConflictRequest,
  ResolveEntityConflictResult,
  ResolveSyncthingConflictRequest,
  ResolveSyncthingConflictResult,
  ResolvedSyncthingConflict,
  SaveSyncthingConflictDraftRequest,
  SaveEntityDocumentRequest,
  SaveEntityDraftRequest,
  SyncthingConflictDocument,
  VaultChangeEvent,
  VaultChangeListener,
} from "./local-vault-service.js";
export {
  assertVaultWritePathSafe,
  hashFileContent,
  readVaultFile,
  resolveVaultPath,
} from "./vault-file.js";
export type { FileHash, VaultFileSnapshot } from "./vault-file.js";
export { scanVault } from "./vault-scan.js";
export { initializeVault } from "./vault-init.js";
export type { InitializeVaultResult } from "./vault-init.js";
export {
  deleteOrphanAssets,
  listOrphanAssets,
  ORPHAN_ASSET_MIN_AGE_MS,
} from "./orphan-assets.js";
export type { OrphanAsset, OrphanAssetCleanupResult } from "./orphan-assets.js";
export {
  createVaultAsset,
  MAX_ASSET_BYTES,
  readVaultAsset,
  requireAssetPath,
  vaultAssetAbsolutePath,
} from "./vault-asset.js";
export type {
  CreateVaultAssetRequest,
  VaultAssetContent,
  VaultAssetInfo,
} from "./vault-asset.js";
export type {
  ScannedVaultFile,
  VaultFileKind,
  VaultScanResult,
} from "./vault-scan.js";
export { saveVaultFileWithDraft, writeVaultFile } from "./vault-store.js";
export type {
  DraftStore,
  SaveVaultFileRequest,
  WriteVaultFileConflict,
  WriteVaultFileRequest,
  WriteVaultFileResult,
  WriteVaultFileSuccess,
} from "./vault-store.js";
export {
  checkSyncthingIgnore,
  REQUIRED_SYNCTHING_IGNORE_RULES,
  SYNCTHING_IGNORE_FILE,
  SYNCTHING_IGNORE_TEMPLATE,
} from "./syncthing-ignore.js";
export {
  DEFAULT_SYNCTHING_URL,
  SyncthingApiError,
  SyncthingClient,
} from "./syncthing-client.js";
export type {
  BootstrapSyncthingFolderRequest,
  BootstrapSyncthingFolderResult,
  SyncthingClientOptions,
  SyncthingFolderConfig,
  SyncthingFolderDevice,
  SyncthingFolderStatus,
  SyncthingStatus,
  SyncthingSystemStatus,
} from "./syncthing-client.js";
export type {
  SyncthingIgnoreCheckResult,
  SyncthingIgnoreIssue,
  SyncthingIgnoreIssueCode,
} from "./syncthing-ignore.js";

export { AgentVaultService, AgentVaultError } from "./agent-vault-service.js";
export type { AgentEntityDto, AgentSnapshot } from "./agent-vault-service.js";
export { AgentOperationStore } from "./agent-operation-store.js";

export { createLinkPreviewLoader } from "./link-preview.js";
