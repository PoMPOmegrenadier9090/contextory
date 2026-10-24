import {
  type PkmChangedSyncthingConflict,
  type PkmSaveConflict,
  type PkmSyncthingConflictDocument,
} from "@pkm/contracts";
import { describe, expect, it, vi } from "vitest";

import { createHttpPkmClient } from "./api-client.js";

describe("HTTP PKM client", () => {
  it("sends permanent deletion with only the expected hash and propagates failures", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    const client = createHttpPkmClient(fetcher);
    const hash = `sha256:${"a".repeat(64)}` as const;
    await client.permanentlyDeleteEntity({
      entityId: "entry/id",
      expectedFileHash: hash,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/entities/entry%2Fid");
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("DELETE");
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ expectedFileHash: hash }),
    );
    fetcher.mockResolvedValue(
      Response.json({ message: "Changed" }, { status: 409 }),
    );
    await expect(
      client.permanentlyDeleteEntity({
        entityId: "entry/id",
        expectedFileHash: hash,
      }),
    ).rejects.toThrow("Changed");
  });

  it("reloads unresolved references without serving stale cached results", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("[]"));
    const client = createHttpPkmClient(fetcher);
    expect(await client.listUnresolvedReferences()).toEqual([]);
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify([{ sourceId: "entry", targetId: "missing" }]),
      ),
    );
    expect(await client.listUnresolvedReferences()).toEqual([
      { sourceId: "entry", targetId: "missing" },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/unresolved-references");
  });

  it("reconnects the change stream after the window regains focus and removes listeners on close", () => {
    const windowEvents = new EventTarget();
    const documentEvents = Object.assign(new EventTarget(), {
      visibilityState: "visible",
    });
    vi.stubGlobal("window", windowEvents);
    vi.stubGlobal("document", documentEvents);
    const sources: { close: ReturnType<typeof vi.fn> }[] = [];
    try {
      const client = createHttpPkmClient(vi.fn<typeof fetch>(), () => {
        const source = { close: vi.fn(), addEventListener: vi.fn() };
        sources.push(source);
        return source;
      });
      const stop = client.subscribeToChanges(() => {});
      windowEvents.dispatchEvent(new Event("focus"));
      expect(sources).toHaveLength(2);
      expect(sources[0]!.close).toHaveBeenCalledOnce();
      stop();
      windowEvents.dispatchEvent(new Event("focus"));
      documentEvents.dispatchEvent(new Event("visibilitychange"));
      expect(sources).toHaveLength(2);
      expect(sources[1]!.close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reuses conditional responses and suggestion menus without another request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) =>
      Promise.resolve(
        new Response(
          new Headers(init?.headers).has("if-none-match")
            ? null
            : JSON.stringify([]),
          {
            status: new Headers(init?.headers).has("if-none-match") ? 304 : 200,
            headers: { etag: 'W/"test"' },
          },
        ),
      ),
    );
    const client = createHttpPkmClient(fetcher);
    await client.queryOptions({ type: "topic" });
    await client.queryOptions({ type: "topic" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.quickOpen("test");
    expect(await client.quickOpen("test")).toEqual([]);
    expect(
      new Headers(fetcher.mock.calls[2]?.[1]?.headers).get("if-none-match"),
    ).toBe('W/"test"');
  });
  it("passes abort signals through HTTP searches and ignores replayed revisions", async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response("[]")));
    const listeners = new Map<string, (event: MessageEvent<string>) => void>();
    const client = createHttpPkmClient(fetcher, () => ({
      addEventListener: (type, listener) => {
        listeners.set(type, listener);
      },
      close: () => {},
    }));
    await client.quickOpen("test", controller.signal);
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    const events: number[] = [];
    const stop = client.subscribeToChanges((e) => events.push(e.revision));
    const event = {
      sessionId: "session",
      revision: 3,
      sync: { changes: { reset: false, entities: [] } },
    };
    listeners.get("vault-change")!(
      new MessageEvent("vault-change", { data: JSON.stringify(event) }),
    );
    listeners.get("vault-change")!(
      new MessageEvent("vault-change", { data: JSON.stringify(event) }),
    );
    expect(events).toEqual([3]);
    listeners.get("ready")!(
      new MessageEvent("ready", {
        data: JSON.stringify({ sessionId: "new", revision: 0, reset: true }),
      }),
    );
    expect(events).toEqual([3, 0]);
    stop();
  });
  it("uses the dedicated Todo API without fetching Entry bodies", async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const page = { items: [], nextCursor: "next" };
    const fetcher = ((path: string, init?: RequestInit) => {
      requests.push({ path, ...(init === undefined ? {} : { init }) });
      return Promise.resolve(
        new Response(
          JSON.stringify(init?.method === "PUT" ? { ok: true } : page),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;
    const client = createHttpPkmClient(fetcher);
    expect(
      await client.listTodos({
        state: "checked",
        limit: 50,
        cursor: "next",
        scopeType: "project",
        scopeId: "project test",
      }),
    ).toEqual(page);
    expect(requests[0]?.path).toBe(
      "/api/todos?state=checked&limit=50&cursor=next&scopeType=project&scopeId=project+test",
    );
    const request = {
      entryId: "entry-id",
      markerFrom: 2,
      checked: false,
      expectedFileHash: `sha256:${"a".repeat(64)}` as const,
    };
    await client.toggleTodo(request);
    expect(requests[1]?.path).toBe("/api/todos/check");
    expect(requests[1]?.init?.method).toBe("PUT");
    expect(JSON.parse(requests[1]?.init?.body as string)).toEqual(request);
  });
  it("requests the selected Daily date from the server", async () => {
    const paths: string[] = [];
    const fetcher = ((path: string) => {
      paths.push(path);
      return Promise.resolve(
        new Response(
          JSON.stringify({ items: [], included: [], nextCursor: null }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;
    expect(
      await createHttpPkmClient(fetcher).queryEntities({
        type: "entry",
        journalDate: "2026-09-27",
      }),
    ).toEqual({ items: [], included: [], nextCursor: null });
    expect(paths).toEqual(["/api/entities?type=entry&journalDate=2026-09-27"]);
  });

  it("posts base64 assets to the Vault API", async () => {
    let request: { path: string; body: unknown } | null = null;
    const fetcher = ((path: string, init?: RequestInit) => {
      if (typeof init?.body !== "string") throw new Error("Missing JSON body");
      request = { path, body: JSON.parse(init.body) as unknown };
      return Promise.resolve(
        new Response(
          JSON.stringify({
            path: "assets/files/12345678-1234-1234-1234-123456789abc.txt",
            fileName: "memo.txt",
            mimeType: "application/octet-stream",
            size: 4,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    await createHttpPkmClient(fetcher).createAsset({
      fileName: "memo.txt",
      dataBase64: "dGVzdA==",
    });
    expect(request).toEqual({
      path: "/api/assets",
      body: { fileName: "memo.txt", dataBase64: "dGVzdA==" },
    });
  });

  it("subscribes to Vault change events and closes the stream", () => {
    let eventListener: ((event: MessageEvent<string>) => void) | undefined;
    let closed = false;
    const client = createHttpPkmClient(fetch, (url) => {
      expect(url).toBe("/api/events?sessionId=&since=0");
      return {
        addEventListener: (_type, listener) => {
          eventListener = listener;
        },
        close: () => {
          closed = true;
        },
      };
    });
    const revisions: number[] = [];
    const unsubscribe = client.subscribeToChanges((event) =>
      revisions.push(event.revision),
    );

    eventListener?.(
      new MessageEvent("vault-change", {
        data: JSON.stringify({
          sessionId: "test",
          revision: 3,
          sync: { changes: { reset: false, entities: [] } },
        }),
      }),
    );
    unsubscribe();

    expect(revisions).toEqual([3]);
    expect(closed).toBe(true);
  });

  it("encodes search queries and decodes successful JSON", async () => {
    const requested: string[] = [];
    const fetcher = ((input: RequestInfo | URL) => {
      requested.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return Promise.resolve(
        new Response(
          JSON.stringify({
            items: [{ id: "entity-1" }],
            included: [],
            nextCursor: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    const result = await createHttpPkmClient(fetcher).queryEntities({
      q: "日本 語",
    });

    expect(requested).toEqual(["/api/entities?q=%E6%97%A5%E6%9C%AC+%E8%AA%9E"]);
    expect(result).toMatchObject({
      items: [{ id: "entity-1" }],
      nextCursor: null,
    });
  });

  it("requests Vault-wide Quick Open with an encoded Japanese query", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: "entity-1", snippet: "本文", breadcrumb: "Area" },
        ]),
        {
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const result = await createHttpPkmClient(fetcher).quickOpen("日 本&");
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/quick-open?q=%E6%97%A5%20%E6%9C%AC%26",
    );
    expect(result[0]?.snippet).toBe("本文");
  });

  it("uses the deleted-only query for the trash listing", async () => {
    const requested: string[] = [];
    const fetcher = ((input: RequestInfo | URL) => {
      requested.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return Promise.resolve(
        new Response(
          JSON.stringify({ items: [], included: [], nextCursor: null }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    await expect(
      createHttpPkmClient(fetcher).queryEntities({ deleted: "only" }),
    ).resolves.toEqual({ items: [], included: [], nextCursor: null });
    expect(requested).toEqual(["/api/entities?deleted=only"]);
  });

  it("returns a 409 save conflict as a recoverable result", async () => {
    const conflict: PkmSaveConflict = {
      ok: false,
      reason: "hash-conflict",
      expectedFileHash:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      actual: null,
      draftContent: "draft",
    };
    const fetcher = (() =>
      Promise.resolve(
        new Response(JSON.stringify(conflict), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch;

    await expect(
      createHttpPkmClient(fetcher).saveEntity({
        entityId: "entity-1",
        content: "draft",
        expectedFileHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).resolves.toEqual(conflict);
  });

  it("encodes Syncthing conflict paths when loading both versions", async () => {
    const requested: string[] = [];
    const hash =
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    const document: PkmSyncthingConflictDocument = {
      conflict: {
        path: "entries/entity.sync-conflict-20260922-120000-DEVICE.md",
        canonicalEntityPath: "entries/entity.md",
        canonicalEntityId: "entity",
        canonicalDisplayName: "Entity",
        hash,
        mtimeMs: 1,
        size: 2,
      },
      canonical: { path: "entries/entity.md", content: "canonical", hash },
      conflicting: {
        path: "entries/entity.sync-conflict-20260922-120000-DEVICE.md",
        content: "conflicting",
        hash,
      },
      draft: null,
    };
    const fetcher = ((input: RequestInfo | URL) => {
      requested.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return Promise.resolve(
        new Response(JSON.stringify(document), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;

    await expect(
      createHttpPkmClient(fetcher).loadSyncthingConflict(
        "entries/entity.sync-conflict-20260922-120000-DEVICE.md",
      ),
    ).resolves.toEqual(document);
    expect(requested).toEqual([
      "/api/conflicts/detail?path=entries%2Fentity.sync-conflict-20260922-120000-DEVICE.md",
    ]);
  });

  it("does not expose server draft operations", () => {
    const client = createHttpPkmClient(fetch);
    expect(client).not.toHaveProperty("saveDraft");
    expect(client).not.toHaveProperty("saveSyncthingConflictDraft");
  });

  it("returns a changed Syncthing conflict as a recoverable 409 result", async () => {
    const hash =
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    const changed: PkmChangedSyncthingConflict = {
      ok: false,
      reason: "hash-conflict",
      current: null,
    };
    let requestBody: unknown;
    const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body !== "string") {
        throw new Error("Expected a JSON request body");
      }
      requestBody = JSON.parse(init.body) as unknown;
      return Promise.resolve(
        new Response(JSON.stringify(changed), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;

    await expect(
      createHttpPkmClient(fetcher).resolveSyncthingConflict({
        conflictPath: "entries/conflict.md",
        resolution: "keep-canonical",
        expectedCanonicalHash: hash,
        expectedConflictHash: hash,
      }),
    ).resolves.toEqual(changed);
    expect(requestBody).toEqual({
      conflictPath: "entries/conflict.md",
      resolution: "keep-canonical",
      expectedCanonicalHash: hash,
      expectedConflictHash: hash,
    });
  });

  it("uses the API error message for non-conflict failures", async () => {
    const fetcher = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "Entity was not found" }), {
          status: 404,
          statusText: "Not Found",
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch;

    await expect(
      createHttpPkmClient(fetcher).loadEntity("missing"),
    ).rejects.toThrow("Entity was not found");
  });

  it("does not mistake a non-conflict 409 response for a save conflict", async () => {
    const fetcher = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "Vault is read-only" }), {
          status: 409,
          statusText: "Conflict",
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch;

    await expect(
      createHttpPkmClient(fetcher).saveEntity({
        entityId: "entity-1",
        content: "draft",
        expectedFileHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).rejects.toThrow("Vault is read-only");
  });
});

it("requests link metadata with the complete URL encoded", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      url: "https://example.com/?a=1&b=2",
      title: "Article",
      description: null,
      siteName: null,
      faviconDataUrl: null,
    }),
  );
  const result = await createHttpPkmClient(fetcher).linkPreview(
    "https://example.com/?a=1&b=2",
  );
  expect(result?.title).toBe("Article");
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "/api/link-preview?url=https%3A%2F%2Fexample.com%2F%3Fa%3D1%26b%3D2",
  );
});
