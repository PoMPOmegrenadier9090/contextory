import {
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  addJournalDays,
  requireJournalDate,
  todayJournalDate,
} from "@pkm/core";
import { useEffect, useState } from "react";

import type { CalendarCount, PkmEntitySummary } from "@pkm/contracts";
import { EntryTimelineGroups } from "./entry-timeline-groups.js";
import type { PkmAsset } from "./asset-links.js";
import { MonthCalendarView } from "./month-calendar-view.js";
import { taskDeadlineDate } from "./month-calendar.js";
import { formatDeadline, deadlineInputValue } from "./task-deadline.js";
import { entityUiTitle } from "./entity-label.js";
import { EntityIcon } from "./entity-icon.js";
import {
  QuickCaptureComposer,
  type CaptureContextEntity,
  type QuickCaptureInput,
} from "./quick-capture.js";

const PAGE_SIZE = 40;

const dayFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface TimelineGroup {
  readonly day: string;
  readonly entries: readonly PkmEntitySummary[];
}

export const groupTimelineEntries = (
  entities: readonly PkmEntitySummary[],
): readonly TimelineGroup[] => {
  const entries = entities
    .filter((entity) => entity.type === "entry" && entity.deletedAt === null)
    .toSorted(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        b.id.localeCompare(a.id),
    );
  const groups = new Map<string, PkmEntitySummary[]>();
  for (const entry of entries) {
    const day = dayFormatter.format(new Date(entry.createdAt));
    const group = groups.get(day) ?? [];
    group.push(entry);
    groups.set(day, group);
  }
  return [...groups].map(([day, dayEntries]) => ({
    day,
    entries: dayEntries,
  }));
};

export const groupJournalEntries = (
  entries: readonly PkmEntitySummary[],
  date: string,
): readonly TimelineGroup[] => [
  {
    day: date,
    entries: entries
      .filter(
        (entry) =>
          entry.type === "entry" &&
          entry.deletedAt === null &&
          entry.journalDate === date,
      )
      .toSorted(
        (a, b) =>
          Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
          b.id.localeCompare(a.id),
      ),
  },
];

export type EntryTimelineViewMode = "list" | "calendar";

export interface EntryTimelineViewProps {
  readonly remote?:
    | {
        readonly loading: boolean;
        readonly hasMore: boolean;
        readonly onLoadMore: () => void;
        readonly loadCounts: (
          from: string,
          to: string,
        ) => Promise<readonly CalendarCount[]>;
        readonly revision: number;
      }
    | undefined;
  readonly entities: readonly PkmEntitySummary[];
  readonly viewMode: EntryTimelineViewMode;
  readonly onViewModeChange: (mode: EntryTimelineViewMode) => void;
  readonly selectedDate: string | null;
  readonly journalEntries: readonly PkmEntitySummary[];
  readonly journalLoading?: boolean;
  readonly onDateChange: (date: string | null) => void;
  readonly readOnly?: boolean;
  readonly draftStorageKey?: string | undefined;
  readonly onCapture: (input: QuickCaptureInput) => Promise<void>;
  readonly contextEntities?: readonly CaptureContextEntity[] | undefined;
  readonly onUploadAsset?: ((file: File) => Promise<PkmAsset>) | undefined;
  readonly assetBaseUrl?: string | undefined;
  readonly onOpenAsset?:
    ((path: string, fileName?: string) => void) | undefined;
  readonly onOpenEntity: (entityId: string) => void;
  readonly onUpdateEntryBody?:
    | ((entityId: string, expectedBody: string, body: string) => Promise<void>)
    | undefined;
}

export const EntryTimelineView = ({
  entities,
  remote,
  viewMode,
  onViewModeChange,
  selectedDate,
  journalEntries,
  journalLoading = false,
  onDateChange,
  readOnly = false,
  draftStorageKey,
  onCapture,
  contextEntities,
  onUploadAsset,
  assetBaseUrl,
  onOpenAsset,
  onOpenEntity,
  onUpdateEntryBody,
}: EntryTimelineViewProps): React.JSX.Element => {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const deadlineTasks =
    selectedDate === null
      ? []
      : entities
          .filter(
            (entity) =>
              entity.type === "task" &&
              entity.deletedAt === null &&
              taskDeadlineDate(entity) === selectedDate,
          )
          .toSorted(
            (a, b) =>
              deadlineInputValue(a.dueAt).localeCompare(
                deadlineInputValue(b.dueAt),
              ) || a.id.localeCompare(b.id),
          );
  useEffect(() => setVisibleCount(PAGE_SIZE), [selectedDate]);
  const groups =
    selectedDate === null
      ? groupTimelineEntries(entities)
      : groupJournalEntries(journalEntries, selectedDate);
  const totalCount = groups.reduce(
    (total, group) => total + group.entries.length,
    0,
  );
  let displayed = 0;
  const visibleGroups = groups
    .map((group) => {
      const remaining =
        remote === undefined
          ? Math.max(0, visibleCount - displayed)
          : group.entries.length;
      const entries = group.entries.slice(0, remaining);
      displayed += entries.length;
      return { ...group, entries };
    })
    .filter((group) => group.entries.length > 0);

  return (
    <Stack className="entry-timeline-view" gap="lg">
      <Group justify="space-between" align="center" gap="sm">
        <Group gap="sm">
          <Title order={2}>Timeline</Title>
          <Badge variant="light">{totalCount}</Badge>
          <SegmentedControl
            aria-label="Timeline表示モード"
            value={viewMode}
            onChange={(value) => {
              if (value === "list" || value === "calendar")
                onViewModeChange(value);
            }}
            data={[
              { value: "list", label: "リスト" },
              { value: "calendar", label: "月カレンダー" },
            ]}
          />
        </Group>
        <Group className="timeline-filters" gap="xs" wrap="wrap">
          <Button
            size="xs"
            variant={selectedDate === null ? "filled" : "subtle"}
            onClick={() => onDateChange(null)}
          >
            すべて
          </Button>
          <Button
            size="xs"
            variant={selectedDate === todayJournalDate() ? "filled" : "subtle"}
            onClick={() => onDateChange(todayJournalDate())}
          >
            今日
          </Button>
          <Group className="timeline-date-navigation" gap="xs" wrap="nowrap">
            {selectedDate !== null && (
              <Button
                size="xs"
                variant="subtle"
                onClick={() => onDateChange(addJournalDays(selectedDate, -1))}
              >
                ←
              </Button>
            )}
            <TextInput
              className="timeline-date-input"
              aria-label="Timelineの日付"
              type="date"
              size="xs"
              value={selectedDate ?? ""}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === "") {
                  onDateChange(null);
                  return;
                }
                try {
                  onDateChange(requireJournalDate(value));
                } catch {
                  /* Incomplete native date input. */
                }
              }}
            />
            {selectedDate !== null && (
              <Button
                size="xs"
                variant="subtle"
                onClick={() => onDateChange(addJournalDays(selectedDate, 1))}
              >
                →
              </Button>
            )}
          </Group>
        </Group>
      </Group>
      {viewMode === "calendar" && (
        <div>
          <MonthCalendarView
            entities={entities}
            loadCounts={remote?.loadCounts}
            revision={remote?.revision}
            selectedDate={selectedDate}
            onDateChange={onDateChange}
          />
        </div>
      )}
      {deadlineTasks.length > 0 && (
        <Paper withBorder p="md" className="timeline-deadlines">
          <Group gap="xs" mb="xs">
            <Title order={3} size="h4">
              {selectedDate} の期限 Task
            </Title>
            <Badge color="orange" variant="light">
              {deadlineTasks.length}
            </Badge>
          </Group>
          <div className="timeline-deadline-items">
            {deadlineTasks.map((task) => (
              <button
                className="timeline-deadline-item"
                key={task.id}
                data-open-entity={task.id}
                onClick={() => onOpenEntity(task.id)}
                type="button"
              >
                <EntityIcon type="task" status={task.status} />
                <span>{entityUiTitle(task)}</span>
                <Text component="span" c="dimmed" size="xs">
                  {formatDeadline(task.dueAt)}
                </Text>
                {task.status === "done" && <Badge size="xs">完了</Badge>}
              </button>
            ))}
          </div>
        </Paper>
      )}
      {!readOnly && (
        <Paper withBorder p="md" className="timeline-composer">
          <QuickCaptureComposer
            key={draftStorageKey}
            onCapture={onCapture}
            contextEntities={contextEntities}
            onUploadAsset={onUploadAsset}
            assetBaseUrl={assetBaseUrl}
            onOpenAsset={onOpenAsset}
            storageKey={draftStorageKey}
            compact
            autoFocus={viewMode === "list" && selectedDate === null}
          />
        </Paper>
      )}
      {journalLoading && selectedDate !== null ? (
        <Text c="dimmed">読み込み中…</Text>
      ) : (
        totalCount === 0 && (
          <Text c="dimmed">
            {selectedDate !== null
              ? "この日のEntryはありません。"
              : readOnly
                ? "まだEntryがありません。"
                : "まだEntryがありません。上の入力欄から始められます。"}
          </Text>
        )
      )}
      {!journalLoading && (
        <EntryTimelineGroups
          groups={visibleGroups}
          readOnly={readOnly}
          onOpenEntity={onOpenEntity}
          assetBaseUrl={assetBaseUrl}
          onOpenAsset={onOpenAsset}
          onUpdateEntryBody={onUpdateEntryBody}
        />
      )}
      {(remote?.hasMore ||
        (remote === undefined && totalCount > visibleCount)) && (
        <Button
          variant="default"
          loading={remote?.loading ?? false}
          onClick={() =>
            remote
              ? remote.onLoadMore()
              : setVisibleCount((value) => value + PAGE_SIZE)
          }
        >
          さらに表示
        </Button>
      )}
    </Stack>
  );
};
