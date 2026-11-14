import { describe, expect, it } from "vitest";

import { dailyDate, dailyHostId, dateRange, shiftDate } from "./object-date.js";

describe("Object Daily date helpers", () => {
  it("round-trips Daily host IDs", () => {
    expect(dailyDate(dailyHostId("2026-11-12"))).toBe("2026-11-12");
    expect(dailyDate("project")).toBeNull();
  });

  it("moves by calendar day", () => {
    expect(shiftDate("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("uses a half-open local day range", () => {
    const range = dateRange("2026-11-12");
    expect(new Date(range.from).getHours()).toBe(0);
    expect(new Date(range.to).getDate()).toBe(13);
  });
});
