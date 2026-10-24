import { describe, expect, it } from "vitest";
import type { Transaction } from "@codemirror/state";
import { createMarkdownBodyEditorState } from "./markdown-live-editor.js";
import {
  listContentStart,
  wordDestination,
  wordRangeAt,
  moveToMarkdownDocumentBoundary,
} from "./markdown-navigation.js";

describe("Markdown cursor boundaries", () => {
  it("moves past a table to document boundaries without entering the first list marker", () => {
    let state = createMarkdownBodyEditorState(
      "- first\n\n| A |\n| --- |\n| a |\n\n- last",
    );
    const target = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = transaction.state;
      },
    };
    moveToMarkdownDocumentBoundary(false)(target);
    expect(state.selection.main.head).toBe(2);
    moveToMarkdownDocumentBoundary(true, true)(target);
    expect(state.selection.main.anchor).toBe(2);
    expect(state.selection.main.head).toBe(state.doc.length);
  });
  it("stops after unordered, numbered, nested and task list prefixes", () => {
    for (const [source, expected] of [
      ["- 本文", 2],
      ["12. 本文", 4],
      ["> - [ ] 本文", 8],
      ["- 親\n  - 子", 8],
      ["- [x] 完了", 6],
    ] as const) {
      expect(
        listContentStart(createMarkdownBodyEditorState(source), source.length),
      ).toBe(expected);
    }
    const code = "```\n- literal\n```";
    expect(listContentStart(createMarkdownBodyEditorState(code), 8)).toBeNull();
    expect(
      listContentStart(createMarkdownBodyEditorState("本文"), 2),
    ).toBeNull();
  });

  it("moves across Japanese words and punctuation without crossing list markers", () => {
    const state = createMarkdownBodyEditorState("- 日本語の入力、hello world");
    expect(wordDestination(state, 2, true)).toBe(5);
    expect(wordDestination(state, 5, false)).toBe(2);
    expect(wordDestination(state, 2, false)).toBe(2);
    expect(wordDestination(state, 8, true)).toBe(14);
    expect(wordDestination(state, 14, false)).toBe(9);
    expect(wordRangeAt("日本語の入力", 1)).toEqual({ from: 0, to: 3 });
  });
});
