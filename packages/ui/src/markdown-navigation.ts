import { markdownListLine } from "./markdown-list-context.js";
import {
  EditorSelection,
  type EditorState,
  type StateCommand,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

const words = new Intl.Segmenter("ja", { granularity: "word" });

export const moveToMarkdownDocumentBoundary =
  (forward: boolean, extend = false): StateCommand =>
  ({ state, dispatch }) => {
    const head = forward
      ? state.doc.length
      : (listContentStart(state, state.doc.line(1).to) ?? 0);
    dispatch(
      state.update({
        selection: EditorSelection.create(
          state.selection.ranges.map((range) =>
            EditorSelection.range(extend ? range.anchor : head, head),
          ),
          state.selection.mainIndex,
        ),
        scrollIntoView: true,
        userEvent: "select",
      }),
    );
    return true;
  };

export const listContentStart = (
  state: EditorState,
  position: number,
): number | null => {
  return markdownListLine(state, position)?.contentFrom ?? null;
};

export const moveToListContent = (
  view: EditorView,
  extend = false,
): boolean => {
  if (
    view.state.selection.ranges.some(
      (range) => listContentStart(view.state, range.head) === null,
    )
  )
    return false;
  view.dispatch({
    selection: EditorSelection.create(
      view.state.selection.ranges.map((range) => {
        const head = listContentStart(view.state, range.head)!;
        return EditorSelection.range(extend ? range.anchor : head, head);
      }),
      view.state.selection.mainIndex,
    ),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
};

export const wordRangeAt = (
  text: string,
  position: number,
): { from: number; to: number } | null => {
  for (const word of words.segment(text)) {
    if (
      word.isWordLike &&
      word.index <= position &&
      position < word.index + word.segment.length
    )
      return { from: word.index, to: word.index + word.segment.length };
  }
  return null;
};

export const wordDestination = (
  state: EditorState,
  position: number,
  forward: boolean,
): number => {
  const line = state.doc.lineAt(position);
  const offset = position - line.from;
  const segments = [...words.segment(line.text)].filter(
    (word) => word.isWordLike,
  );
  const word = forward
    ? segments.find((word) => word.index + word.segment.length > offset)
    : segments.reverse().find((word) => word.index < offset);
  let result =
    word === undefined
      ? forward
        ? Math.min(state.doc.length, line.to + 1)
        : Math.max(0, line.from - 1)
      : line.from + word.index + (forward ? word.segment.length : 0);
  const contentStart = listContentStart(state, position);
  if (!forward && contentStart !== null && position >= contentStart)
    result = Math.max(contentStart, result);
  return result;
};

export const moveByWord = (
  view: EditorView,
  forward: boolean,
  extend = false,
): boolean => {
  view.dispatch({
    selection: EditorSelection.create(
      view.state.selection.ranges.map((range) => {
        const head =
          !extend && !range.empty
            ? forward
              ? range.to
              : range.from
            : wordDestination(view.state, range.head, forward);
        return EditorSelection.range(extend ? range.anchor : head, head);
      }),
      view.state.selection.mainIndex,
    ),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
};

export const deleteWordBackward: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly || state.selection.ranges.some((range) => !range.empty))
    return false;
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const from = wordDestination(state, range.head, false);
        return {
          changes: { from, to: range.head },
          range: EditorSelection.cursor(from),
        };
      }),
      { scrollIntoView: true, userEvent: "delete.backward" },
    ),
  );
  return true;
};
