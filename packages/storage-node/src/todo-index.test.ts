import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseMarkdownEntity,
  serializeMarkdownEntity,
  updateEntityMetadata,
} from "@pkm/core";
import {
  openLocalVault,
  type LocalVaultService,
} from "./local-vault-service.js";
import { openVaultIndex } from "./index-database.js";
import { listIndexedTodos } from "./todo-index.js";
import { rebuildVaultIndex } from "./index-rebuild.js";

const roots: string[] = [];
const services: LocalVaultService[] = [];
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "pkms-todos-"));
  roots.push(root);
  await cp(
    fileURLToPath(new URL("../../../fixtures/vault-v1/", import.meta.url)),
    root,
    { recursive: true },
  );
  await rm(join(root, ".pkm"), { recursive: true, force: true });
  const service = await openLocalVault(root, {
    watch: false,
    now: () => new Date("2030-01-01T00:00:00.000Z"),
  });
  services.push(service);
  return { root, service };
};
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("Todo index and saves", () => {
  it("lists small pages, filters state and inherited Context, and never returns full bodies", async () => {
    const { service } = await setup();
    const entry = await service.createEntity({
      type: "entry",
      displayName: "Todo source",
      body: "- [ ] first\n  - [x] nested\n\n```md\n- [ ] code\n```",
    });
    const linked = updateEntityMetadata(entry.content, {
      entryContexts: { task: "tsk_01997c2a-7b1c-7a01-8a10-000000000004" },
    });
    await service.saveEntity({
      entityId: entry.entity.id,
      content: linked.content,
      expectedFileHash: entry.fileHash,
    });
    const query = {
      scopeType: "area" as const,
      scopeId: "area_01997c2a-7b1c-7a01-8a10-000000000001",
      state: "all" as const,
    };
    const all = service.listTodos(query);
    expect(
      all.items
        .filter((todo) => todo.entryId === entry.entity.id)
        .map((todo) => ({
          text: todo.text,
          checked: todo.checked,
          depth: todo.depth,
        })),
    ).toEqual([
      { text: "first", checked: false, depth: 0 },
      { text: "nested", checked: true, depth: 1 },
    ]);
    expect(all.items[0]).not.toHaveProperty("body");
    expect(
      service
        .listTodos({ ...query, state: "unchecked" })
        .items.every((todo) => !todo.checked),
    ).toBe(true);
    expect(
      service
        .listTodos({ ...query, state: "checked" })
        .items.every((todo) => todo.checked),
    ).toBe(true);
    expect(service.listTodos({ ...query, limit: 1 }).items).toEqual(
      all.items.slice(0, 1),
    );
    expect(
      service.listTodos({
        ...query,
        limit: 1,
        cursor: service.listTodos({ ...query, limit: 1 }).nextCursor!,
      }).items,
    ).toEqual(all.items.slice(1, 2));
    expect(service.listTodos({ ...query, limit: 100 }).nextCursor).toBeNull();
    expect(
      service.listTodos({ ...query, scopeId: "missing" }).items.length,
    ).toBe(0);
    expect(() => service.listTodos({ limit: 101 })).toThrow(TypeError);
  });

  it("replaces only changed Entry rows and removes deleted or invalid sources", async () => {
    const { root, service } = await setup();
    const first = await service.createEntity({
      type: "entry",
      displayName: "First",
      body: "- [ ] first",
    });
    const second = await service.createEntity({
      type: "entry",
      displayName: "Second",
      body: "- [ ] second",
    });
    const database = new Database(join(root, ".pkm", "index.sqlite"));
    database
      .prepare("UPDATE entry_todos SET text = 'sentinel' WHERE entity_id = ?")
      .run(second.entity.id);
    database.close();
    const parsed = parseMarkdownEntity(first.content);
    if (!parsed.ok) throw new Error("fixture parse failed");
    await writeFile(
      join(root, first.entity.path),
      serializeMarkdownEntity(parsed.value, {
        body: "- [x] changed\n- [ ] added",
      }),
    );
    const sync = await service.rescan();
    expect(sync).toMatchObject({ mode: "incremental", changedFiles: 1 });
    const rows = service.listTodos({ state: "all" }).items;
    expect(
      rows
        .filter((todo) => todo.entryId === first.entity.id)
        .map((todo) => todo.text),
    ).toEqual(["changed", "added"]);
    expect(rows.find((todo) => todo.entryId === second.entity.id)?.text).toBe(
      "sentinel",
    );
    const loaded = await service.loadEntity(first.entity.id);
    const deleted = updateEntityMetadata(loaded.content, {
      deletedAt: "2030-01-01T01:00:00.000Z",
    });
    await service.saveEntity({
      entityId: first.entity.id,
      content: deleted.content,
      expectedFileHash: loaded.fileHash,
    });
    expect(
      service
        .listTodos({ state: "all" })
        .items.some((todo) => todo.entryId === first.entity.id),
    ).toBe(false);
    const tombstone = await service.loadEntity(first.entity.id);
    await service.saveEntity({
      entityId: first.entity.id,
      content: updateEntityMetadata(tombstone.content, { deletedAt: null })
        .content,
      expectedFileHash: tombstone.fileHash,
    });
    expect(
      service
        .listTodos({ state: "all" })
        .items.filter((todo) => todo.entryId === first.entity.id),
    ).toHaveLength(2);
    await writeFile(join(root, first.entity.path), "invalid Markdown");
    await service.rescan();
    expect(
      service
        .listTodos({ state: "all" })
        .items.some((todo) => todo.entryId === first.entity.id),
    ).toBe(false);
    await rm(join(root, second.entity.path));
    await service.rescan();
    expect(
      service
        .listTodos({ state: "all" })
        .items.some((todo) => todo.entryId === second.entity.id),
    ).toBe(false);
  });

  it("backfills a v8 index and reconstructs the same Todo rows on a full rebuild", async () => {
    const { root, service } = await setup();
    await service.createEntity({
      type: "entry",
      displayName: null,
      body: "- [ ] todo\n- [x] done",
    });
    const expected = service.listTodos({ state: "all" });
    await service.close();
    const old = new Database(join(root, ".pkm", "index.sqlite"));
    old.exec("DROP TABLE entry_todos; PRAGMA user_version = 8;");
    old.close();
    const migrated = await openLocalVault(root, { watch: false });
    services.push(migrated);
    expect(migrated.listTodos({ state: "all" })).toEqual(expected);
    await migrated.close();
    const index = openVaultIndex(root);
    try {
      await rebuildVaultIndex(root, index);
      expect(listIndexedTodos(index, { state: "all" })).toEqual(expected);
    } finally {
      index.close();
    }
  });

  it("updates only the selected marker, persists and refuses stale positions or drafts", async () => {
    const { root, service } = await setup();
    const created = await service.createEntity({
      type: "entry",
      displayName: "Todo",
      body: "😀\n- [ ] same\n- [ ] same",
    });
    const todos = service
      .listTodos({ state: "all" })
      .items.filter((todo) => todo.entryId === created.entity.id);
    const selected = todos[1]!;
    const request = {
      entryId: selected.entryId,
      markerFrom: selected.markerFrom,
      expectedFileHash: selected.fileHash,
      checked: true,
    };
    await service.toggleTodo(request);
    expect((await service.loadEntity(created.entity.id)).entity.body).toBe(
      "😀\n- [ ] same\n- [x] same",
    );
    await expect(service.toggleTodo(request)).rejects.toMatchObject({
      code: "TODO_CHANGED",
    });
    const current = await service.loadEntity(created.entity.id);
    service.saveDraft({
      entityId: created.entity.id,
      content: current.content + "draft",
      baseHash: current.fileHash,
    });
    await expect(
      service.toggleTodo({ ...request, expectedFileHash: current.fileHash }),
    ).rejects.toMatchObject({ code: "TODO_DRAFT_PRESENT" });
    expect(service.listDrafts()[0]?.content).toBe(current.content + "draft");
    service.discardDraft(created.entity.id);
    const changed = current.content + "\nexternal";
    await writeFile(join(root, created.entity.path), changed);
    await expect(
      service.toggleTodo({ ...request, expectedFileHash: current.fileHash }),
    ).rejects.toMatchObject({ code: "TODO_CHANGED" });
    expect(await readFile(join(root, created.entity.path), "utf8")).toBe(
      changed,
    );
    expect(service.listDrafts()).toEqual([]);
  });

  it("serializes competing check operations on the same source version", async () => {
    const { service } = await setup();
    const created = await service.createEntity({
      type: "entry",
      displayName: "Race",
      body: "- [ ] one\n- [ ] two",
    });
    const rows = service
      .listTodos()
      .items.filter((todo) => todo.entryId === created.entity.id);
    const results = await Promise.allSettled(
      rows.map((todo) =>
        service.toggleTodo({
          entryId: todo.entryId,
          markerFrom: todo.markerFrom,
          expectedFileHash: todo.fileHash,
          checked: true,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      service
        .listTodos({ state: "checked" })
        .items.filter((todo) => todo.entryId === created.entity.id),
    ).toHaveLength(1);
    expect(service.listDrafts()).toEqual([]);
  });
  it("preserves the rejected Entity save's draft when competing saves use the same write lock", async () => {
    const { service } = await setup();
    const created = await service.createEntity({
      type: "entry",
      displayName: null,
      body: "- [ ] original",
    });
    const parsed = parseMarkdownEntity(created.content);
    if (!parsed.ok) throw new Error("fixture parse failed");
    const results = await Promise.all(
      ["first", "second"].map((body) =>
        service.saveEntity({
          entityId: created.entity.id,
          expectedFileHash: created.fileHash,
          content: serializeMarkdownEntity(parsed.value, { body }),
        }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const conflict = results.find((result) => !result.ok);
    if (conflict === undefined || conflict.ok)
      throw new Error("expected a hash conflict");
    expect(service.listDrafts()).toEqual([
      expect.objectContaining({
        entityId: created.entity.id,
        content: conflict.draftContent,
      }),
    ]);
  });
  it("keeps Todos visible in a newer read-only Vault but forbids checks", async () => {
    const { root, service } = await setup();
    const created = await service.createEntity({
      type: "entry",
      displayName: null,
      body: "- [ ] read only",
    });
    await service.close();
    const config = await readFile(join(root, "vault.yaml"), "utf8");
    await writeFile(
      join(root, "vault.yaml"),
      config.replace("schema_version: 1", "schema_version: 2"),
    );
    const readOnly = await openLocalVault(root, { watch: false });
    services.push(readOnly);
    const todo = readOnly
      .listTodos()
      .items.find((item) => item.entryId === created.entity.id)!;
    expect(readOnly.accessMode).toBe("read-only");
    await expect(
      readOnly.toggleTodo({
        entryId: todo.entryId,
        markerFrom: todo.markerFrom,
        checked: true,
        expectedFileHash: todo.fileHash,
      }),
    ).rejects.toMatchObject({ code: "READ_ONLY_SCHEMA" });
    expect(
      readOnly
        .listTodos()
        .items.find((item) => item.entryId === created.entity.id)?.checked,
    ).toBe(false);
  });
});
