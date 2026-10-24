import { LinkOnlyEntry, singlePreviewUrl } from "./link-preview.js";
import { Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useState } from "react";
import type { TimelineGroup } from "./entry-timeline-view.js";
import { MarkdownBodyPreview } from "./markdown-body-preview.js";
import { toggleMarkdownTodo } from "./markdown-todos.js";

const dayLabelFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});

const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  hour: "2-digit",
  minute: "2-digit",
});

export interface EntryTimelineGroupsProps {
  readonly groups: readonly TimelineGroup[];
  readonly readOnly?: boolean | undefined;
  readonly assetBaseUrl?: string | undefined;
  readonly onOpenAsset?:
    ((path: string, fileName?: string) => void) | undefined;
  readonly onOpenEntity: (entityId: string) => void;
  readonly onUpdateEntryBody?:
    | ((entityId: string, expectedBody: string, body: string) => Promise<void>)
    | undefined;
}

export const EntryTimelineGroups = ({
  groups,
  readOnly,
  assetBaseUrl,
  onOpenAsset,
  onOpenEntity,
  onUpdateEntryBody,
}: EntryTimelineGroupsProps): React.JSX.Element => {
  const [error, setError] = useState<string | null>(null);
  return (
    <Stack gap="lg">
      {error && (
        <Text c="red" role="alert">
          {error}
        </Text>
      )}
      {groups.map((group) => (
        <section key={group.day} className="timeline-day-group">
          <Title order={3} size="h4" mb="sm">
            {dayLabelFormatter.format(new Date(`${group.day}T12:00:00+09:00`))}
          </Title>
          <Stack gap="sm">
            {group.entries.map((entry) => {
              const singleUrl = !entry.bodyTruncated
                ? singlePreviewUrl(entry.body)
                : null;
              return singleUrl ? (
                <LinkOnlyEntry
                  key={entry.id}
                  entry={entry}
                  url={singleUrl}
                  onOpenEntity={onOpenEntity}
                />
              ) : (
                <Paper
                  withBorder
                  p="md"
                  key={entry.id}
                  className="timeline-entry-card"
                >
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
                      onClick={() => onOpenEntity(entry.id)}
                    >
                      {entry.displayName ??
                        timeFormatter.format(new Date(entry.createdAt))}
                    </button>
                    {entry.displayName !== null && (
                      <Text c="dimmed" size="xs">
                        {timeFormatter.format(new Date(entry.createdAt))}
                      </Text>
                    )}
                  </Group>
                  {entry.entryRelation && (
                    <Text c="dimmed" size="xs" mb="xs">
                      {entry.entryRelation.kind === "direct"
                        ? "直接"
                        : entry.entryRelation.path
                            .map((node) => node.displayName ?? node.id)
                            .join(" › ") + " を経由"}
                    </Text>
                  )}
                  <MarkdownBodyPreview
                    showLinkPreviews
                    body={entry.body}
                    className="timeline-entry-body"
                    onOpenEntity={onOpenEntity}
                    assetBaseUrl={assetBaseUrl}
                    onOpenAsset={onOpenAsset}
                    onToggleTodo={
                      readOnly ||
                      entry.bodyTruncated ||
                      onUpdateEntryBody === undefined
                        ? undefined
                        : async (from, checked) => {
                            setError(null);
                            try {
                              await onUpdateEntryBody(
                                entry.id,
                                entry.body,
                                toggleMarkdownTodo(entry.body, from, checked),
                              );
                            } catch (error) {
                              setError(
                                error instanceof Error
                                  ? error.message
                                  : String(error),
                              );
                            }
                          }
                    }
                  />
                  {entry.body.length > 0 && (
                    <Button
                      variant="subtle"
                      size="xs"
                      data-open-entity={entry.id}
                      onClick={() => onOpenEntity(entry.id)}
                    >
                      本文をすべて表示
                    </Button>
                  )}
                </Paper>
              );
            })}
          </Stack>
        </section>
      ))}
    </Stack>
  );
};
