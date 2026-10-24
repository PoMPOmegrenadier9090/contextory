import { describe, expect, it } from "vitest";
import { parseEntityPageQuery } from "@pkm/core";
import type { EntityPageQuery } from "@pkm/contracts";
import { IndexDatabase } from "./index-database.js";
import { queryIndexedEntityPage } from "./index-query.js";

const fixture = () => {
  const index = new IndexDatabase(":memory:");
  const add = (
    id: string,
    type: string,
    area: string | null = null,
    project: string | null = null,
    task: string | null = null,
    resource: string | null = null,
  ) =>
    index.database
      .prepare(
        `
    INSERT INTO entities(id,type,path,display_name,name_key,created_at,updated_at,body,exclude_from_ai,area_id,project_id,task_id,resource_id)
    VALUES(?,?,?, ?,?, '2026-10-12T00:00:00Z','2026-10-12T00:00:00Z','preview',0,?,?,?,?)
  `,
      )
      .run(id, type, `${id}.md`, id, id, area, project, task, resource);
  add("area", "area");
  add("other-area", "area");
  add("project", "project", "area");
  add("task", "task", null, "project");
  add("area-task", "task", "area");
  add("resource", "resource");
  add("topic", "topic");
  add("direct", "entry", "area");
  add("project-entry", "entry", null, "project");
  add("task-entry", "entry", null, null, "task");
  add("area-task-entry", "entry", null, null, "area-task");
  add("overridden", "entry", "other-area", null, "task");
  add("duplicate", "entry", "area", "project", "task");
  add("resource-entry", "entry", null, null, null, "resource");
  add("topic-entry", "entry");
  add("reference", "entry");
  add("child-reference", "entry");
  add("outgoing", "entry");
  add("related-entry", "entry");
  add("unrelated", "entry");
  const reference = (source: string, target: string, kind = "direct") =>
    index.database
      .prepare(
        "INSERT INTO entity_references(source_id,target_id,reference_kind) VALUES(?,?,?)",
      )
      .run(source, target, kind);
  reference("reference", "area");
  reference("duplicate", "area");
  reference("child-reference", "task");
  reference("area", "outgoing");
  reference("resource", "related-entry", "related");
  reference("reference", "resource");
  reference("reference", "topic");
  reference("reference", "direct");
  index.database
    .prepare("INSERT INTO entity_topics VALUES('topic-entry','topic')")
    .run();
  const query = (
    relatedTo = "area",
    mode: "direct" | "scoped" = "direct",
    extra: EntityPageQuery = {},
  ) =>
    queryIndexedEntityPage(index, {
      type: "entry",
      relatedTo,
      entryRelationMode: mode,
      sort: "createdAt",
      direction: "desc",
      ...extra,
    });
  return { index, query, add };
};

describe("Entity Entry relations", () => {
  it("distinguishes direct contexts and incoming references from hierarchy paths, without duplicate Entries", () => {
    const { index, query } = fixture();
    try {
      expect(query().items.map((e) => e.id)).toEqual([
        "reference",
        "duplicate",
        "direct",
      ]);
      const scoped = query("area", "scoped");
      expect(scoped.items.map((e) => e.id)).toEqual([
        "task-entry",
        "reference",
        "project-entry",
        "overridden",
        "duplicate",
        "direct",
        "child-reference",
        "area-task-entry",
      ]);
      expect(
        scoped.items.find((e) => e.id === "duplicate")?.entryRelation?.kind,
      ).toBe("direct");
      expect(
        scoped.items.find((e) => e.id === "task-entry")?.entryRelation,
      ).toEqual({
        kind: "inherited",
        path: [
          { id: "area", type: "area", displayName: "area" },
          { id: "project", type: "project", displayName: "project" },
          { id: "task", type: "task", displayName: "task" },
        ],
      });
      expect(query("project").items.map((e) => e.id)).toEqual([
        "project-entry",
        "duplicate",
      ]);
      expect(query("project", "scoped").items.map((e) => e.id)).toEqual([
        "task-entry",
        "project-entry",
        "overridden",
        "duplicate",
        "child-reference",
      ]);
    } finally {
      index.close();
    }
  });
  it("supports direct Task, Resource, Topic and Entry relations without traversing references", () => {
    const { index, query } = fixture();
    try {
      for (const mode of ["direct", "scoped"] as const) {
        expect(query("task", mode).items.map((e) => e.id)).toEqual([
          "task-entry",
          "overridden",
          "duplicate",
          "child-reference",
        ]);
        expect(query("resource", mode).items.map((e) => e.id)).toEqual([
          "resource-entry",
          "related-entry",
          "reference",
        ]);
        expect(query("topic", mode).items.map((e) => e.id)).toEqual([
          "topic-entry",
          "reference",
        ]);
        expect(query("direct", mode).items.map((e) => e.id)).toEqual([
          "reference",
        ]);
      }
    } finally {
      index.close();
    }
  });
  it("filters deleted intermediate Entities and Entries, and responds to restoration and hierarchy changes", () => {
    const { index, query } = fixture();
    try {
      index.database
        .prepare(
          "UPDATE entities SET deleted_at='2026-10-12' WHERE id IN ('task','direct')",
        )
        .run();
      expect(query("area", "scoped").items.map((e) => e.id)).toEqual([
        "reference",
        "project-entry",
        "duplicate",
        "area-task-entry",
      ]);
      index.database
        .prepare(
          "UPDATE entities SET deleted_at=NULL WHERE id IN ('task','direct')",
        )
        .run();
      expect(query("area", "scoped").items.map((e) => e.id)).toContain(
        "task-entry",
      );
      index.database
        .prepare("UPDATE entities SET area_id='other-area' WHERE id='project'")
        .run();
      expect(query("area", "scoped").items.map((e) => e.id)).toEqual([
        "reference",
        "duplicate",
        "direct",
        "area-task-entry",
      ]);
      index.database
        .prepare("UPDATE entities SET deleted_at='2026-10-12' WHERE id='area'")
        .run();
      expect(query("area", "scoped").items).toEqual([]);
    } finally {
      index.close();
    }
  });
  it("pages after filtering, ties cursors to the relation mode and bounds previews", () => {
    const { index, query, add } = fixture();
    try {
      for (let i = 0; i < 60; i++)
        add(`paged-${String(i).padStart(3, "0")}`, "entry", null, null, "task");
      const all = query("area", "scoped", { limit: 100 }).items.map(
        (e) => e.id,
      );
      const paged: string[] = [];
      let cursor: string | undefined;
      do {
        const page = query("area", "scoped", {
          limit: 7,
          ...(cursor ? { cursor } : {}),
        });
        paged.push(...page.items.map((e) => e.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(paged).toEqual(all);
      const first = query("area", "scoped", { limit: 1 });
      expect(() =>
        query("area", "direct", { cursor: first.nextCursor! }),
      ).toThrow("cursor");
      index.database
        .prepare("UPDATE entities SET body=? WHERE id='task-entry'")
        .run("本文".repeat(2000));
      expect(
        query("area", "scoped", { view: "timeline" }).items.find(
          (e) => e.id === "task-entry",
        ),
      ).toMatchObject({ bodyTruncated: true, body: "本文".repeat(600) });
      expect(query("area", "scoped").items.every((e) => e.body === "")).toBe(
        true,
      );
    } finally {
      index.close();
    }
  });
  it("preserves AI exclusions for both results and intermediate Entities", () => {
    const { index } = fixture();
    try {
      index.database
        .prepare(
          "UPDATE entities SET exclude_from_ai=1 WHERE id IN ('task','direct')",
        )
        .run();
      const items = queryIndexedEntityPage(
        index,
        { type: "entry", relatedTo: "area", entryRelationMode: "scoped" },
        { forAi: true },
      ).items;
      expect(items.map((e) => e.id)).not.toContain("direct");
      expect(items.map((e) => e.id)).not.toContain("task-entry");
      expect(items.map((e) => e.id)).not.toContain("child-reference");
    } finally {
      index.close();
    }
  });
  it("rejects incomplete relation queries", () => {
    expect(() =>
      parseEntityPageQuery({ entryRelationMode: "direct", relatedTo: "area" }),
    ).toThrow();
    expect(() =>
      parseEntityPageQuery({ type: "entry", entryRelationMode: "scoped" }),
    ).toThrow();
    expect(() =>
      parseEntityPageQuery({
        type: "entry",
        relatedTo: "area",
        entryRelationMode: "direct",
        deleted: "only",
      }),
    ).toThrow();
    expect(
      parseEntityPageQuery({
        type: "entry",
        relatedTo: "area",
        entryRelationMode: "direct",
      }),
    ).toMatchObject({ entryRelationMode: "direct" });
  });
});
