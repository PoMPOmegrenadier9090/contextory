import { describe, expect, it } from "vitest";
import { IndexDatabase } from "./index-database.js";
import { quickOpenIndexedEntities, QUICK_OPEN_LIMIT } from "./quick-open.js";
import { upsertSearchDocument } from "./search.js";

const insert = (
  index: IndexDatabase,
  id: string,
  title: string,
  body = "",
  deleted = false,
): void => {
  index.database
    .prepare(
      `INSERT INTO entities
    (id, type, path, display_name, name_key, created_at, updated_at, deleted_at, exclude_from_ai, body)
    VALUES (?, 'entry', ?, ?, ?, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', ?, 0, ?)
  `,
    )
    .run(
      id,
      `entries/${id}.md`,
      title,
      title.normalize("NFKC").toLocaleLowerCase("ja"),
      deleted ? "2026-10-02T00:00:00Z" : null,
      body,
    );
  upsertSearchDocument(index.database, { id, content: `${title}\n${body}` });
};

describe("Quick Open search", () => {
  it("ranks exact, prefix and contained titles before body matches, excludes deleted entities and shows parent context", () => {
    const index = new IndexDatabase(":memory:");
    try {
      insert(index, "a-body", "Other", "Find ALPHA in the body");
      insert(index, "b-contained", "My Alpha research");
      insert(index, "c-prefix", "Alpha research");
      insert(index, "d-exact", "Alpha");
      insert(index, "e-deleted", "ALPHA", "", true);
      insert(index, "parent", "Research area");
      index.database
        .prepare(
          `INSERT INTO entity_scopes
        (entity_id, scope_type, scope_id, relation) VALUES ('d-exact', 'area', 'parent', 'direct')`,
        )
        .run();
      const results = quickOpenIndexedEntities(index, " alpha ");
      expect(results.map((result) => result.id)).toEqual([
        "d-exact",
        "c-prefix",
        "b-contained",
        "a-body",
      ]);
      expect(results[0]?.breadcrumb).toBe("Research area");
      expect(results[3]?.snippet).toContain("ALPHA");
      expect(results[0]).not.toHaveProperty("body");
    } finally {
      index.close();
    }
  });

  it("supports one or two Japanese characters and treats FTS syntax as literal text", () => {
    const index = new IndexDatabase(":memory:");
    try {
      insert(index, "research", "研究ノート", "同期方式を考える");
      expect(
        quickOpenIndexedEntities(index, "研").map((result) => result.id),
      ).toEqual(["research"]);
      expect(
        quickOpenIndexedEntities(index, "同期").map((result) => result.id),
      ).toEqual(["research"]);
      expect(
        quickOpenIndexedEntities(index, "同期方式").map((result) => result.id),
      ).toEqual(["research"]);
      expect(quickOpenIndexedEntities(index, "研究 OR 同期")).toEqual([]);
      expect(quickOpenIndexedEntities(index, '"')).toEqual([]);
      expect(quickOpenIndexedEntities(index, "  ")).toEqual([]);
    } finally {
      index.close();
    }
  });

  it("ranks Unicode prefixes before contained names and body matches", () => {
    const index = new IndexDatabase(":memory:");
    try {
      insert(index, "a-body", "Other", "研究");
      insert(index, "b-prefix", "研究😀");
      expect(quickOpenIndexedEntities(index, "研究").map((e) => e.id)).toEqual([
        "b-prefix",
        "a-body",
      ]);
    } finally {
      index.close();
    }
  });
  it("limits after ranking and bounds snippets around the body match", () => {
    const index = new IndexDatabase(":memory:");
    try {
      for (let n = 0; n < 40; n += 1) {
        insert(
          index,
          `a-${n}`,
          "Other",
          `${"before ".repeat(80)}needle ${"after ".repeat(80)}`,
        );
      }
      insert(index, "z-exact", "needle");
      const results = quickOpenIndexedEntities(index, "needle");
      expect(results).toHaveLength(QUICK_OPEN_LIMIT);
      expect(results[0]?.id).toBe("z-exact");
      expect(results[1]?.snippet).toContain("needle");
      expect(results[1]?.snippet.length).toBeLessThanOrEqual(162);
      expect(results[1]?.snippet).toMatch(/^….*…$/);
    } finally {
      index.close();
    }
  });
});
