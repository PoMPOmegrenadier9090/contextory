import { describe, expect, it, vi } from "vitest";
import type {
  PkmEntityDocument,
  PkmFileHash,
  PkmSaveConflict,
  PkmSaveSuccess,
} from "@pkm/contracts";
import { createHttpPkmClient } from "./api-client.js";
import { BrowserDraftStore, withBrowserDrafts } from "./browser-drafts.js";

const hash: PkmFileHash = `sha256:${"a".repeat(64)}`;
const changedHash: PkmFileHash = `sha256:${"b".repeat(64)}`;
const document: PkmEntityDocument = {
  entity: {
    id: "entry",
    type: "entry",
    path: "entries/entry.md",
    displayName: null,
    origin: "human",
    status: null,
    priority: null,
    projectId: null,
    areaId: null,
    taskId: null,
    resourceId: null,
    canonicalIdentifier: null,
    sourceUri: null,
    assetPath: null,
    journalDate: null,
    occurredAt: null,
    dueAt: null,
    topicIds: [],
    createdAt: "2026-10-04T00:00:00Z",
    updatedAt: "2026-10-04T00:00:00Z",
    deletedAt: null,
    excludeFromAi: false,
    body: "original",
  },
  content: "original",
  fileHash: hash,
  draft: null,
  hasExternalChange: false,
};
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
const success: PkmSaveSuccess = {
  ok: true,
  snapshot: { path: document.entity.path, content: "saved", hash: changedHash },
};
const conflict: PkmSaveConflict = {
  ok: false,
  reason: "hash-conflict",
  expectedFileHash: hash,
  actual: {
    path: document.entity.path,
    content: "external",
    hash: changedHash,
  },
  draftContent: "local",
};
const setup = () => {
  const storage = new MemoryStorage();
  let vaultId = "vault";
  let current = document;
  let saveResult: PkmSaveSuccess | PkmSaveConflict = success;
  const fetcher = vi.fn<typeof fetch>((url, init) => {
    const path =
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (path === "/health")
      return Promise.resolve(
        Response.json({ status: "ok", accessMode: "read-write", vaultId }),
      );
    if (path === "/api/entities/entry" && init?.method === "PUT")
      return Promise.resolve(
        Response.json(saveResult, { status: saveResult.ok ? 200 : 409 }),
      );
    if (path === "/api/entities/entry")
      return Promise.resolve(Response.json(current));
    if (path === "/api/entities/entry/resolve-conflict")
      return Promise.resolve(
        Response.json({
          ok: true,
          resolution: "keep-draft",
          document: { ...document, draft: null, fileHash: changedHash },
        }),
      );
    if (path === "/api/todos/check")
      return Promise.resolve(Response.json({ ok: true }));
    throw new Error(`Unexpected network request: ${path}`);
  });
  const remote = createHttpPkmClient(fetcher);
  return {
    storage,
    fetcher,
    remote,
    client: withBrowserDrafts(remote, () => storage),
    setVault: (id: string) => {
      vaultId = id;
    },
    setDocument: (next: PkmEntityDocument) => {
      current = next;
    },
    setResult: (result: typeof saveResult) => {
      saveResult = result;
    },
  };
};
const saveDraft = (
  client: ReturnType<typeof withBrowserDrafts>,
  content = "local",
) => client.saveDraft({ entityId: "entry", content, baseHash: hash });

describe("browser drafts", () => {
  it("discards the local draft only after successful permanent deletion", async () => {
    const s = setup();
    await s.client.loadEntity("entry");
    await saveDraft(s.client);
    const remove = vi
      .spyOn(s.remote, "permanentlyDeleteEntity")
      .mockRejectedValue(new Error("Changed"));
    const request = { entityId: "entry", expectedFileHash: hash };
    await expect(s.client.permanentlyDeleteEntity(request)).rejects.toThrow(
      "Changed",
    );
    expect(
      new BrowserDraftStore("vault", () => s.storage).entity("entry")?.content,
    ).toBe("local");
    remove.mockResolvedValue(undefined);
    await s.client.permanentlyDeleteEntity(request);
    expect(
      new BrowserDraftStore("vault", () => s.storage).entity("entry"),
    ).toBeNull();
    expect(remove).toHaveBeenLastCalledWith(request);
  });

  it("writes synchronously without HTTP and restores after reload, independently for each Vault", async () => {
    const s = setup();
    await s.client.loadEntity("entry");
    s.fetcher.mockClear();
    const pending = saveDraft(s.client);
    expect(
      new BrowserDraftStore("vault", () => s.storage).entity("entry")?.content,
    ).toBe("local");
    await pending;
    expect(s.fetcher).not.toHaveBeenCalled();
    const reopened = withBrowserDrafts(s.remote, () => s.storage);
    expect((await reopened.loadEntity("entry")).draft?.content).toBe("local");
    s.setVault("other-vault");
    await reopened.health();
    expect((await reopened.loadEntity("entry")).draft).toBeNull();
  });

  it("preserves the original base hash when reopened after an external change", async () => {
    const s = setup();
    await s.client.loadEntity("entry");
    await saveDraft(s.client);
    s.setDocument({ ...document, content: "external", fileHash: changedHash });
    const reopened = await s.client.loadEntity("entry");
    expect(reopened.hasExternalChange).toBe(true);
    await s.client.saveDraft({
      entityId: "entry",
      content: "more edits",
      baseHash: changedHash,
    });
    s.setResult(conflict);
    expect(
      (
        await s.client.saveEntity({
          entityId: "entry",
          content: "more edits",
          expectedFileHash: changedHash,
        })
      ).ok,
    ).toBe(false);
    const request = s.fetcher.mock.calls.find(
      ([, init]) => init?.method === "PUT",
    )?.[1];
    expect(JSON.parse(request?.body as string)).toMatchObject({
      expectedFileHash: hash,
    });
    expect((await s.client.loadEntity("entry")).draft?.content).toBe(
      "more edits",
    );
  });

  it("retains the latest local draft if the canonical save is offline", async () => {
    const s = setup();
    await s.client.loadEntity("entry");
    s.fetcher.mockRejectedValueOnce(new Error("offline"));
    await expect(
      s.client.saveEntity({
        entityId: "entry",
        content: "last edit",
        expectedFileHash: hash,
      }),
    ).rejects.toThrow("offline");
    expect((await s.client.loadEntity("entry")).draft?.content).toBe(
      "last edit",
    );
  });

  it("clears the local draft only after a successful save", async () => {
    const s = setup();
    await s.client.loadEntity("entry");
    await saveDraft(s.client);
    await s.client.saveEntity({
      entityId: "entry",
      content: "local",
      expectedFileHash: hash,
    });
    expect((await s.client.loadEntity("entry")).draft).toBeNull();
  });

  it("does not delete edits made while a save is in flight, and rebases them on the saved version", async () => {
    const s = setup();
    await s.client.loadEntity("entry");
    const pending = Promise.withResolvers<Response>();
    s.fetcher.mockImplementationOnce(() => pending.promise);
    const save = s.client.saveEntity({
      entityId: "entry",
      content: "submitted",
      expectedFileHash: hash,
    });
    await vi.waitFor(() =>
      expect(s.fetcher.mock.calls.at(-1)?.[1]?.method).toBe("PUT"),
    );
    await saveDraft(s.client, "newer edit");
    pending.resolve(Response.json(success));
    await save;
    expect((await s.client.loadEntity("entry")).draft).toMatchObject({
      content: "newer edit",
      baseHash: changedHash,
    });
  });

  it("never imports remote drafts and keeps local discard local", async () => {
    const s = setup();
    s.setDocument({
      ...document,
      draft: {
        entityId: "entry",
        filePath: document.entity.path,
        baseHash: hash,
        content: "old server draft",
        updatedAt: "2026-10-04T00:00:00Z",
      },
    });
    expect((await s.client.loadEntity("entry")).draft).toBeNull();
    s.fetcher.mockClear();
    await s.client.discardDraft("entry");
    expect(s.fetcher).not.toHaveBeenCalled();
    expect(
      (await withBrowserDrafts(s.remote, () => s.storage).loadEntity("entry"))
        .draft,
    ).toBeNull();
  });

  it("sends the browser draft only when resolving a canonical save conflict", async () => {
    const s = setup();
    await s.client.loadEntity("entry");
    await saveDraft(s.client);
    await s.client.resolveConflict({
      entityId: "entry",
      resolution: "keep-draft",
      expectedExternalHash: changedHash,
    });
    const request = s.fetcher.mock.calls.find(
      ([url]) => typeof url === "string" && url.endsWith("/resolve-conflict"),
    )?.[1];
    expect(JSON.parse(request?.body as string)).toMatchObject({
      content: "local",
      expectedExternalHash: changedHash,
    });
    expect((await s.client.loadEntity("entry")).draft).toBeNull();
  });

  it("protects local drafts from Todo updates and allows the update after discard", async () => {
    const s = setup();
    await s.client.loadEntity("entry");
    await saveDraft(s.client);
    s.fetcher.mockClear();
    const request = {
      entryId: "entry",
      markerFrom: 0,
      checked: true,
      expectedFileHash: hash,
    };
    await expect(s.client.toggleTodo(request)).rejects.toThrow("未保存");
    expect(s.fetcher).not.toHaveBeenCalled();
    await s.client.discardDraft("entry");
    await s.client.toggleTodo(request);
    expect(s.fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps Syncthing manual merge drafts in the browser and restores them", async () => {
    const s = setup();
    await s.client.health();
    const path = "entries/entry.sync-conflict.md";
    s.remote.loadSyncthingConflict = vi.fn().mockResolvedValue({
      conflict: { path },
      canonical: null,
      conflicting: { content: "conflict", hash },
      draft: null,
    });
    const client = withBrowserDrafts(s.remote, () => s.storage);
    await client.health();
    s.fetcher.mockClear();
    await client.saveSyncthingConflictDraft({
      conflictPath: path,
      canonicalHash: null,
      conflictHash: hash,
      content: "merge",
    });
    expect(s.fetcher).not.toHaveBeenCalled();
    expect((await client.loadSyncthingConflict(path)).draft?.content).toBe(
      "merge",
    );
    await client.discardSyncthingConflictDraft(path);
    expect((await client.loadSyncthingConflict(path)).draft).toBeNull();
  });

  it("surfaces storage failures without falling back to network draft saving", async () => {
    const s = setup();
    const client = withBrowserDrafts(s.remote, () => ({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    }));
    await client.loadEntity("entry");
    s.fetcher.mockClear();
    await expect(saveDraft(client)).rejects.toThrow("下書きを保存できません");
    expect(s.fetcher).not.toHaveBeenCalled();
  });

  it("does not silently erase malformed or unreadable stored drafts", () => {
    const storage = new MemoryStorage();
    const store = new BrowserDraftStore("vault", () => storage);
    store.discardEntity("entry");
    const key = [...storage.values.keys()][0]!;
    storage.values.set(key, "broken draft data");
    expect(() => store.entity("entry")).toThrow("下書きを読み取れません");
    expect(storage.values.get(key)).toBe("broken draft data");
  });
});
