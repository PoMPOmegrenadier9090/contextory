import {
  EditorSelection,
  StateField,
  type EditorState,
  type Range,
  type StateCommand,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { mouseSelectingField } from "codemirror-live-markdown";
import katex from "katex";

import { markdownMathRanges, type MarkdownMathRange } from "./markdown-math.js";
import { markdownTablePreviewField } from "./markdown-table-preview.js";
import { markdownListLine } from "./markdown-list-context.js";

// Block replacements have no text cursor stops. Reveal their source before
// the normal movement can carry the cursor past the entire formula.
export const moveIntoMarkdownMath = (
  view: EditorView,
  forward: boolean,
  vertical: boolean,
  extend = false,
): boolean => {
  if (view.state.readOnly || !view.state.field(markdownMathField).ranges.length)
    return false;
  if (!extend && view.state.selection.ranges.some((range) => !range.empty))
    return false;
  let entered = false;
  const ranges = view.state.selection.ranges.map((range) => {
    const next = vertical
      ? view.moveVertically(range, forward)
      : view.moveByChar(range, forward);
    let head = next.head;
    const candidates: { from: number; to: number }[] = [];
    view.state
      .field(markdownMathField)
      .decorations.between(
        Math.min(range.head, head),
        Math.max(range.head, head),
        (from, to, decoration) => {
          if (
            (decoration.spec as { widget?: unknown }).widget instanceof
              MathWidget &&
            (forward
              ? range.head < from && head >= from
              : range.head > to && head <= to)
          )
            candidates.push({ from, to });
        },
      );
    const math = forward ? candidates[0] : candidates.at(-1);
    if (math) {
      head = forward ? math.from : math.to;
      entered = true;
    }
    return extend
      ? EditorSelection.range(range.anchor, head)
      : EditorSelection.cursor(
          head,
          next.assoc,
          next.bidiLevel ?? undefined,
          next.goalColumn,
        );
  });
  if (!entered) return false;
  view.dispatch({
    selection: EditorSelection.create(ranges, view.state.selection.mainIndex),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
};

// Math is parsed separately from CodeMirror's Markdown tree, so its Enter
// handling must take priority over the ordinary list continuation commands.
export const insertMarkdownMathNewline: StateCommand = ({
  state,
  dispatch,
}) => {
  if (state.readOnly) return false;
  const formulas = state.field(markdownMathField).ranges;
  if (
    state.selection.ranges.some((range) => {
      const math = formulas.find(
        (math) =>
          math.from < range.from &&
          (range.to <= math.to ||
            (range.to <= state.doc.lineAt(math.to).to &&
              !state.doc.sliceString(math.to, range.to).trim())),
      );
      if (!math) return true;
      const source = state.doc.sliceString(math.from, math.to);
      const opening = /^(\${2,})/.exec(source)?.[1];
      if (!opening) return true;
      if (range.to < math.to) return false;
      // Continue an unfinished dollar fence, but let Enter after a completed
      // formula create the next list item as usual.
      const lines = source.split("\n");
      const closing = /^\s*(\${2,})\s*$/.exec(lines.at(-1)!);
      return lines.length > 1
        ? !!closing && closing[1]!.length >= opening.length
        : !/^\${2,}[ \t]*$/.test(source);
    })
  )
    return false;
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const line = state.doc.lineAt(range.from);
        const context = markdownListLine(state, range.from, true);
        const prefix =
          context?.continuationPrefix ??
          line.text.match(/^[ \t]*(?:>[ \t]*)*/)?.[0] ??
          "";
        const newline = state.lineBreak + prefix;
        const before = state.doc
          .sliceString(context?.contentFrom ?? line.from, range.from)
          .trim();
        const after = state.doc.sliceString(range.to, line.to).trim();
        const paired = /^\${2,}$/.test(before) && before === after;
        return {
          changes: {
            from: range.from,
            to: range.to,
            insert: newline + (paired ? newline : ""),
          },
          range: EditorSelection.cursor(range.from + newline.length),
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    ),
  );
  return true;
};

class MathWidget extends WidgetType {
  constructor(
    readonly math: Pick<MarkdownMathRange, "source" | "displayMode">,
  ) {
    super();
  }

  override eq(other: MathWidget): boolean {
    return (
      this.math.source === other.math.source &&
      this.math.displayMode === other.math.displayMode
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const element = document.createElement(
      this.math.displayMode ? "div" : "span",
    );
    element.className = this.math.displayMode
      ? "pkm-math-block"
      : "pkm-math-inline";
    katex.render(this.math.source, element, {
      displayMode: this.math.displayMode,
      throwOnError: false,
      trust: false,
      strict: "ignore",
    });
    element.addEventListener("mousedown", (event) => {
      if (view.state.readOnly) return;
      event.preventDefault();
      // The DOM can be reused after edits before this formula. Resolve its
      // current position instead of retaining the original document offset.
      view.dispatch({ selection: { anchor: view.posAtDOM(element) + 1 } });
      view.focus();
    });
    return element;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const decorationsFor = (
  state: EditorState,
  ranges: readonly MarkdownMathRange[],
) => {
  const decorations: Range<Decoration>[] = [];
  for (const math of ranges) {
    let insideTable = false;
    state
      .field(markdownTablePreviewField, false)
      ?.between(math.from, math.to, (from, to) => {
        insideTable ||= from <= math.from && to >= math.to;
      });
    if (insideTable) continue;
    const editing =
      !state.readOnly &&
      state.selection.ranges.some(
        ({ from, to }) => from <= math.to && to >= math.from,
      );
    decorations.push(
      (editing
        ? Decoration.mark({ class: "pkm-math-source" })
        : Decoration.replace({
            widget: new MathWidget(math),
            block: math.displayMode,
          })
      ).range(math.from, math.to),
    );
  }
  return Decoration.set(decorations, true);
};

export const markdownMathField = StateField.define({
  create(state) {
    const ranges = markdownMathRanges(state.doc.toString());
    return { ranges, decorations: decorationsFor(state, ranges) };
  },
  update(previous, transaction) {
    // Keep layout fixed while the browser resolves a pointer selection. A
    // mouse press elsewhere is not a request to edit every formula.
    if (
      transaction.state.field(mouseSelectingField, false) &&
      !transaction.docChanged &&
      !transaction.reconfigured
    )
      return previous;
    if (
      !transaction.docChanged &&
      !transaction.selection &&
      !transaction.reconfigured &&
      !transaction.effects.length
    )
      return previous;
    const ranges = transaction.docChanged
      ? markdownMathRanges(transaction.state.doc.toString())
      : previous.ranges;
    return {
      ranges,
      decorations: decorationsFor(transaction.state, ranges),
    };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});
