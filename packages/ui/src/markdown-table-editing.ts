import { syntaxTree } from "@codemirror/language";
import {
  Annotation,
  EditorSelection,
  type EditorState,
  type Transaction,
} from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

export const tableBoundaryRepair = Annotation.define<boolean>();

export const tableRowCells = (source: string) => {
  const pipes: number[] = [];
  let slashes = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === "|" && slashes % 2 === 0) pipes.push(index);
    slashes = character === "\\" ? slashes + 1 : 0;
  }
  const leading = pipes[0] === source.search(/\S/);
  const trailing =
    pipes.length > 0 && source.slice(pipes.at(-1)! + 1).trim() === "";
  const boundaries = [-1, ...pipes, source.length];
  const cells: { from: number; to: number; value: string }[] = [];
  for (
    let index = leading ? 1 : 0;
    index < boundaries.length - 1 - (trailing ? 1 : 0);
    index++
  ) {
    const start = boundaries[index]! + 1;
    const text = source.slice(start, boundaries[index + 1]);
    const from = start + text.length - text.trimStart().length;
    cells.push({ from, to: from + text.trim().length, value: text.trim() });
  }
  return cells;
};

export const tableCellMarkdown = (value: string) =>
  value
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "<br>")
    .replace(/\\*\|/g, (pipe) => (pipe.length % 2 === 1 ? `\\${pipe}` : pipe));

export const insertTablePart = (
  source: string,
  axis: "row" | "column",
  index: number,
) => {
  const lines = source.split("\n");
  const width = tableRowCells(lines[1]!).length;
  if (axis === "row") {
    lines.splice(
      Math.max(1, index) + 1,
      0,
      `| ${Array<string>(width).fill("").join(" | ")} |`,
    );
    return lines.join("\n");
  }
  return lines
    .map((line, row) => {
      const cells = tableRowCells(line).map((cell) => cell.value);
      while (cells.length < width) cells.push("");
      cells.splice(index, 0, row === 1 ? "---" : "");
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");
};

export const removeTablePart = (
  source: string,
  axis: "row" | "column",
  index: number,
) => {
  const lines = source.split("\n");
  if (axis === "row") {
    if (index === 0 || lines.length <= 3) return source;
    lines.splice(index + 1, 1);
    return lines.join("\n");
  }
  if (tableRowCells(lines[1]!).length <= 1) return source;
  return lines
    .map((line) => {
      const cells = tableRowCells(line).map((cell) => cell.value);
      cells.splice(index, 1);
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");
};

// Do not let a parser's permissive TableRow consume the following paragraph.
export const markdownTableRanges = (state: EditorState) => {
  const ranges: {
    from: number;
    to: number;
    topLevel: boolean;
    source: string;
  }[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return;
      let to = node.from;
      const rows: string[] = [];
      for (let row = node.node.firstChild; row; row = row.nextSibling) {
        if (!["TableHeader", "TableDelimiter", "TableRow"].includes(row.name))
          continue;
        if (row.name === "TableRow" && !row.getChild("TableDelimiter")) break;
        to = row.to;
        rows.push(state.doc.sliceString(row.from, row.to));
      }
      ranges.push({
        from: node.from,
        to,
        source: rows.join("\n"),
        topLevel:
          node.node.parent?.name === "Document" &&
          state.doc.lineAt(node.from).from === node.from,
      });
      return false;
    },
  });
  return ranges;
};

// Track the old table too: typing at its edge may already have changed parsing.
export const tableBoundaryTransaction = (transaction: Transaction) => {
  if (
    !transaction.docChanged ||
    transaction.startState.readOnly ||
    transaction.isUserEvent("input.type.compose") ||
    transaction.isUserEvent("undo") ||
    transaction.isUserEvent("redo")
  )
    return transaction;
  const ranges = markdownTableRanges(transaction.state).filter(
    (range) => range.topLevel,
  );
  for (const range of markdownTableRanges(transaction.startState)) {
    if (!range.topLevel) continue;
    let replaced = false;
    transaction.changes.iterChangedRanges((from, to) => {
      replaced ||= to > from && from <= range.from && to >= range.to;
    });
    if (replaced) continue;
    const from = transaction.changes.mapPos(range.from, 1);
    const to = transaction.changes.mapPos(range.to, -1);
    // A deliberately broken/deleted header is no longer a table.
    const lines = transaction.newDoc
      .sliceString(from, Math.max(from, to))
      .split("\n");
    if (
      lines.length < 2 ||
      !/^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[1]!)
    )
      continue;
    for (let index = ranges.length - 1; index >= 0; index--) {
      const current = ranges[index]!;
      if (current.from <= to && current.to >= from) ranges.splice(index, 1);
    }
    ranges.push({ from, to, topLevel: true, source: lines.join("\n") });
  }
  const repair = tableBoundaryChanges(transaction.state, ranges);
  return repair ? [transaction, { ...repair, sequential: true }] : transaction;
};

const tableBoundaryChanges = (
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
) => {
  const additions = new Map<number, { count: number; before: boolean }>();
  const add = (from: number, count: number, before: boolean) => {
    if (count > (additions.get(from)?.count ?? 0))
      additions.set(from, { count, before });
  };
  for (const { from, to } of ranges) {
    const before = state.doc.sliceString(0, from);
    const after = state.doc.sliceString(to);
    const preceding = /\n*$/.exec(before)![0].length;
    add(from, (before.trim() === "" ? 1 : 2) - preceding, true);
    add(to, 2 - /^\n*/.exec(after)![0].length, false);
  }
  if (!additions.size) return null;
  const changes = state.changes(
    [...additions]
      .sort(([a], [b]) => a - b)
      .map(([from, { count }]) => ({ from, insert: "\n".repeat(count) })),
  );
  const mapPosition = (position: number) =>
    changes.mapPos(position, additions.get(position)?.before ? -1 : 1);
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) =>
      EditorSelection.range(mapPosition(range.anchor), mapPosition(range.head)),
    ),
    state.selection.mainIndex,
  );
  return { changes, selection };
};

// EditContext cannot safely shift the composition's start while IME is active.
export const tableBoundaryComposition = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | null = null;
    pendingDocument: EditorState["doc"] | null = null;
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      // The first IME change may still be tagged as ordinary input.type.
      if (
        update.docChanged &&
        (this.view.compositionStarted ||
          update.transactions.some((transaction) =>
            transaction.isUserEvent("input.type.compose"),
          ))
      ) {
        this.pendingDocument = update.state.doc;
        this.schedule();
      }
    }
    schedule() {
      if (this.timer !== null) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.view.compositionStarted) {
          this.schedule();
          return;
        }
        if (this.view.state.doc !== this.pendingDocument) return;
        this.pendingDocument = null;
        if (this.view.state.readOnly) return;
        const repair = tableBoundaryChanges(
          this.view.state,
          markdownTableRanges(this.view.state).filter(
            (range) => range.topLevel,
          ),
        );
        if (repair)
          this.view.dispatch({
            ...repair,
            annotations: tableBoundaryRepair.of(true),
            userEvent: "input.type",
          });
      }, 30);
    }
    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
    }
  },
);
