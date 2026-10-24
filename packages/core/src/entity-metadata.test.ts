import { describe, expect, it } from "vitest";

import { updateEntityMetadata } from "./entity-metadata.js";
import { parseMarkdownEntity } from "./markdown-parser.js";

const taskSource = `---
id: tsk_01997c2a-7b1c-7a01-8a10-000000000004
type: task
title: Before
status: not_started
priority: normal
project_id: null
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
x-plugin:
  keep: true
---
# Body

Do not rewrite this body.
`;

describe("updateEntityMetadata", () => {
  it("sets and clears task deadlines, validates timestamps, and retains body", () => {
    const updated = updateEntityMetadata(taskSource, {
      dueAt: "2026-10-03T10:00:00+09:00",
    });
    expect(updated.entity).toMatchObject({
      due_at: "2026-10-03T10:00:00+09:00",
    });
    expect(updated.content).toContain("x-plugin:\n  keep: true");
    expect(
      updated.content.endsWith("# Body\n\nDo not rewrite this body.\n"),
    ).toBe(true);
    expect(
      updateEntityMetadata(updated.content, { dueAt: null }).entity,
    ).toMatchObject({ due_at: null });
    expect(
      updateEntityMetadata(taskSource, { dueAt: "2026-10-03" }).entity,
    ).toMatchObject({ due_at: "2026-10-03" });
    expect(() =>
      updateEntityMetadata(taskSource, { dueAt: "2026-02-30" }),
    ).toThrow("Metadata update is invalid");
    const project = taskSource
      .replace("type: task", "type: project")
      .replace("tsk_", "prj_");
    expect(() => updateEntityMetadata(project, { dueAt: null })).toThrow(
      "does not have a due_at",
    );
  });

  it("updates known fields while preserving unknown fields and body", () => {
    const updated = updateEntityMetadata(
      taskSource,
      {
        displayName: "After",
        status: "in_progress",
        priority: null,
      },
      { now: () => new Date("2026-09-22T01:23:45.000Z") },
    );

    expect(updated.entity).toMatchObject({
      title: "After",
      status: "in_progress",
      priority: null,
      "x-plugin": { keep: true },
    });
    expect(updated.content).toContain("x-plugin:\n  keep: true");
    expect(
      updated.content.endsWith("# Body\n\nDo not rewrite this body.\n"),
    ).toBe(true);
  });

  it("sets and clears completed_at when status crosses done", () => {
    const completed = updateEntityMetadata(
      taskSource,
      { status: "done" },
      { now: () => new Date("2026-09-22T01:23:45.000Z") },
    );
    expect(completed.entity).toMatchObject({
      status: "done",
      completed_at: "2026-09-22T01:23:45.000Z",
    });

    const reopened = updateEntityMetadata(completed.content, {
      status: "in_progress",
    });
    expect(reopened.entity).toMatchObject({
      status: "in_progress",
      completed_at: null,
    });
  });

  it("sets and clears the logical deletion timestamp", () => {
    const deleted = updateEntityMetadata(taskSource, {
      deletedAt: "2026-09-22T01:23:45.000Z",
    });
    expect(deleted.entity.deleted_at).toBe("2026-09-22T01:23:45.000Z");
    expect(deleted.content).toContain("deleted_at: 2026-09-22T01:23:45.000Z");

    const restored = updateEntityMetadata(deleted.content, {
      deletedAt: null,
    });
    expect(restored.entity.deleted_at).toBeNull();
  });

  it("updates Entry AI visibility without moving its heading", () => {
    const entrySource = `---
id: ent_01997c2a-7b1c-7a01-8a10-000000000006
type: entry
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
origin: human
exclude_from_ai: false
---
# Entry title
`;
    const updated = updateEntityMetadata(entrySource, {
      excludeFromAi: true,
    });

    expect(updated.entity).toMatchObject({ exclude_from_ai: true });
    expect(parseMarkdownEntity(updated.content)).toMatchObject({
      ok: true,
      value: { body: "# Entry title\n" },
    });
    const retitled = updateEntityMetadata(entrySource, {
      displayName: "新しいタイトル",
    });
    expect(retitled.entity).toMatchObject({ title: "新しいタイトル" });
    expect(retitled.content).toContain("title: 新しいタイトル");
    expect(parseMarkdownEntity(retitled.content)).toMatchObject({
      ok: true,
      value: { body: "# Entry title\n" },
    });
    expect(
      updateEntityMetadata(entrySource, { occurredAt: "2026-10-07" }).entity,
    ).toMatchObject({ occurred_at: "2026-10-07" });
    expect(() =>
      updateEntityMetadata(entrySource, { occurredAt: "2026-02-30" }),
    ).toThrow();
    const moved = updateEntityMetadata(entrySource, {
      journalDate: "2026-09-20",
    });
    expect(moved.entity).toMatchObject({ journal_date: "2026-09-20" });
    expect(() =>
      updateEntityMetadata(entrySource, { journalDate: "2026-02-30" }),
    ).toThrow("Invalid journal date");
    expect(() =>
      updateEntityMetadata(taskSource, { journalDate: "2026-09-20" }),
    ).toThrow(/does not have/);
  });

  it("updates relationship fields while preserving Task hierarchy rules", () => {
    const updated = updateEntityMetadata(taskSource, {
      projectId: "prj_01997c2a-7b1c-7a01-8a10-000000000003",
      areaId: "area_01997c2a-7b1c-7a01-8a10-000000000001",
      topics: ["topic_01997c2a-7b1c-7a01-8a10-000000000002"],
    });

    expect(updated.entity).toMatchObject({
      project_id: "prj_01997c2a-7b1c-7a01-8a10-000000000003",
      area_id: null,
      topics: ["topic_01997c2a-7b1c-7a01-8a10-000000000002"],
    });
  });

  it("updates Resource source identifiers", () => {
    const resourceSource = `---
id: res_01997c2a-7b1c-7a01-8a10-000000000005
type: resource
title: Paper
canonical_identifier: null
source_uri: null
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
---
`;
    const updated = updateEntityMetadata(resourceSource, {
      resourceType: "paper",
      canonicalIdentifier: "10.1145/example",
      sourceUri: "https://doi.org/10.1145/example",
      assetPath: "assets/files/01997c2a-7b1c-7a01-8a10-000000000099.pdf",
    });

    expect(updated.entity).toMatchObject({
      resource_type: "paper",
      canonical_identifier: "10.1145/example",
      source_uri: "https://doi.org/10.1145/example",
      asset_path: "assets/files/01997c2a-7b1c-7a01-8a10-000000000099.pdf",
    });
    expect(() =>
      updateEntityMetadata(taskSource, { resourceType: "book" }),
    ).toThrow(/does not have/);
    expect(
      updateEntityMetadata(updated.content, { resourceType: null }).entity,
    ).toMatchObject({ resource_type: null });
    expect(() =>
      updateEntityMetadata(resourceSource, { assetPath: "../vault.yaml" }),
    ).toThrow();
    expect(() =>
      updateEntityMetadata(taskSource, {
        assetPath: "assets/files/01997c2a-7b1c-7a01-8a10-000000000099.pdf",
      }),
    ).toThrow(/does not have/);
  });
});
