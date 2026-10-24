import { undoDepth } from "@codemirror/commands";
import { CompletionContext } from "@codemirror/autocomplete";
import type { EntityType } from "@pkm/contracts";
import { syntaxTree } from "@codemirror/language";
import {
  buildDirectReferenceCompletionOptions,
  MAX_REFERENCE_COMPLETIONS,
} from "@pkm/ui";
import { describe, expect, it } from "vitest";

import {
  createDirectReferenceCompletionSource,
  createMarkdownBodyEditorState,
} from "./markdown-live-editor.js";

describe("Markdown editor history and reference completion", () => {
  it("retains the Markdown source and records Japanese edits in history", () => {
    const source = "# 見出し\n\n本文 **強調**。\n";
    const initial = createMarkdownBodyEditorState(source);
    const edited = initial.update({
      changes: { from: initial.doc.length, insert: "日本語入力\n" },
    }).state;

    expect(initial.doc.toString()).toBe(source);
    expect(edited.doc.toString()).toBe(`${source}日本語入力\n`);
    expect(undoDepth(edited)).toBe(1);
  });

  it("recognizes fenced code blocks", () => {
    const state = createMarkdownBodyEditorState(
      "```typescript\nconst answer = 42;\n```\n",
    );
    const nodeNames: string[] = [];

    syntaxTree(state).iterate({
      enter: (node) => {
        nodeNames.push(node.name);
      },
    });

    expect(nodeNames).toContain("FencedCode");
    expect(nodeNames).toContain("CodeInfo");
    expect(nodeNames).toContain("CodeText");
  });

  it("suggests entities after a double bracket", async () => {
    const state = createMarkdownBodyEditorState("関連: [[pro");
    const source = createDirectReferenceCompletionSource(() => [
      {
        id: "prj_01997c2a-7b1c-7a01-8a10-000000000003",
        type: "project",
        displayName: "PKM開発",
        hierarchy: "Research",
      },
    ]);

    const result = await source(
      new CompletionContext(state, state.doc.length, false),
    );

    expect(result).toMatchObject({
      from: 6,
      options: [
        {
          label: "PKM開発",
          detail: "Research",
          apply: "project:prj_01997c2a-7b1c-7a01-8a10-000000000003|PKM開発]]",
          type: "project",
        },
      ],
    });
  });

  it("limits suggestions before rendering them", async () => {
    const state = createMarkdownBodyEditorState("[[");
    const source = createDirectReferenceCompletionSource(() =>
      Array.from({ length: MAX_REFERENCE_COMPLETIONS + 10 }, (_, index) => ({
        id: `entity-${index}`,
        type: "entry",
        displayName: `Entry ${index}`,
      })),
    );

    const result = await source(
      new CompletionContext(state, state.doc.length, false),
    );

    expect(result?.options).toHaveLength(MAX_REFERENCE_COMPLETIONS);
  });

  it("uses the entity hierarchy instead of IDs in suggestion details", () => {
    const options = buildDirectReferenceCompletionOptions([
      {
        id: "area-1",
        type: "area",
        displayName: "Research",
        areaId: null,
        projectId: null,
        taskId: null,
        resourceId: null,
      },
      {
        id: "project-1",
        type: "project",
        displayName: "PKM開発",
        areaId: "area-1",
        projectId: null,
        taskId: null,
        resourceId: null,
      },
      {
        id: "task-1",
        type: "task",
        displayName: "Editorを実装",
        areaId: null,
        projectId: "project-1",
        taskId: null,
        resourceId: null,
      },
      {
        id: "entry-1",
        type: "entry",
        displayName: "実装メモ",
        areaId: null,
        projectId: null,
        taskId: "task-1",
        resourceId: null,
      },
    ]);

    expect(options.at(-1)?.hierarchy).toBe("Research > PKM開発 > Editorを実装");
  });

  it.each(["area", "project", "task", "entry", "resource", "topic"] as const)(
    "treats %s: as a type filter before requesting candidates",
    async (type) => {
      const calls: { query: string; type: EntityType | undefined }[] = [];
      const source = createDirectReferenceCompletionSource(
        (query, requestedType) => {
          calls.push({ query, type: requestedType });
          return Promise.resolve([
            { id: "matching", type, displayName: "研究" },
            { id: "wrong-type", type: "other", displayName: "研究" },
          ]);
        },
      );
      for (const query of ["", "研究"]) {
        const state = createMarkdownBodyEditorState(`[[${type}:${query}`);
        const result = await source(
          new CompletionContext(state, state.doc.length, false),
        );
        expect(result?.options.map((option) => option.label)).toEqual(["研究"]);
        expect(result?.options[0]?.apply).toBe(`${type}:matching|研究]]`);
      }
      expect(calls).toEqual([
        { query: "", type },
        { query: "研究", type },
      ]);
    },
  );

  it("labels untitled references with a timestamp without reading their body", async () => {
    const options = buildDirectReferenceCompletionOptions([
      {
        id: "ent_example",
        type: "entry",
        displayName: null,
        get body(): string {
          throw new Error("Completion must not read Markdown");
        },
        createdAt: "2026-10-18T00:00:00Z",
        areaId: null,
        projectId: null,
        taskId: null,
        resourceId: null,
      },
    ]);
    expect(options[0]).toMatchObject({
      displayName: null,
      label: "2026/10/18 09:00",
      hierarchy: "entry · 2026/10/18 09:00",
    });
    const state = createMarkdownBodyEditorState("[[entry:2026");
    const result = await createDirectReferenceCompletionSource(() => options)(
      new CompletionContext(state, state.doc.length, false),
    );
    expect(result?.options[0]?.apply).toBe(
      "entry:ent_example|2026/10/18 09:00]]",
    );
    expect(result?.options[0]?.label).not.toContain("ent_");
  });

  it("uses a placeholder without generating a label from Markdown", () => {
    const base = {
      areaId: null,
      projectId: null,
      taskId: null,
      resourceId: null,
    };
    const projectId = "prj_01997c2a-7b1c-7a01-8a10-000000000003";
    const options = buildDirectReferenceCompletionOptions([
      { ...base, id: projectId, type: "project", displayName: "研究" },
      {
        ...base,
        id: "untitled",
        type: "entry",
        displayName: null,
        body: `確認 [[project:${projectId}]] と [[project:${projectId}|実験]]`,
      },
    ]);
    expect(options[1]?.label).toBe("無題のEntry");
  });
});
