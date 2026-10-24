import { describe, expect, it } from "vitest";
import {
  clipboardTableMarkdown,
  tableClipboardCells,
} from "./table-clipboard.js";

describe("table clipboard", () => {
  it("reads spreadsheet cells without a phantom trailing row", () => {
    expect(tableClipboardCells("a\tb\r\nc\t\r\n")).toEqual([
      ["a", "b"],
      ["c", ""],
    ]);
    expect(
      tableClipboardCells('"line\nbreak"\t"a""b"\r\n"tab\tinside"\tplain\r\n'),
    ).toEqual([
      ["line\nbreak", 'a"b'],
      ["tab\tinside", "plain"],
    ]);
  });
  it("formats TSV as ordinary Markdown, escaping pipes and retaining cell Markdown", () => {
    expect(
      clipboardTableMarkdown(
        tableClipboardCells("名前\t値\n左|右\t**日本語**\n"),
      ),
    ).toBe("| 名前 | 値 |\n| --- | --- |\n| 左\\|右 | **日本語** |");
    expect(clipboardTableMarkdown([["A"], ["a", "b"]])).toBe(
      "| A |  |\n| --- | --- |\n| a | b |",
    );
    expect(clipboardTableMarkdown([["A"], ["line\nbreak"]])).toBe(
      "| A |\n| --- |\n| line<br>break |",
    );
  });
});
