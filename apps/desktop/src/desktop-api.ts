import type {
  PkmClient,
  PkmBacklink,
  PkmEntitySummary,
  PkmSearchResult,
  PkmIndexSyncResult,
  ResolveEntityConflictRequest,
  PkmResolveConflictResult,
} from "@pkm/contracts";
import type { VaultAccessMode } from "@pkm/core";
import type { VaultAssetContent } from "@pkm/storage-node";
import type {
  SyncthingStatus,
  BootstrapSyncthingFolderResult,
} from "@pkm/storage-node";
import type {
  DesktopSyncConnection,
  DesktopSyncSetup,
} from "./desktop-sync.js";

export interface OpenDesktopVault {
  readonly vaultRoot: string;
  readonly vaultId: string;
  readonly accessMode: VaultAccessMode;
}

// Commands are the same across HTTP and IPC. Vault selection, change delivery,
// asset opening and the separate search operation are desktop adapters.
export interface DesktopVaultOperations extends Omit<
  PkmClient,
  "health" | "subscribeToChanges" | "resolveConflict"
> {
  chooseVault(): Promise<OpenDesktopVault | null>;
  restoreVault(): Promise<OpenDesktopVault | null>;
  closeVault(): Promise<void>;
  refreshVault(): Promise<void>;
  syncStatus(connection: DesktopSyncConnection): Promise<SyncthingStatus>;
  setupSync(request: DesktopSyncSetup): Promise<BootstrapSyncthingFolderResult>;
  getBacklinks(entityId: string): Promise<readonly PkmBacklink[]>;
  listJournalEntries(date: string): Promise<readonly PkmEntitySummary[]>;
  listDeletedEntities(): Promise<readonly PkmEntitySummary[]>;
  listEntities(): Promise<readonly PkmEntitySummary[]>;
  searchEntities(query: string): Promise<readonly PkmSearchResult[]>;
  readAsset(path: string): Promise<VaultAssetContent>;
  assetAbsolutePath(path: string): Promise<string>;
  resolveEntityConflict(
    request: ResolveEntityConflictRequest,
  ): Promise<PkmResolveConflictResult>;
}

export interface DesktopApi extends Omit<
  DesktopVaultOperations,
  "readAsset" | "assetAbsolutePath"
> {
  openAsset(path: string): Promise<void>;
  readImage(path: string): Promise<{ mimeType: string; dataBase64: string }>;
  onVaultChanged(listener: (result: PkmIndexSyncResult) => void): void;
  clearVaultChangedListener(): void;
}
