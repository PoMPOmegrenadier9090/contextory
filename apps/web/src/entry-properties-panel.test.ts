import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { EntryPropertiesPanel } from "@pkm/ui";
import type { PkmEntitySummary } from "@pkm/contracts";
import { describe, expect, it } from "vitest";

const entry: PkmEntitySummary = {
  id: "entry",
  type: "entry",
  path: "entries/entry.md",
  displayName: null,
  origin: "human",
  status: null,
  priority: null,
  projectId: null,
  areaId: null,
  taskId: null,
  resourceId: null,
  canonicalIdentifier: null,
  sourceUri: null,
  assetPath: null,
  journalDate: null,
  occurredAt: null,
  dueAt: null,
  topicIds: ["topic"],
  createdAt: "2026-10-04T00:00:00Z",
  updatedAt: "2026-10-04T00:00:00Z",
  deletedAt: null,
  excludeFromAi: false,
  body: "本文",
};
const render = (editable: boolean, readOnly = false) =>
  renderToStaticMarkup(
    createElement(
      MantineProvider,
      {
        theme: {
          components: {
            Accordion: {
              defaultProps: {
                defaultValue: "properties",
                transitionDuration: 0,
              },
            },
          },
        },
      },
      createElement(EntryPropertiesPanel, {
        entity: entry,
        entities: [
          {
            ...entry,
            id: "topic",
            type: "topic",
            displayName: "Existing Topic",
          },
        ],
        readOnly,
        ...(editable ? { onUpdateTopics: () => Promise.resolve() } : {}),
      }),
    ),
  );

describe("Entry property Topics input", () => {
  it("renders an enabled input and selected labels when topic editing is connected", () => {
    const html = render(true);
    const input = html.match(
      /<input[^>]*aria-label="EntryのTopics"[^>]*>/,
    )?.[0];
    expect(input).toBeDefined();
    expect(input).not.toContain("disabled");
    expect(html).toContain("Existing Topic");
  });
  it("disables the input in a read-only Vault and keeps display-only consumers unchanged", () => {
    expect(
      render(true, true).match(
        /<input[^>]*aria-label="EntryのTopics"[^>]*>/,
      )?.[0],
    ).toContain("disabled");
    expect(render(false)).not.toContain('aria-label="EntryのTopics"');
    expect(render(false)).toContain("Existing Topic");
  });
});
