import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import {
  createEntityId,
  parseMarkdownEntity,
  serializeMarkdownEntity,
  serializeNewMarkdownEntity,
  updateEntityMetadata,
} from "@pkm/core";
import { openLocalVault } from "./local-vault-service.js";
import { AgentVaultService } from "./agent-vault-service.js";
import { AgentOperationStore } from "./agent-operation-store.js";
const ENTRY = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
const TASK = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
const TOPIC = "topic_01997c2a-7b1c-7a01-8a10-000000000002";
const AREA = "area_01997c2a-7b1c-7a01-8a10-000000000001";
const PROJECT = "prj_01997c2a-7b1c-7a01-8a10-000000000003";
const additionalTypes = ["project", "resource", "topic", "area"] as const;
const cleanups: (() => Promise<void>)[] = [];
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "pkm-agent-"));
  await cp(
    fileURLToPath(new URL("../../../fixtures/vault-v1/", import.meta.url)),
    root,
    { recursive: true },
  );
  const vault = await openLocalVault(root, { watch: false });
  let store = new AgentOperationStore(join(root, ".pkm/agent-state.sqlite"));
  let agent = new AgentVaultService(vault, store);
  cleanups.push(async () => {
    await store.close();
    await vault.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    vault,
    get agent() {
      return agent;
    },
    store,
    restart: async () => {
      await store.close();
      store = new AgentOperationStore(join(root, ".pkm/agent-state.sqlite"));
      agent = new AgentVaultService(vault, store);
    },
  };
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("creates, preserves, replaces and clears Resource body through AI commands", async () => {
  const f = await fixture();
  const body = `# AI summary\n[[project:${PROJECT}|根拠]]\n`;
  const created = await f.agent.execute(
    {
      kind: "create_resource",
      operationId: "resource-memo-create",
      displayName: "資料",
      body,
      authors: ["Author"],
    },
    "tester",
  );
  expect((await f.agent.read(created.entityId)).parsed.body).toBe(body);
  expect(
    f.vault
      .searchEntities("AI summary")
      .some((item) => item.id === created.entityId),
  ).toBe(true);
  expect(
    f.vault
      .getBacklinks(PROJECT)
      .some(
        (item) => item.sourceId === created.entityId && item.kind === "direct",
      ),
  ).toBe(true);
  const metadata = await f.agent.execute(
    {
      kind: "update_resource",
      operationId: "resource-memo-metadata",
      entityId: created.entityId,
      expectedFileHash: created.fileHash,
      patch: { description: "一行説明" },
    },
    "tester",
  );
  expect((await f.agent.read(created.entityId)).parsed.body).toBe(body);
  await expect(
    f.agent.execute(
      {
        kind: "update_resource",
        operationId: "resource-memo-stale",
        entityId: created.entityId,
        expectedFileHash: created.fileHash,
        patch: { body: "stale" },
      },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "HASH_CONFLICT" });
  const updated = await f.agent.execute(
    {
      kind: "update_resource",
      operationId: "resource-memo-update",
      entityId: created.entityId,
      expectedFileHash: metadata.fileHash,
      patch: { body: "改訂した全般メモ\n" },
    },
    "tester",
  );
  expect((await f.agent.read(created.entityId)).parsed).toMatchObject({
    body: "改訂した全般メモ\n",
    entity: { authors: ["Author"], description: "一行説明" },
  });
  await f.agent.execute(
    {
      kind: "update_resource",
      operationId: "resource-memo-clear",
      entityId: created.entityId,
      expectedFileHash: updated.fileHash,
      patch: { body: "" },
    },
    "tester",
  );
  expect((await f.agent.read(created.entityId)).parsed.body).toBe("");
  await expect(
    f.agent.execute(
      {
        kind: "create_resource",
        operationId: "resource-memo-missing-ref",
        displayName: "missing",
        body: `[[entry:${createEntityId("entry")}]]`,
      },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it.each(additionalTypes)(
  "creates and edits %s with durable replay and metadata preservation",
  async (type) => {
    const f = await fixture();
    const input = {
      kind: `create_${type}`,
      operationId: `create-${type}`,
      displayName: `New ${type}`,
      description: "Initial description",
      body: "Initial body",
      ...(type !== "topic" ? { topics: [TOPIC] } : {}),
      ...(type === "project" ? { areaId: AREA, priority: "high" } : {}),
      ...(type === "resource"
        ? {
            authors: ["Author"],
            relatedEntityIds: [PROJECT],
            canonicalIdentifier: "resource-001",
            sourceUri: "https://example.com/original",
          }
        : {}),
    };
    expect(await f.agent.validate(input)).toMatchObject({
      valid: true,
      entityType: type,
    });
    expect(f.vault.listEntities()).toHaveLength(6);
    const [created, duplicate] = await Promise.all([
      f.agent.execute(input, "tester"),
      f.agent.execute(input, "tester"),
    ]);
    expect(duplicate).toMatchObject({
      entityId: created.entityId,
      replayed: true,
    });
    expect(f.vault.listEntities()).toHaveLength(7);
    const initial = await f.agent.read(created.entityId);
    expect(initial.parsed.body).toBe("Initial body");
    expect(initial.parsed.entity).toMatchObject({
      type,
      description: "Initial description",
    });
    if (type === "project")
      expect(initial.parsed.entity).toMatchObject({
        status: "not_started",
        area_id: AREA,
        priority: "high",
      });
    if (type === "resource")
      expect(initial.parsed.entity).toMatchObject({
        authors: ["Author"],
        related_entity_ids: [PROJECT],
        canonical_identifier: "resource-001",
        source_uri: "https://example.com/original",
      });
    await f.restart();
    expect((await f.agent.execute(input, "tester")).replayed).toBe(true);
    await expect(
      f.agent.execute({ ...input, displayName: "Different intent" }, "tester"),
    ).rejects.toMatchObject({ code: "OPERATION_ID_REUSED" });

    const file = await f.vault.loadEntity(created.entityId);
    await writeFile(
      join(f.root, file.entity.path),
      file.content.replace("type:", "x_custom: preserved\ntype:"),
    );
    const before = await f.agent.read(created.entityId);
    const update = {
      kind: `update_${type}`,
      operationId: `update-${type}`,
      entityId: created.entityId,
      expectedFileHash: before.fileHash,
      patch: {
        displayName: `Edited ${type}`,
        description: null,
        body: "Edited body",
        ...(type === "project"
          ? { status: "done", areaId: null, priority: null }
          : {}),
        ...(type === "resource"
          ? {
              authors: null,
              relatedEntityIds: [],
              canonicalIdentifier: null,
              sourceUri: null,
            }
          : {}),
      },
    };
    await f.agent.execute(update, "tester");
    expect((await f.agent.execute(update, "tester")).replayed).toBe(true);
    const next = await f.agent.read(created.entityId);
    expect(next.parsed.body).toBe("Edited body");
    expect(next.parsed.entity).toMatchObject({
      description: null,
      x_custom: "preserved",
      created_at: initial.parsed.entity.created_at,
    });
    expect((await f.agent.dto(next)).title).toBe(`Edited ${type}`);
    if (type !== "topic") expect(next.parsed.entity.topics).toEqual([TOPIC]);
    if (type === "project") {
      expect(next.parsed.entity).toMatchObject({
        status: "done",
        area_id: null,
        priority: null,
        completed_at: next.parsed.entity.updated_at,
      });
      await f.agent.execute(
        {
          ...update,
          operationId: "project-reopen",
          expectedFileHash: next.fileHash,
          patch: { status: "in_progress" },
        },
        "tester",
      );
      expect(
        (await f.agent.read(created.entityId)).parsed.entity.completed_at,
      ).toBeNull();
    }
    if (type === "resource")
      expect(next.parsed.entity).toMatchObject({
        authors: null,
        related_entity_ids: [],
        canonical_identifier: null,
        source_uri: null,
      });
  },
);

it.each(additionalTypes)(
  "protects %s edits from stale hashes, drafts, wrong types and unavailable files",
  async (type) => {
    const f = await fixture();
    const created = await f.agent.execute(
      {
        kind: `create_${type}`,
        operationId: `protected-${type}`,
        displayName: "Protected",
      },
      "tester",
    );
    const update = {
      kind: `update_${type}`,
      operationId: `stale-${type}`,
      entityId: created.entityId,
      expectedFileHash: `sha256:${"0".repeat(64)}`,
      patch: { displayName: "Changed" },
    };
    await expect(f.agent.execute(update, "tester")).rejects.toMatchObject({
      code: "HASH_CONFLICT",
    });
    const entry = await f.agent.read(ENTRY);
    await expect(
      f.agent.execute(
        {
          ...update,
          operationId: `wrong-${type}`,
          entityId: ENTRY,
          expectedFileHash: entry.fileHash,
        },
        "tester",
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    f.vault.saveDraft({
      entityId: created.entityId,
      baseHash: (await f.agent.read(created.entityId)).fileHash,
      content: "Human draft",
    });
    await expect(
      f.agent.execute(
        {
          ...update,
          operationId: `draft-${type}`,
          expectedFileHash: created.fileHash,
        },
        "tester",
      ),
    ).rejects.toMatchObject({ code: "LOCAL_DRAFT_PRESENT" });
    expect((await f.vault.loadEntity(created.entityId)).draft?.content).toBe(
      "Human draft",
    );
    f.vault.discardDraft(created.entityId);
    const file = await f.vault.loadEntity(created.entityId);
    const conflictPath = join(
      f.root,
      file.entity.path.replace(
        /\.md$/,
        ".sync-conflict-20261005-120000-abc.md",
      ),
    );
    await writeFile(conflictPath, file.content);
    await expect(
      f.agent.execute(
        {
          ...update,
          operationId: `conflict-${type}`,
          expectedFileHash: file.fileHash,
        },
        "tester",
      ),
    ).rejects.toMatchObject({ code: "ENTITY_CONFLICT" });
    await rm(conflictPath);
    await writeFile(
      join(f.root, file.entity.path),
      updateEntityMetadata(file.content, {
        deletedAt: new Date().toISOString(),
      }).content,
    );
    await expect(
      f.agent.execute(
        {
          ...update,
          operationId: `deleted-${type}`,
          expectedFileHash: file.fileHash,
        },
        "tester",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  },
);

it.each(additionalTypes)(
  "recovers a %s creation interrupted after saving without creating a duplicate",
  async (type) => {
    const f = await fixture();
    const write = f.vault.writeAgentEntity.bind(f.vault);
    vi.spyOn(f.vault, "writeAgentEntity").mockImplementationOnce(
      async (...args) => {
        await write(...args);
        throw new Error("interrupted");
      },
    );
    const input = {
      kind: `create_${type}`,
      operationId: `interrupted-${type}`,
      displayName: "Durable",
      ...(type === "project" ? { status: "done" } : {}),
    };
    await expect(f.agent.execute(input, "tester")).rejects.toThrow(
      "interrupted",
    );
    await f.restart();
    expect((await f.agent.execute(input, "tester")).replayed).toBe(true);
    expect(f.vault.listEntities()).toHaveLength(7);
  },
);

it("rejects unavailable and invalid relationships when creating or updating other Entities", async () => {
  const f = await fixture();
  const unavailableTopic = createEntityId("topic");
  for (const type of ["project", "resource", "area"] as const) {
    await expect(
      f.agent.execute(
        {
          kind: `create_${type}`,
          operationId: `missing-topic-${type}`,
          displayName: "Invalid",
          topics: [unavailableTopic],
        },
        "tester",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
  await expect(
    f.agent.execute(
      {
        kind: "create_project",
        operationId: "missing-area",
        displayName: "Invalid",
        areaId: createEntityId("area"),
      },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    f.agent.execute(
      {
        kind: "create_resource",
        operationId: "missing-related",
        displayName: "Invalid",
        relatedEntityIds: [createEntityId("task")],
      },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const file = await f.vault.loadEntity(PROJECT);
  await writeFile(
    join(f.root, file.entity.path),
    updateEntityMetadata(file.content, { deletedAt: new Date().toISOString() })
      .content,
  );
  await expect(
    f.agent.execute(
      {
        kind: "create_resource",
        operationId: "deleted-related",
        displayName: "Invalid",
        relatedEntityIds: [PROJECT],
      },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const created = await f.agent.execute(
    {
      kind: "create_resource",
      operationId: "valid-resource",
      displayName: "Valid",
    },
    "tester",
  );
  const update = {
    kind: "update_resource",
    operationId: "invalid-resource",
    entityId: created.entityId,
    expectedFileHash: created.fileHash,
  };
  await expect(
    f.agent.execute(
      { ...update, patch: { relatedEntityIds: [created.entityId] } },
      "tester",
    ),
  ).rejects.toThrow();
  await expect(
    f.agent.execute(
      { ...update, patch: { relatedEntityIds: [PROJECT] } },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await f.agent.read(created.entityId)).fileHash).toBe(
    created.fileHash,
  );
});

it("rechecks canonical visibility before returning stale search snippets", async () => {
  const f = await fixture();
  expect((await f.agent.search({ q: "実装開始" })).items).toHaveLength(1);
  const original = await readFile(join(f.root, `entries/${ENTRY}.md`), "utf8");
  await writeFile(
    join(f.root, `entries/${ENTRY}.md`),
    updateEntityMetadata(original, { excludeFromAi: true }).content,
  );
  await expect(f.agent.read(ENTRY)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect((await f.agent.search({ q: "実装開始" })).items).toEqual([]);
  await f.vault.rescan();
  const page = await f.agent.search({ limit: 50 });
  expect(page.items.some((e) => e.id === ENTRY)).toBe(false);
});
it("hides deleted, invalid and conflicted Entities even before the watcher runs", async () => {
  const f = await fixture();
  const path = join(f.root, `entries/${ENTRY}.md`);
  const original = await readFile(path, "utf8");
  await writeFile(
    path,
    updateEntityMetadata(original, { deletedAt: new Date().toISOString() })
      .content,
  );
  await expect(f.agent.read(ENTRY)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await writeFile(path, "invalid secret text");
  await expect(f.agent.read(ENTRY)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await writeFile(path, original);
  await writeFile(
    join(f.root, `entries/${ENTRY}.sync-conflict-20261004-120000-abc.md`),
    original,
  );
  await expect(f.agent.read(ENTRY)).rejects.toMatchObject({
    code: "ENTITY_CONFLICT",
  });
  expect((await f.agent.search({ type: "entry" })).items).toEqual([]);
});
it("hides uncurated derivatives transitively and fails closed on cycles", async () => {
  const f = await fixture();
  const first = await f.agent.execute(
    {
      kind: "create_entry",
      operationId: "derived-one",
      body: "derived",
      sourceEntityIds: [ENTRY],
    },
    "tester",
  );
  const second = await f.agent.execute(
    {
      kind: "create_entry",
      operationId: "derived-two",
      sourceEntityIds: [first.entityId],
    },
    "tester",
  );
  const source = await f.vault.loadEntity(ENTRY);
  await writeFile(
    join(f.root, source.entity.path),
    updateEntityMetadata(source.content, { excludeFromAi: true }).content,
  );
  await expect(f.agent.read(first.entityId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(f.agent.read(second.entityId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const parsed = parseMarkdownEntity(
    (await f.vault.loadEntity(first.entityId)).content,
  );
  if (!parsed.ok || parsed.value.entity.type !== "entry")
    throw new Error("fixture");
  await writeFile(
    join(f.root, `entries/${first.entityId}.md`),
    serializeMarkdownEntity(parsed.value, {
      entity: {
        ...parsed.value.entity,
        source_entity_ids: [first.entityId] as never,
      },
    }),
  );
  await expect(f.agent.read(first.entityId)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("sanitizes hidden relationships and unknown fields without exposing paths or drafts", async () => {
  const f = await fixture();
  const hidden = await f.vault.createEntity({
    type: "entry",
    displayName: "hidden secret",
    metadata: { excludeFromAi: true },
  });
  const target = await f.vault.loadEntity(ENTRY);
  const parsed = parseMarkdownEntity(target.content);
  if (!parsed.ok || parsed.value.entity.type !== "entry")
    throw new Error("fixture");
  const content = serializeNewMarkdownEntity({
    ...parsed.value.entity,
    secret_extension: "DO_NOT_LEAK",
    source_entity_ids: [hidden.entity.id] as never,
  });
  await writeFile(join(f.root, target.entity.path), content);
  f.vault.saveDraft({
    entityId: ENTRY,
    baseHash: target.fileHash,
    content: "DRAFT_SECRET",
  });
  const dto = await f.agent.dto(await f.agent.read(ENTRY));
  expect(dto.metadata.source_entity_ids).toEqual([]);
  expect(JSON.stringify(dto)).not.toMatch(
    /DO_NOT_LEAK|DRAFT_SECRET|hidden secret|entries\//,
  );
});
it("preserves unknown metadata and human origin while applying direct updates", async () => {
  const f = await fixture();
  const original = await f.vault.loadEntity(ENTRY);
  await writeFile(
    join(f.root, original.entity.path),
    original.content.replace(
      "origin: human",
      "origin: human\nx_custom: keep-me",
    ),
  );
  const snapshot = await f.agent.read(ENTRY);
  const result = await f.agent.execute(
    {
      kind: "update_entry",
      operationId: "direct-entry",
      entityId: ENTRY,
      expectedFileHash: snapshot.fileHash,
      patch: { body: "updated body", displayName: "updated title" },
    },
    "tester",
  );
  const next = await f.vault.loadEntity(ENTRY);
  expect(next.content).toContain("x_custom: keep-me");
  expect(next.content).toContain("origin: human");
  expect(next.content).toContain("updated body");
  expect(next.fileHash).toBe(result.fileHash);
  expect(next.draft).toBeNull();
});
it("preserves a human draft and rejects stale hashes and protected fields", async () => {
  const f = await fixture();
  const snapshot = await f.agent.read(ENTRY);
  f.vault.saveDraft({
    entityId: ENTRY,
    baseHash: snapshot.fileHash,
    content: "unsaved user text",
  });
  const update = {
    kind: "update_entry",
    operationId: "draft-block",
    entityId: ENTRY,
    expectedFileHash: snapshot.fileHash,
    patch: { body: "agent text" },
  };
  await expect(f.agent.execute(update, "tester")).rejects.toMatchObject({
    code: "LOCAL_DRAFT_PRESENT",
  });
  expect((await f.vault.loadEntity(ENTRY)).draft?.content).toBe(
    "unsaved user text",
  );
  expect((await f.agent.read(ENTRY)).fileHash).toBe(snapshot.fileHash);
  f.vault.discardDraft(ENTRY);
  await expect(
    f.agent.execute(
      {
        ...update,
        operationId: "stale-hash",
        expectedFileHash: `sha256:${"0".repeat(64)}`,
      },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "HASH_CONFLICT" });
  expect(() =>
    f.agent.execute({ ...update, patch: { excludeFromAi: false } }, "tester"),
  ).toThrow();
});
it("applies Task, context and explicit Topic changes through the same command path", async () => {
  const f = await fixture();
  const snapshot = await f.agent.read(TASK);
  await f.agent.execute(
    {
      kind: "update_task",
      operationId: "task-done",
      entityId: TASK,
      expectedFileHash: snapshot.fileHash,
      patch: { status: "done", body: "Task note" },
    },
    "tester",
  );
  expect((await f.agent.read(TASK)).parsed.entity.completed_at).toBeTruthy();
  expect((await f.agent.read(TASK)).parsed.body).toBe("Task note");
  const created = await f.agent.execute(
    {
      kind: "create_task",
      operationId: "task-new",
      displayName: "New task",
      projectId: "prj_01997c2a-7b1c-7a01-8a10-000000000003",
      priority: "high",
      body: "New task note",
      topics: [TOPIC],
    },
    "tester",
  );
  expect((await f.agent.read(created.entityId)).parsed.entity.priority).toBe(
    "high",
  );
  expect((await f.agent.read(created.entityId)).parsed.body).toBe(
    "New task note",
  );
  let current = await f.agent.read(ENTRY);
  await f.agent.execute(
    {
      kind: "update_topics",
      operationId: "topic-remove",
      entityId: ENTRY,
      expectedFileHash: current.fileHash,
      remove: [TOPIC],
    },
    "tester",
  );
  current = await f.agent.read(ENTRY);
  expect(current.parsed.entity.topics).toEqual([]);
  await f.agent.execute(
    {
      kind: "set_entry_context",
      operationId: "context-clear",
      entityId: ENTRY,
      expectedFileHash: current.fileHash,
      contexts: null,
    },
    "tester",
  );
  expect((await f.agent.read(ENTRY)).parsed.entity.contexts).toBeNull();
});
it("validates referenced targets before creating Entities", async () => {
  const f = await fixture();
  await expect(
    f.agent.execute(
      {
        kind: "create_entry",
        operationId: "bad-source",
        sourceEntityIds: [createEntityId("entry")],
      },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(f.vault.listEntities({ includeDeleted: true })).toHaveLength(6);
});
it("serializes duplicate calls, persists replay across restart, and rejects operation ID reuse", async () => {
  const f = await fixture();
  const input = {
    kind: "create_entry",
    operationId: "create-retry",
    body: "only once",
    sourceEntityIds: [ENTRY],
  };
  const [first, second] = await Promise.all([
    f.agent.execute(input, "tester"),
    f.agent.execute(input, "tester"),
  ]);
  expect(first.entityId).toBe(second.entityId);
  expect(second.replayed).toBe(true);
  const note = await f.agent.read(first.entityId);
  expect(note.parsed.entity.origin).toBe("ai");
  expect(note.parsed.entity.generated_at).toBeTruthy();
  expect(f.vault.listEntities()).toHaveLength(7);
  await f.restart();
  expect((await f.agent.execute(input, "tester")).entityId).toBe(
    first.entityId,
  );
  await expect(
    f.agent.execute({ ...input, body: "different" }, "tester"),
  ).rejects.toMatchObject({ code: "OPERATION_ID_REUSED" });
});
it("recovers a crash after the file write without creating another Entity", async () => {
  const f = await fixture();
  const original = f.vault.writeAgentEntity.bind(f.vault);
  vi.spyOn(f.vault, "writeAgentEntity").mockImplementationOnce(
    async (...args) => {
      await original(...args);
      throw new Error("simulated crash");
    },
  );
  const input = {
    kind: "create_entry",
    operationId: "crash-after-write",
    body: "durable",
  };
  await expect(f.agent.execute(input, "tester")).rejects.toThrow(
    "simulated crash",
  );
  await f.restart();
  expect((await f.agent.execute(input, "tester")).replayed).toBe(true);
  expect(f.vault.listEntities()).toHaveLength(7);
});
it("never overwrites an externally edited file while recovering a pending operation", async () => {
  const f = await fixture();
  const original = f.vault.writeAgentEntity.bind(f.vault);
  vi.spyOn(f.vault, "writeAgentEntity").mockImplementationOnce(
    async (...args) => {
      await original(...args);
      throw new Error("crash");
    },
  );
  const input = {
    kind: "create_entry",
    operationId: "crash-edited",
    body: "durable",
  };
  await expect(f.agent.execute(input, "tester")).rejects.toThrow("crash");
  const created = f.vault.listEntities().find((e) => e.origin === "ai")!;
  await writeFile(
    join(f.root, created.path),
    (await f.vault.loadEntity(created.id)).content + "user edit",
  );
  await f.restart();
  await expect(f.agent.execute(input, "tester")).rejects.toMatchObject({
    code: "OPERATION_RECOVERY_REQUIRED",
  });
  expect((await f.vault.loadEntity(created.id)).content).toContain("user edit");
});
it("rejects read-only services before persisting or modifying an Entity", async () => {
  const f = await fixture();
  const readOnly = new AgentVaultService(f.vault);
  await expect(
    readOnly.execute(
      { kind: "create_entry", operationId: "no-writer" },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "WRITE_DISABLED" });
});
it("validates a command without persisting an operation or creating a file", async () => {
  const f = await fixture();
  const result = await f.agent.validate({
    kind: "create_entry",
    operationId: "preflight",
    body: "preview",
  });
  expect(result).toEqual({
    valid: true,
    kind: "create_entry",
    entityType: "entry",
  });
  expect(f.vault.listEntities()).toHaveLength(6);
});
it("protects pagination cursors and returns each visible indexed Entity once", async () => {
  const f = await fixture();
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await f.agent.search({
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    if (cursor)
      expect(Buffer.from(cursor, "base64url").toString("utf8")).not.toContain(
        "01997c2a",
      );
  } while (cursor);
  expect(new Set(ids).size).toBe(6);
  await expect(f.agent.search({ cursor: "forged" })).rejects.toMatchObject({
    code: "INVALID_ARGUMENT",
  });
});
it("rejects body references to unavailable Entities before any write", async () => {
  const f = await fixture();
  const target = createEntityId("entry");
  await expect(
    f.agent.execute(
      {
        kind: "create_entry",
        operationId: "bad-body-ref",
        body: `[[entry:${target}|missing]]`,
      },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(f.vault.listEntities()).toHaveLength(6);
});

it("exposes date filters through agent search and preserves visibility policy", async () => {
  const f = await fixture();
  const query = {
    type: "entry",
    createdAt: { from: "2026-09-21T01:00:00Z", to: "2026-09-22T00:00:00Z" },
    journalDateRange: { from: "2026-09-21", to: "2026-09-22" },
  };
  expect((await f.agent.search(query)).items.map((item) => item.id)).toContain(
    ENTRY,
  );
  expect(
    (
      await f.agent.search({
        ...query,
        createdAt: { to: "2026-09-21T01:00:00Z" },
      })
    ).items.map((item) => item.id),
  ).not.toContain(ENTRY);
  const original = await readFile(join(f.root, `entries/${ENTRY}.md`), "utf8");
  await writeFile(
    join(f.root, `entries/${ENTRY}.md`),
    updateEntityMetadata(original, { excludeFromAi: true }).content,
  );
  expect(
    (await f.agent.search(query)).items.map((item) => item.id),
  ).not.toContain(ENTRY);
});

it("uploads once across concurrent calls and restarts, rejecting changed retries", async () => {
  const f = await fixture();
  const command = {
    operationId: "asset-upload-once",
    fileName: "資料[1].pdf",
    dataBase64: Buffer.from("file bytes").toString("base64"),
  };
  const [first, second] = await Promise.all([
    f.agent.uploadAsset(command, "tester"),
    f.agent.uploadAsset(command, "tester"),
  ]);
  expect(second).toEqual({ ...first, replayed: true });
  expect((await f.vault.readAsset(first.path)).data.toString()).toBe(
    "file bytes",
  );
  await f.restart();
  expect(await f.agent.uploadAsset(command, "tester")).toEqual(second);
  await expect(
    f.agent.uploadAsset({ ...command, fileName: "different.pdf" }, "tester"),
  ).rejects.toMatchObject({ code: "OPERATION_ID_REUSED" });
  await expect(
    f.agent.execute(
      { kind: "create_entry", operationId: command.operationId },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "OPERATION_ID_REUSED" });
  await writeFile(join(f.root, first.path), "external change");
  await expect(f.agent.uploadAsset(command, "tester")).rejects.toMatchObject({
    code: "OPERATION_RECOVERY_REQUIRED",
  });
  expect(await readFile(join(f.root, first.path), "utf8")).toBe(
    "external change",
  );
});

it.each([false, true])(
  "recovers a pending asset upload after restart (written: %s)",
  async (written) => {
    const f = await fixture();
    const create = f.vault.createAsset.bind(f.vault);
    vi.spyOn(f.vault, "createAsset").mockImplementationOnce(async (...args) => {
      if (written) await create(...args);
      throw new Error("interrupted before completion");
    });
    const command = {
      operationId: "asset-interrupted",
      fileName: "notes.txt",
      dataBase64: Buffer.from("recover me").toString("base64"),
    };
    await expect(f.agent.uploadAsset(command, "tester")).rejects.toThrow(
      "interrupted",
    );
    await f.restart();
    const recovered = await f.agent.uploadAsset(command, "tester");
    expect(recovered.replayed).toBe(written);
    expect((await f.vault.readAsset(recovered.path)).data.toString()).toBe(
      "recover me",
    );
    expect((await f.agent.uploadAsset(command, "tester")).replayed).toBe(true);
  },
);

it("attaches an uploaded asset to a Resource and checks existence before saving", async () => {
  const f = await fixture();
  const asset = await f.agent.uploadAsset(
    {
      operationId: "asset-for-resource",
      fileName: "notes.txt",
      dataBase64: Buffer.from("attachment").toString("base64"),
    },
    "tester",
  );
  const created = await f.agent.execute(
    {
      kind: "create_resource",
      operationId: "resource-with-asset",
      displayName: "With attachment",
      assetPath: asset.path,
    },
    "tester",
  );
  expect((await f.agent.read(created.entityId)).parsed.entity.asset_path).toBe(
    asset.path,
  );
  await expect(
    f.agent.execute(
      {
        kind: "create_resource",
        operationId: "resource-missing-asset",
        displayName: "Missing",
        assetPath: "assets/files/00000000-0000-0000-0000-000000000000.txt",
      },
      "tester",
    ),
  ).rejects.toMatchObject({ code: "ASSET_NOT_FOUND" });
  await f.agent.execute(
    {
      kind: "update_resource",
      operationId: "resource-detach-asset",
      entityId: created.entityId,
      expectedFileHash: created.fileHash,
      patch: { assetPath: null },
    },
    "tester",
  );
  expect(
    (await f.agent.read(created.entityId)).parsed.entity.asset_path,
  ).toBeNull();
  expect((await f.vault.readAsset(asset.path)).data.toString()).toBe(
    "attachment",
  );
});
