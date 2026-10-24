import { describe, expect, it } from "vitest";
import { undo, redo } from "@codemirror/commands";
import { createMarkdownBodyEditorState } from "./markdown-live-editor.js";
import {
  insertTablePart,
  removeTablePart,
  markdownTableRanges,
  tableCellMarkdown,
  tableRowCells,
} from "./markdown-table-editing.js";

const table = "| A | B |\n| :--- | ---: |\n| a | b |";

describe("table editing and paragraph boundaries", () => {
  it("keeps escaped pipes, formatting and alignment when inserting rows/columns", () => {
    expect(
      tableRowCells("| left\\|right | `code` | ").map((cell) => cell.value),
    ).toEqual(["left\\|right", "`code`"]);
    expect(tableRowCells("A | B").map((cell) => cell.value)).toEqual([
      "A",
      "B",
    ]);
    expect(insertTablePart(table, "row", 1)).toBe(
      table.replace("| a |", "|  |  |\n| a |"),
    );
    expect(insertTablePart(table, "column", 1)).toBe(
      "| A |  | B |\n| :--- | --- | ---: |\n| a |  | b |",
    );
    expect(tableCellMarkdown("**a**|b\n$x$")).toBe("**a**\\|b<br>$x$");
    expect(removeTablePart(table, "row", 1)).toBe(table);
    expect(removeTablePart(insertTablePart(table, "row", 2), "row", 2)).toBe(
      table,
    );
    expect(removeTablePart(table, "column", 0)).toBe("| B |\n| ---: |\n| b |");
    expect(removeTablePart("| A |\n| --- |\n| a |", "column", 0)).toBe(
      "| A |\n| --- |\n| a |",
    );
  });

  it.each(["before", "after"])(
    "keeps a real separator when typing in the blank %s a table",
    (side) => {
      const source = "前文\n\n" + table + "\n\n後文";
      let state = createMarkdownBodyEditorState(source);
      const position =
        side === "before"
          ? source.indexOf(table) - 1
          : source.indexOf("後文") - 1;
      state = state.update({
        changes: { from: position, insert: "入力" },
        selection: { anchor: position + 2 },
        userEvent: "input.type",
      }).state;
      expect(state.doc.toString()).toBe(
        side === "before"
          ? "前文\n入力\n\n" + table + "\n\n後文"
          : "前文\n\n" + table + "\n\n入力\n後文",
      );
      expect(
        state.doc.sliceString(
          state.selection.main.head - 2,
          state.selection.main.head,
        ),
      ).toBe("入力");
      expect(
        markdownTableRanges(state).map((range) =>
          state.doc.sliceString(range.from, range.to),
        ),
      ).toEqual([table]);
      const normalized = state.doc.toString();
      state = state.update({
        changes: { from: state.selection.main.head, insert: "続き" },
        userEvent: "input.type",
      }).state;
      expect(state.doc.toString()).toBe(normalized.replace("入力", "入力続き"));
    },
  );

  it.each([0, table.length])(
    "separates text inserted directly at a table edge: %i",
    (position) => {
      const state = createMarkdownBodyEditorState(table).update({
        changes: { from: position, insert: "本文" },
        selection: { anchor: position + 2 },
        userEvent: "input.type",
      }).state;
      expect(state.doc.toString()).toBe(
        position === 0
          ? "本文\n\n" + table + "\n\n"
          : "\n" + table + "\n\n本文",
      );
      expect(
        state.doc.sliceString(
          state.selection.main.head - 2,
          state.selection.main.head,
        ),
      ).toBe("本文");
    },
  );

  it("repairs pasted/deleted separators and groups the repair with Undo/Redo", () => {
    const source = "前文\n\n" + table + "\n\n後文";
    let state = createMarkdownBodyEditorState(source);
    const from = source.indexOf("後文") - 2;
    state = state.update({
      changes: { from, to: from + 2, insert: "貼り付け" },
      selection: { anchor: from + 4 },
      userEvent: "input.paste",
    }).state;
    expect(state.doc.toString()).toBe("前文\n\n" + table + "\n\n貼り付け後文");
    const edited = state.doc.toString();
    const target = {
      get state() {
        return state;
      },
      dispatch(transaction: ReturnType<typeof state.update>) {
        state = transaction.state;
      },
    };
    expect(undo(target)).toBe(true);
    expect(state.doc.toString()).toBe(source);
    expect(redo(target)).toBe(true);
    expect(state.doc.toString()).toBe(edited);
    state = state.update({
      changes: {
        from: state.doc.toString().indexOf(table) - 2,
        to: state.doc.toString().indexOf(table),
      },
      userEvent: "delete.selection",
    }).state;
    expect(state.doc.toString()).toBe(edited);
  });

  it("does not resurrect deleted tables, touch code fences or normalize on selection", () => {
    const state = createMarkdownBodyEditorState(table);
    expect(
      state
        .update({
          changes: { from: 0, to: table.length },
          userEvent: "delete.selection",
        })
        .state.doc.toString(),
    ).toBe("");
    expect(
      state.update({ selection: { anchor: 0 } }).state.doc.toString(),
    ).toBe(table);
    const code = "```md\n" + table + "\n```";
    expect(
      createMarkdownBodyEditorState(code)
        .update({
          changes: { from: code.length, insert: "x" },
          userEvent: "input.type",
        })
        .state.doc.toString(),
    ).toBe(code + "x");
  });
  it("leaves native composition offsets unchanged until composition finishes", () => {
    const source = "前文\n\n" + table + "\n\n後文";
    const from = source.indexOf("後文") - 1;
    const state = createMarkdownBodyEditorState(source).update({
      changes: { from, insert: "変換中" },
      userEvent: "input.type.compose",
    }).state;
    expect(state.doc.toString()).toBe(
      source.slice(0, from) + "変換中" + source.slice(from),
    );
    expect(markdownTableRanges(state)[0]!.source).toBe(table);
  });
});
