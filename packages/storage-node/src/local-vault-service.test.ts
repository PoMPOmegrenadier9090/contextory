import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { parseMarkdownEntity, updateEntityMetadata } from "@pkm/core";

import { openLocalVault } from "./local-vault-service.js";
import type {
  LocalVaultError,
  LocalVaultService,
} from "./local-vault-service.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../../fixtures/vault-v1/", import.meta.url),
);
const ENTRY_ID = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
const ENTRY_RELATIVE_PATH = `entries/${ENTRY_ID}.md`;
const CONFLICT_RELATIVE_PATH = `entries/${ENTRY_ID}.sync-conflict-20260922-120000-ABCDEFG.md`;
const temporaryDirectories: string[] = [];
const openServices: LocalVaultService[] = [];

const createFixtureVault = async (): Promise<string> => {
  const parent = await mkdtemp(join(tmpdir(), "pkms-local-vault-"));
  temporaryDirectories.push(parent);
  const vaultRoot = join(parent, "vault");
  await cp(FIXTURE_ROOT, vaultRoot, { recursive: true });
  await rm(join(vaultRoot, ".pkm"), { recursive: true, force: true });
  return vaultRoot;
};

const openFixtureVault = async (
  vaultRoot: string,
  now: () => Date = () => new Date("2026-09-22T01:23:45.000Z"),
): Promise<LocalVaultService> => {
  const service = await openLocalVault(vaultRoot, {
    watch: false,
    now,
  });
  openServices.push(service);
  return service;
};

const createSyncthingConflict = async (
  vaultRoot: string,
  heading: string,
): Promise<void> => {
  const canonical = await readFile(
    join(vaultRoot, ENTRY_RELATIVE_PATH),
    "utf8",
  );
  await writeFile(
    join(vaultRoot, CONFLICT_RELATIVE_PATH),
    canonical.replace("# 実装開始", `# ${heading}`),
    "utf8",
  );
};

afterEach(async () => {
  await Promise.all(openServices.splice(0).map((service) => service.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("LocalVaultService", () => {
  const trash = async (service: LocalVaultService, id = ENTRY_ID) => {
    const entry = await service.loadEntity(id);
    await service.saveEntity({
      entityId: id,
      content: updateEntityMetadata(entry.content, {
        deletedAt: "2026-10-18T00:00:00Z",
      }).content,
      expectedFileHash: entry.fileHash,
    });
    return service.loadEntity(id);
  };

  it("permanently deletes only trashed Markdown and its draft while keeping assets and inbound references", async () => {
    const root = await createFixtureVault();
    const service = await openFixtureVault(root);
    const taskId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    const target = await trash(service, taskId);
    const asset = await service.createAsset({
      fileName: "keep.txt",
      dataBase64: Buffer.from("keep").toString("base64"),
    });
    const before = await readFile(join(root, ENTRY_RELATIVE_PATH), "utf8");
    service.saveDraft({
      entityId: taskId,
      content: target.content,
      baseHash: target.fileHash,
    });
    await service.permanentlyDeleteEntity({
      entityId: taskId,
      expectedFileHash: target.fileHash,
    });
    await expect(
      readFile(join(root, target.entity.path)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(service.loadEntity(taskId)).rejects.toMatchObject({
      code: "ENTITY_NOT_FOUND",
    });
    expect(service.listDrafts()).toEqual([]);
    expect(service.queryEntities({ deleted: "only" }).items).toEqual([]);
    expect(await readFile(join(root, ENTRY_RELATIVE_PATH), "utf8")).toBe(
      before,
    );
    expect((await service.readAsset(asset.path)).data.toString()).toBe("keep");
    expect(
      service
        .listUnresolvedReferences()
        .filter((ref) => ref.targetId === taskId),
    ).toHaveLength(2);
  });

  it("refuses active, changed and restored files, including changes not yet indexed", async () => {
    const root = await createFixtureVault();
    const service = await openFixtureVault(root);
    const original = await service.loadEntity(ENTRY_ID);
    await expect(
      service.permanentlyDeleteEntity({
        entityId: ENTRY_ID,
        expectedFileHash: original.fileHash,
      }),
    ).rejects.toMatchObject({ code: "DELETE_BLOCKED" });
    const target = await trash(service);
    await expect(
      service.permanentlyDeleteEntity({
        entityId: ENTRY_ID,
        expectedFileHash: original.fileHash,
      }),
    ).rejects.toMatchObject({ code: "DELETE_BLOCKED" });
    await writeFile(join(root, ENTRY_RELATIVE_PATH), original.content);
    const restored = await service.loadEntity(ENTRY_ID);
    await expect(
      service.permanentlyDeleteEntity({
        entityId: ENTRY_ID,
        expectedFileHash: restored.fileHash,
      }),
    ).rejects.toMatchObject({ code: "DELETE_BLOCKED" });
    expect(await readFile(join(root, ENTRY_RELATIVE_PATH), "utf8")).toBe(
      original.content,
    );
    const outside = join(root, "keep-outside.md");
    await writeFile(outside, target.content);
    await rm(join(root, ENTRY_RELATIVE_PATH));
    await symlink(outside, join(root, ENTRY_RELATIVE_PATH));
    await expect(
      service.permanentlyDeleteEntity({
        entityId: ENTRY_ID,
        expectedFileHash: target.fileHash,
      }),
    ).rejects.toThrow("symbolic link");
    expect(await readFile(outside, "utf8")).toBe(target.content);
  });

  it("keeps both files and the local draft when an unresolved sync conflict exists", async () => {
    const root = await createFixtureVault();
    const service = await openFixtureVault(root);
    const target = await trash(service);
    service.saveDraft({
      entityId: ENTRY_ID,
      content: target.content,
      baseHash: target.fileHash,
    });
    await createSyncthingConflict(root, "同期中の版");
    await expect(
      service.permanentlyDeleteEntity({
        entityId: ENTRY_ID,
        expectedFileHash: target.fileHash,
      }),
    ).rejects.toMatchObject({ code: "DELETE_BLOCKED" });
    expect(service.listDrafts()).toHaveLength(1);
    expect(await readFile(join(root, ENTRY_RELATIVE_PATH), "utf8")).toBe(
      target.content,
    );
    await expect(
      readFile(join(root, CONFLICT_RELATIVE_PATH), "utf8"),
    ).resolves.toContain("同期中の版");
  });

  it("serializes permanent deletion with saves without leaving a stale save draft", async () => {
    const root = await createFixtureVault();
    const service = await openFixtureVault(root);
    const target = await trash(service);
    const [deleted, saved] = await Promise.allSettled([
      service.permanentlyDeleteEntity({
        entityId: ENTRY_ID,
        expectedFileHash: target.fileHash,
      }),
      service.saveEntity({
        entityId: ENTRY_ID,
        expectedFileHash: target.fileHash,
        content: target.content + "\nlocal edit",
      }),
    ]);
    expect(deleted.status).toBe("fulfilled");
    expect(saved.status).toBe("rejected");
    expect(service.listDrafts()).toEqual([]);
    await expect(
      readFile(join(root, ENTRY_RELATIVE_PATH)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retains a concurrent saved edit instead of deleting it with an older hash", async () => {
    const root = await createFixtureVault();
    const service = await openFixtureVault(root);
    const target = await trash(service);
    const [saved, deleted] = await Promise.allSettled([
      service.saveEntity({
        entityId: ENTRY_ID,
        expectedFileHash: target.fileHash,
        content: target.content + "\nlocal edit",
      }),
      service.permanentlyDeleteEntity({
        entityId: ENTRY_ID,
        expectedFileHash: target.fileHash,
      }),
    ]);
    expect(saved.status).toBe("fulfilled");
    expect(deleted.status).toBe("rejected");
    expect(service.listDrafts()).toEqual([]);
    expect(await readFile(join(root, ENTRY_RELATIVE_PATH), "utf8")).toContain(
      "local edit",
    );
  });

  it("lists broken body and metadata references, including trash sources, and clears repaired warnings", async () => {
    const root = await createFixtureVault();
    const service = await openFixtureVault(root);
    expect(service.listUnresolvedReferences()).toEqual([]);
    const taskId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    const task = await service.loadEntity(taskId);
    const deleted = updateEntityMetadata(task.content, {
      deletedAt: "2026-10-17T00:00:00Z",
    });
    await service.saveEntity({
      entityId: taskId,
      content: deleted.content,
      expectedFileHash: task.fileHash,
    });
    expect(service.listUnresolvedReferences()).toEqual([]);
    await rm(join(root, task.entity.path));
    await service.rescan([task.entity.path]);
    const references = service.listUnresolvedReferences();
    expect(references).toHaveLength(2);
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: ENTRY_ID,
          sourceName: "実装開始",
          sourcePath: ENTRY_RELATIVE_PATH,
          targetId: taskId,
          fieldPath: ["contexts", "task"],
          startOffset: null,
          sourceDeletedAt: null,
        }),
        expect.objectContaining({
          sourceId: ENTRY_ID,
          targetId: taskId,
          fieldPath: null,
        }),
      ]),
    );
    expect(
      references.find((reference) => reference.fieldPath === null)?.startOffset,
    ).toBeTypeOf("number");
    const entry = await service.loadEntity(ENTRY_ID);
    await service.saveEntity({
      entityId: ENTRY_ID,
      content: updateEntityMetadata(entry.content, {
        deletedAt: "2026-10-17T00:00:00Z",
      }).content,
      expectedFileHash: entry.fileHash,
    });
    expect(
      service
        .listUnresolvedReferences()
        .every((ref) => ref.sourceDeletedAt !== null),
    ).toBe(true);
    await writeFile(join(root, task.entity.path), task.content);
    await service.rescan([task.entity.path]);
    expect(service.listUnresolvedReferences()).toEqual([]);
    await service.close();
    expect(() => service.listUnresolvedReferences()).toThrow();
  });

  it("persists Resource memos with search, references, metadata and draft/hash protection", async () => {
    const root = await createFixtureVault();
    const service = await openFixtureVault(root);
    const body = `# 資料理解の整理\n[[entry:${ENTRY_ID}|元の記録]]\n- [ ] 資料本文の項目\n`;
    const created = await service.createEntity({
      type: "resource",
      displayName: "資料の全般メモ",
      body,
      metadata: { authors: ["Author"] },
    });
    const id = created.entity.id;
    expect(created.entity.body).toBe(body);
    expect(
      service.searchEntities("資料理解の整理").map((item) => item.id),
    ).toContain(id);
    expect(
      service.getBacklinks(ENTRY_ID).map((item) => item.sourceId),
    ).toContain(id);
    expect(
      service
        .listTodos({ state: "all" })
        .items.some((item) => item.entryId === id),
    ).toBe(false);
    const metadata = await service.patchMetadata(
      id,
      { description: "一行の説明" },
      created.fileHash,
    );
    expect(metadata.ok).toBe(true);
    const withMetadata = await service.loadEntity(id);
    expect(parseMarkdownEntity(withMetadata.content)).toMatchObject({
      ok: true,
      value: {
        body,
        entity: { authors: ["Author"], description: "一行の説明" },
      },
    });
    expect((await service.patchBody(id, "stale", created.fileHash)).ok).toBe(
      false,
    );
    service.saveDraft({
      entityId: id,
      content: withMetadata.content + "未保存",
      baseHash: withMetadata.fileHash,
    });
    await expect(
      service.patchBody(id, "blocked", withMetadata.fileHash),
    ).rejects.toThrow("local draft");
    service.discardDraft(id);
    expect((await service.patchBody(id, "", withMetadata.fileHash)).ok).toBe(
      true,
    );
    const cleared = await service.loadEntity(id);
    expect(cleared.entity.body).toBe("");
    expect(
      service.getBacklinks(ENTRY_ID).some((item) => item.sourceId === id),
    ).toBe(false);
    await service.close();
    const reopened = await openFixtureVault(root);
    expect((await reopened.loadEntity(id)).entity.body).toBe("");
    expect(
      reopened.listEntities().filter((item) => item.type === "entry"),
    ).toHaveLength(1);
  });

  it("stores Resource authors and relations, searches authors, handles backlinks, removal and rebuild", async () => {
    const root = await createFixtureVault();
    const service = await openFixtureVault(root);
    const targets = service
      .listEntities()
      .filter((entity) =>
        ["area", "project", "task", "resource"].includes(entity.type),
      );
    const created = await service.createEntity({
      type: "resource",
      displayName: "新規資料",
      metadata: {
        authors: ["AuthorOnly", "著者二人目"],
        relatedEntityIds: targets.map((entity) => entity.id),
      },
    });
    const id = created.entity.id;
    expect(created.entity.authors).toEqual(["AuthorOnly", "著者二人目"]);
    expect(
      service.searchEntities("AuthorOnly").map((entity) => entity.id),
    ).toContain(id);
    for (const target of targets) {
      expect(
        service
          .queryEntities({ type: "resource", relatedTo: target.id })
          .items.map((entity) => entity.id),
      ).toContain(id);
      expect(
        service
          .queryEntities({
            type: target.type as "area" | "project" | "task" | "resource",
            relatedTo: id,
          })
          .items.map((entity) => entity.id),
      ).toContain(target.id);
      expect(
        service
          .queryBacklinks(target.id)
          .items.find((group) => group.sourceId === id)?.kinds,
      ).toContain("related");
    }
    expect(service.entityLabels([id]).map((entity) => entity.id)).toEqual(
      expect.arrayContaining(targets.map((entity) => entity.id)),
    );
    const first = targets[0]!;
    const remove = await service.patchMetadata(
      id,
      { authors: ["UpdatedAuthor"], relatedEntityIds: [first.id] },
      created.fileHash,
    );
    expect(remove.ok).toBe(true);
    expect(
      service.searchEntities("AuthorOnly").map((entity) => entity.id),
    ).not.toContain(id);
    expect(
      service.queryEntities({ relatedTo: id }).items.map((entity) => entity.id),
    ).toContain(first.id);
    for (const target of targets.slice(1))
      expect(
        service.queryBacklinks(target.id).items.map((group) => group.sourceId),
      ).not.toContain(id);
    const stale = await service.patchMetadata(
      id,
      { authors: ["Overwritten"] },
      created.fileHash,
    );
    expect(stale.ok).toBe(false);
    const snapshot = await service.loadEntity(id);
    await service.close();
    openServices.splice(openServices.indexOf(service), 1);
    await rm(join(root, ".pkm", "index.sqlite"), { force: true });
    const rebuilt = await openFixtureVault(root);
    expect((await rebuilt.loadEntity(id)).entity).toMatchObject({
      authors: ["UpdatedAuthor"],
      relatedEntityIds: [first.id],
    });
    expect((await rebuilt.loadEntity(id)).content).toBe(snapshot.content);
    expect(
      rebuilt
        .queryEntities({ type: "resource", sort: "authors" })
        .items.map((entity) => entity.id),
    ).toContain(id);
  });

  it("projects Task due_at through list and load after an incremental save", async () => {
    const service = await openFixtureVault(await createFixtureVault());
    const taskId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    const task = await service.loadEntity(taskId);
    expect(task.entity.dueAt).toBeNull();
    const dueAt = "2026-10-05T09:00:00+09:00";
    const content = task.content.replace("due_at: null", `due_at: '${dueAt}'`);
    expect(
      (
        await service.saveEntity({
          entityId: taskId,
          content,
          expectedFileHash: task.fileHash,
        })
      ).ok,
    ).toBe(true);
    expect((await service.loadEntity(taskId)).entity.dueAt).toBe(
      new Date(dueAt).toISOString(),
    );
    expect(
      service.listEntities().find((entity) => entity.id === taskId)?.dueAt,
    ).toBe(new Date(dueAt).toISOString());
  });

  it("provides Entity-scoped list, search, load, and backlink queries", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);

    expect(service.vaultId).toBe("01997c2a-7b1c-7a01-8a10-000000000000");
    expect(service.accessMode).toBe("read-write");
    expect(service.listEntities()).toHaveLength(6);
    expect(service.searchEntities("実装開始")).toHaveLength(1);
    const document = await service.loadEntity(ENTRY_ID);
    expect(document).toMatchObject({
      entity: { id: ENTRY_ID, type: "entry" },
      draft: null,
      hasExternalChange: false,
    });
    expect(document.content).toContain("# 実装開始");
    expect(
      service.getBacklinks("tsk_01997c2a-7b1c-7a01-8a10-000000000004"),
    ).toHaveLength(2);
    expect(service.listEntityScopes(ENTRY_ID)).toHaveLength(4);
    expect(
      service
        .listEntitiesInScope(
          "area",
          "area_01997c2a-7b1c-7a01-8a10-000000000001",
        )
        .map(({ id }) => id),
    ).toEqual(
      expect.arrayContaining([
        "prj_01997c2a-7b1c-7a01-8a10-000000000003",
        "tsk_01997c2a-7b1c-7a01-8a10-000000000004",
        ENTRY_ID,
      ]),
    );
  });

  it("lists and loads Syncthing conflict copies without duplicating the Entity", async () => {
    const vaultRoot = await createFixtureVault();
    await createSyncthingConflict(vaultRoot, "別peerの編集");
    const service = await openFixtureVault(vaultRoot);

    expect(service.listEntities()).toHaveLength(6);
    expect(service.listSyncthingConflicts()).toEqual([
      expect.objectContaining({
        path: CONFLICT_RELATIVE_PATH,
        canonicalEntityPath: ENTRY_RELATIVE_PATH,
        canonicalEntityId: ENTRY_ID,
        canonicalDisplayName: "実装開始",
      }),
    ]);
    const conflict = await service.loadSyncthingConflict(
      CONFLICT_RELATIVE_PATH,
    );
    expect(conflict.canonical?.content).toContain("# 実装開始");
    expect(conflict.conflicting.content).toContain("# 別peerの編集");
  });

  it("resolves a Syncthing conflict by keeping the canonical version", async () => {
    const vaultRoot = await createFixtureVault();
    await createSyncthingConflict(vaultRoot, "破棄する競合版");
    const service = await openFixtureVault(vaultRoot);
    const conflict = await service.loadSyncthingConflict(
      CONFLICT_RELATIVE_PATH,
    );

    const resolved = await service.resolveSyncthingConflict({
      conflictPath: CONFLICT_RELATIVE_PATH,
      resolution: "keep-canonical",
      expectedCanonicalHash: conflict.canonical?.hash ?? null,
      expectedConflictHash: conflict.conflicting.hash,
    });

    expect(resolved).toMatchObject({
      ok: true,
      resolution: "keep-canonical",
    });
    if (!resolved.ok) throw new Error("Expected the conflict to be resolved");
    expect(resolved.document?.content).toContain("# 実装開始");
    expect(service.listSyncthingConflicts()).toEqual([]);
    await expect(
      readFile(join(vaultRoot, CONFLICT_RELATIVE_PATH), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("resolves a Syncthing conflict by saving the conflict copy as canonical", async () => {
    const vaultRoot = await createFixtureVault();
    await createSyncthingConflict(vaultRoot, "採用する競合版");
    const service = await openFixtureVault(vaultRoot);
    const conflict = await service.loadSyncthingConflict(
      CONFLICT_RELATIVE_PATH,
    );

    const resolved = await service.resolveSyncthingConflict({
      conflictPath: CONFLICT_RELATIVE_PATH,
      resolution: "keep-conflict",
      expectedCanonicalHash: conflict.canonical?.hash ?? null,
      expectedConflictHash: conflict.conflicting.hash,
    });

    expect(resolved).toMatchObject({
      ok: true,
      resolution: "keep-conflict",
    });
    if (!resolved.ok) throw new Error("Expected the conflict to be resolved");
    expect(resolved.document?.content).toContain("# 採用する競合版");
    expect(service.listDrafts()).toEqual([]);
    expect(service.listSyncthingConflicts()).toEqual([]);
    await expect(
      readFile(join(vaultRoot, ENTRY_RELATIVE_PATH), "utf8"),
    ).resolves.toContain("updated_at: 2026-09-22T01:23:45.000Z");
  });

  it("restores a missing canonical Entity from its Syncthing conflict copy", async () => {
    const vaultRoot = await createFixtureVault();
    await createSyncthingConflict(vaultRoot, "削除から復元");
    await rm(join(vaultRoot, ENTRY_RELATIVE_PATH));
    const service = await openFixtureVault(vaultRoot);
    const conflict = await service.loadSyncthingConflict(
      CONFLICT_RELATIVE_PATH,
    );

    expect(conflict.canonical).toBeNull();
    expect(conflict.conflict.canonicalEntityId).toBeNull();
    const resolved = await service.resolveSyncthingConflict({
      conflictPath: CONFLICT_RELATIVE_PATH,
      resolution: "keep-conflict",
      expectedCanonicalHash: null,
      expectedConflictHash: conflict.conflicting.hash,
    });

    expect(resolved).toMatchObject({
      ok: true,
      document: {
        entity: { id: ENTRY_ID },
      },
    });
    if (!resolved.ok) throw new Error("Expected the conflict to be resolved");
    expect(resolved.document?.content).toContain("# 削除から復元");
    expect(service.listEntities()).toHaveLength(6);
    expect(service.listSyncthingConflicts()).toEqual([]);
  });

  it("saves a manually merged Syncthing conflict through Entity validation", async () => {
    const vaultRoot = await createFixtureVault();
    await createSyncthingConflict(vaultRoot, "競合版");
    const service = await openFixtureVault(vaultRoot);
    const conflict = await service.loadSyncthingConflict(
      CONFLICT_RELATIVE_PATH,
    );
    const merged = conflict.canonical?.content.replace(
      "# 実装開始",
      "# 手動マージ版",
    );
    if (merged === undefined) throw new Error("Expected a canonical version");

    const resolved = await service.resolveSyncthingConflict({
      conflictPath: CONFLICT_RELATIVE_PATH,
      resolution: "manual",
      expectedCanonicalHash: conflict.canonical?.hash ?? null,
      expectedConflictHash: conflict.conflicting.hash,
      content: merged,
    });

    expect(resolved).toMatchObject({ ok: true, resolution: "manual" });
    if (!resolved.ok) throw new Error("Expected the conflict to be resolved");
    expect(resolved.document?.content).toContain("# 手動マージ版");
    expect(service.listSyncthingConflicts()).toEqual([]);
  });

  it("recovers a manual Syncthing merge draft and retains its base hashes", async () => {
    const vaultRoot = await createFixtureVault();
    await createSyncthingConflict(vaultRoot, "競合版1");
    let service = await openFixtureVault(vaultRoot);
    const original = await service.loadSyncthingConflict(
      CONFLICT_RELATIVE_PATH,
    );
    const merged = original.canonical?.content.replace(
      "# 実装開始",
      "# 手動マージ途中",
    );
    if (merged === undefined) throw new Error("Expected a canonical version");
    await service.saveSyncthingConflictDraft({
      conflictPath: CONFLICT_RELATIVE_PATH,
      canonicalHash: original.canonical?.hash ?? null,
      conflictHash: original.conflicting.hash,
      content: merged,
    });
    await service.close();
    openServices.splice(openServices.indexOf(service), 1);

    await createSyncthingConflict(vaultRoot, "競合版2");
    service = await openFixtureVault(vaultRoot);
    const recovered = await service.loadSyncthingConflict(
      CONFLICT_RELATIVE_PATH,
    );
    expect(recovered.draft?.content).toContain("# 手動マージ途中");
    expect(recovered.draft?.canonicalHash).toBe(
      original.canonical?.hash ?? null,
    );
    expect(recovered.draft?.conflictHash).toBe(original.conflicting.hash);
    expect(recovered.draft?.conflictHash).not.toBe(recovered.conflicting.hash);

    const resolved = await service.resolveSyncthingConflict({
      conflictPath: CONFLICT_RELATIVE_PATH,
      resolution: "manual",
      expectedCanonicalHash: recovered.canonical?.hash ?? null,
      expectedConflictHash: recovered.conflicting.hash,
      content: recovered.draft?.content ?? "",
    });
    expect(resolved.ok).toBe(true);

    await createSyncthingConflict(vaultRoot, "新しい競合");
    await service.rescan();
    await expect(
      service.loadSyncthingConflict(CONFLICT_RELATIVE_PATH),
    ).resolves.toMatchObject({ draft: null });
  });

  it("rejects a conflict copy whose Entity identity does not match its canonical path", async () => {
    const vaultRoot = await createFixtureVault();
    await createSyncthingConflict(vaultRoot, "不正な競合版");
    const invalid = await readFile(
      join(vaultRoot, CONFLICT_RELATIVE_PATH),
      "utf8",
    );
    await writeFile(
      join(vaultRoot, CONFLICT_RELATIVE_PATH),
      invalid.replace(ENTRY_ID, "ent_01997c2a-7b1c-7a01-8a10-000000000099"),
      "utf8",
    );
    const service = await openFixtureVault(vaultRoot);
    const conflict = await service.loadSyncthingConflict(
      CONFLICT_RELATIVE_PATH,
    );

    await expect(
      service.resolveSyncthingConflict({
        conflictPath: CONFLICT_RELATIVE_PATH,
        resolution: "keep-conflict",
        expectedCanonicalHash: conflict.canonical?.hash ?? null,
        expectedConflictHash: conflict.conflicting.hash,
      }),
    ).rejects.toThrow(`as requested Entity ${ENTRY_ID}`);
    expect(service.listSyncthingConflicts()).toHaveLength(1);
    await expect(
      readFile(join(vaultRoot, ENTRY_RELATIVE_PATH), "utf8"),
    ).resolves.toContain(`# 実装開始`);
  });

  it("keeps both Syncthing versions when either hash changed before resolution", async () => {
    const vaultRoot = await createFixtureVault();
    await createSyncthingConflict(vaultRoot, "競合版1");
    const service = await openFixtureVault(vaultRoot);
    const conflict = await service.loadSyncthingConflict(
      CONFLICT_RELATIVE_PATH,
    );
    await createSyncthingConflict(vaultRoot, "競合版2");

    const raced = await service.resolveSyncthingConflict({
      conflictPath: CONFLICT_RELATIVE_PATH,
      resolution: "keep-canonical",
      expectedCanonicalHash: conflict.canonical?.hash ?? null,
      expectedConflictHash: conflict.conflicting.hash,
    });

    expect(raced).toMatchObject({
      ok: false,
      reason: "hash-conflict",
    });
    if (raced.ok) throw new Error("Expected changed conflict hashes");
    expect(raced.current?.conflicting.content).toContain("# 競合版2");
    await expect(
      readFile(join(vaultRoot, CONFLICT_RELATIVE_PATH), "utf8"),
    ).resolves.toContain("# 競合版2");
    await expect(
      readFile(join(vaultRoot, ENTRY_RELATIVE_PATH), "utf8"),
    ).resolves.toContain("# 実装開始");
  });

  it("publishes meaningful index changes and supports unsubscribe", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);
    const events: Array<{
      readonly revision: number;
      readonly changed: number;
    }> = [];
    const unsubscribe = service.subscribeToChanges((event) => {
      events.push({
        revision: event.revision,
        changed: event.sync.changedFiles,
      });
    });
    const original = await readFile(
      join(vaultRoot, ENTRY_RELATIVE_PATH),
      "utf8",
    );

    await service.rescan();
    expect(events).toEqual([]);
    await writeFile(
      join(vaultRoot, ENTRY_RELATIVE_PATH),
      original.replace("# 実装開始", "# 通知対象"),
      "utf8",
    );
    await service.rescan();
    expect(events).toEqual([{ revision: 1, changed: 1 }]);

    unsubscribe();
    await writeFile(join(vaultRoot, ENTRY_RELATIVE_PATH), original, "utf8");
    await service.rescan();
    expect(events).toHaveLength(1);
  });

  it("recovers a persisted draft and detects an external file change", async () => {
    const vaultRoot = await createFixtureVault();
    let service = await openFixtureVault(vaultRoot);
    const original = await service.loadEntity(ENTRY_ID);
    service.saveDraft({
      entityId: ENTRY_ID,
      content: original.content.replace("# 実装開始", "# 未保存の編集"),
      baseHash: original.fileHash,
    });
    await service.close();
    openServices.splice(openServices.indexOf(service), 1);
    await writeFile(
      join(vaultRoot, ENTRY_RELATIVE_PATH),
      original.content.replace("# 実装開始", "# 外部編集"),
      "utf8",
    );

    service = await openFixtureVault(vaultRoot);
    const recovered = await service.loadEntity(ENTRY_ID);

    expect(recovered.content).toContain("# 外部編集");
    expect(recovered.draft?.content).toContain("# 未保存の編集");
    expect(recovered.hasExternalChange).toBe(true);
  });

  it("saves through the shared service, updates the index, and clears the draft", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);
    const original = await service.loadEntity(ENTRY_ID);

    const result = await service.saveEntity({
      entityId: ENTRY_ID,
      content: original.content.replace("# 実装開始", "# Desktopから更新"),
      expectedFileHash: original.fileHash,
    });

    expect(result.ok).toBe(true);
    expect(service.listDrafts()).toEqual([]);
    expect(service.searchEntities("Desktopから更新")).toHaveLength(1);
    const saved = await readFile(join(vaultRoot, ENTRY_RELATIVE_PATH), "utf8");
    expect(saved).toContain("updated_at: 2026-09-22T01:23:45.000Z");
  });

  it("keeps logical deletions as tombstones while hiding them from normal queries", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);
    const original = await service.loadEntity(ENTRY_ID);
    const deletedAt = "2026-09-22T01:23:45.000Z";
    const deleted = updateEntityMetadata(original.content, { deletedAt });

    const result = await service.saveEntity({
      entityId: ENTRY_ID,
      content: deleted.content,
      expectedFileHash: original.fileHash,
    });

    expect(result.ok).toBe(true);
    expect(
      service.listEntities().some((entity) => entity.id === ENTRY_ID),
    ).toBe(false);
    expect(service.searchEntities("実装開始")).toEqual([]);

    const tombstone = await service.loadEntity(ENTRY_ID);
    expect(tombstone.entity.deletedAt).toBe(deletedAt);
    expect(service.listEntities({ includeDeleted: true })).toContainEqual(
      expect.objectContaining({ id: ENTRY_ID, deletedAt }),
    );
    expect(service.listEntities({ onlyDeleted: true })).toEqual([
      expect.objectContaining({ id: ENTRY_ID, deletedAt }),
    ]);
    await expect(
      readFile(join(vaultRoot, ENTRY_RELATIVE_PATH), "utf8"),
    ).resolves.toContain(`deleted_at: ${deletedAt}`);
  });

  it("creates a canonical Entity file and indexes it", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);

    const created = await service.createEntity({
      type: "entry",
      displayName: "Desktopで作成",
    });

    expect(created.entity).toMatchObject({
      type: "entry",
      displayName: "Desktopで作成",
    });
    expect(created.entity.id).toMatch(/^ent_[0-9a-f-]+$/);
    expect(created.content).toContain("origin: human");
    expect(created.content).toContain("journal_date: 2026-09-22");
    expect(created.content).toContain("exclude_from_ai: false");
    expect(created.content).toContain("title: Desktopで作成");
    expect(created.content).not.toContain("# Desktopで作成");
    await expect(
      readFile(join(vaultRoot, created.entity.path), "utf8"),
    ).resolves.toBe(created.content);
    expect(service.searchEntities("Desktopで作成")).toHaveLength(1);
  });

  it("creates a titleless Entry for quick capture", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);

    const created = await service.createEntity({
      type: "entry",
      displayName: null,
      body: "- [ ] 牛乳を買う\n",
    });

    expect(created.entity.displayName).toBeNull();
    expect(created.content).toContain("title: null");
    expect(created.content).toContain("journal_date: 2026-09-22");
    expect(created.content).toMatch(/---\n- \[ \] 牛乳を買う\n$/);
    expect(service.searchEntities("牛乳を買う")).toHaveLength(1);
  });

  it("does not turn a Markdown heading into an Entry title", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);

    const created = await service.createEntity({
      type: "entry",
      displayName: null,
      body: "# 本文の見出し\n内容\n",
    });

    expect(created.entity.displayName).toBeNull();
    expect(created.content).toContain("title: null");
    expect(created.content).toMatch(/---\n# 本文の見出し\n内容\n$/);
    expect(
      service.listEntities().find((entity) => entity.id === created.entity.id)
        ?.displayName,
    ).toBeNull();
  });

  it("uses the Tokyo date at the UTC day boundary", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(
      vaultRoot,
      () => new Date("2026-09-22T15:05:00.000Z"),
    );

    const created = await service.createEntity({
      type: "entry",
      displayName: null,
      body: "境界時刻のメモ\n",
    });

    expect(created.content).toContain("journal_date: 2026-09-23");
  });

  it("queries Daily by journal_date and moves an Entry between dates", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);
    const created = await service.createEntity({
      type: "entry",
      displayName: "別の日のメモ",
      body: "Daily本文\n",
      journalDate: "2026-09-20",
    });
    expect(created.entity.journalDate).toBe("2026-09-20");
    expect(
      service.listJournalEntries("2026-09-20").map(({ id }) => id),
    ).toEqual([created.entity.id]);
    expect(service.listJournalEntries("2026-09-22")).toEqual([]);

    const moved = updateEntityMetadata(created.content, {
      journalDate: "2026-09-21",
    });
    const saved = await service.saveEntity({
      entityId: created.entity.id,
      content: moved.content,
      expectedFileHash: created.fileHash,
    });
    expect(saved.ok).toBe(true);
    expect(service.listJournalEntries("2026-09-20")).toEqual([]);
    expect(
      service.listJournalEntries("2026-09-21").map(({ id }) => id),
    ).toContain(created.entity.id);
    await expect(
      service.createEntity({
        type: "entry",
        displayName: null,
        journalDate: "2026-02-30",
      }),
    ).rejects.toThrow("Invalid journal date");
    expect(() => service.listJournalEntries("2026-02-30")).toThrow();
  });

  it("preserves all-day deadlines through save, reload, query and calendar projection", async () => {
    const service = await openFixtureVault(await createFixtureVault());
    const created = await service.createEntity({
      type: "task",
      displayName: "終日",
    });
    const updated = updateEntityMetadata(created.content, {
      dueAt: "2026-10-03",
    });
    expect(
      await service.saveEntity({
        entityId: created.entity.id,
        content: updated.content,
        expectedFileHash: created.fileHash,
      }),
    ).toMatchObject({ ok: true });
    expect((await service.loadEntity(created.entity.id)).entity.dueAt).toBe(
      "2026-10-03",
    );
    expect(
      service.queryEntities({ dueDate: "2026-10-03" }).items.map((e) => e.id),
    ).toContain(created.entity.id);
    expect(
      service.queryEntities({ dueDate: "2026-10-04" }).items.map((e) => e.id),
    ).not.toContain(created.entity.id);
    expect(service.calendarCounts("2026-10-03", "2026-10-04")).toEqual([
      { date: "2026-10-03", entries: 0, tasks: 1 },
    ]);
  });

  it("allows blank names for every Entity type and rejects multiline names", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);

    for (const type of [
      "entry",
      "task",
      "project",
      "resource",
      "topic",
      "area",
    ] as const) {
      const created = await service.createEntity({ type, displayName: "  " });
      expect(created.entity.displayName).toBeNull();
      expect(
        (await service.loadEntity(created.entity.id)).entity.displayName,
      ).toBeNull();
    }
    await expect(
      service.createEntity({ type: "task", displayName: "line one\nline two" }),
    ).rejects.toThrow("must be a single line");
    const task = await service.createEntity({
      type: "task",
      displayName: "Task",
      body: "本文",
    });
    expect(task.entity.body).toBe("本文");
    const updated = await service.patchBody(
      task.entity.id,
      "更新",
      task.fileHash,
    );
    expect(updated.ok).toBe(true);
    expect((await service.loadEntity(task.entity.id)).entity.body).toBe("更新");
  });

  it("creates schema-valid defaults for all Entity types", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);

    for (const type of [
      "entry",
      "project",
      "task",
      "resource",
      "topic",
      "area",
    ] as const) {
      const created = await service.createEntity({
        type,
        displayName: `New ${type}`,
      });
      expect(created.entity.type).toBe(type);
      expect(created.entity.createdAt).toBe("2026-09-22T01:23:45.000Z");
      expect(created.entity.updatedAt).toBe("2026-09-22T01:23:45.000Z");
    }

    expect(service.listEntities()).toHaveLength(12);
  });

  it("retains the draft and both versions on a hash conflict", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);
    const original = await service.loadEntity(ENTRY_ID);
    const external = original.content.replace("# 実装開始", "# 外部編集");
    await writeFile(join(vaultRoot, ENTRY_RELATIVE_PATH), external, "utf8");

    const result = await service.saveEntity({
      entityId: ENTRY_ID,
      content: original.content.replace("# 実装開始", "# Desktop編集"),
      expectedFileHash: original.fileHash,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "hash-conflict",
      actual: { content: external },
    });
    expect(service.listDrafts()[0]?.content).toContain("# Desktop編集");
    await expect(
      readFile(join(vaultRoot, ENTRY_RELATIVE_PATH), "utf8"),
    ).resolves.toBe(external);
  });

  it("resolves a save conflict by keeping the confirmed external version", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);
    const original = await service.loadEntity(ENTRY_ID);
    const external = original.content.replace("# 実装開始", "# 外部版を採用");
    await writeFile(join(vaultRoot, ENTRY_RELATIVE_PATH), external, "utf8");
    const conflict = await service.saveEntity({
      entityId: ENTRY_ID,
      content: original.content.replace("# 実装開始", "# Draft版"),
      expectedFileHash: original.fileHash,
    });
    if (conflict.ok || conflict.actual === null) {
      throw new Error("Expected an external save conflict");
    }

    const resolved = await service.resolveEntityConflict({
      entityId: ENTRY_ID,
      resolution: "keep-external",
      expectedExternalHash: conflict.actual.hash,
    });

    expect(resolved).toMatchObject({
      ok: true,
      resolution: "keep-external",
      document: { content: external, draft: null },
    });
    expect(service.listDrafts()).toEqual([]);
  });

  it("resolves a save conflict by atomically replacing the confirmed external version with the draft", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);
    const original = await service.loadEntity(ENTRY_ID);
    const external = original.content.replace("# 実装開始", "# 外部版");
    const draft = original.content.replace("# 実装開始", "# Draft版を採用");
    await writeFile(join(vaultRoot, ENTRY_RELATIVE_PATH), external, "utf8");
    const conflict = await service.saveEntity({
      entityId: ENTRY_ID,
      content: draft,
      expectedFileHash: original.fileHash,
    });
    if (conflict.ok || conflict.actual === null) {
      throw new Error("Expected an external save conflict");
    }

    const resolved = await service.resolveEntityConflict({
      entityId: ENTRY_ID,
      resolution: "keep-draft",
      expectedExternalHash: conflict.actual.hash,
    });

    expect(resolved).toMatchObject({
      ok: true,
      resolution: "keep-draft",
      document: { draft: null },
    });
    await expect(
      readFile(join(vaultRoot, ENTRY_RELATIVE_PATH), "utf8"),
    ).resolves.toContain("# Draft版を採用");
    expect(service.searchEntities("Draft版を採用")).toHaveLength(1);
  });

  it("keeps the draft when the external version changes again during conflict resolution", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);
    const original = await service.loadEntity(ENTRY_ID);
    await writeFile(
      join(vaultRoot, ENTRY_RELATIVE_PATH),
      original.content.replace("# 実装開始", "# 外部版1"),
      "utf8",
    );
    const conflict = await service.saveEntity({
      entityId: ENTRY_ID,
      content: original.content.replace("# 実装開始", "# Draft版"),
      expectedFileHash: original.fileHash,
    });
    if (conflict.ok || conflict.actual === null) {
      throw new Error("Expected an external save conflict");
    }
    await writeFile(
      join(vaultRoot, ENTRY_RELATIVE_PATH),
      original.content.replace("# 実装開始", "# 外部版2"),
      "utf8",
    );

    const raced = await service.resolveEntityConflict({
      entityId: ENTRY_ID,
      resolution: "keep-external",
      expectedExternalHash: conflict.actual.hash,
    });

    expect(raced).toMatchObject({ ok: false, reason: "hash-conflict" });
    if (raced.ok)
      throw new Error("Expected the resolution hash recheck to fail");
    expect(raced.actual?.content).toContain("# 外部版2");
    expect(raced.draftContent).toContain("# Draft版");
    expect(service.listDrafts()).toHaveLength(1);
  });

  it("can accept an external deletion without leaving a stale draft", async () => {
    const vaultRoot = await createFixtureVault();
    const service = await openFixtureVault(vaultRoot);
    const original = await service.loadEntity(ENTRY_ID);
    await rm(join(vaultRoot, ENTRY_RELATIVE_PATH));
    const conflict = await service.saveEntity({
      entityId: ENTRY_ID,
      content: original.content.replace("# 実装開始", "# Draft版"),
      expectedFileHash: original.fileHash,
    });
    expect(conflict).toMatchObject({ ok: false, actual: null });

    const resolved = await service.resolveEntityConflict({
      entityId: ENTRY_ID,
      resolution: "keep-external",
      expectedExternalHash: null,
    });

    expect(resolved).toEqual({
      ok: true,
      resolution: "keep-external",
      document: null,
    });
    expect(service.listDrafts()).toEqual([]);
    expect(service.listEntities()).toHaveLength(5);
  });

  it("opens a newer Vault read-only and refuses canonical writes", async () => {
    const vaultRoot = await createFixtureVault();
    await writeFile(
      join(vaultRoot, "vault.yaml"),
      "vault_id: 01997c2a-7b1c-7a01-8a10-000000000000\nschema_version: 2\n",
      "utf8",
    );
    const service = await openFixtureVault(vaultRoot);
    const document = await service.loadEntity(ENTRY_ID);

    expect(service.accessMode).toBe("read-only");
    const current = await service.loadEntity(ENTRY_ID);
    await expect(
      service.permanentlyDeleteEntity({
        entityId: ENTRY_ID,
        expectedFileHash: current.fileHash,
      }),
    ).rejects.toMatchObject({ code: "READ_ONLY_SCHEMA" });
    await expect(
      service.createEntity({ type: "entry", displayName: "作成不可" }),
    ).rejects.toMatchObject<Partial<LocalVaultError>>({
      code: "READ_ONLY_SCHEMA",
    });
    await expect(
      service.saveEntity({
        entityId: ENTRY_ID,
        content: document.content,
        expectedFileHash: document.fileHash,
      }),
    ).rejects.toMatchObject<Partial<LocalVaultError>>({
      code: "READ_ONLY_SCHEMA",
    });
  });
});
