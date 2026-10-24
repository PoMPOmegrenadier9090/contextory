import { deadlineInputValue } from "./task-deadline.js";
import type { PkmEntitySummary } from "@pkm/contracts";

const dateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface CalendarDay {
  readonly date: string;
  readonly dayOfMonth: number;
  readonly inMonth: boolean;
}

export interface CalendarDayItems {
  readonly entries: readonly PkmEntitySummary[];
  readonly tasks: readonly PkmEntitySummary[];
}

export const entryCalendarDate = (entry: PkmEntitySummary): string | null =>
  entry.journalDate;

export const taskDeadlineDate = (task: PkmEntitySummary): string | null =>
  task.dueAt === null
    ? null
    : deadlineInputValue(task.dueAt).slice(0, 10) || null;

export const groupCalendarItems = (
  entities: readonly PkmEntitySummary[],
): ReadonlyMap<string, CalendarDayItems> => {
  const groups = new Map<
    string,
    { entries: PkmEntitySummary[]; tasks: PkmEntitySummary[] }
  >();
  const getGroup = (date: string) => {
    const group = groups.get(date) ?? { entries: [], tasks: [] };
    groups.set(date, group);
    return group;
  };
  for (const entity of entities) {
    if (entity.deletedAt !== null) continue;
    if (entity.type === "entry") {
      const date = entryCalendarDate(entity);
      if (date !== null) getGroup(date).entries.push(entity);
    } else if (entity.type === "task") {
      const date = taskDeadlineDate(entity);
      if (date !== null) getGroup(date).tasks.push(entity);
    }
  }
  return new Map(
    [...groups].map(([date, items]) => [
      date,
      {
        entries: items.entries.toSorted(
          (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
        ),
        tasks: items.tasks.toSorted((a, b) =>
          (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id, "ja"),
        ),
      },
    ]),
  );
};

export const buildMonthCalendar = (month: string): readonly CalendarDay[] => {
  if (!/^\d{4}-\d{2}$/u.test(month))
    throw new TypeError("月はYYYY-MM形式で指定してください。");
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber === undefined || monthNumber < 1 || monthNumber > 12) {
    throw new TypeError("有効な月を指定してください。");
  }
  const monthIndex = monthNumber - 1;
  const first = new Date(Date.UTC(year!, monthIndex, 1));
  const lastDay = new Date(Date.UTC(year!, monthNumber, 0)).getUTCDate();
  const offset = first.getUTCDay();
  const cellCount = Math.ceil((offset + lastDay) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(Date.UTC(year!, monthIndex, index - offset + 1));
    const dateKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    return {
      date: dateKey,
      dayOfMonth: date.getUTCDate(),
      inMonth: date.getUTCMonth() === monthIndex,
    };
  });
};

export const shiftCalendarMonth = (month: string, offset: number): string => {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year!, monthNumber! - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const todayCalendarDate = (now = new Date()): string =>
  dateFormatter.format(now);
