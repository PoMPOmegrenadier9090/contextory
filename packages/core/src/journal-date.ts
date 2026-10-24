const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const requireJournalDate = (value: string): string => {
  if (!DATE_ONLY.test(value)) throw new TypeError("Invalid journal date");
  const instant = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(instant.getTime()) ||
    instant.toISOString().slice(0, 10) !== value
  )
    throw new TypeError("Invalid journal date");
  return value;
};

export const todayJournalDate = (instant: Date = new Date()): string =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);

export const addJournalDays = (value: string, days: number): string => {
  requireJournalDate(value);
  if (!Number.isInteger(days)) throw new TypeError("days must be an integer");
  const instant = new Date(`${value}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
};
