import { describe, expect, it } from "vitest";

import {
  groupJournalEntries,
  groupTimelineEntries,
} from "./entry-timeline-view.js";
import type { PkmEntitySummary } from "@pkm/contracts";

const entry = (id: string, createdAt: string): PkmEntitySummary => ({
  id,
  type: "entry",
  path: `entries/${id}.md`,
  displayName: null,
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
  journalDate: null,
  occurredAt: null,
  dueAt: null,
  topicIds: [],
  createdAt,
  updatedAt: createdAt,
  deletedAt: null,
  excludeFromAi: false,
  body: "メモ\n",
});

describe("groupJournalEntries", () => {
  it("uses journal date instead of creation date and keeps newest first", () => {
    const groups = groupJournalEntries(
      [
        {
          ...entry("older", "2026-09-29T20:00:00Z"),
          journalDate: "2026-09-28",
        },
        {
          ...entry("newer", "2026-09-30T10:00:00Z"),
          journalDate: "2026-09-28",
        },
        {
          ...entry("other", "2026-09-28T10:00:00Z"),
          journalDate: "2026-09-29",
        },
      ],
      "2026-09-28",
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.day).toBe("2026-09-28");
    expect(groups[0]?.entries.map((item) => item.id)).toEqual([
      "newer",
      "older",
    ]);
  });
});

describe("groupTimelineEntries", () => {
  it("groups by Tokyo day and orders newest first", () => {
    const groups = groupTimelineEntries([
      entry("old", "2026-09-26T14:30:00Z"),
      entry("new", "2026-09-26T15:05:00Z"),
      entry("latest", "2026-09-26T15:30:00Z"),
    ]);

    expect(groups.map((group) => group.day)).toEqual([
      "2026-09-27",
      "2026-09-26",
    ]);
    expect(groups[0]?.entries.map((item) => item.id)).toEqual([
      "latest",
      "new",
    ]);
  });

  it("does not include deleted Entries or other types", () => {
    expect(
      groupTimelineEntries([
        {
          ...entry("deleted", "2026-09-26T15:00:00Z"),
          deletedAt: "2026-09-27T00:00:00Z",
        },
        { ...entry("task", "2026-09-26T15:00:00Z"), type: "task" },
      ]),
    ).toEqual([]);
  });

  it("orders timestamps by instant rather than their timezone text", () => {
    const groups = groupTimelineEntries([
      entry("earlier", "2026-09-27T00:00:00+09:00"),
      entry("later", "2026-09-26T17:00:00Z"),
    ]);

    expect(groups[0]?.entries.map((item) => item.id)).toEqual([
      "later",
      "earlier",
    ]);
  });
});
