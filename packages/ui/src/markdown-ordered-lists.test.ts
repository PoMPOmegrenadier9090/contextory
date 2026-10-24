import { expect, it } from "vitest";
import { orderedListMarkers } from "./markdown-ordered-lists.js";
import { createMarkdownBodyEditorState } from "./markdown-live-editor.js";

it.each([
  ["1. first\n1. second\n1. third", [1, 2, 3]],
  ["3) first\n8) second", [3, 4]],
  ["1. parent\n   5. nested\n   5. nested again\n1. next parent", [1, 2, 5, 6]],
  ["1. \n", [1]],
  ["- bullet\n\n```md\n1. code\n```\n\ntext 1. inline", []],
])(
  "computes preview numbering without changing Markdown: %s",
  (source, numbers) => {
    const state = createMarkdownBodyEditorState(source);
    expect(
      [...orderedListMarkers(state).values()].map((mark) => mark.number),
    ).toEqual(numbers);
    expect(state.doc.toString()).toBe(source);
  },
);

it("replaces the marker and following spaces, leaving the content editable", () => {
  const state = createMarkdownBodyEditorState("12.   text");
  const [from, mark] = [...orderedListMarkers(state)][0]!;
  expect(state.doc.sliceString(from, mark.to)).toBe("12.   ");
  expect(state.doc.sliceString(mark.to)).toBe("text");
});
