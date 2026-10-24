import { afterEach, describe, expect, it } from "vitest";
import { IndexDatabase } from "./index-database.js";
import { queryIndexedEntityPage } from "./index-query.js";
import { resolveRelatedEntities } from "./related-entities.js";

let index: IndexDatabase;
afterEach(() => index?.close());
const setup = () => {
  index = new IndexDatabase(":memory:");
  const entity = (id: string, type: string, deleted = false) =>
    index.database
      .prepare(
        `INSERT INTO entities(id,type,path,display_name,created_at,updated_at,body,exclude_from_ai,deleted_at)
    VALUES (?,?,?,?,'2026-10-12T00:00:00Z','2026-10-12T00:00:00Z','本文',0,?)`,
      )
      .run(id, type, `${id}.md`, id, deleted ? "2026-10-12T01:00:00Z" : null);
  const link = (source: string, target: string, kind: string) =>
    index.database
      .prepare(
        "INSERT INTO entity_references(source_id,target_id,reference_kind) VALUES (?,?,?)",
      )
      .run(source, target, kind);
  const ids = (
    root: string,
    resolution: "direct" | "transitive",
    type?: "entry" | "task" | "project",
  ) =>
    queryIndexedEntityPage(index, {
      relatedTo: root,
      relatedResolution: resolution,
      ...(type ? { type } : {}),
    }).items.map((e) => e.id);
  return { entity, link, ids };
};
describe("related Entity resolution", () => {
  it("aggregates every structured path without changing effective Context precedence", () => {
    const { entity, link, ids } = setup();
    entity("area", "area");
    entity("p", "project");
    entity("q", "project");
    entity("t", "task");
    entity("e", "entry");
    link("p", "area", "parent");
    link("t", "p", "parent");
    link("e", "t", "context");
    link("e", "q", "context");
    expect(ids("p", "direct", "entry")).toEqual([]);
    expect(ids("p", "transitive", "entry")).toEqual(["e"]);
    expect(ids("q", "direct", "entry")).toEqual(["e"]);
    const result = queryIndexedEntityPage(index, {
      relatedTo: "area",
      relatedResolution: "transitive",
      type: "entry",
    }).items[0]!;
    expect(result.relatedVia?.via.map((e) => e.id)).toEqual(["p", "t"]);
    expect(ids("area", "transitive", "task")).toEqual(["t"]);
  });
  it("includes insertion links only at the root, never as seeds or final indirect edges", () => {
    const { entity, link, ids } = setup();
    entity("r", "resource");
    entity("p", "project");
    entity("t", "task");
    entity("e", "entry");
    entity("body", "entry");
    link("p", "r", "direct");
    link("t", "p", "parent");
    link("e", "t", "context");
    link("body", "t", "direct");
    expect(ids("r", "transitive")).toEqual(["p"]);
    expect(ids("p", "transitive", "entry")).toEqual(["e"]);
    expect(ids("t", "direct", "entry")).toEqual(["body", "e"]);
    link("e", "r", "direct");
    link("e", "r", "direct");
    expect(ids("r", "direct", "entry")).toEqual(["e"]);
    expect(ids("r", "transitive", "entry")).toEqual(["e"]);
  });
  it("expands structured Topics and inbound Resource relations but not outgoing relations", () => {
    const { entity, link, ids } = setup();
    entity("topic", "topic");
    entity("p", "project");
    entity("t", "task");
    entity("r", "resource");
    entity("e", "entry");
    link("p", "topic", "topic");
    link("t", "p", "parent");
    link("r", "t", "related");
    link("e", "r", "context");
    expect(ids("topic", "direct")).toEqual(["p"]);
    expect(ids("topic", "transitive", "entry")).toEqual(["e"]);
    expect(ids("r", "transitive", "task")).toEqual(["t"]);
    expect(ids("r", "transitive", "project")).toEqual([]);
    expect(ids("r", "transitive", "entry")).toEqual(["e"]);
  });
  it("deduplicates cyclic and repeated Resource paths and stops at Entries", () => {
    const { entity, link, ids } = setup();
    entity("a", "resource");
    entity("b", "resource");
    entity("e", "entry");
    entity("other", "entry");
    link("a", "b", "related");
    link("b", "a", "related");
    link("b", "a", "related");
    link("e", "b", "context");
    link("other", "e", "direct");
    expect(ids("a", "transitive")).toEqual(["b", "e"]);
    expect(ids("e", "transitive")).toEqual(["other"]);
  });
  it("does not traverse deleted, unresolved or AI-excluded intermediates", () => {
    const { entity, link, ids } = setup();
    entity("p", "project");
    entity("t", "task", true);
    entity("e", "entry");
    link("t", "p", "parent");
    link("e", "t", "context");
    link("e", "missing", "context");
    expect(ids("p", "transitive")).toEqual([]);
    expect(ids("missing", "transitive")).toEqual([]);
    index.database
      .prepare(
        "UPDATE entities SET deleted_at=NULL,exclude_from_ai=1 WHERE id='t'",
      )
      .run();
    expect(ids("p", "transitive", "entry")).toEqual(["e"]);
    expect(
      queryIndexedEntityPage(
        index,
        { relatedTo: "p", relatedResolution: "transitive", type: "entry" },
        { forAi: true },
      ).items,
    ).toEqual([]);
  });
  it("shares graph resolution across pages and invalidates after relationship edits", () => {
    const { entity, link } = setup();
    entity("p", "project");
    entity("t", "task");
    entity("e", "entry");
    entity("f", "entry");
    link("t", "p", "parent");
    link("e", "t", "context");
    link("f", "p", "context");
    const graph = resolveRelatedEntities(index, "p", "transitive");
    expect(resolveRelatedEntities(index, "p", "transitive")).toBe(graph);
    const query = {
      relatedTo: "p",
      relatedResolution: "transitive" as const,
      type: "entry" as const,
      limit: 1,
    };
    const first = queryIndexedEntityPage(index, query);
    const second = queryIndexedEntityPage(index, {
      ...query,
      cursor: first.nextCursor!,
    });
    expect([...first.items, ...second.items].map((e) => e.id)).toEqual([
      "e",
      "f",
    ]);
    expect(() =>
      queryIndexedEntityPage(index, {
        ...query,
        relatedResolution: "direct",
        cursor: first.nextCursor!,
      }),
    ).toThrow("cursor");
    index.database
      .prepare("DELETE FROM entity_references WHERE source_id='t'")
      .run();
    expect(resolveRelatedEntities(index, "p", "transitive")).not.toBe(graph);
    expect(queryIndexedEntityPage(index, query).items.map((e) => e.id)).toEqual(
      ["f"],
    );
    expect(() =>
      queryIndexedEntityPage(index, { relatedResolution: "direct" }),
    ).toThrow("relatedResolution");
  });
});
