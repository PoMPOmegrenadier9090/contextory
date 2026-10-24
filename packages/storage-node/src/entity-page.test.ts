import { describe, expect, it, vi } from "vitest";
import { IndexDatabase } from "./index-database.js";
import {
  queryIndexedEntityPage,
  countIndexedCalendarDays,
  countIndexedEntities,
  queryIndexedBacklinkPage,
} from "./index-query.js";
import { createSearchDocumentWriter } from "./search.js";

const seed = (index: IndexDatabase, count = 125) => {
  const insert = index.database
    .prepare(`INSERT INTO entities(id,type,path,display_name,name_key,description,created_at,updated_at,deleted_at,exclude_from_ai,body,journal_date,due_at,status)
    VALUES (@id,@type,@path,@name,@name,@description,@created,@created,@deleted,0,@body,@journal,@due,@status)`);
  const search = createSearchDocumentWriter(index.database);
  index.database.transaction(() => {
    for (let i = 0; i < count; i++) {
      const id = `entity-${String(i).padStart(5, "0")}`;
      const type = i % 5 === 0 ? "task" : "entry";
      const name = `Same ${String(Math.floor(i / 2)).padStart(5, "0")}`;
      const body =
        i === 124 ? "末尾だけ検索対象" : `本文 ${i} ${"a".repeat(1000)}`;
      insert.run({
        id,
        type,
        path: `${id}.md`,
        name,
        description: i === 0 ? "説明専用の語句" : null,
        created: "2026-10-03T00:00:00.000Z",
        deleted: i === 120 ? "2026-10-04T00:00:00.000Z" : null,
        body,
        journal: type === "entry" ? "2026-10-03" : null,
        due: type === "task" ? "2026-10-02T15:00:00.000Z" : null,
        status: "not_started",
      });
      search({ id, content: `${name}\n${body}` });
    }
  })();
};

describe("bounded indexed Entity queries", () => {
  it("uses workflow ranks across cursor pages and filters Home and Resource types", () => {
    const index = new IndexDatabase(":memory:");
    try {
      seed(index, 7);
      const states = [
        ["not_started", "highest"],
        ["in_progress", "low"],
        ["done", "highest"],
        ["in_progress", "highest"],
        ["on_hold", "normal"],
        ["in_progress", null],
        ["not_started", "low"],
      ];
      states.forEach(([status, priority], i) =>
        index.database
          .prepare(
            "UPDATE entities SET type='task', status=?, priority=? WHERE id=?",
          )
          .run(status, priority, `entity-0000${i}`),
      );
      const ids: string[] = [];
      let cursor: string | undefined;
      do {
        const page = queryIndexedEntityPage(index, {
          type: "task",
          sort: "workflow",
          limit: 2,
          ...(cursor ? { cursor } : {}),
        });
        ids.push(...page.items.map((entity) => entity.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(ids).toEqual([3, 1, 5, 0, 6, 4, 2].map((i) => `entity-0000${i}`));
      expect(
        queryIndexedEntityPage(index, { activeOnly: true }).items,
      ).toHaveLength(5);
      index.database
        .prepare(
          "UPDATE entities SET type='resource', resource_type='paper' WHERE id='entity-00002'",
        )
        .run();
      expect(
        queryIndexedEntityPage(index, {
          type: "resource",
          resourceType: "paper",
        }).items[0],
      ).toMatchObject({ id: "entity-00002", resourceType: "paper" });
      expect(
        queryIndexedEntityPage(index, { resourceType: "book" }).items,
      ).toEqual([]);
    } finally {
      index.close();
    }
  });
  it("filters and pages mixed all-day and timed deadlines in Tokyo order", () => {
    const index = new IndexDatabase(":memory:");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      seed(index, 5);
      const deadlines = [
        "2026-10-03",
        "2026-10-03T00:00:00+09:00",
        "2026-10-02T14:59:59Z",
        "2026-10-03T08:00:00+09:00",
        "2026-10-04",
      ];
      deadlines.forEach((due, i) =>
        index.database
          .prepare("UPDATE entities SET type='task', due_at=? WHERE id=?")
          .run(due, `entity-0000${i}`),
      );
      const ids = (query: Parameters<typeof queryIndexedEntityPage>[1]) =>
        queryIndexedEntityPage(index, query).items.map((e) => e.id);
      expect(ids({ dueDate: "2026-10-03" })).toEqual([
        "entity-00000",
        "entity-00001",
        "entity-00003",
      ]);
      expect(
        countIndexedCalendarDays(index, "2026-10-03", "2026-10-05"),
      ).toEqual([
        { date: "2026-10-03", entries: 0, tasks: 3 },
        { date: "2026-10-04", entries: 0, tasks: 1 },
      ]);
      const sorted: string[] = [];
      let cursor: string | undefined;
      do {
        const page = queryIndexedEntityPage(index, {
          sort: "dueAt",
          limit: 2,
          ...(cursor ? { cursor } : {}),
        });
        sorted.push(...page.items.map((e) => e.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(sorted).toEqual([
        "entity-00002",
        "entity-00000",
        "entity-00001",
        "entity-00003",
        "entity-00004",
      ]);
      vi.setSystemTime(new Date("2026-10-03T23:59:59+09:00"));
      expect(ids({ deadline: "overdue" })).not.toContain("entity-00000");
      expect(ids({ deadline: "today" })).toContain("entity-00000");
      vi.setSystemTime(new Date("2026-10-04T00:00:00+09:00"));
      expect(ids({ deadline: "overdue" })).toContain("entity-00000");
      expect(ids({ deadline: "overdue" })).not.toContain("entity-00004");
    } finally {
      vi.useRealTimers();
      index.close();
    }
  });

  it("filters every date field with inclusive/exclusive boundaries across timezone offsets", () => {
    const index = new IndexDatabase(":memory:");
    try {
      seed(index, 5);
      for (let i = 0; i < 5; i++) {
        const timestamp = `2026-09-${20 + i}T10:00:00+09:00`;
        index.database
          .prepare(
            `UPDATE entities SET created_at=?,updated_at=?,occurred_at=?,due_at=?,journal_date=? WHERE id=?`,
          )
          .run(
            timestamp,
            timestamp,
            timestamp,
            i === 2 ? null : timestamp,
            `2026-09-${20 + i}`,
            `entity-${String(i).padStart(5, "0")}`,
          );
      }
      const range = {
        from: "2026-09-21T01:00:00Z",
        to: "2026-09-23T01:00:00.000Z",
      };
      for (const field of [
        "createdAt",
        "updatedAt",
        "occurredAt",
        "dueAt",
      ] as const) {
        const page = queryIndexedEntityPage(index, {
          [field]: range,
          sort: "createdAt",
          direction: "asc",
        });
        expect(page.items.map((item) => item.id)).toEqual(
          field === "dueAt"
            ? ["entity-00001"]
            : ["entity-00001", "entity-00002"],
        );
      }
      const query = {
        createdAt: range,
        journalDateRange: { from: "2026-09-21", to: "2026-09-23" },
        type: "entry" as const,
        sort: "createdAt" as const,
        direction: "asc" as const,
        limit: 1,
      };
      const first = queryIndexedEntityPage(index, query);
      expect(first.items.map((item) => item.id)).toEqual(["entity-00001"]);
      expect(
        queryIndexedEntityPage(index, {
          ...query,
          cursor: first.nextCursor!,
        }).items.map((item) => item.id),
      ).toEqual(["entity-00002"]);
      expect(() =>
        queryIndexedEntityPage(index, {
          ...query,
          createdAt: { ...range, to: "2026-09-24T00:00:00Z" },
          cursor: first.nextCursor!,
        }),
      ).toThrow();
      expect(
        queryIndexedEntityPage(index, {
          journalDateRange: { to: "2026-09-21" },
        }).items,
      ).toHaveLength(1);
      expect(
        queryIndexedEntityPage(index, {
          createdAt: { from: "2026-09-24T01:00:00Z" },
        }).items,
      ).toHaveLength(1);
    } finally {
      index.close();
    }
  });

  it("pages complete backlink groups, bounds labels and excludes deleted sources", () => {
    const index = new IndexDatabase(":memory:");
    try {
      seed(index);
      const insert = index.database.prepare(
        "INSERT INTO entity_references(source_id,target_id,reference_kind,label) VALUES (?,'target',?,?)",
      );
      for (const id of ["entity-00001", "entity-00002", "entity-00120"]) {
        for (let i = 0; i < 8; i++) {
          insert.run(
            id,
            i % 2 === 0 ? "direct" : "context",
            `${i}${"長".repeat(200)}`,
          );
        }
      }
      const first = queryIndexedBacklinkPage(index, "target", { limit: 1 });
      expect(first.items).toHaveLength(1);
      expect(first.items[0]).toMatchObject({
        sourceId: "entity-00001",
        count: 8,
      });
      expect([...(first.items[0]?.kinds ?? [])].sort()).toEqual([
        "context",
        "direct",
      ]);
      expect(first.items[0]?.labels).toHaveLength(3);
      expect(first.items[0]?.labels.every((label) => label.length <= 160)).toBe(
        true,
      );
      const second = queryIndexedBacklinkPage(index, "target", {
        limit: 1,
        cursor: first.nextCursor!,
      });
      expect(second.items.map((group) => group.sourceId)).toEqual([
        "entity-00002",
      ]);
      expect(second.nextCursor).toBeNull();
      expect(() =>
        queryIndexedBacklinkPage(index, "target", { limit: 101 }),
      ).toThrow();
    } finally {
      index.close();
    }
  });
  it("seeks through ties in both directions without duplicate/missing IDs and bounds previews", () => {
    const index = new IndexDatabase(":memory:");
    try {
      seed(index);
      for (const sort of ["name", "createdAt"] as const)
        for (const direction of ["asc", "desc"] as const) {
          const ids: string[] = [];
          let cursor: string | undefined;
          do {
            const page = queryIndexedEntityPage(index, {
              sort,
              direction,
              limit: 11,
              ...(cursor ? { cursor } : {}),
            });
            expect(page.items.length).toBeLessThanOrEqual(11);
            expect(page.items.every((e) => e.body.length === 0)).toBe(true);
            ids.push(...page.items.map((e) => e.id));
            cursor = page.nextCursor ?? undefined;
          } while (cursor);
          expect(ids).toHaveLength(124);
          expect(new Set(ids).size).toBe(124);
          const reverse = queryIndexedEntityPage(index, {
            sort,
            direction: direction === "asc" ? "desc" : "asc",
            limit: 100,
          });
          expect(ids.slice(-100).reverse()).toEqual(
            reverse.items.map((e) => e.id),
          );
        }
      const page = queryIndexedEntityPage(index, { limit: 3 });
      expect(() =>
        queryIndexedEntityPage(index, {
          type: "task",
          cursor: page.nextCursor!,
        }),
      ).toThrow(/cursor/);
      expect(() => queryIndexedEntityPage(index, { limit: 101 })).toThrow();
      expect(() => queryIndexedEntityPage(index, { cursor: "null" })).toThrow(
        /cursor/,
      );
      expect(
        queryIndexedEntityPage(index, { ids: [], limit: 100 }).items,
      ).toEqual([]);
      expect(
        queryIndexedEntityPage(index, {
          ids: ["entity-00001"],
          view: "timeline",
        }).items[0]?.body.length,
      ).toBeGreaterThan(240);
    } finally {
      index.close();
    }
  });
  it("filters the whole index before paging, including short Japanese, todos, scopes and related entities", () => {
    const index = new IndexDatabase(":memory:");
    try {
      seed(index);
      expect(
        queryIndexedEntityPage(index, { q: "末尾", limit: 1 }).items.map(
          (e) => e.id,
        ),
      ).toEqual(["entity-00124"]);
      expect(
        queryIndexedEntityPage(index, { q: "検索対象" }).items.map((e) => e.id),
      ).toEqual(["entity-00124"]);
      expect(queryIndexedEntityPage(index, { q: "説明専用" }).items).toEqual(
        [],
      );
      index.database
        .prepare(
          "INSERT INTO entity_scopes VALUES (?, 'area', 'area-a', 'inherited', 'project-a')",
        )
        .run("entity-00124");
      index.database
        .prepare("INSERT INTO entity_topics VALUES (?, 'topic-a')")
        .run("entity-00124");
      index.database
        .prepare(
          "INSERT INTO entry_todos VALUES (?, 0, 3, 'todo', 0, 0, 'hash')",
        )
        .run("entity-00124");
      const query = {
        areaId: "area-a",
        topicIds: ["topic-a"],
        todosOnly: true,
        journalDate: "2026-10-03",
        limit: 1,
      };
      expect(
        queryIndexedEntityPage(index, query).items.map((e) => e.id),
      ).toEqual(["entity-00124"]);
      expect(
        queryIndexedEntityPage(index, { relatedTo: "area-a" }).items.map(
          (e) => e.id,
        ),
      ).toEqual(["entity-00124"]);
      expect(
        queryIndexedEntityPage(index, { deleted: "only" }).items.map(
          (e) => e.id,
        ),
      ).toEqual(["entity-00120"]);
      expect(
        queryIndexedEntityPage(index, { nameKeys: ["Same 00062"] }).items.map(
          (e) => e.id,
        ),
      ).toEqual(["entity-00124"]);
    } finally {
      index.close();
    }
  });
  it("uses title postings for name searches and marks bounded Timeline previews", () => {
    const index = new IndexDatabase(":memory:");
    try {
      seed(index);
      expect(
        queryIndexedEntityPage(index, { q: "末尾", nameOnly: true }).items,
      ).toEqual([]);
      expect(
        queryIndexedEntityPage(index, { q: "Same", nameOnly: true, limit: 100 })
          .items,
      ).toHaveLength(100);
      index.database
        .prepare("UPDATE entities SET body=? WHERE id=?")
        .run("長い本文".repeat(100_000), "entity-00001");
      const preview = queryIndexedEntityPage(index, {
        ids: ["entity-00001"],
        view: "timeline",
      }).items[0]!;
      expect(preview.bodyTruncated).toBe(true);
      expect(preview.body.length).toBe(1200);
      for (const sort of [
        "COALESCE(display_name, '') COLLATE NOCASE",
        "COALESCE(due_at, '')",
      ]) {
        const plan = index.database
          .prepare(
            `EXPLAIN QUERY PLAN SELECT id FROM entities WHERE deleted_at IS NULL ${sort.includes("due_at") ? "AND type='task'" : ""} ORDER BY (${sort}),id LIMIT 50`,
          )
          .all() as { detail: string }[];
        expect(plan.some((row) => row.detail.includes("TEMP B-TREE"))).toBe(
          false,
        );
      }
    } finally {
      index.close();
    }
  });
  it("aggregates counts without bodies, uses Tokyo deadline boundaries and indexed page ordering", () => {
    const index = new IndexDatabase(":memory:");
    try {
      seed(index);
      expect(countIndexedEntities(index)).toEqual({
        types: {
          entry: 100,
          task: 24,
          area: 0,
          project: 0,
          resource: 0,
          topic: 0,
        },
        deleted: 1,
      });
      expect(
        countIndexedCalendarDays(index, "2026-10-01", "2026-10-05"),
      ).toEqual([{ date: "2026-10-03", entries: 100, tasks: 24 }]);
      expect(
        queryIndexedEntityPage(index, {
          type: "task",
          dueDate: "2026-10-03",
          limit: 100,
        }).items,
      ).toHaveLength(24);
      expect(
        queryIndexedEntityPage(index, { type: "task", dueDate: "2026-10-02" })
          .items,
      ).toEqual([]);
      expect(() =>
        countIndexedCalendarDays(index, "2026-10-01", "2027-01-01"),
      ).toThrow();
      const plan = index.database
        .prepare(
          `EXPLAIN QUERY PLAN SELECT id FROM entities e WHERE type='entry' AND deleted_at IS NULL AND (created_at,id)<('2026-10-03T00:00:00.000Z','entity-00050') ORDER BY created_at DESC,id DESC LIMIT 50`,
        )
        .all() as { detail: string }[];
      expect(
        plan.some((row) => row.detail.includes("entities_created_idx")),
      ).toBe(true);
      expect(plan.some((row) => row.detail.includes("TEMP B-TREE"))).toBe(
        false,
      );
    } finally {
      index.close();
    }
  });
});
