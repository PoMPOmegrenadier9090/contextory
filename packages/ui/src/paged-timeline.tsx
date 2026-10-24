import { Alert, Button, Stack, Text } from "@mantine/core";
import { useContext, useRef } from "react";
import type { PkmClient, PkmEntitySummary } from "@pkm/contracts";
import { EntityQueryContext } from "./entity-query-context.js";
import { EntryTimelineView } from "./entry-timeline-view.js";
import {
  useEntityPage,
  EntityPageFooter as PageFooter,
} from "./use-entity-page.js";
export const PagedTimeline = ({
  entities,
  client,
  enabled = true,
  ...props
}: Omit<
  React.ComponentProps<typeof EntryTimelineView>,
  "entities" | "journalEntries" | "journalLoading" | "remote"
> & {
  entities: readonly PkmEntitySummary[];
  client: Pick<PkmClient, "calendarCounts">;
  enabled?: boolean;
}) => {
  const source = useContext(EntityQueryContext)!;
  const entries = useEntityPage(
    {
      type: "entry",
      sort: "createdAt",
      direction: "desc",
      view: "timeline",
      ...(props.selectedDate ? { journalDate: props.selectedDate } : {}),
    },
    enabled,
  );
  const tasks = useEntityPage(
    {
      type: "task",
      ...(props.selectedDate ? { dueDate: props.selectedDate } : {}),
      sort: "dueAt",
    },
    enabled && props.selectedDate !== null,
  );
  const loadCounts = useRef(client.calendarCounts);
  loadCounts.current = client.calendarCounts;
  const stableCounts = useRef(
    (from: string, to: string, signal?: AbortSignal) =>
      loadCounts.current(from, to, signal),
  ).current;
  return (
    <Stack>
      <EntryTimelineView
        {...props}
        entities={[...entries.items, ...tasks.items]}
        contextEntities={entities}
        journalEntries={entries.items}
        journalLoading={entries.loading && entries.items.length === 0}
        remote={{
          loading: entries.loading,
          hasMore: entries.cursor !== null,
          onLoadMore: () => void entries.loadMore(),
          loadCounts: stableCounts,
          revision: source.calendarRevision,
        }}
      />
      {entries.error && (
        <Alert color="red">
          {entries.error}
          <Button onClick={entries.retry}>再試行</Button>
        </Alert>
      )}
      {props.selectedDate === null && entries.loading && (
        <Text c="dimmed">読み込み中…</Text>
      )}
      {props.selectedDate !== null && <PageFooter page={tasks} />}
    </Stack>
  );
};
