import { ActionIcon, Button, Group, Paper, Text, Title } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import type { CalendarCount, PkmEntitySummary } from "@pkm/contracts";
import {
  buildMonthCalendar,
  groupCalendarItems,
  shiftCalendarMonth,
  todayCalendarDate,
} from "./month-calendar.js";

const monthFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
});
const weekdayLabels = ["日", "月", "火", "水", "木", "金", "土"];

export interface MonthCalendarViewProps {
  readonly loadCounts?:
    | ((
        from: string,
        to: string,
        signal?: AbortSignal,
      ) => Promise<readonly CalendarCount[]>)
    | undefined;
  readonly revision?: number | undefined;
  readonly entities: readonly PkmEntitySummary[];
  readonly selectedDate: string | null;
  readonly onDateChange: (date: string) => void;
}

export const MonthCalendarView = ({
  entities,
  loadCounts,
  revision,
  selectedDate,
  onDateChange,
}: MonthCalendarViewProps): React.JSX.Element => {
  const today = todayCalendarDate();
  const [month, setMonth] = useState((selectedDate ?? today).slice(0, 7));
  useEffect(() => {
    if (selectedDate !== null) setMonth(selectedDate.slice(0, 7));
  }, [selectedDate]);
  const groups = useMemo(() => groupCalendarItems(entities), [entities]);
  const days = useMemo(() => buildMonthCalendar(month), [month]);
  const [counts, setCounts] = useState<readonly CalendarCount[]>([]);
  const [countError, setCountError] = useState<string | null>(null);
  useEffect(() => {
    if (!loadCounts) return;
    let active = true;
    const controller = new AbortController();
    setCounts([]);
    setCountError(null);
    const from = days[0]!.date;
    const last = new Date(`${days.at(-1)!.date}T00:00:00Z`);
    last.setUTCDate(last.getUTCDate() + 1);
    void loadCounts(from, last.toISOString().slice(0, 10), controller.signal)
      .then((result) => {
        if (active) setCounts(result);
      })
      .catch((reason: unknown) => {
        if (active)
          setCountError(
            reason instanceof Error ? reason.message : String(reason),
          );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [days, loadCounts, revision]);
  const countsByDate = new Map(counts.map((day) => [day.date, day]));
  const displayMonth = monthFormatter.format(
    new Date(`${month}-01T00:00:00+09:00`),
  );

  const changeMonth = (offset: number): void => {
    setMonth((current) => shiftCalendarMonth(current, offset));
  };

  return (
    <Paper className="month-calendar" withBorder p="md">
      <Group justify="space-between" mb="sm">
        <Title order={3}>月カレンダー</Title>
        <Group gap="xs">
          <ActionIcon
            aria-label="前の月"
            variant="subtle"
            onClick={() => changeMonth(-1)}
          >
            ‹
          </ActionIcon>
          <Text className="month-calendar-heading" fw={650} aria-live="polite">
            {displayMonth}
          </Text>
          <ActionIcon
            aria-label="次の月"
            variant="subtle"
            onClick={() => changeMonth(1)}
          >
            ›
          </ActionIcon>
          <Button
            size="xs"
            variant="light"
            onClick={() => {
              setMonth(today.slice(0, 7));
              if (selectedDate !== today) onDateChange(today);
            }}
          >
            今日
          </Button>
        </Group>
      </Group>
      {countError && (
        <Text c="red" role="alert">
          {countError}
        </Text>
      )}
      <div
        className="month-calendar-grid"
        role="group"
        aria-label={`${displayMonth}の日付選択`}
      >
        {weekdayLabels.map((label, index) => (
          <div
            className="month-calendar-weekday"
            aria-hidden="true"
            key={label}
            data-weekend={index === 0 || index === 6 || undefined}
          >
            {label}
          </div>
        ))}
        {days.map((day) => {
          const items = groups.get(day.date);
          const entryCount = loadCounts
            ? (countsByDate.get(day.date)?.entries ?? 0)
            : (items?.entries.length ?? 0);
          const taskCount = loadCounts
            ? (countsByDate.get(day.date)?.tasks ?? 0)
            : (items?.tasks.length ?? 0);
          const label = `${day.date}、Entry ${entryCount}件、期限 Task ${taskCount}件`;
          return (
            <button
              aria-label={label}
              aria-pressed={selectedDate === day.date}
              className="month-calendar-day"
              data-in-month={day.inMonth}
              data-selected={selectedDate === day.date || undefined}
              data-today={day.date === today || undefined}
              key={day.date}
              onClick={() => {
                setMonth(day.date.slice(0, 7));
                if (selectedDate !== day.date) onDateChange(day.date);
              }}
              type="button"
            >
              <span className="month-calendar-day-number">
                {day.dayOfMonth}
              </span>
              <span className="month-calendar-markers" aria-hidden="true">
                {entryCount > 0 && (
                  <span className="month-calendar-entry-count">
                    {entryCount}
                  </span>
                )}
                {taskCount > 0 && (
                  <span className="month-calendar-task-marker">
                    ▪{taskCount > 1 ? taskCount : ""}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <Group className="month-calendar-legend" gap="md" mt="xs">
        <Text size="xs" c="dimmed">
          <span className="month-calendar-legend-entry" /> Entry
        </Text>
        <Text size="xs" c="dimmed">
          <span className="month-calendar-legend-task">▪</span> 期限 Task
        </Text>
      </Group>
    </Paper>
  );
};
