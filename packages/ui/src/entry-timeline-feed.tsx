import { LinkOnlyEntry, singlePreviewUrl } from "./link-preview.js";
import { Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { PkmClient, PkmEntitySummary } from "@pkm/contracts";
import { MarkdownBodyPreview } from "./markdown-body-preview.js";
import { toggleMarkdownTodo } from "./markdown-todos.js";
import { EntityRelationReason } from "./entity-relation-reason.js";
import type { TimelineGroup } from "./entry-timeline-view.js";

const dayLabel = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});
const timeLabel = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
});
export interface EntryTimelineFeedProps {
  readonly groups: readonly TimelineGroup[];
  readonly readOnly?: boolean | undefined;
  readonly onOpenEntity: (id: string) => void;
  readonly loadEntity?: PkmClient["loadEntity"] | undefined;
  readonly assetBaseUrl?: string | undefined;
  readonly onOpenAsset?: ((path: string, name?: string) => void) | undefined;
  readonly onUpdateEntryBody?:
    | ((id: string, expectedBody: string, body: string) => Promise<void>)
    | undefined;
}
const TimelineEntryCard = ({
  entry,
  ...props
}: Omit<EntryTimelineFeedProps, "groups"> & {
  readonly entry: PkmEntitySummary;
}) => {
  const [full, setFull] = useState<{ body: string; editable: boolean } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setFull(null);
    setError(null);
    setLoading(false);
    return () => {
      generation.current++;
    };
  }, [entry.id, entry.fileHash, entry.body]);
  const body = full?.body ?? entry.body;
  const expand = async () => {
    if (!props.loadEntity || loading) return;
    const request = generation.current;
    setLoading(true);
    setError(null);
    try {
      const document = await props.loadEntity(entry.id);
      if (request === generation.current)
        setFull({
          body: document.entity.body,
          editable: document.draft === null && !document.hasExternalChange,
        });
    } catch (reason) {
      if (request === generation.current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };
  const singleUrl =
    full || !entry.bodyTruncated ? singlePreviewUrl(body) : null;
  if (singleUrl)
    return (
      <LinkOnlyEntry
        entry={entry}
        url={singleUrl}
        onOpenEntity={props.onOpenEntity}
      />
    );
  return (
    <Paper withBorder p="md" className="timeline-entry-card">
      <Group
        className="timeline-entry-heading"
        justify="space-between"
        align="start"
        mb="xs"
      >
        <button
          type="button"
          className="timeline-entry-title"
          data-open-entity={entry.id}
          onClick={() => props.onOpenEntity(entry.id)}
        >
          {entry.displayName ?? timeLabel.format(new Date(entry.createdAt))}
        </button>
        {entry.displayName !== null && (
          <Text c="dimmed" size="xs">
            {timeLabel.format(new Date(entry.createdAt))}
          </Text>
        )}
      </Group>
      <EntityRelationReason entity={entry} onOpenEntity={props.onOpenEntity} />
      <MarkdownBodyPreview
        showLinkPreviews
        body={body}
        className="timeline-entry-body"
        onOpenEntity={props.onOpenEntity}
        assetBaseUrl={props.assetBaseUrl}
        onOpenAsset={props.onOpenAsset}
        onToggleTodo={
          props.readOnly ||
          (full ? !full.editable : entry.bodyTruncated) ||
          !props.onUpdateEntryBody
            ? undefined
            : async (from, checked) => {
                setError(null);
                try {
                  await props.onUpdateEntryBody!(
                    entry.id,
                    body,
                    toggleMarkdownTodo(body, from, checked),
                  );
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : String(reason),
                  );
                }
              }
        }
      />
      {error && (
        <Text c="red" role="alert">
          {error}
        </Text>
      )}
      <Group gap="xs">
        {entry.bodyTruncated && !full && props.loadEntity && (
          <Button
            variant="subtle"
            size="xs"
            loading={loading}
            onClick={() => void expand()}
          >
            本文を展開
          </Button>
        )}
        <Button
          variant="subtle"
          size="xs"
          data-open-entity={entry.id}
          onClick={() => props.onOpenEntity(entry.id)}
        >
          Entryを開く
        </Button>
      </Group>
    </Paper>
  );
};
export const EntryTimelineFeed = ({
  groups,
  ...props
}: EntryTimelineFeedProps): React.JSX.Element => (
  <Stack gap="lg">
    {groups.map((group) => (
      <section key={group.day} className="timeline-day-group">
        <Title order={3} size="h4" mb="sm">
          {dayLabel.format(new Date(`${group.day}T12:00:00+09:00`))}
        </Title>
        <Stack gap="sm">
          {group.entries.map((entry) => (
            <TimelineEntryCard key={entry.id} entry={entry} {...props} />
          ))}
        </Stack>
      </section>
    ))}
  </Stack>
);
