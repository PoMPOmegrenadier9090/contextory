import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it } from "vitest";
import type { PkmEntitySummary } from "@pkm/contracts";
import { EntityRelationTable } from "../../../packages/ui/src/entity-detail-view.js";
import { EntityDataTable } from "../../../packages/ui/src/entity-data-table.js";

const task: PkmEntitySummary = {
  id: "task",
  type: "task",
  path: "tasks/task.md",
  displayName: "日本語の長いタスク名",
  origin: "human",
  status: "not_started",
  priority: "high",
  projectId: "project",
  areaId: null,
  taskId: null,
  resourceId: null,
  canonicalIdentifier: null,
  sourceUri: null,
  assetPath: null,
  journalDate: null,
  occurredAt: null,
  dueAt: null,
  topicIds: [],
  createdAt: "2026-10-08T00:00:00Z",
  updatedAt: "2026-10-08T00:00:00Z",
  deletedAt: null,
  excludeFromAi: false,
  body: "",
};
const render = (readOnly = false) =>
  renderToStaticMarkup(
    createElement(
      MantineProvider,
      {},
      createElement(EntityDataTable, {
        initialView: "list",
        entities: [task],
        allEntities: [
          task,
          { ...task, id: "project", type: "project", displayName: "開発" },
        ],
        columns: [
          { kind: "name", label: "名前" },
          { kind: "status", label: "状態", editable: true },
          { kind: "priority", label: "優先度", editable: true },
          { kind: "project", label: "Project", editable: true },
          { kind: "dueAt", label: "期限", editable: true },
        ],
        readOnly,
        onOpenEntity: () => {},
        onUpdateEntity: () => Promise.resolve(),
      }),
    ),
  );

describe("compact Entity lists", () => {
  it("shows one compact navigation row with a status summary and offers the full table on PC", () => {
    const html = render();
    expect(html).not.toContain("<table");
    expect(html).toContain('data-open-entity="task"');
    expect(html).toContain("未着手");
    expect(html).not.toContain('aria-label="日本語の長いタスク名のステータス"');
    expect(html).not.toContain('<details class="entity-record-properties">');
    expect(html).not.toContain('aria-label="日本語の長いタスク名の期限"');
    expect(html).toContain('aria-label="一覧の表示形式"');
  });
  it("keeps a read-only Vault's list properties read-only", () => {
    const html = render(true);
    expect(html).not.toContain('aria-label="日本語の長いタスク名のステータス"');
    expect(html).toContain("未着手");
    expect(html).toContain('data-open-entity="task"');
  });
});

describe("Entity page relations", () => {
  it("renders a table without a list/table selector", () => {
    const html = renderToStaticMarkup(
      createElement(
        MantineProvider,
        {},
        createElement(EntityRelationTable, {
          title: "Tasks",
          entities: [task],
          allEntities: [task],
          columns: [
            { kind: "name", label: "名前" },
            { kind: "status", label: "状態" },
          ],
          onOpenEntity: () => {},
        }),
      ),
    );
    expect(html).toContain("<table");
    expect(html).not.toContain('aria-label="一覧の表示形式"');
    expect(html).not.toContain('class="entity-record-list"');
    expect(html).toContain('data-entity-status="not_started"');
  });
});
