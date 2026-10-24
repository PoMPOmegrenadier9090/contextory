export type DeadlineFilter =
  "overdue" | "today" | "next7days" | "scheduled" | "unscheduled";

export const isAllDayDate = (value: string | null): boolean =>
  value !== null && /^\d{4}-\d{2}-\d{2}$/u.test(value);

// Vault deadline dates use the design's Asia/Tokyo base timezone.
export const deadlineInputValue = (value: string | null): string => {
  if (value === null) return "";
  if (isAllDayDate(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string): string =>
    parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
};

export const deadlineFromInput = (value: string): string | null => {
  if (value === "") return null;
  if (isAllDayDate(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    )
      throw new TypeError("有効な期限日時を入力してください。");
    return value;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u.test(value)) {
    throw new TypeError("有効な期限日時を入力してください。");
  }
  const date = new Date(`${value}+09:00`);
  const normalized = value.length === 16 ? `${value}:00` : value;
  if (
    !Number.isFinite(date.getTime()) ||
    deadlineInputValue(date.toISOString()) !== normalized
  ) {
    throw new TypeError("有効な期限日時を入力してください。");
  }
  return date.toISOString();
};

export const matchesDeadlineFilter = (
  task: { readonly dueAt: string | null; readonly status: string | null },
  filter: DeadlineFilter | null,
  now = new Date(),
): boolean => {
  if (filter === null) return true;
  if (filter === "unscheduled") return task.dueAt === null;
  if (task.dueAt === null) return false;
  const allDay = isAllDayDate(task.dueAt);
  const due = new Date(
    allDay ? `${task.dueAt}T00:00:00+09:00` : task.dueAt,
  ).getTime();
  if (!Number.isFinite(due)) return false;
  if (filter === "scheduled") return true;
  if (filter === "overdue")
    return (
      task.status !== "done" &&
      (allDay ? due + 86_400_000 <= now.getTime() : due < now.getTime())
    );
  const today = deadlineInputValue(now.toISOString()).slice(0, 10);
  const start = new Date(`${today}T00:00:00+09:00`);
  const end = new Date(
    start.getTime() + (filter === "today" ? 1 : 7) * 86_400_000,
  );
  return due >= start.getTime() && due < end.getTime();
};

export const formatDeadline = (value: string | null): string =>
  value === null
    ? "—"
    : new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        dateStyle: "short",
        ...(isAllDayDate(value) ? {} : { timeStyle: "short" as const }),
      }).format(new Date(value));
