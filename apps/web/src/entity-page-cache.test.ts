import { describe, expect, it, vi } from "vitest";
import type { EntityPage, PkmEntitySummary } from "@pkm/contracts";
import {
  EntityPageCache,
  entityPageKey,
  type CachedEntityPage,
  type EntityPageStore,
} from "./entity-page-cache.js";

class MemoryStore implements EntityPageStore {
  records = new Map<string, CachedEntityPage>();
  get(key: string) {
    return Promise.resolve(this.records.get(key));
  }
  put(record: CachedEntityPage) {
    this.records.set(record.key, record);
    return Promise.resolve();
  }
  clear(namespace: string) {
    for (const [key, record] of this.records)
      if (record.namespace === namespace) this.records.delete(key);
    return Promise.resolve();
  }
}
const page: EntityPage = { items: [], nextCursor: "next" };
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("browser Entity page cache", () => {
  it("keeps direct/scoped and summary/Timeline pages separate", () => {
    const query = {
      type: "entry" as const,
      relatedTo: "area",
      entryRelationMode: "direct" as const,
    };
    expect(entityPageKey(query)).not.toBe(
      entityPageKey({ ...query, entryRelationMode: "scoped" }),
    );
    expect(entityPageKey(query)).not.toBe(
      entityPageKey({ ...query, view: "timeline" }),
    );
  });
  it("reuses memory and disk across reloads, and isolates Vault/version/TTL", async () => {
    const store = new MemoryStore();
    const fetchPage = vi.fn(() => Promise.resolve(page));
    let now = 0;
    const cache = new EntityPageCache(
      "vault-a",
      "version-a",
      fetchPage,
      store,
      () => now,
    );
    await cache.query({ type: "task", limit: 50 });
    expect(await cache.query({ limit: 50, type: "task" })).toBe(page);
    expect(cache.peek({ type: "task", limit: 50 })).toBe(page);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await flush();
    const reload = new EntityPageCache(
      "vault-a",
      "version-a",
      fetchPage,
      store,
      () => now,
    );
    await reload.query({ type: "task", limit: 50 });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await new EntityPageCache(
      "vault-b",
      "version-a",
      fetchPage,
      store,
      () => now,
    ).query({ type: "task", limit: 50 });
    await new EntityPageCache(
      "vault-a",
      "version-b",
      fetchPage,
      store,
      () => now,
    ).query({ type: "task", limit: 50 });
    expect(fetchPage).toHaveBeenCalledTimes(3);
    now = 300_001;
    await cache.query({ type: "task", limit: 50 });
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });
  it("shares an in-flight request without one consumer aborting the other", async () => {
    let resolve!: (page: EntityPage) => void;
    const fetchPage = vi.fn(
      () =>
        new Promise<EntityPage>((done) => {
          resolve = done;
        }),
    );
    const cache = new EntityPageCache(
      "vault",
      "version",
      fetchPage,
      new MemoryStore(),
    );
    const controller = new AbortController();
    const first = cache.query({}, controller.signal);
    const second = cache.query({});
    await flush();
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    resolve(page);
    expect(await second).toBe(page);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
  it("aborts invalidated requests and never restores their responses", async () => {
    let resolve!: (page: EntityPage) => void;
    const store = new MemoryStore();
    const fetchPage = vi.fn(
      () =>
        new Promise<EntityPage>((done) => {
          resolve = done;
        }),
    );
    const cache = new EntityPageCache("vault", "version", fetchPage, store);
    const previous = cache.query({});
    await flush();
    cache.invalidate();
    resolve(page);
    await expect(previous).rejects.toMatchObject({ name: "AbortError" });
    await flush();
    expect(cache.peek({})).toBeUndefined();
    expect(store.records.size).toBe(0);
    const next = cache.query({});
    await flush();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    resolve({ items: [], nextCursor: null });
    expect((await next).nextCursor).toBeNull();
  });
  it("passes network cancellation through when the final consumer leaves", async () => {
    let networkSignal!: AbortSignal;
    const cache = new EntityPageCache(
      "vault",
      "version",
      (_query, signal) => {
        networkSignal = signal;
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        );
      },
      new MemoryStore(),
    );
    const controller = new AbortController();
    const request = cache.query({}, controller.signal);
    await flush();
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(networkSignal.aborted).toBe(true);
  });
  it("does not wait for disk writes and checks persisted label dependencies", async () => {
    const store = new MemoryStore();
    const labelPage: EntityPage = {
      items: [],
      included: [{ id: "parent" } as PkmEntitySummary],
      nextCursor: null,
    };
    const fetchPage = vi.fn(() => Promise.resolve(labelPage));
    const first = new EntityPageCache("vault", "version", fetchPage, store);
    await first.query({ type: "entry" });
    await flush();
    const reload = new EntityPageCache("vault", "version", fetchPage, store);
    reload.invalidate(
      (_query, cached) =>
        cached?.included?.some((e) => e.id === "parent") ?? false,
    );
    await reload.query({ type: "entry" });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    store.put = () => new Promise(() => {});
    await reload.query({ type: "task" });
    await reload.query({ type: "resource" });
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });
  it("keeps working if disk caching is unavailable and bounds the memory page count", async () => {
    const store: EntityPageStore = {
      get: () => Promise.reject(new Error("unavailable")),
      put: () => Promise.reject(new Error("quota")),
      clear: () => Promise.reject(new Error("unavailable")),
    };
    const fetchPage = vi.fn(() => Promise.resolve(page));
    const cache = new EntityPageCache("vault", "version", fetchPage, store);
    for (let i = 0; i < 65; i++) await cache.query({ q: String(i) });
    expect(cache.peek({ q: "0" })).toBeUndefined();
    expect(cache.peek({ q: "64" })).toBe(page);
    cache.invalidate();
    expect(await cache.query({})).toBe(page);
  });
});

it("canonicalizes date range property order and distinguishes different periods", () => {
  const from = "2026-09-01T00:00:00Z";
  const to = "2026-10-01T00:00:00Z";
  expect(entityPageKey({ createdAt: { from, to } })).toBe(
    entityPageKey({ createdAt: { to, from } }),
  );
  expect(entityPageKey({ createdAt: { from } })).not.toBe(
    entityPageKey({ createdAt: { to } }),
  );
});
