import { describe, expect, it, vi } from "vitest";
import type { PkmClient, PkmEntityDocument, PkmFileHash } from "@pkm/contracts";
import { parseMarkdownEntity } from "@pkm/core";

import {
  createEntityActions,
  creationContextPatch,
  creationSourceContextPatch,
  canCreateInContext,
} from "./entity-actions.js";
import { entityRelationTables } from "./entity-detail-view.js";

const entityId = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
const source = `---
id: ${entityId}
type: entry
title: 実装開始
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
origin: human
exclude_from_ai: false
custom_property: retain me
---

# 本文

- [ ] やること
`;
const hash: PkmFileHash = `sha256:${"a".repeat(64)}`;
const document: PkmEntityDocument = {
  entity: {
    id: entityId,
    type: "entry",
    path: `entries/${entityId}.md`,
    displayName: "実装開始",
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
    journalDate: "2026-09-21",
    occurredAt: null,
    dueAt: null,
    topicIds: [],
    createdAt: "2026-09-21T10:00:00+09:00",
    updatedAt: "2026-09-21T10:00:00+09:00",
    deletedAt: null,
    excludeFromAi: false,
    body: "",
  },
  content: source,
  fileHash: hash,
  draft: null,
  hasExternalChange: false,
};
const clientFor = (current: PkmEntityDocument = document) => ({
  loadEntity: vi.fn(() => Promise.resolve(current)),
  saveEntity: vi.fn<PkmClient["saveEntity"]>((request) =>
    Promise.resolve({
      ok: true,
      snapshot: { path: current.entity.path, hash, content: request.content },
    }),
  ),
});

describe("shared Entity editing", () => {
  it("passes deadlines through the guarded metadata save path", async () => {
    const taskContent = source
      .replace("type: entry", "type: task")
      .replace("ent_", "tsk_")
      .replace("title: 実装開始", "title: 実装開始\nstatus: not_started");
    const client = clientFor({ ...document, content: taskContent });
    await createEntityActions(client).updateMetadata(entityId, {
      dueAt: "2026-10-03T01:00:00Z",
    });
    const request = client.saveEntity.mock.calls[0]![0];
    expect(request.expectedFileHash).toBe(hash);
    expect(parseMarkdownEntity(request.content)).toMatchObject({
      ok: true,
      value: { entity: { due_at: "2026-10-03T01:00:00Z" } },
    });
  });

  it("blocks table edits when a saved draft exists", async () => {
    const client = clientFor({
      ...document,
      draft: {
        entityId,
        filePath: document.entity.path,
        baseHash: hash,
        content: "my draft",
        updatedAt: document.entity.updatedAt,
      },
    });
    await expect(
      createEntityActions(client).updateMetadata(entityId, {
        displayName: "new",
      }),
    ).rejects.toThrow("未保存draft");
    expect(client.saveEntity).not.toHaveBeenCalled();
  });

  it("saves table edits against the current hash while preserving the Markdown body", async () => {
    const client = clientFor();
    await createEntityActions(client).updateMetadata(entityId, {
      displayName: "改名",
    });
    const request = client.saveEntity.mock.calls[0]![0];
    expect(request.expectedFileHash).toBe(hash);
    const before = parseMarkdownEntity(source);
    const after = parseMarkdownEntity(request.content);
    expect(
      before.ok && after.ok && after.value.body === before.value.body,
    ).toBe(true);
    expect(after.ok && after.value.entity).toMatchObject({ title: "改名" });
  });

  it("rejects stale Timeline content before writing", async () => {
    const client = clientFor();
    await expect(
      createEntityActions(client).updateEntryBody(
        entityId,
        "old body",
        "new body",
      ),
    ).rejects.toThrow("別の編集");
    expect(client.saveEntity).not.toHaveBeenCalled();
  });

  it("keeps a hash conflict visible to the caller", async () => {
    const client = clientFor();
    client.saveEntity.mockResolvedValue({
      ok: false,
      reason: "hash-conflict",
      expectedFileHash: hash,
      actual: null,
      draftContent: source,
    });
    await expect(
      createEntityActions(client).updateMetadata(entityId, {
        displayName: "new",
      }),
    ).rejects.toThrow("外部更新と競合");
  });

  it("uses context only for supported Entity relationships", () => {
    const area = {
      ...document.entity,
      type: "area",
      id: "area_01997c2a-7b1c-7a01-8a10-000000000001",
    };
    expect(creationContextPatch("task", area)).toEqual({ areaId: area.id });
    expect(creationContextPatch("entry", area)).toEqual({
      entryContexts: { area: area.id },
    });
    for (const type of ["area", "project", "task", "resource"]) {
      const context = { ...area, type };
      expect(creationContextPatch("resource", context)).toEqual({
        relatedEntityIds: [context.id],
      });
    }
    expect(
      creationContextPatch("topic", { ...area, type: "topic" }),
    ).toBeNull();
  });

  it("supports creation in every context table and preserves Resource relationships", () => {
    for (const type of ["area", "project", "task", "resource", "topic"]) {
      const context = {
        ...document.entity,
        type,
        relatedEntityIds: ["existing"],
      };
      for (const table of entityRelationTables(context)) {
        expect(canCreateInContext(table.type, context)).toBe(true);
      }
    }
    const resource = {
      ...document.entity,
      type: "resource",
      relatedEntityIds: ["existing", "created"],
    };
    expect(creationSourceContextPatch("task", resource, "created")).toEqual({
      relatedEntityIds: ["existing", "created"],
    });
    expect(creationSourceContextPatch("entry", resource, "created")).toBeNull();
    expect(
      creationContextPatch("entry", { ...document.entity, type: "topic" }),
    ).toEqual({ topics: [entityId] });
  });
});
