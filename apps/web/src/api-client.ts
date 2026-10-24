import type { PkmLinkPreview } from "@pkm/contracts";
import { RequestCache } from "./request-cache.js";
import { entityPageKey } from "./entity-page-cache.js";
import type { PkmSaveConflict, PkmFileHash } from "@pkm/contracts";
import { parseMarkdownEntity } from "@pkm/core";
import type {
  PkmRemoteClient,
  PkmBootstrap,
  PkmEntityOption,
  RemoteEntityDocument,
  RemoteEntityPage,
  PkmEntitySummary,
} from "@pkm/contracts";
const fromRemoteDocument = (d: RemoteEntityDocument): PkmEntityDocument => {
  const parsed = parseMarkdownEntity(d.content);
  return {
    ...d,
    entity: {
      ...d.entity,
      body: parsed.ok ? parsed.value.body : "",
      fileHash: d.fileHash,
    },
    draft: null,
    hasExternalChange: false,
  };
};
const fromRemotePage = (p: RemoteEntityPage): EntityPage => ({
  items: p.items.map(({ preview, ...e }) => ({ ...e, body: preview ?? "" })),
  included: p.included.map((e) => ({ ...e, body: "" })),
  nextCursor: p.nextCursor,
});
import type { EntityPage, EntityCounts, CalendarCount } from "@pkm/contracts";
import type {
  BacklinkPage,
  PkmAsset,
  PkmQuickOpenResult,
  PkmEntityDocument,
  PkmHealth,
  PkmOrphanAsset,
  PkmUnresolvedReference,
  PkmOrphanAssetCleanupResult,
  PkmResolveConflictResult,
  PkmSaveResult,
  PkmResolveSyncthingConflictResult,
  PkmSyncthingConflictDocument,
  PkmSyncthingConflictSummary,
  PkmVaultChangeEvent,
} from "@pkm/contracts";
import type { TodoPage } from "@pkm/contracts";

interface ErrorResponse {
  readonly message?: unknown;
}

interface PkmEventSource {
  addEventListener(
    type: "vault-change" | "ready",
    listener: (event: MessageEvent<string>) => void,
  ): void;
  close(): void;
}

type PkmEventSourceFactory = (url: string) => PkmEventSource;

const readJson = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as ErrorResponse;
      if (typeof body.message === "string") message = body.message;
    } catch {
      // The status remains useful if a proxy returned a non-JSON error page.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
};

const requestJson = async <T>(
  fetcher: typeof fetch,
  path: string,
  init?: RequestInit,
): Promise<T> =>
  readJson<T>(
    await fetcher(path, {
      ...init,
      headers: {
        ...(init?.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...init?.headers,
      },
    }),
  );

const requestResult = async <T>(
  fetcher: typeof fetch,
  path: string,
  init: RequestInit,
): Promise<T> => {
  const response = await fetcher(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (response.status === 409) {
    const body = (await response.json()) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      "ok" in body &&
      body.ok === false &&
      "reason" in body &&
      body.reason === "hash-conflict"
    ) {
      return body as T;
    }
    if (
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
    ) {
      throw new Error(body.message);
    }
    throw new Error("409 Conflict");
  }
  return readJson<T>(response);
};

export const createHttpPkmClient = (
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  eventSourceFactory: PkmEventSourceFactory = (url) => new EventSource(url),
): PkmRemoteClient => {
  const optionsCache = new RequestCache<readonly PkmEntityOption[]>();
  const cache = new Map<
    string,
    { etag: string; value: unknown; bytes: number }
  >();
  const cachedFetch: typeof fetch = async (input, init) => {
    const path =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const cached =
      init?.method === undefined || init.method === "GET"
        ? cache.get(path)
        : undefined;
    const headers = new Headers(init?.headers);
    if (cached) headers.set("if-none-match", cached.etag);
    const response = await fetcher(input, { ...init, headers });
    if (response.status === 304 && cached)
      return new Response(JSON.stringify(cached.value), {
        headers: { "content-type": "application/json" },
      });
    if (response.ok && (init?.method === undefined || init.method === "GET")) {
      const etag = response.headers.get("etag");
      if (etag) {
        const raw = await response.clone().text();
        const bytes = new TextEncoder().encode(raw).length;
        if (bytes <= 8 * 1024 * 1024) {
          cache.delete(path);
          cache.set(path, { etag, value: JSON.parse(raw), bytes });
          let total = [...cache.values()].reduce((sum, v) => sum + v.bytes, 0);
          while (cache.size > 64 || total > 8 * 1024 * 1024) {
            const key = cache.keys().next().value!;
            total -= cache.get(key)!.bytes;
            cache.delete(key);
          }
        }
      }
    }
    return response;
  };
  const mutate: typeof fetch = async (input, init) => {
    const result = await fetcher(input, init);
    if (result.ok) optionsCache.clear();
    return result;
  };
  let sessionId = "";
  let revision = 0;
  return {
    linkPreview: (url) =>
      requestJson<PkmLinkPreview | null>(
        fetcher,
        `/api/link-preview?url=${encodeURIComponent(url)}`,
      ),
    bootstrap: async (signal) => {
      const result = await requestJson<
        Omit<PkmBootstrap, "page"> & { page: RemoteEntityPage }
      >(cachedFetch, "/api/bootstrap", signal ? { signal } : undefined);
      revision =
        sessionId === result.health.sessionId
          ? Math.max(revision, result.health.revision)
          : result.health.revision;
      sessionId = result.health.sessionId;
      return { ...result, page: fromRemotePage(result.page) };
    },
    queryOptions: (query, signal) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== undefined)
          params.set(
            key,
            typeof value === "object" ? JSON.stringify(value) : String(value),
          );
      return optionsCache.get(
        entityPageKey(query),
        (abortSignal) =>
          requestJson<readonly PkmEntityOption[]>(
            cachedFetch,
            `/api/entity-options?${params}`,
            { signal: abortSignal },
          ),
        signal,
      );
    },
    patchBody: async (id, body, expectedFileHash) => {
      const result = await requestResult<
        | PkmSaveConflict
        | {
            ok: true;
            entity: Omit<PkmEntitySummary, "body">;
            fileHash: PkmFileHash;
          }
      >(mutate, `/api/entities/${encodeURIComponent(id)}/body`, {
        method: "PATCH",
        body: JSON.stringify({ body, expectedFileHash }),
      });
      return result.ok
        ? {
            ...result,
            entity: { ...result.entity, body, fileHash: result.fileHash },
          }
        : result;
    },
    patchMetadata: async (id, patch, expectedFileHash) => {
      const result = await requestResult<
        | PkmSaveConflict
        | {
            ok: true;
            entity: Omit<PkmEntitySummary, "body">;
            fileHash: PkmFileHash;
          }
      >(mutate, `/api/entities/${encodeURIComponent(id)}/metadata`, {
        method: "PATCH",
        body: JSON.stringify({ patch, expectedFileHash }),
      });
      return result.ok
        ? {
            ...result,
            entity: { ...result.entity, body: "", fileHash: result.fileHash },
          }
        : result;
    },
    queryEntities: (query = {}, signal) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== undefined)
          params.set(
            key,
            typeof value === "object" ? JSON.stringify(value) : String(value),
          );
      return requestJson<RemoteEntityPage>(
        cachedFetch,
        `/api/entities${params.size ? `?${params}` : ""}`,
        signal === undefined ? undefined : { signal },
      ).then(fromRemotePage);
    },
    entityCounts: () =>
      requestJson<EntityCounts>(cachedFetch, "/api/entity-counts"),
    calendarCounts: (from, to, signal) =>
      requestJson<readonly CalendarCount[]>(
        cachedFetch,
        `/api/calendar-counts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        signal ? { signal } : undefined,
      ),
    health: async () => {
      const health = await requestJson<PkmHealth>(cachedFetch, "/health");
      revision =
        sessionId === health.sessionId
          ? Math.max(revision, health.revision)
          : health.revision;
      sessionId = health.sessionId;
      return health;
    },
    subscribeToChanges: (listener) => {
      let source: PkmEventSource;
      let closed = false;
      const connect = () => {
        source = eventSourceFactory(
          `/api/events?sessionId=${encodeURIComponent(sessionId)}&since=${revision}`,
        );
        source.addEventListener("ready", (message) => {
          try {
            const ready = JSON.parse(message.data) as {
              sessionId: string;
              revision: number;
              reset: boolean;
            };
            if (ready.reset) {
              optionsCache.clear();
              sessionId = ready.sessionId;
              revision = ready.revision;
              cache.clear();
              listener({
                sessionId,
                revision,
                sync: {
                  mode: "incremental",
                  scannedFiles: 0,
                  addedFiles: 0,
                  changedFiles: 0,
                  deletedFiles: 0,
                  indexedEntities: 0,
                  conflicts: 0,
                  validationIssues: 0,
                  changes: {
                    reset: true,
                    entities: [],
                    types: [],
                    scopeIds: [],
                    backlinkIds: [],
                    namesChanged: true,
                    countsChanged: true,
                    calendarChanged: true,
                    conflictsChanged: true,
                  },
                },
              });
            }
          } catch {
            /* malformed handshake */
          }
        });
        source.addEventListener("vault-change", (message) => {
          try {
            const event = JSON.parse(message.data) as unknown;
            if (
              typeof event === "object" &&
              event !== null &&
              "revision" in event &&
              typeof event.revision === "number" &&
              "sync" in event &&
              typeof event.sync === "object" &&
              event.sync !== null &&
              "sessionId" in event &&
              typeof event.sessionId === "string" &&
              "changes" in event.sync &&
              event.sync.changes !== null &&
              typeof event.sync.changes === "object" &&
              "entities" in event.sync.changes &&
              Array.isArray(event.sync.changes.entities)
            ) {
              const change = event as PkmVaultChangeEvent;
              if (change.sessionId === sessionId && change.revision <= revision)
                return;
              if (change.sync.changes.reset || change.sync.changes.namesChanged)
                optionsCache.clear();
              sessionId = change.sessionId;
              revision = change.revision;
              listener(change);
            }
          } catch {
            // Ignore malformed events; EventSource will continue receiving updates.
          }
        });
      };
      connect();
      const reconnect = () => {
        if (!closed) {
          source.close();
          connect();
        }
      };
      const visibility = () => {
        if (document.visibilityState === "visible") reconnect();
      };
      if (typeof window !== "undefined") {
        window.addEventListener("online", reconnect);
        window.addEventListener("focus", reconnect);
        document.addEventListener("visibilitychange", visibility);
      }
      return () => {
        closed = true;
        source.close();
        if (typeof window !== "undefined") {
          window.removeEventListener("online", reconnect);
          window.removeEventListener("focus", reconnect);
          document.removeEventListener("visibilitychange", visibility);
        }
      };
    },
    quickOpen: (query, signal) =>
      requestJson<readonly PkmQuickOpenResult[]>(
        cachedFetch,
        `/api/quick-open?q=${encodeURIComponent(query)}`,
        signal ? { signal } : undefined,
      ),
    listTodos: (query = {}, signal) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== undefined) params.set(key, String(value));
      return requestJson<TodoPage>(
        cachedFetch,
        `/api/todos${params.size > 0 ? `?${params}` : ""}`,
        signal ? { signal } : undefined,
      );
    },
    toggleTodo: async (request) => {
      await requestJson<{ readonly ok: true }>(fetcher, "/api/todos/check", {
        method: "PUT",
        body: JSON.stringify(request),
      });
    },
    loadEntity: (entityId, signal) =>
      requestJson<RemoteEntityDocument>(
        cachedFetch,
        `/api/entities/${encodeURIComponent(entityId)}`,
        signal ? { signal } : undefined,
      ).then(fromRemoteDocument),
    queryBacklinks: (id, query = {}, signal) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query))
        if (value !== undefined) params.set(key, String(value));
      return requestJson<BacklinkPage>(
        cachedFetch,
        `/api/entities/${encodeURIComponent(id)}/backlinks?${params}`,
        signal ? { signal } : undefined,
      );
    },
    listSyncthingConflicts: () =>
      requestJson<readonly PkmSyncthingConflictSummary[]>(
        fetcher,
        "/api/conflicts",
      ),
    loadSyncthingConflict: (path) =>
      requestJson<Omit<PkmSyncthingConflictDocument, "draft">>(
        cachedFetch,
        `/api/conflicts/detail?path=${encodeURIComponent(path)}`,
      ).then((d) => ({ ...d, draft: null })),
    createEntity: (request) =>
      requestJson<RemoteEntityDocument>(mutate, "/api/entities", {
        method: "POST",
        body: JSON.stringify(request),
      }).then(fromRemoteDocument),
    createAsset: (request) =>
      requestJson<PkmAsset>(fetcher, "/api/assets", {
        method: "POST",
        body: JSON.stringify(request),
      }),
    listUnresolvedReferences: () =>
      requestJson<readonly PkmUnresolvedReference[]>(
        fetcher,
        "/api/unresolved-references",
      ),
    listOrphanAssets: () =>
      requestJson<readonly PkmOrphanAsset[]>(fetcher, "/api/orphan-assets"),
    deleteOrphanAssets: (assets) =>
      requestJson<PkmOrphanAssetCleanupResult>(
        fetcher,
        "/api/orphan-assets/delete",
        { method: "POST", body: JSON.stringify({ assets }) },
      ),
    permanentlyDeleteEntity: async (request) => {
      await requestJson<{ ok: true }>(
        mutate,
        `/api/entities/${encodeURIComponent(request.entityId)}`,
        {
          method: "DELETE",
          body: JSON.stringify({ expectedFileHash: request.expectedFileHash }),
        },
      );
      cache.clear();
    },
    saveEntity: async (request) => {
      const result = await requestResult<PkmSaveResult>(
        mutate,
        `/api/entities/${encodeURIComponent(request.entityId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            content: request.content,
            expectedFileHash: request.expectedFileHash,
          }),
        },
      );
      if (result.ok && result.entity)
        return {
          ...result,
          entity: fromRemoteDocument({
            entity: result.entity,
            content: result.snapshot.content,
            fileHash: result.snapshot.hash,
          }).entity,
        };
      return result;
    },
    resolveConflict: (request) =>
      requestResult<PkmResolveConflictResult>(
        fetcher,
        `/api/entities/${encodeURIComponent(request.entityId)}/resolve-conflict`,
        {
          method: "POST",
          body: JSON.stringify({
            resolution: request.resolution,
            expectedExternalHash: request.expectedExternalHash,
            ...(request.content === undefined
              ? {}
              : { content: request.content }),
          }),
        },
      ).then((result) =>
        result.ok && result.document
          ? { ...result, document: fromRemoteDocument(result.document) }
          : result,
      ),
    resolveSyncthingConflict: (request) =>
      requestResult<PkmResolveSyncthingConflictResult>(
        fetcher,
        "/api/conflicts/resolve",
        {
          method: "POST",
          body: JSON.stringify(request),
        },
      ).then((result) =>
        result.ok && result.document
          ? { ...result, document: fromRemoteDocument(result.document) }
          : !result.ok && result.current
            ? { ...result, current: { ...result.current, draft: null } }
            : result,
      ),
  };
};
