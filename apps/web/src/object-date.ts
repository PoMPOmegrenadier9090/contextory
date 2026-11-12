const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const localDate = (date = new Date()): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const dailyHostId = (date = localDate()): string => `daily:${date}`;

export const dailyDate = (hostId: string): string | null => {
  const date = hostId.startsWith("daily:") ? hostId.slice(6) : "";
  return DATE.test(date) ? date : null;
};

export const shiftDate = (date: string, days: number): string => {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
};

export const dateRange = (date: string): { from: number; to: number } => {
  const from = new Date(`${date}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.getTime(), to: to.getTime() };
};
