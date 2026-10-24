import { describe, expect, it } from "vitest";

import type { PkmEntitySummary } from "@pkm/contracts";

import {
  nextQuickOpenIndex,
  parseQuickOpenRecent,
  quickOpenSuggestions,
  rememberQuickOpen,
} from "./quick-open-state.js";

const entity = (
  id: string,
  deletedAt: string | null = null,
): PkmEntitySummary => ({
  id,
  type: "task",
  path: `tasks/${id}.md`,
  displayName: id,
  origin: null,
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
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T00:00:00Z",
  deletedAt,
  excludeFromAi: false,
  body: "test body",
});

describe("Quick Open suggestions", () => {
  it("prioritizes recents, adds pins once, and drops missing/deleted entities", () => {
    const results = quickOpenSuggestions(
      [entity("a"), entity("b"), entity("c", "2026-10-03"), entity("d")],
      ["b", "missing", "c", "a"],
      new Set(["a", "d", "c"]),
    );
    expect(results.map(({ id }) => id)).toEqual(["b", "a", "d"]);
    expect(results[0]).toMatchObject({
      snippet: "test body",
      breadcrumb: "tasks/b.md",
    });
  });

  it("caps suggestions and recent storage at 30", () => {
    const ids = Array.from({ length: 40 }, (_, index) => String(index));
    expect(
      quickOpenSuggestions(
        ids.map((id) => entity(id)),
        ids,
        new Set(),
      ),
    ).toHaveLength(30);
    expect(rememberQuickOpen(ids, "new")).toHaveLength(30);
    expect(rememberQuickOpen(["b", "a", "c"], "a")).toEqual(["a", "b", "c"]);
  });

  it("safely restores deduplicated string IDs from browser storage", () => {
    expect(parseQuickOpenRecent(null)).toEqual([]);
    expect(parseQuickOpenRecent("broken")).toEqual([]);
    expect(parseQuickOpenRecent('{"id":"a"}')).toEqual([]);
    expect(parseQuickOpenRecent('["a", 1, "b", "a", null]')).toEqual([
      "a",
      "b",
    ]);
  });

  it("wraps keyboard navigation and handles an empty list", () => {
    expect(nextQuickOpenIndex(0, -1, 3)).toBe(2);
    expect(nextQuickOpenIndex(2, 1, 3)).toBe(0);
    expect(nextQuickOpenIndex(0, 1, 0)).toBe(0);
  });
});
