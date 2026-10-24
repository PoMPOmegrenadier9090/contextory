import { describe, expect, it } from "vitest";
import type { PkmEntitySummary } from "@pkm/contracts";
import {
  buildMonthCalendar,
  entryCalendarDate,
  groupCalendarItems,
  shiftCalendarMonth,
} from "./month-calendar.js";

const entity = (overrides: Partial<PkmEntitySummary>): PkmEntitySummary => ({
  id: "id",
  type: "entry",
  path: "entries/id.md",
  displayName: "Entity",
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
  createdAt: "2026-10-02T16:00:00.000Z",
  updatedAt: "2026-10-02T16:00:00.000Z",
  deletedAt: null,
  excludeFromAi: false,
  body: "",
  ...overrides,
});

describe("month calendar", () => {
  it("builds Sunday-first complete weeks and shifts across year boundaries", () => {
    const days = buildMonthCalendar("2026-10");
    expect(days).toHaveLength(35);
    expect(days[0]).toMatchObject({ date: "2026-09-27", inMonth: false });
    expect(days.find((day) => day.date === "2026-10-31")?.inMonth).toBe(true);
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
  });

  it("uses only the journal date, matching the Timeline date filter", () => {
    expect(entryCalendarDate(entity({ journalDate: "2026-09-30" }))).toBe(
      "2026-09-30",
    );
    expect(
      entryCalendarDate(entity({ occurredAt: "2026-10-02T16:00:00Z" })),
    ).toBeNull();
    expect(entryCalendarDate(entity({}))).toBeNull();
  });

  it("groups entries and tasks by day and ignores deleted entities", () => {
    const grouped = groupCalendarItems([
      entity({ id: "entry-1", journalDate: "2026-10-03" }),
      entity({
        id: "entry-2",
        journalDate: "2026-10-03",
        createdAt: "2026-10-03T02:00:00Z",
      }),
      entity({ id: "task-1", type: "task", dueAt: "2026-10-03T15:00:00Z" }),
      entity({
        id: "deleted",
        journalDate: "2026-10-03",
        deletedAt: "2026-10-03T00:00:00Z",
      }),
      entity({ id: "unassigned" }),
      entity({ id: "invalid-task", type: "task", dueAt: "invalid" }),
    ]);
    expect(grouped.get("2026-10-03")?.entries.map(({ id }) => id)).toEqual([
      "entry-2",
      "entry-1",
    ]);
    expect(grouped.get("2026-10-04")?.tasks.map(({ id }) => id)).toEqual([
      "task-1",
    ]);
  });
});
