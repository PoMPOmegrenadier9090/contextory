import {
  createLinkPreviewLoader,
  openLocalVault,
  initializeVault,
  SyncthingClient,
  type IndexSyncResult,
  type LocalVaultService,
  type OpenLocalVaultOptions,
} from "@pkm/storage-node";

import type {
  DesktopVaultOperations,
  OpenDesktopVault,
} from "./desktop-api.js";
import {
  parseDesktopSyncConnection,
  setupDesktopSync,
} from "./desktop-sync.js";
import { resolve } from "node:path";
import type { VaultPreferences } from "./vault-preferences.js";

export type VaultDirectoryPicker = () => Promise<string | null>;
export type LocalVaultOpener = (
  vaultRoot: string,
  options?: OpenLocalVaultOptions,
) => Promise<LocalVaultService>;
export type VaultChangeListener = (result: IndexSyncResult) => void;

export class DesktopVaultControllerError extends Error {
  override readonly name = "DesktopVaultControllerError";

  constructor(
    readonly code: "VAULT_NOT_OPEN",
    message: string,
  ) {
    super(message);
  }
}

export class DesktopVaultController {
  private service: LocalVaultService | null = null;
  private activeGeneration = 0;
  private nextGeneration = 0;
  private vaultRoot: string | null = null;
  private readonly changeListeners = new Set<VaultChangeListener>();

  constructor(
    private readonly pickVaultDirectory: VaultDirectoryPicker,
    private readonly openVault: LocalVaultOpener = openLocalVault,
    private readonly openOptions: OpenLocalVaultOptions = {},
    private readonly preferences?: VaultPreferences,
    private readonly hostVault?: (
      service: LocalVaultService,
      root: string,
    ) => Promise<() => Promise<void>>,
  ) {}

  private requireService(): LocalVaultService {
    if (this.service === null) {
      throw new DesktopVaultControllerError(
        "VAULT_NOT_OPEN",
        "Choose a Vault before using Entity operations",
      );
    }
    return this.service;
  }

  private summary(service: LocalVaultService): OpenDesktopVault {
    return {
      vaultId: service.vaultId,
      accessMode: service.accessMode,
      vaultRoot: this.vaultRoot!,
    };
  }

  private invoke<T>(operation: () => T | Promise<T>): Promise<T> {
    return Promise.resolve().then(operation);
  }

  private emitVaultChanged(result: IndexSyncResult): void {
    if (
      result.addedFiles === 0 &&
      result.changedFiles === 0 &&
      result.deletedFiles === 0 &&
      !result.changes.reset
    )
      return;
    for (const listener of this.changeListeners) listener(result);
  }

  onVaultChanged(listener: VaultChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private async rescanVault(): Promise<void> {
    const service = this.service;
    if (service === null) return;
    await service.rescan();
  }

  private closeHost: (() => Promise<void>) | undefined;

  private async activateVault(vaultRoot: string): Promise<OpenDesktopVault> {
    const root = resolve(vaultRoot);
    if (root === this.vaultRoot && this.service) {
      await this.rescanVault();
      return this.summary(this.service);
    }
    const generation = ++this.nextGeneration;
    let ready = false;
    const next = await this.openVault(root, this.openOptions);
    next.subscribeToChanges(({ sync }) => {
      if (ready && generation === this.activeGeneration)
        this.emitVaultChanged(sync);
    });
    let nextCloseHost: (() => Promise<void>) | undefined;
    try {
      await this.preferences?.saveLastVaultRoot(root);
      nextCloseHost = await this.hostVault?.(next, root);
    } catch (error) {
      await nextCloseHost?.();
      await next.close();
      throw error;
    }
    const previous = this.service;
    const previousCloseHost = this.closeHost;
    this.closeHost = nextCloseHost;
    this.service = next;
    this.vaultRoot = root;
    this.activeGeneration = generation;
    ready = true;
    await previousCloseHost?.();
    await previous?.close();
    return this.summary(next);
  }

  readonly api: DesktopVaultOperations = {
    linkPreview: createLinkPreviewLoader(),
    restoreVault: async () => {
      if (this.service) {
        await this.rescanVault();
        return this.summary(this.service);
      }
      const root = await this.preferences?.readLastVaultRoot();
      if (!root) return null;
      try {
        return await this.activateVault(root);
      } catch (error) {
        throw new Error(
          `前回のVaultを開けませんでした（${root}）。Vaultを選択し直してください: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    },
    refreshVault: () => this.invoke(() => this.rescanVault()),
    syncStatus: (connection) =>
      this.invoke(() => {
        const service = this.requireService();
        return new SyncthingClient(
          parseDesktopSyncConnection(connection),
        ).getStatus(`pkm-${service.vaultId}`);
      }),
    setupSync: (request) =>
      this.invoke(() => {
        const service = this.requireService();
        if (service.accessMode !== "read-write")
          throw new Error("読み取り専用Vaultでは同期設定を変更できません。");
        return setupDesktopSync(this.vaultRoot!, service.vaultId, request);
      }),
    chooseVault: async () => {
      const vaultRoot = await this.pickVaultDirectory();
      if (vaultRoot === null) return null;
      const initialized = await initializeVault(vaultRoot);
      return this.activateVault(initialized.vaultRoot);
    },
    closeVault: async () => {
      this.activeGeneration = ++this.nextGeneration;
      const current = this.service;
      this.service = null;
      this.vaultRoot = null;
      const closeHost = this.closeHost;
      this.closeHost = undefined;
      await closeHost?.();
      await current?.close();
    },
    queryEntities: (query) =>
      this.invoke(() => this.requireService().queryEntities(query)),
    entityCounts: () => this.invoke(() => this.requireService().entityCounts()),
    calendarCounts: (from, to) =>
      this.invoke(() => this.requireService().calendarCounts(from, to)),
    listEntities: () =>
      this.invoke(() =>
        this.requireService().listEntities({ includeBody: false }),
      ),
    listTodos: (query) =>
      this.invoke(() => this.requireService().listTodos(query)),
    toggleTodo: (request) =>
      this.invoke(() => this.requireService().toggleTodo(request)),
    listJournalEntries: (date) =>
      this.invoke(() => this.requireService().listJournalEntries(date)),
    listDeletedEntities: () =>
      this.invoke(() =>
        this.requireService().listEntities({
          onlyDeleted: true,
          includeBody: false,
        }),
      ),
    quickOpen: (query) =>
      this.invoke(() => this.requireService().quickOpen(query)),
    searchEntities: (query) =>
      this.invoke(() => this.requireService().searchEntities(query)),
    createEntity: (request) =>
      this.invoke(() => this.requireService().createEntity(request)),
    createAsset: (request) =>
      this.invoke(() => this.requireService().createAsset(request)),
    readAsset: (path) =>
      this.invoke(() => this.requireService().readAsset(path)),
    assetAbsolutePath: (path) =>
      this.invoke(() => this.requireService().assetAbsolutePath(path)),
    permanentlyDeleteEntity: (request) =>
      this.invoke(() => this.requireService().permanentlyDeleteEntity(request)),
    listUnresolvedReferences: () =>
      this.invoke(() => this.requireService().listUnresolvedReferences()),
    listOrphanAssets: () =>
      this.invoke(() => this.requireService().listOrphanAssets()),
    deleteOrphanAssets: (assets) =>
      this.invoke(() => this.requireService().deleteOrphanAssets(assets)),
    loadEntity: (entityId) =>
      this.invoke(() => this.requireService().loadEntity(entityId)),
    queryBacklinks: (id, query) =>
      this.invoke(() => this.requireService().queryBacklinks(id, query)),
    getBacklinks: (entityId) =>
      this.invoke(() => this.requireService().getBacklinks(entityId)),
    listSyncthingConflicts: () =>
      this.invoke(() => this.requireService().listSyncthingConflicts()),
    loadSyncthingConflict: (path) =>
      this.invoke(() => this.requireService().loadSyncthingConflict(path)),
    saveSyncthingConflictDraft: (request) =>
      this.invoke(async () => {
        await this.requireService().saveSyncthingConflictDraft(request);
      }),
    discardSyncthingConflictDraft: (conflictPath) =>
      this.invoke(() => {
        this.requireService().discardSyncthingConflictDraft(conflictPath);
      }),
    saveDraft: (request) =>
      this.invoke(() => {
        this.requireService().saveDraft(request);
      }),
    discardDraft: (entityId) =>
      this.invoke(() => {
        this.requireService().discardDraft(entityId);
      }),
    saveEntity: (request) =>
      this.invoke(() => this.requireService().saveEntity(request)),
    resolveEntityConflict: (request) =>
      this.invoke(() => this.requireService().resolveEntityConflict(request)),
    resolveSyncthingConflict: (request) =>
      this.invoke(() =>
        this.requireService().resolveSyncthingConflict(request),
      ),
  };

  async close(): Promise<void> {
    await this.api.closeVault();
  }
}
