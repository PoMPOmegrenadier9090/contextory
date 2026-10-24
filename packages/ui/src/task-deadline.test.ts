import { describe, expect, it } from "vitest";
import {
  deadlineFromInput,
  deadlineInputValue,
  matchesDeadlineFilter,
  formatDeadline,
} from "./task-deadline.js";

describe("Task deadlines", () => {
  it("round trips Tokyo timestamps regardless of device timezone and clears empty values", () => {
    const value = "2026-10-03T12:34:56";
    expect(deadlineInputValue(deadlineFromInput(value))).toBe(value);
    expect(deadlineFromInput("")).toBeNull();
    expect(deadlineInputValue(null)).toBe("");
    expect(deadlineInputValue("2026-10-03T12:34:56+09:00")).toBe(
      deadlineInputValue("2026-10-03T03:34:56Z"),
    );
  });

  it("rejects invalid and normalized calendar dates", () => {
    for (const value of ["invalid", "2026-02-30T10:00", "2026-10-03T25:00"]) {
      expect(() => deadlineFromInput(value)).toThrow("有効な期限日時");
    }
  });

  it("uses calendar day boundaries instead of rolling 24 hour windows", () => {
    const now = new Date("2026-10-03T12:00:00+09:00");
    const task = (day: number, hour = 0) => ({
      dueAt: `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+09:00`,
      status: "not_started",
    });
    expect(matchesDeadlineFilter(task(3), "today", now)).toBe(true);
    expect(matchesDeadlineFilter(task(4), "today", now)).toBe(false);
    expect(matchesDeadlineFilter(task(9, 23), "next7days", now)).toBe(true);
    expect(matchesDeadlineFilter(task(10), "next7days", now)).toBe(false);
    expect(matchesDeadlineFilter(task(2), "next7days", now)).toBe(false);
    expect(matchesDeadlineFilter(task(3, 11), "overdue", now)).toBe(true);
    expect(matchesDeadlineFilter(task(3, 12), "overdue", now)).toBe(false);
    expect(
      matchesDeadlineFilter({ ...task(2), status: "done" }, "overdue", now),
    ).toBe(false);
  });

  it("keeps all-day dates unchanged and treats them as overdue only after the Tokyo day ends", () => {
    const task = { dueAt: "2026-10-03", status: "not_started" };
    expect(deadlineFromInput(task.dueAt)).toBe(task.dueAt);
    expect(deadlineInputValue(task.dueAt)).toBe(task.dueAt);
    expect(formatDeadline(task.dueAt)).not.toContain(":");
    expect(
      matchesDeadlineFilter(
        task,
        "today",
        new Date("2026-10-03T23:59:59+09:00"),
      ),
    ).toBe(true);
    expect(
      matchesDeadlineFilter(
        task,
        "overdue",
        new Date("2026-10-03T23:59:59+09:00"),
      ),
    ).toBe(false);
    expect(
      matchesDeadlineFilter(
        task,
        "overdue",
        new Date("2026-10-04T00:00:00+09:00"),
      ),
    ).toBe(true);
    expect(() => deadlineFromInput("2026-02-30")).toThrow();
  });

  it("distinguishes missing deadlines from scheduled ones", () => {
    const task = { dueAt: null, status: "not_started" };
    expect(matchesDeadlineFilter(task, "unscheduled")).toBe(true);
    expect(matchesDeadlineFilter(task, "scheduled")).toBe(false);
    expect(matchesDeadlineFilter(task, "today")).toBe(false);
    expect(matchesDeadlineFilter(task, null)).toBe(true);
  });
});
