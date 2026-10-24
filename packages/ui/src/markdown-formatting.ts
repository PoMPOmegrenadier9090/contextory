import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type StateCommand,
  type ChangeSpec,
  type SelectionRange,
} from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { markdownListLine } from "./markdown-list-context.js";
export type InlineFormat = "bold" | "italic" | "strike";
const formats = {
  bold: {
    node: "StrongEmphasis",
    mark: "EmphasisMark",
    open: "**",
    close: "**",
  },
  italic: { node: "Emphasis", mark: "EmphasisMark", open: "*", close: "*" },
  strike: {
    node: "Strikethrough",
    mark: "StrikethroughMark",
    open: "~~",
    close: "~~",
  },
} as const;

interface PendingFormatting {
  readonly position: number;
  readonly compositionFrom?: number;
  readonly formats: readonly InlineFormat[];
}
const setPending = StateEffect.define<PendingFormatting | null>();
export const pendingInlineFormatting =
  StateField.define<PendingFormatting | null>({
    create: () => null,
    update(previous, transaction) {
      for (const effect of transaction.effects)
        if (effect.is(setPending)) return effect.value;
      if (!previous) return null;
      const position = transaction.changes.mapPos(previous.position, 1);
      if (transaction.isUserEvent("input.type.compose"))
        return {
          ...previous,
          position,
          compositionFrom: transaction.changes.mapPos(
            previous.compositionFrom ?? previous.position,
            -1,
          ),
        };
      const selection = transaction.newSelection.main;
      if (
        previous.compositionFrom !== undefined &&
        !transaction.docChanged &&
        !transaction.isUserEvent("select.pointer") &&
        selection.from >= previous.compositionFrom &&
        selection.to <= position
      )
        return previous;
      if (!selection.empty || selection.head !== position) return null;
      if (transaction.docChanged && !transaction.isUserEvent("input.type"))
        return null;
      return { ...previous, position };
    },
  });

const codeAt = (state: EditorState, position: number): boolean => {
  for (
    let node = syntaxTree(state).resolveInner(position, -1);
    ;
    node = node.parent!
  ) {
    if (
      ["InlineCode", "FencedCode", "CodeBlock", "HTMLBlock"].includes(node.name)
    )
      return true;
    if (!node.parent) return false;
  }
};

const activeFormat = (
  state: EditorState,
  from: number,
  to: number,
  format: InlineFormat,
  includeDelimiters = false,
) => {
  const definition = formats[format];
  for (
    let node = syntaxTree(state).resolveInner(from, 1);
    ;
    node = node.parent!
  ) {
    if (node.name === definition.node && node.to >= to) {
      const marks = node.getChildren(definition.mark);
      const open = marks[0];
      const close = marks.at(-1);
      if (
        open &&
        close &&
        open !== close &&
        from >= (includeDelimiters ? node.from : open.to) &&
        to <= (includeDelimiters ? node.to : close.from)
      )
        return { node, open, close };
    }
    if (!node.parent) return null;
  }
};

export const isInlineFormatActive = (
  state: EditorState,
  format: InlineFormat,
): boolean =>
  state.field(pendingInlineFormatting, false)?.formats.includes(format) ===
    true ||
  activeFormat(
    state,
    state.selection.main.from,
    state.selection.main.to,
    format,
  ) !== null;

const graphemes = new Intl.Segmenter("ja", { granularity: "grapheme" });
export const deleteInlineFormatBoundary =
  (forward = false): StateCommand =>
  (target) => {
    const { state, dispatch } = target;
    const range = state.selection.main;
    if (
      state.readOnly ||
      !range.empty ||
      state.selection.ranges.length !== 1 ||
      codeAt(state, range.head)
    )
      return false;
    for (const format of Object.keys(formats) as InlineFormat[]) {
      const active = activeFormat(state, range.head, range.head, format);
      if (!active) continue;
      const boundary = forward ? active.close.from : active.open.to;
      if (range.head === boundary) {
        const changes = state.changes([
          { from: active.open.from, to: active.open.to },
          { from: active.close.from, to: active.close.to },
        ]);
        dispatch(
          state.update({
            changes,
            selection: range.map(changes),
            userEvent: forward ? "delete.forward" : "delete.backward",
          }),
        );
        return true;
      }
      const content = state.doc.sliceString(active.open.to, active.close.from);
      if (
        range.head === (forward ? active.open.to : active.close.from) &&
        [...graphemes.segment(content)].length === 1
      ) {
        dispatch(
          state.update({
            changes: { from: active.node.from, to: active.node.to },
            selection: { anchor: active.node.from },
            effects: setPending.of({
              position: active.node.from,
              formats: [format],
            }),
            userEvent: forward ? "delete.forward" : "delete.backward",
          }),
        );
        return true;
      }
    }
    return false;
  };

export const toggleInlineFormat =
  (format: InlineFormat): StateCommand =>
  ({ state, dispatch }) => {
    if (state.readOnly) return true;
    if (
      state.selection.ranges.some(
        (range) => codeAt(state, range.from) || codeAt(state, range.to),
      )
    )
      return true;
    const main = state.selection.main;
    const active = activeFormat(state, main.from, main.to, format);
    if (main.empty && !active) {
      const before =
        main.head > 0
          ? activeFormat(state, main.head - 1, main.head, format, true)
          : null;
      const after =
        main.head < state.doc.length
          ? activeFormat(state, main.head, main.head + 1, format, true)
          : null;
      const adjacent =
        before?.node.to === main.head
          ? before.close.from
          : after?.node.from === main.head
            ? after.open.to
            : null;
      if (adjacent !== null) {
        dispatch(
          state.update({
            selection: { anchor: adjacent },
            effects: setPending.of(null),
            userEvent: "select",
          }),
        );
        return true;
      }
      const previous = state.field(pendingInlineFormatting, false);
      const enabled = previous?.position === main.head ? previous.formats : [];
      const next = enabled.includes(format)
        ? enabled.filter((value) => value !== format)
        : [...enabled, format];
      dispatch(
        state.update({
          effects: setPending.of(
            next.length ? { position: main.head, formats: next } : null,
          ),
          annotations: Transaction.addToHistory.of(false),
        }),
      );
      return true;
    }
    // At the end of a formatted run, toggle off for subsequent input while
    // keeping the already-written text formatted.
    if (main.empty && active && main.head === active.close.from) {
      dispatch(
        state.update({
          selection: { anchor: active.close.to },
          effects: setPending.of(null),
          userEvent: "select",
        }),
      );
      return true;
    }
    const definition = formats[format];
    const result = state.changeByRange((range) => {
      const existing = activeFormat(state, range.from, range.to, format);
      if (existing) {
        if (
          !range.empty &&
          (range.from > existing.open.to || range.to < existing.close.from)
        ) {
          const wrap = (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return text;
            const start = text.indexOf(trimmed);
            return (
              text.slice(0, start) +
              definition.open +
              trimmed +
              definition.close +
              text.slice(start + trimmed.length)
            );
          };
          const before = wrap(
            state.doc.sliceString(existing.open.to, range.from),
          );
          const selected = state.doc.sliceString(range.from, range.to);
          const after = wrap(
            state.doc.sliceString(range.to, existing.close.from),
          );
          const from = existing.node.from + before.length;
          const to = from + selected.length;
          return {
            changes: {
              from: existing.node.from,
              to: existing.node.to,
              insert: before + selected + after,
            },
            range: EditorSelection.range(
              range.anchor <= range.head ? from : to,
              range.anchor <= range.head ? to : from,
            ),
          };
        }
        const changes = state.changes([
          { from: existing.open.from, to: existing.open.to },
          { from: existing.close.from, to: existing.close.to },
        ]);
        return { changes, range: range.map(changes) };
      }
      const segments: { from: number; to: number }[] = [];
      const first = state.doc.lineAt(range.from).number;
      const last = state.doc.lineAt(range.to).number;
      for (let number = first; number <= last; number++) {
        const line = state.doc.line(number);
        let from = Math.max(range.from, line.from);
        const to = Math.min(range.to, line.to);
        const list = markdownListLine(state, line.to);
        if (list) from = Math.max(from, list.contentFrom);
        syntaxTree(state).iterate({
          from: line.from,
          to: from,
          enter(node) {
            if (
              !["HeaderMark", "QuoteMark"].includes(node.name) ||
              node.to > to
            )
              return;
            const spacing =
              state.doc.sliceString(node.to, to).match(/^[ \t]*/)?.[0].length ??
              0;
            from = Math.max(from, node.to + spacing);
          },
        });
        const text = state.doc.sliceString(from, to);
        const leading = text.match(/^[ \t]*/)?.[0].length ?? 0;
        const trailing = text.match(/[ \t]*$/)?.[0].length ?? 0;
        if (leading + trailing >= text.length) continue;
        segments.push({ from: from + leading, to: to - trailing });
      }
      const remove = segments.every(({ from, to }) =>
        activeFormat(state, from, to, format, true),
      );
      const changes: ChangeSpec[] = [];
      const removed = new Set<number>();
      for (const { from, to } of segments) {
        const existingLine = activeFormat(state, from, to, format, true);
        if (existingLine) {
          if (remove && !removed.has(existingLine.node.from)) {
            changes.push(
              { from: existingLine.open.from, to: existingLine.open.to },
              { from: existingLine.close.from, to: existingLine.close.to },
            );
            removed.add(existingLine.node.from);
          }
          continue;
        }
        syntaxTree(state).iterate({
          from,
          to,
          enter(node) {
            if (
              node.name !== definition.node ||
              node.from < from ||
              node.to > to
            )
              return;
            for (const mark of node.node.getChildren(definition.mark))
              changes.push({ from: mark.from, to: mark.to });
          },
        });
        changes.push(
          { from, insert: definition.open },
          { from: to, insert: definition.close },
        );
      }
      const changeSet = state.changes(changes);
      return {
        changes: changeSet,
        range: EditorSelection.range(
          changeSet.mapPos(range.anchor, range.anchor <= range.head ? 1 : -1),
          changeSet.mapPos(range.head, range.head >= range.anchor ? -1 : 1),
        ),
      };
    });
    dispatch(
      state.update(result, {
        effects: setPending.of(null),
        userEvent: "input.format",
        scrollIntoView: true,
      }),
    );
    return true;
  };

export const inlineFormattingInput = EditorState.transactionFilter.of(
  (transaction) => {
    const pending = transaction.startState.field(
      pendingInlineFormatting,
      false,
    );
    if (
      !pending ||
      pending.compositionFrom !== undefined ||
      transaction.isUserEvent("input.type.compose") ||
      !transaction.docChanged ||
      !(
        transaction.isUserEvent("input.type") ||
        transaction.isUserEvent("input.paste")
      )
    )
      return transaction;
    let insertion: { from: number; to: number; text: string } | null = null;
    let count = 0;
    transaction.changes.iterChanges((from, to, fromNew, toNew, inserted) => {
      count++;
      if (from === pending.position && to === from)
        insertion = { from: fromNew, to: toNew, text: inserted.toString() };
      else {
        const context = markdownListLine(
          transaction.startState,
          pending.position,
        );
        if (
          !context ||
          from !== context.line.from ||
          to !== pending.position ||
          context.contentFrom !== pending.position
        )
          return;
        const task = context.task
          ? transaction.startState.doc.sliceString(
              context.task.from,
              context.task.to,
            ) + " "
          : "";
        const prefix = `${context.leading}${context.marker} ${task}`;
        const text = inserted.toString();
        if (text.startsWith(prefix))
          insertion = {
            from: fromNew + prefix.length,
            to: toNew,
            text: text.slice(prefix.length),
          };
      }
    });
    const change = insertion as {
      from: number;
      to: number;
      text: string;
    } | null;
    if (
      count !== 1 ||
      !change ||
      !change.text.trim() ||
      change.text.includes("\n")
    )
      return transaction;
    const leading = change.text.match(/^[ \t]*/)?.[0].length ?? 0;
    const trailing = change.text.match(/[ \t]*$/)?.[0].length ?? 0;
    const open = pending.formats.map((format) => formats[format].open).join("");
    const close = [...pending.formats]
      .reverse()
      .map((format) => formats[format].close)
      .join("");
    return [
      transaction,
      {
        sequential: true,
        changes: [
          { from: change.from + leading, insert: open },
          { from: change.to - trailing, insert: close },
        ],
        selection: {
          anchor: change.to + open.length + (trailing ? close.length : 0),
        },
        effects: setPending.of(null),
      },
    ];
  },
);

// Let the browser finish its composition before adding hidden delimiters.
export const finishInlineComposition: StateCommand = ({ state, dispatch }) => {
  const pending = state.field(pendingInlineFormatting, false);
  if (!pending || pending.compositionFrom === undefined || state.readOnly)
    return false;
  const from = pending.compositionFrom;
  const to = pending.position;
  const text = state.doc.sliceString(from, to);
  if (!text.trim() || text.includes("\n")) {
    dispatch(
      state.update({
        effects: setPending.of(
          text.includes("\n")
            ? null
            : { position: to, formats: pending.formats },
        ),
      }),
    );
    return true;
  }
  const leading = text.match(/^[ \t]*/)?.[0].length ?? 0;
  const trailing = text.match(/[ \t]*$/)?.[0].length ?? 0;
  const open = pending.formats.map((format) => formats[format].open).join("");
  const close = [...pending.formats]
    .reverse()
    .map((format) => formats[format].close)
    .join("");
  dispatch(
    state.update({
      changes: [
        { from: from + leading, insert: open },
        { from: to - trailing, insert: close },
      ],
      selection: { anchor: to + open.length + (trailing ? close.length : 0) },
      effects: setPending.of(null),
      userEvent: "input.type.compose",
    }),
  );
  return true;
};

export const inlineComposition = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | null = null;
    composedSelection: SelectionRange | null = null;
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (
        update.transactions.some((transaction) =>
          transaction.isUserEvent("input.type.compose"),
        )
      ) {
        const selection = update.state.selection.main;
        this.composedSelection = selection.empty ? null : selection;
      } else if (update.selectionSet || update.docChanged) {
        this.composedSelection = null;
      }
      this.schedule();
    }
    schedule() {
      if (
        (this.view.state.field(pendingInlineFormatting)?.compositionFrom ===
          undefined &&
          !this.composedSelection) ||
        this.timer !== null
      )
        return;
      this.timer = setTimeout(() => this.finish(), 60);
    }
    finish() {
      this.timer = null;
      if (this.view.compositionStarted) {
        this.schedule();
        return;
      }
      // Some IMEs leave their conversion range selected after committing.
      const selection = this.composedSelection;
      this.composedSelection = null;
      if (selection && this.view.state.selection.main.eq(selection))
        this.view.dispatch({
          selection: { anchor: selection.to },
          userEvent: "select",
        });
      finishInlineComposition(this.view);
    }
    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
    }
  },
);
