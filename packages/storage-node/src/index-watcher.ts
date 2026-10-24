import { sep, relative } from "node:path";

import { watch, type FSWatcher } from "chokidar";

import type { IndexDatabase } from "./index-database.js";
import { synchronizeVaultIndex, type IndexSyncResult } from "./index-sync.js";

export interface VaultIndexWatcherOptions {
  readonly debounceMs?: number;
  readonly usePolling?: boolean;
  readonly pollIntervalMs?: number;
  readonly onRebuild?: (result: IndexSyncResult) => void;
  readonly onError?: (error: Error) => void;
}

export interface VaultIndexWatcher {
  rescan(paths?: readonly string[]): Promise<IndexSyncResult>;
  close(): Promise<void>;
}

class VaultIndexWatcherImplementation implements VaultIndexWatcher {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<IndexSyncResult> | null = null;
  private rescanRequested = false;
  private closed = false;
  private fullScan = false;
  private dirty = new Set<string>();

  constructor(
    private readonly vaultRoot: string,
    private readonly index: IndexDatabase,
    private readonly watcher: FSWatcher,
    private readonly options: VaultIndexWatcherOptions,
  ) {}

  schedule(path?: string): void {
    if (path) this.dirty.add(path);
    else this.fullScan = true;
    if (this.closed) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.rescan([]).catch((error: unknown) => {
        this.options.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }, this.options.debounceMs ?? 50);
  }

  async rescan(paths?: readonly string[]): Promise<IndexSyncResult> {
    if (paths) paths.forEach((path) => this.dirty.add(path));
    else this.fullScan = true;
    if (this.closed) {
      throw new Error("Vault index watcher is closed");
    }
    this.rescanRequested = true;
    if (this.active === null) {
      this.active = this.drainRescans().finally(() => {
        this.active = null;
      });
    }
    return this.active;
  }

  private async drainRescans(): Promise<IndexSyncResult> {
    let result: IndexSyncResult | null = null;
    while (this.rescanRequested) {
      this.rescanRequested = false;
      const paths = this.fullScan ? undefined : [...this.dirty];
      this.fullScan = false;
      this.dirty.clear();
      result = await synchronizeVaultIndex(this.vaultRoot, this.index, paths);
      this.options.onRebuild?.(result);
    }
    if (result === null) {
      throw new Error("No index rebuild was requested");
    }
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.watcher.close();
    await this.active;
  }
}

export const startVaultIndexWatcher = async (
  vaultRoot: string,
  index: IndexDatabase,
  options: VaultIndexWatcherOptions = {},
): Promise<VaultIndexWatcher> => {
  const ignoredSegment = `${sep}.pkm${sep}`;
  const watcher = watch(vaultRoot, {
    atomic: true,
    ignoreInitial: true,
    ignored: (path) =>
      path.endsWith(`${sep}.pkm`) || path.includes(ignoredSegment),
    interval: options.pollIntervalMs ?? 100,
    usePolling: options.usePolling ?? false,
  });
  const implementation = new VaultIndexWatcherImplementation(
    vaultRoot,
    index,
    watcher,
    options,
  );
  watcher.on("all", (event, path) =>
    implementation.schedule(
      event === "addDir" || event === "unlinkDir"
        ? undefined
        : relative(vaultRoot, path).replaceAll("\\", "/"),
    ),
  );
  watcher.on("error", (error) => {
    options.onError?.(
      error instanceof Error ? error : new Error(String(error)),
    );
  });
  await new Promise<void>((resolve) => watcher.on("ready", () => resolve()));
  await implementation.rescan();
  return implementation;
};
