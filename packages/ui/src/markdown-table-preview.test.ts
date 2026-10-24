import { describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Transaction } from "@codemirror/state";
import { Table } from "@lezer/markdown";
import {
  markdownTablePreviewField,
  protectTableBoundary,
  writeAfterTable,
} from "./markdown-table-preview.js";

const table = "| A | B |\n| --- | --- |\n| a | b |";
const editor = (doc: string, anchor = doc.length, readOnly = false) => {
  let state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [
      markdown({ extensions: [Table] }),
      markdownTablePreviewField,
      EditorState.readOnly.of(readOnly),
    ],
  });
  return {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
  };
};

const previewSource = (state: EditorState) => {
  const sources: string[] = [];
  state
    .field(markdownTablePreviewField)
    .between(0, state.doc.length, (from, to) => {
      sources.push(state.doc.sliceString(from, to));
    });
  return sources;
};

describe("Display-only tables", () => {
  it("never consumes following prose even without a blank separator", () => {
    expect(previewSource(editor(table + "\n本文\n続き").state)).toEqual([
      table,
    ]);
    expect(previewSource(editor(table + "\n\\|本文").state)).toEqual([table]);
    expect(previewSource(editor(table + "\n\n本文").state)).toEqual([table]);
    expect(previewSource(editor("```md\n" + table + "\n```").state)).toEqual(
      [],
    );
  });

  it("protects only the last separator and allows surplus blank lines to be removed", () => {
    for (const gap of ["\n", "\n\n", "\n\n\n"]) {
      const source = table + gap + "本文";
      expect(
        protectTableBoundary()(editor(source, source.indexOf("本文"))),
      ).toBe(gap.length <= 2);
      expect(protectTableBoundary(true)(editor(source, table.length))).toBe(
        gap.length <= 2,
      );
    }
    expect(
      protectTableBoundary()(editor(table + "\n\n本文", table.length + 3)),
    ).toBe(false);
    expect(protectTableBoundary()(editor("普通の本文\n\n次の段落", 8))).toBe(
      false,
    );
  });

  it("creates a paragraph after a terminal table without changing the table", () => {
    const target = editor(table);
    expect(writeAfterTable(target)).toBe(true);
    expect(target.state.doc.toString()).toBe(table + "\n\n");
    expect(target.state.selection.main.head).toBe(table.length + 2);
    expect(previewSource(target.state)).toEqual([table]);
    expect(writeAfterTable(target)).toBe(false);
    expect(writeAfterTable(editor(table, table.length, true))).toBe(false);
  });
});
