import type { EntityPage, EntityPageQuery } from "@pkm/contracts";

export interface CachedEntityPage {
  readonly key: string;
  readonly namespace: string;
  readonly version: string;
  readonly savedAt: number;
  readonly expiresAt: number;
  readonly bytes: number;
  readonly page: EntityPage;
}
export interface EntityPageStore {
  get(key: string): Promise<CachedEntityPage | undefined>;
  put(page: CachedEntityPage): Promise<void>;
  clear(namespace: string): Promise<void>;
}

const MAX_PAGES = 64;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_AGE_MS = 5 * 60_000;
export const entityPageKey = (query: EntityPageQuery): string =>
  JSON.stringify(
    Object.entries({ sort: "name", direction: "asc", limit: 50, ...query })
      .filter(
        ([key, value]) =>
          value !== undefined &&
          value !== false &&
          !(key === "q" && typeof value === "string" && value.trim() === ""),
      )
      .map(
        ([key, value]) =>
          [
            key,
            Array.isArray(value)
              ? [...new Set(value)].sort()
              : key === "q" && typeof value === "string"
                ? value.trim()
                : typeof value === "object" && value !== null
                  ? Object.fromEntries(
                      Object.entries(value).sort(([a], [b]) =>
                        a.localeCompare(b),
                      ),
                    )
                  : value,
          ] as const,
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );

// This is a disposable browser cache, separate from Markdown and editing drafts.
// Disk writes are asynchronous and never delay rendering a fetched page.
export class IndexedDbEntityPageStore implements EntityPageStore {
  private connection: Promise<IDBDatabase> | undefined;
  private open(): Promise<IDBDatabase> {
    this.connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("pkm-web-entity-pages-v2", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("pages", {
          keyPath: "key",
        });
        store.createIndex("namespace", "namespace");
        const metadata = request.result.createObjectStore("metadata", {
          keyPath: "key",
        });
        metadata.createIndex("namespace", "namespace");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB request failed"));
    });
    return this.connection;
  }
  async get(key: string): Promise<CachedEntityPage | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction("pages").objectStore("pages").get(key);
      request.onsuccess = () =>
        resolve(request.result as CachedEntityPage | undefined);
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB request failed"));
    });
  }
  async put(page: CachedEntityPage): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["pages", "metadata"], "readwrite");
      const store = transaction.objectStore("pages");
      const metadata = transaction.objectStore("metadata");
      const request = metadata.index("namespace").getAll(page.namespace);
      request.onsuccess = () => {
        const existing = (request.result as CachedEntityPage[]).filter(
          (item) => item.key !== page.key,
        );
        existing.sort((a, b) => a.savedAt - b.savedAt);
        let bytes =
          existing.reduce((sum, item) => sum + item.bytes, 0) + page.bytes;
        while (
          existing.length &&
          (existing.length >= MAX_PAGES || bytes > MAX_BYTES)
        ) {
          const oldest = existing.shift()!;
          bytes -= oldest.bytes;
          store.delete(oldest.key);
          metadata.delete(oldest.key);
        }
        if (page.bytes <= MAX_BYTES) {
          store.put(page);
          const { page: _page, ...meta } = page;
          void _page;
          metadata.put(meta);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    });
  }
  async clear(namespace: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["pages", "metadata"], "readwrite");
      const store = transaction.objectStore("pages");
      const request = store.index("namespace").getAllKeys(namespace);
      request.onsuccess = () => {
        for (const key of request.result) {
          store.delete(key);
          transaction.objectStore("metadata").delete(key);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    });
  }
}

const browserPageStore = new IndexedDbEntityPageStore();
interface PendingPage {
  promise: Promise<EntityPage>;
  controller: AbortController;
  users: number;
  query: EntityPageQuery;
}
const abortError = () => new DOMException("Aborted", "AbortError");
export class EntityPageCache {
  private pages = new Map<string, CachedEntityPage>();
  private pending = new Map<string, PendingPage>();
  private diskInvalidations: ((
    query: EntityPageQuery,
    page?: EntityPage,
  ) => boolean)[] = [];
  private skipDisk = false;
  private diskWrites: Promise<void> = Promise.resolve();
  constructor(
    private readonly namespace: string,
    private readonly version: string,
    private readonly fetchPage: (
      query: EntityPageQuery,
      signal: AbortSignal,
    ) => Promise<EntityPage>,
    private readonly store: EntityPageStore = browserPageStore,
    private readonly now = Date.now,
  ) {}
  private key(query: EntityPageQuery) {
    return `${this.namespace}:${entityPageKey(query)}`;
  }
  private valid(
    record: CachedEntityPage | undefined,
  ): record is CachedEntityPage {
    return (
      record !== undefined &&
      record.version === this.version &&
      this.now() < record.expiresAt
    );
  }
  peek(query: EntityPageQuery) {
    const record = this.pages.get(this.key(query));
    return this.valid(record) ? record.page : undefined;
  }
  private remember(record: CachedEntityPage) {
    if (record.bytes > MAX_BYTES) return;
    this.pages.delete(record.key);
    this.pages.set(record.key, record);
    let bytes = [...this.pages.values()].reduce(
      (sum, item) => sum + item.bytes,
      0,
    );
    while (this.pages.size > MAX_PAGES || bytes > MAX_BYTES) {
      const old = this.pages.values().next().value!;
      bytes -= old.bytes;
      this.pages.delete(old.key);
    }
  }
  seed(query: EntityPageQuery, page: EntityPage): void {
    this.remember({
      key: this.key(query),
      namespace: this.namespace,
      version: this.version,
      savedAt: this.now(),
      expiresAt: this.now() + MAX_AGE_MS,
      bytes: new TextEncoder().encode(JSON.stringify(page)).length,
      page,
    });
  }
  query(query: EntityPageQuery, signal?: AbortSignal): Promise<EntityPage> {
    if (signal?.aborted) return Promise.reject(abortError());
    const cached = this.peek(query);
    if (cached) return Promise.resolve(cached);
    const key = this.key(query);
    let pending = this.pending.get(key);
    if (!pending) {
      const controller = new AbortController();
      const active: PendingPage = {
        controller,
        users: 0,
        query,
        promise: Promise.resolve({ items: [], nextCursor: null }),
      };
      active.promise = (async () => {
        if (
          !this.skipDisk &&
          !this.diskInvalidations.some((predicate) => predicate(query))
        ) {
          const disk = await this.store.get(key).catch(() => undefined);
          if (controller.signal.aborted) throw abortError();
          if (
            this.valid(disk) &&
            !this.diskInvalidations.some((predicate) =>
              predicate(query, disk.page),
            )
          ) {
            this.remember(disk);
            return disk.page;
          }
        }
        if (controller.signal.aborted) throw abortError();
        const page = await this.fetchPage(query, controller.signal);
        if (controller.signal.aborted) throw abortError();
        if (this.pending.get(key) === active) {
          const record = {
            key,
            namespace: this.namespace,
            version: this.version,
            savedAt: this.now(),
            expiresAt: this.now() + (query.deadline ? 60_000 : MAX_AGE_MS),
            bytes: new TextEncoder().encode(JSON.stringify(page)).length,
            page,
          };
          this.remember(record);
          this.diskWrites = this.diskWrites
            .then(() => this.store.put(record))
            .catch(() => {});
        }
        return page;
      })();
      this.pending.set(key, active);
      pending = active;
      void active.promise
        .finally(() => {
          if (this.pending.get(key) === active) this.pending.delete(key);
        })
        .catch(() => {});
    }
    const active = pending;
    active.users++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true;
        signal?.removeEventListener("abort", abort);
        active.users--;
        return true;
      };
      const abort = () => {
        if (finish()) {
          reject(abortError());
          if (active.users === 0) {
            active.controller.abort();
            if (this.pending.get(key) === active) this.pending.delete(key);
          }
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      active.promise.then(
        (page) => {
          if (finish()) resolve(page);
        },
        (error) => {
          if (finish())
            reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
  invalidate(
    predicate: (query: EntityPageQuery, page?: EntityPage) => boolean = () =>
      true,
  ): void {
    this.diskInvalidations.push(predicate);
    if (this.diskInvalidations.length > 128) {
      this.skipDisk = true;
      this.diskInvalidations = [];
    }
    for (const [key, record] of this.pages) {
      const query = Object.fromEntries(
        JSON.parse(key.slice(this.namespace.length + 1)) as [string, unknown][],
      ) as EntityPageQuery;
      if (predicate(query, record.page)) this.pages.delete(key);
    }
    for (const [key, pending] of this.pending)
      if (predicate(pending.query)) {
        pending.controller.abort();
        this.pending.delete(key);
      }
  }
}
