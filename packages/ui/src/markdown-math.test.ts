import { describe, expect, it } from "vitest";
import { markdownMathRanges } from "./markdown-math.js";
import {
  markdownMathField,
  insertMarkdownMathNewline,
} from "./markdown-math-editor.js";
import { createMarkdownBodyEditorState } from "./markdown-live-editor.js";
import { undo } from "@codemirror/commands";

describe("Markdown math", () => {
  it("parses inline, display, and fenced formulas with source positions", () => {
    const body = "式 $E=mc^2$\n\n$$\n\\frac{1}{2}\n$$\n\n```math\nx^2\n```";
    const ranges = markdownMathRanges(body);
    expect(
      ranges.map(({ source, displayMode }) => ({ source, displayMode })),
    ).toEqual([
      { source: "E=mc^2", displayMode: false },
      { source: "\\frac{1}{2}", displayMode: true },
      { source: "x^2", displayMode: true },
    ]);
    expect(ranges.map(({ from, to }) => body.slice(from, to))).toEqual([
      "$E=mc^2$",
      "$$\n\\frac{1}{2}\n$$",
      "```math\nx^2\n```",
    ]);
  });

  it("keeps escaped dollars, ordinary inline code and code blocks literal", () => {
    expect(
      markdownMathRanges(
        "\\$5 and \\$10\n\n`$x$`\n\n```js\nconst formula = '$x$';\n```\n\n$unclosed",
      ),
    ).toEqual([]);
  });

  it("switches formulas between widgets and source without changing the document", () => {
    const body = "本文\n\n$$\nx^2\n$$\n\n末尾";
    let state = createMarkdownBodyEditorState(body);
    const math = state.field(markdownMathField).ranges[0]!;
    const spec = () =>
      state.field(markdownMathField).decorations.iter().value?.spec as {
        widget?: unknown;
        class?: string;
      };
    expect(spec().widget).toBeDefined();
    state = state.update({ selection: { anchor: math.from + 1 } }).state;
    expect(spec().class).toBe("pkm-math-source");
    state = state.update({ selection: { anchor: body.length } }).state;
    expect(spec().widget).toBeDefined();
    expect(state.doc.toString()).toBe(body);
    state = state.update({
      changes: { from: math.from, to: math.to, insert: "$y$" },
    }).state;
    expect(state.field(markdownMathField).ranges[0]?.source).toBe("y");
  });

  it.each([
    ["$$¦$$", "$$\n¦\n$$"],
    ["- $$¦$$", "- $$\n  ¦\n  $$"],
    ["1. $$¦$$", "1. $$\n   ¦\n   $$"],
    ["- parent\n  - $$¦$$", "- parent\n  - $$\n    ¦\n    $$"],
    ["- $$¦", "- $$\n  ¦"],
    ["- $$\n  ¦", "- $$\n  \n  ¦"],
    ["- $$\n  x¦\n  $$", "- $$\n  x\n  ¦\n  $$"],
    ["- $$x¦$$", "- $$x\n  ¦$$"],
  ])("keeps Enter inside a dollar formula: %j", (input, expected) => {
    const source = input.replace("¦", "");
    let state = createMarkdownBodyEditorState(source).update({
      selection: { anchor: input.indexOf("¦") },
    }).state;
    const target = {
      get state() {
        return state;
      },
      dispatch: (transaction: { state: typeof state }) => {
        state = transaction.state;
      },
    };
    expect(insertMarkdownMathNewline(target)).toBe(true);
    expect(state.doc.toString()).toBe(expected.replace("¦", ""));
    expect(state.selection.main.head).toBe(expected.indexOf("¦"));
    expect(undo(target)).toBe(true);
    expect(state.doc.toString()).toBe(source);
  });

  it.each([
    "- text¦",
    "- $x¦$",
    "- $$x$$¦",
    "- $$\n  x\n  $$¦",
    "- `$X¦$`",
    "```md\n$$¦$$\n```",
    "    $$¦$$",
  ])("leaves ordinary Enter handling intact: %j", (input) => {
    const source = input.replace("¦", "");
    const state = createMarkdownBodyEditorState(source).update({
      selection: { anchor: input.indexOf("¦") },
    }).state;
    expect(
      insertMarkdownMathNewline({
        state,
        dispatch: () => {
          throw new Error("Unexpected math newline");
        },
      }),
    ).toBe(false);
  });
});
