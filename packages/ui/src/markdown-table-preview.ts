import { isolateHistory, redo, undo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  insertTablePart,
  markdownTableRanges,
  tableCellMarkdown,
  tableRowCells,
} from "./markdown-table-editing.js";
import {
  StateField,
  type EditorState,
  type StateCommand,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { RootContent } from "mdast";
import katex from "katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

const appendContent = (parent: HTMLElement, node: RootContent): void => {
  if (node.type === "inlineMath") {
    const span = parent.appendChild(document.createElement("span"));
    katex.render(node.value, span, {
      throwOnError: false,
      trust: false,
      strict: "ignore",
    });
  } else if ("children" in node) {
    const tag =
      node.type === "strong"
        ? "strong"
        : node.type === "emphasis"
          ? "em"
          : node.type === "delete"
            ? "del"
            : null;
    const target = tag
      ? parent.appendChild(document.createElement(tag))
      : parent;
    node.children.forEach((child) => appendContent(target, child));
  } else if (
    node.type === "break" ||
    (node.type === "html" && /^<br\s*\/?\s*>$/i.test(node.value))
  ) {
    parent.appendChild(document.createElement("br"));
  } else if (node.type === "inlineCode") {
    parent.appendChild(document.createElement("code")).textContent = node.value;
  } else if ("value" in node) {
    parent.appendChild(document.createTextNode(node.value));
  } else if (node.type === "image") {
    parent.appendChild(document.createTextNode(node.alt ?? ""));
  }
};

interface TableData {
  from: number;
  to: number;
  source: string;
  editable: boolean;
}

const tableControllers = new WeakMap<HTMLElement, { data: TableData }>();
const tableRows = (source: string) =>
  source.split("\n").filter((_, index) => index !== 1);
const cellText = (value: string) => value.replace(/<br\s*\/?\s*>/gi, "\n");

const renderCells = (wrapper: HTMLElement, data: TableData) => {
  const parsed = parser
    .parse(data.source)
    .children.find((node) => node.type === "table");
  if (!parsed) return;
  wrapper.querySelectorAll<HTMLTableRowElement>("tr").forEach((tr, row) => {
    [...tr.cells].forEach((cell, column) => {
      const display = cell.querySelector<HTMLElement>(
        ".pkm-table-cell-display",
      )!;
      const input = cell.querySelector("textarea");
      const raw =
        tableRowCells(tableRows(data.source)[row] ?? "")[column]?.value ?? "";
      cell.style.textAlign = parsed.align?.[column] ?? "left";
      if (input) {
        // Keep the native input and its composition/caret alive during redraws.
        if (
          input.dataset.composing !== "true" &&
          input.dataset.writing !== "true" &&
          input.value !== cellText(raw)
        ) {
          const start = input.selectionStart;
          const end = input.selectionEnd;
          input.value = cellText(raw);
          input.setSelectionRange(
            Math.min(start, input.value.length),
            Math.min(end, input.value.length),
          );
        }
        if (
          input.dataset.writing !== "true" &&
          input.dataset.composing !== "true"
        )
          display.textContent =
            input.value + (input.value.endsWith("\n") ? "\u200b" : "");
        return;
      }
      display.replaceChildren();
      parsed.children[row]?.children[column]?.children.forEach((child) =>
        appendContent(display, child),
      );
    });
  });
};

const editTableCell = (
  view: EditorView,
  wrapper: HTMLElement,
  row: number,
  column: number,
  pointer?: { x: number; y: number },
) => {
  const controller = tableControllers.get(wrapper)!;
  if (!controller.data.editable || view.state.readOnly) return;
  const cell = wrapper.querySelectorAll("tr")[row]?.cells[column];
  if (!cell) return;
  const existing = cell.querySelector("textarea");
  if (existing) {
    existing.focus();
    return;
  }
  const input = document.createElement("textarea");
  input.className = "pkm-table-cell-input";
  input.setAttribute("aria-label", `表の${row + 1}行${column + 1}列`);
  input.value = cellText(
    tableRowCells(tableRows(controller.data.source)[row]!)[column]?.value ?? "",
  );
  input.rows = Math.max(1, input.value.split("\n").length);
  input.cols = 1;
  const display = cell.querySelector<HTMLElement>(".pkm-table-cell-display")!;
  cell.classList.add("pkm-table-cell-editing");
  cell.append(input);
  const updateLayout = () => {
    display.textContent =
      input.value + (input.value.endsWith("\n") ? "\u200b" : "");
    view.requestMeasure();
  };
  let firstInput = true;
  const commit = () => {
    if (
      input.dataset.composing === "true" ||
      input.dataset.cancelled === "true" ||
      view.state.readOnly ||
      !wrapper.isConnected
    )
      return;
    const data = controller.data;
    const lines = data.source.split("\n");
    const lineIndex = row === 0 ? 0 : row + 1;
    const line = lines[lineIndex]!;
    const target = tableRowCells(line)[column];
    const value = tableCellMarkdown(input.value);
    input.dataset.writing = "true";
    if (target && !(value.trim() === "" && !/^\s*\|.*\|\s*$/.test(line))) {
      // Do not let a final backslash escape a delimiter in compact Markdown.
      const insert =
        value +
        ((value.match(/\\+$/)?.[0].length ?? 0) % 2 === 1 &&
        line[target.to] === "|"
          ? " "
          : "");
      if (line.slice(target.from, target.to) === insert) {
        delete input.dataset.writing;
        return;
      }
      const from =
        data.from +
        lines
          .slice(0, lineIndex)
          .reduce((sum, text) => sum + text.length + 1, 0) +
        target.from;
      view.dispatch({
        changes: { from, to: from + target.to - target.from, insert },
        annotations: firstInput ? isolateHistory.of("before") : [],
        userEvent: "input.type",
      });
    } else {
      const cells = tableRowCells(line).map((cell) => cell.value);
      while (cells.length <= column) cells.push("");
      cells[column] = value;
      lines[lineIndex] = `| ${cells.join(" | ")} |`;
      view.dispatch({
        changes: { from: data.from, to: data.to, insert: lines.join("\n") },
        annotations: firstInput ? isolateHistory.of("before") : [],
        userEvent: "input.type",
      });
    }
    delete input.dataset.writing;
    firstInput = false;
    updateLayout();
  };
  input.addEventListener("compositionstart", (event) => {
    event.stopPropagation();
    input.dataset.composing = "true";
  });
  input.addEventListener("compositionend", (event) => {
    event.stopPropagation();
    delete input.dataset.composing;
    commit();
  });
  input.addEventListener("input", (event) => {
    event.stopPropagation();
    updateLayout();
    commit();
  });
  input.addEventListener("paste", (event) => event.stopPropagation());
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (
      event.isComposing ||
      input.dataset.composing === "true" ||
      event.keyCode === 229
    )
      return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      (event.shiftKey ? redo : undo)(view);
      return;
    }
    if (!["Enter", "Tab", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Enter" && event.shiftKey) {
      input.setRangeText("\n", input.selectionStart, input.selectionEnd, "end");
      commit();
      return;
    }
    commit();
    if (event.key === "Escape") {
      input.blur();
      view.dispatch({
        selection: { anchor: controller.data.to + 2 },
        scrollIntoView: true,
      });
      view.focus();
      return;
    }
    const width = tableRowCells(controller.data.source.split("\n")[1]!).length;
    let nextFrom = controller.data.from;
    let nextRow = row;
    let nextColumn = column + (event.shiftKey ? -1 : 1);
    if (event.key === "Enter") {
      nextRow++;
      if (nextRow >= tableRows(controller.data.source).length)
        nextFrom = changeTablePart(view, wrapper, "row", nextRow) ?? nextFrom;
      nextColumn = column;
    } else if (nextColumn >= width) {
      nextColumn = 0;
      nextRow++;
      if (nextRow >= tableRows(controller.data.source).length)
        nextFrom = changeTablePart(view, wrapper, "row", nextRow) ?? nextFrom;
    } else if (nextColumn < 0) {
      nextColumn = width - 1;
      nextRow--;
    }
    if (nextRow < 0) {
      input.blur();
      view.dispatch({
        selection: { anchor: Math.max(0, controller.data.from - 2) },
        scrollIntoView: true,
      });
      view.focus();
    } else {
      const current = view.dom.querySelector<HTMLElement>(
        `.pkm-table-preview[data-from="${nextFrom}"]`,
      );
      if (current) editTableCell(view, current, nextRow, nextColumn);
    }
  });
  input.addEventListener("blur", () => {
    if (input.dataset.cancelled === "true") return;
    delete input.dataset.composing;
    commit();
    if (input.parentElement === cell) {
      input.remove();
      cell.classList.remove("pkm-table-cell-editing");
      renderCells(wrapper, controller.data);
    }
  });
  input.focus();
  const caret =
    pointer && document.caretPositionFromPoint?.(pointer.x, pointer.y);
  const offset =
    caret?.offsetNode === input ? caret.offset : input.value.length;
  input.setSelectionRange(offset, offset);
};

const changeTablePart = (
  view: EditorView,
  wrapper: HTMLElement,
  axis: "row" | "column",
  index: number,
) => {
  if (view.state.readOnly) return;
  const { data } = tableControllers.get(wrapper)!;
  const ordinal = markdownTableRanges(view.state).findIndex(
    (range) => range.from === data.from,
  );
  view.dispatch({
    changes: {
      from: data.from,
      to: data.to,
      insert: insertTablePart(data.source, axis, index),
    },
    annotations: isolateHistory.of("full"),
    userEvent: "input",
  });
  return markdownTableRanges(view.state)[ordinal]?.from;
};

class TablePreview extends WidgetType {
  constructor(readonly data: TableData) {
    super();
  }
  override eq(other: TablePreview): boolean {
    return (
      this.data.source === other.data.source &&
      this.data.from === other.data.from &&
      this.data.editable === other.data.editable
    );
  }
  override toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "pkm-table-preview";
    wrapper.contentEditable = "false";
    wrapper.dataset.from = String(this.data.from);
    tableControllers.set(wrapper, { data: this.data });
    const scroll = wrapper.appendChild(document.createElement("div"));
    scroll.className = "pkm-table-scroll";
    const table = scroll.appendChild(document.createElement("table"));
    const rows = tableRows(this.data.source);
    const width = tableRowCells(this.data.source.split("\n")[1]!).length;
    const head = table.createTHead();
    const body = table.createTBody();
    rows.forEach((_, row) => {
      const tr = (row === 0 ? head : body).insertRow();
      for (let column = 0; column < width; column++) {
        const cell = tr.appendChild(
          document.createElement(row === 0 ? "th" : "td"),
        );
        cell.appendChild(document.createElement("div")).className =
          "pkm-table-cell-display";
        if (this.data.editable) {
          cell.tabIndex = 0;
          cell.addEventListener("click", (event) => {
            event.stopPropagation();
            if (event.target instanceof HTMLTextAreaElement) return;
            // First interaction supplies actual writable lines around old tables.
            const { data } = tableControllers.get(wrapper)!;
            const transaction = view.state.update({
              changes: { from: data.from, to: data.to, insert: data.source },
              annotations: isolateHistory.of("full"),
              userEvent: "input",
            });
            if (!transaction.newDoc.eq(view.state.doc))
              view.dispatch(transaction);
            editTableCell(
              view,
              wrapper,
              row,
              column,
              event.detail > 0
                ? { x: event.clientX, y: event.clientY }
                : undefined,
            );
          });
          cell.addEventListener("keydown", (event) => {
            if (event.target !== cell || !["Enter", " "].includes(event.key))
              return;
            event.preventDefault();
            event.stopPropagation();
            cell.click();
          });
        }
      }
    });
    renderCells(wrapper, this.data);
    if (this.data.editable) {
      const controls = wrapper.appendChild(document.createElement("div"));
      controls.className = "pkm-table-controls";
      for (const axis of ["row", "column"] as const) {
        const button = controls.appendChild(document.createElement("button"));
        button.type = "button";
        button.textContent = "+";
        button.className = `pkm-table-add-${axis}`;
        button.setAttribute(
          "aria-label",
          axis === "row" ? "行を追加" : "列を追加",
        );
        button.title = axis === "row" ? "行を追加" : "列を追加";
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const { data } = tableControllers.get(wrapper)!;
          const index =
            axis === "row"
              ? tableRows(data.source).length
              : tableRowCells(data.source.split("\n")[1]!).length;
          const from = changeTablePart(view, wrapper, axis, index);
          const current = view.dom.querySelector<HTMLElement>(
            `.pkm-table-preview[data-from="${from}"]`,
          );
          if (current)
            editTableCell(
              view,
              current,
              axis === "row" ? index : 0,
              axis === "column" ? index : 0,
            );
        });
      }
    }
    return wrapper;
  }
  override updateDOM(wrapper: HTMLElement): boolean {
    const controller = tableControllers.get(wrapper)!;
    const old = controller.data;
    if (
      old.editable !== this.data.editable ||
      tableRows(old.source).length !== tableRows(this.data.source).length ||
      tableRowCells(old.source.split("\n")[1]!).length !==
        tableRowCells(this.data.source.split("\n")[1]!).length
    )
      return false;
    const input = wrapper.querySelector("textarea");
    if (
      old.source !== this.data.source &&
      input?.dataset.composing === "true" &&
      input.dataset.writing !== "true"
    ) {
      input.dataset.cancelled = "true";
      input.parentElement?.classList.remove("pkm-table-cell-editing");
      input.remove();
    }
    controller.data = this.data;
    wrapper.dataset.from = String(this.data.from);
    renderCells(wrapper, this.data);
    return true;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

const tableDecorations = (state: EditorState) =>
  Decoration.set(
    markdownTableRanges(state).map((range) =>
      Decoration.replace({
        widget: new TablePreview({
          ...range,
          editable: range.topLevel && !state.readOnly,
        }),
        block: true,
        inclusive: true,
      }).range(range.from, range.to),
    ),
    true,
  );

export const markdownTablePreviewField = StateField.define({
  create: tableDecorations,
  update(value, transaction) {
    return transaction.docChanged ||
      transaction.reconfigured ||
      syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
      ? tableDecorations(transaction.state)
      : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
    EditorView.baseTheme({
      ".pkm-table-preview": {
        margin: "0 16px",
        position: "relative",
        maxWidth: "calc(100% - 56px)",
        width: "fit-content",
        fontSize: "0.9em",
        lineHeight: "1.4",
      },
      ".pkm-table-scroll": { overflowX: "auto" },
      ".pkm-table-preview table": { borderCollapse: "collapse" },
      ".pkm-table-preview th, .pkm-table-preview td": {
        position: "relative",
        borderRight: "1px solid var(--mantine-color-default-border, #dee2e6)",
        borderBottom: "1px solid var(--mantine-color-default-border, #dee2e6)",
        padding: "4px 8px",
        textAlign: "left",
        minWidth: "3em",
        cursor: "text",
      },
      ".pkm-table-preview tr > :first-child": { paddingLeft: "0" },
      ".pkm-table-preview tr > :last-child": {
        borderRight: "none",
        paddingRight: "0",
      },
      ".pkm-table-preview tbody tr:last-child > td": { borderBottom: "none" },
      ".pkm-table-cell-display": { whiteSpace: "pre-wrap", minHeight: "1lh" },
      ".pkm-table-cell-editing .pkm-table-cell-display": {
        visibility: "hidden",
      },
      ".pkm-table-cell-input": {
        position: "absolute",
        inset: "0",
        display: "block",
        width: "100%",
        height: "100%",
        minWidth: "0",
        minHeight: "0",
        boxSizing: "border-box",
        resize: "none",
        appearance: "none",
        font: "inherit",
        lineHeight: "inherit",
        textAlign: "inherit",
        color: "inherit",
        background: "transparent",
        border: "none",
        outline: "none",
        margin: "0",
        padding: "inherit",
        overflow: "hidden",
      },
      ".pkm-table-controls": {
        position: "absolute",
        inset: "0",
        zIndex: "1",
        pointerEvents: "none",
        visibility: "hidden",
      },
      ".pkm-table-preview:hover .pkm-table-controls, .pkm-table-preview:focus-within .pkm-table-controls":
        { visibility: "visible" },
      ".pkm-table-controls button": {
        position: "absolute",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0",
        font: "inherit",
        fontSize: "14px",
        lineHeight: "1",
        color: "var(--mantine-color-dimmed, #868e96)",
        background: "var(--mantine-color-default-hover, #f1f3f5)",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
        pointerEvents: "auto",
      },
      ".pkm-table-controls button:hover, .pkm-table-controls button:focus-visible":
        { background: "var(--mantine-color-default-border, #dee2e6)" },
      ".pkm-table-add-column": {
        left: "calc(100% + 2px)",
        top: "0",
        width: "16px",
        height: "100%",
      },
      ".pkm-table-add-row": {
        left: "0",
        top: "calc(100% + 2px)",
        width: "100%",
        height: "min(16px, 0.8lh)",
      },
      "@media (hover: none)": {
        ".pkm-table-controls": { visibility: "visible" },
      },
    }),
  ],
});

export const protectTableBoundary =
  (forward = false): StateCommand =>
  ({ state }) => {
    if (state.readOnly) return false;
    return state.selection.ranges.some((range) => {
      if (!range.empty) return false;
      let protect = false;
      state
        .field(markdownTablePreviewField)
        .between(0, range.head, (_from, to) => {
          if (to > range.head) return;
          const gap = state.doc.sliceString(to, range.head);
          if (forward) {
            const following = /^\n*/.exec(
              state.doc.sliceString(range.head),
            )![0];
            protect ||=
              /^\n*$/.test(gap) &&
              following.length > 0 &&
              gap.length + following.length <= 2;
          } else {
            protect ||= /^\n{1,2}$/.test(gap);
          }
        });
      return protect;
    });
  };

export const writeAfterTable: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly || state.selection.ranges.length !== 1) return false;
  const range = state.selection.main;
  if (!range.empty || range.head !== state.doc.length) return false;
  let atEnd = false;
  state
    .field(markdownTablePreviewField)
    .between(range.head, range.head, (_from, to) => {
      atEnd ||= to === range.head;
    });
  if (!atEnd) return false;
  dispatch(
    state.update({
      changes: { from: range.head, insert: "\n\n" },
      selection: { anchor: range.head + 2 },
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};
