import { describe, expect, it } from "vitest";

import {
  addJournalDays,
  requireJournalDate,
  todayJournalDate,
} from "./journal-date.js";

describe("journal dates", () => {
  it("uses the Tokyo day at UTC boundaries", () => {
    expect(todayJournalDate(new Date("2026-09-26T14:59:59Z"))).toBe(
      "2026-09-26",
    );
    expect(todayJournalDate(new Date("2026-09-26T15:00:00Z"))).toBe(
      "2026-09-27",
    );
  });

  it("moves by calendar days without timezone shifts", () => {
    expect(addJournalDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addJournalDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("rejects nonexistent calendar dates", () => {
    expect(requireJournalDate("2024-02-29")).toBe("2024-02-29");
    expect(() => requireJournalDate("2026-02-29")).toThrow();
    expect(() => requireJournalDate("2026-13-01")).toThrow();
    expect(() => requireJournalDate("2026-9-1")).toThrow();
  });
});
