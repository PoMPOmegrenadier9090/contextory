import { markdownListLine } from "./markdown-list-context.js";
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  StateField,
  type EditorState,
  type Range,
  type StateCommand,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import {
  highlightCode,
  isLanguageRegistered,
  mouseSelectingField,
} from "codemirror-live-markdown";

interface CodeBlock {
  from: number;
  to: number;
  contentFrom: number;
  contentTo: number;
  infoFrom: number;
  infoTo: number;
  language: string;
  code: string;
  lineStarts: number[];
  hasContent: boolean;
  closed: boolean;
}

// These are lowlight's bundled common languages; filter against the actual
// registry so the menu never promises an unavailable highlighter.
const languages = (
  "arduino bash c cpp csharp css diff go graphql ini java javascript json kotlin " +
  "less lua makefile markdown objectivec perl php php-template plaintext python " +
  "python-repl r ruby rust scss shell sql swift typescript vbnet wasm xml yaml"
).split(" ");

const codeBlocks = (state: EditorState): CodeBlock[] => {
  const blocks: CodeBlock[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const marks = node.node.getChildren("CodeMark");
      const opening = marks[0]!;
      const closing = marks[1];
      const info = node.node.getChild("CodeInfo");
      if (info && state.doc.sliceString(info.from, info.to) === "math")
        return false;
      const language = info
        ? state.doc.sliceString(info.from, info.to).split(/\s/)[0]!
        : "";
      const textNodes = node.node.getChildren("CodeText");
      const lines: string[] = [];
      const lineStarts: number[] = [];
      const firstLine = state.doc.lineAt(opening.from).number + 1;
      const lastLine = closing
        ? state.doc.lineAt(closing.from).number - 1
        : state.doc.lineAt(node.to).number;
      let textIndex = 0;
      for (let number = firstLine; number <= lastLine; number++) {
        const line = state.doc.line(number);
        while (textNodes[textIndex] && textNodes[textIndex]!.to <= line.from)
          textIndex++;
        const text = textNodes[textIndex];
        const from =
          text && text.from <= line.to
            ? Math.max(line.from, text.from)
            : line.to;
        const to = text ? Math.min(line.to, Math.max(from, text.to)) : from;
        lineStarts.push(from);
        lines.push(state.doc.sliceString(from, to));
      }
      if (!lines.length) {
        lines.push("");
        lineStarts.push(closing?.from ?? node.to);
      }
      blocks.push({
        hasContent: firstLine <= lastLine,
        closed: closing !== undefined,
        from: node.from,
        to: node.to,
        contentFrom: lineStarts[0]!,
        contentTo: lineStarts.at(-1)! + lines.at(-1)!.length,
        code: lines.join("\n"),
        lineStarts,
        infoFrom: info?.from ?? opening.to,
        infoTo: info ? info.from + language.length : opening.to,
        language,
      });
      return false;
    },
  });
  return blocks;
};

class CodeHeader extends WidgetType {
  constructor(
    readonly language: string,
    readonly readOnly: boolean,
  ) {
    super();
  }

  override eq(other: CodeHeader): boolean {
    return this.readOnly === other.readOnly && this.language === other.language;
  }

  override toDOM(view: EditorView): HTMLElement {
    const header = document.createElement("div");
    header.className = "pkm-code-header";
    const select = document.createElement("select");
    select.className = "pkm-code-language";
    select.setAttribute("aria-label", "コードブロックの言語");
    select.disabled = this.readOnly;
    const current = this.language;
    const options = ["", "text", ...languages.filter(isLanguageRegistered)];
    if (!options.includes(current)) options.push(current);
    for (const language of options) {
      const option = document.createElement("option");
      option.value = language;
      option.textContent = language === "" ? "言語を選択" : language;
      select.appendChild(option);
    }
    select.value = current;
    select.addEventListener("change", () => {
      if (view.state.readOnly) return;
      // The header may survive edits before the block. Resolve its live offset.
      const from = view.posAtDOM(header);
      const block = view.state
        .field(markdownCodeField)
        .blocks.find((b) => b.from === from);
      if (!block) return;
      view.dispatch({
        changes: {
          from: block.infoFrom,
          to: block.infoTo,
          insert: select.value,
        },
        userEvent: "input",
      });
      view.focus();
    });
    header.appendChild(select);
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "pkm-code-copy";
    copy.textContent = "コピー";
    copy.setAttribute("aria-label", "コードをコピー");
    copy.addEventListener("click", () => {
      const from = view.posAtDOM(header);
      const block = view.state
        .field(markdownCodeField)
        .blocks.find((b) => b.from === from);
      if (!block) return;
      void navigator.clipboard
        .writeText(block.code)
        .then(() => {
          copy.textContent = "コピー済み";
        })
        .catch(() => {
          copy.textContent = "コピー失敗";
        });
    });
    header.appendChild(copy);
    return header;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

class CodePreview extends WidgetType {
  constructor(
    readonly code: string,
    readonly language: string,
    readonly lineStarts: number[],
    readonly hasContent: boolean,
    readonly closed: boolean,
  ) {
    super();
  }

  override eq(other: CodePreview): boolean {
    return (
      this.hasContent === other.hasContent &&
      this.closed === other.closed &&
      this.code === other.code &&
      this.language === other.language &&
      JSON.stringify(this.lineStarts) === JSON.stringify(other.lineStarts)
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-codeblock-widget";
    const pre = element.appendChild(document.createElement("pre"));
    const code = pre.appendChild(document.createElement("code"));
    const starts = this.lineStarts;
    for (const index of (this.hasContent ? this.code.split("\n") : []).keys()) {
      const line = code.appendChild(document.createElement("span"));
      line.className = "cm-codeblock-line";
      line.dataset.lineIndex = String(index);
    }
    // Highlight the whole block so multiline comments and strings retain their
    // context, then split its text nodes into clickable, wrapping source lines.
    const highlighted = document.createElement("code");
    highlighted.innerHTML = highlightCode(
      this.hasContent ? this.code : "",
      this.language || "text",
    ).html;
    const walker = document.createTreeWalker(highlighted, NodeFilter.SHOW_TEXT);
    let lineIndex = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parts = node.textContent!.split("\n");
      for (const [index, part] of parts.entries()) {
        if (index) lineIndex++;
        let fragment: Node = document.createTextNode(part);
        for (
          let parent = node.parentElement;
          parent && parent !== highlighted;
          parent = parent.parentElement
        ) {
          const wrapper = parent.cloneNode(false);
          wrapper.appendChild(fragment);
          fragment = wrapper;
        }
        code.children[lineIndex]!.appendChild(fragment);
      }
    }
    for (const line of code.children) {
      if (!line.textContent) line.appendChild(document.createElement("br"));
    }
    const openingSpace = document.createElement("span");
    openingSpace.className = "pkm-code-fence-space";
    openingSpace.setAttribute("aria-hidden", "true");
    code.prepend(openingSpace);
    if (this.closed) code.appendChild(openingSpace.cloneNode());
    element.dataset.lineStarts = JSON.stringify(starts);
    element.addEventListener("mousedown", (event) => {
      if (view.state.readOnly) return;
      event.preventDefault();
      const index =
        event.target instanceof Element
          ? Number(
              event.target.closest<HTMLElement>(".cm-codeblock-line")?.dataset
                .lineIndex ?? 0,
            )
          : 0;
      view.dispatch({
        selection: { anchor: starts[index] ?? starts[0]! },
        scrollIntoView: true,
      });
      view.focus();
    });
    return element;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const decorationsFor = (state: EditorState, blocks: CodeBlock[]) => {
  const decorations: Range<Decoration>[] = [];
  for (const block of blocks) {
    decorations.push(
      Decoration.widget({
        widget: new CodeHeader(block.language, state.readOnly),
        block: true,
        side: -1,
      }).range(block.from),
    );
    const editing =
      !state.readOnly &&
      state.selection.ranges.some(
        (range) => range.from <= block.to && range.to >= block.from,
      );
    if (!editing) {
      decorations.push(
        Decoration.replace({
          widget: new CodePreview(
            block.code,
            block.language,
            block.lineStarts,
            block.hasContent,
            block.closed,
          ),
          block: true,
        }).range(block.from, block.to),
      );
    } else {
      for (let pos = block.from; pos <= block.to;) {
        const line = state.doc.lineAt(pos);
        const fence =
          pos === block.from || (block.closed && line.to === block.to);
        decorations.push(
          Decoration.line({
            class: `cm-codeblock-source${line.to === block.to ? " pkm-code-last" : ""}${fence ? " pkm-code-fence-line" : ""}`,
          }).range(line.from),
        );
        if (
          fence &&
          line.from < line.to &&
          !state.selection.ranges.some(
            (range) => range.from <= line.to && range.to >= line.from,
          )
        ) {
          decorations.push(
            Decoration.mark({ class: "pkm-code-fence-hidden" }).range(
              line.from,
              line.to,
            ),
          );
        }
        pos = line.to + 1;
      }
    }
  }
  return Decoration.set(decorations, true);
};

export const markdownCodeField = StateField.define({
  create(state) {
    const blocks = codeBlocks(state);
    return { blocks, decorations: decorationsFor(state, blocks) };
  },
  update(previous, tr) {
    if (
      !tr.docChanged &&
      !tr.reconfigured &&
      tr.state.field(mouseSelectingField, false)
    )
      return previous;
    if (
      !tr.docChanged &&
      !tr.reconfigured &&
      !tr.selection &&
      !tr.effects.length
    )
      return previous;
    const blocks = codeBlocks(tr.state);
    return { blocks, decorations: decorationsFor(tr.state, blocks) };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

export const moveIntoMarkdownCode = (
  view: EditorView,
  forward: boolean,
  vertical: boolean,
  extend = false,
): boolean => {
  if (
    view.state.readOnly ||
    (!extend && view.state.selection.ranges.some((r) => !r.empty))
  )
    return false;
  const blocks = view.state.field(markdownCodeField).blocks;
  let entered = false;
  const ranges = view.state.selection.ranges.map((range) => {
    const next = vertical
      ? view.moveVertically(range, forward)
      : view.moveByChar(range, forward);
    const block = blocks.find((b) =>
      forward
        ? range.head < b.from && next.head >= b.from
        : range.head > b.to && next.head <= b.to,
    );
    if (!block)
      return extend ? EditorSelection.range(range.anchor, next.head) : next;
    entered = true;
    const head = forward ? block.contentFrom : block.contentTo;
    return extend
      ? EditorSelection.range(range.anchor, head)
      : EditorSelection.cursor(head);
  });
  if (!entered) return false;
  view.dispatch({
    selection: EditorSelection.create(ranges, view.state.selection.mainIndex),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
};

export const moveToCodeBoundary =
  (forward: boolean, extend = false): StateCommand =>
  ({ state, dispatch }) => {
    const blocks = state.field(markdownCodeField).blocks;
    const targets = state.selection.ranges.map((range) =>
      blocks.find((b) => range.head >= b.from && range.head <= b.to),
    );
    if (targets.some((b) => !b)) return false;
    dispatch(
      state.update({
        selection: EditorSelection.create(
          state.selection.ranges.map((range, index) => {
            const block = targets[index]!;
            const head = forward ? block.contentTo : block.contentFrom;
            return extend
              ? EditorSelection.range(range.anchor, head)
              : EditorSelection.cursor(head);
          }),
          state.selection.mainIndex,
        ),
        scrollIntoView: true,
        userEvent: "select",
      }),
    );
    return true;
  };

// Pair a newly typed fence, leaving the caret after the opening marker so the
// language can still be typed. Enter then moves into the prepared empty line.
export const completeCodeFence = (
  view: EditorView,
  from: number,
  to: number,
  text: string,
): boolean => {
  if (
    view.state.readOnly ||
    text !== "`" ||
    from !== to ||
    view.state.selection.ranges.length !== 1
  )
    return false;
  const line = view.state.doc.lineAt(from);
  if (
    from !== line.to ||
    view.state.doc.sliceString(Math.max(line.from, from - 2), from) !== "``"
  )
    return false;
  for (let node = syntaxTree(view.state).resolveInner(from, -1); ;) {
    if (["FencedCode", "CodeBlock", "HTMLBlock"].includes(node.name))
      return false;
    if (!node.parent) break;
    node = node.parent;
  }
  const typed = view.state.update({ changes: { from, insert: text } }).state;
  const node = syntaxTree(typed).resolveInner(from, 1);
  const fence = node.name === "FencedCode" ? node : node.parent;
  if (fence?.name !== "FencedCode") return false;
  const marks = fence.getChildren("CodeMark");
  if (marks.length > 1 || marks[0]?.from !== from - 2) return false;
  // Before the third backtick this may still parse as a lazy list continuation.
  // Generate list indentation only when its marker is on the opening line.
  const prefix =
    markdownListLine(view.state, from)?.continuationPrefix ??
    view.state.doc.sliceString(line.from, from - 2);
  view.dispatch({
    changes: { from, insert: "`\n" + prefix + "\n" + prefix + "```" },
    selection: { anchor: from + 1 },
    userEvent: "input.type",
  });
  return true;
};

export const enterCodeBlock: StateCommand = ({ state, dispatch }) => {
  if (
    state.readOnly ||
    state.selection.ranges.length !== 1 ||
    !state.selection.main.empty
  )
    return false;
  const head = state.selection.main.head;
  const block = state
    .field(markdownCodeField)
    .blocks.find((b) => b.from <= head && head <= b.to);
  if (
    !block ||
    state.doc.lineAt(head).number !== state.doc.lineAt(block.from).number ||
    head !== state.doc.lineAt(head).to
  )
    return false;
  const next = state.doc.lineAt(head).number + 1;
  if (
    next > state.doc.lines ||
    !/^[ \t]*(?:>[ \t]*)*$/.test(state.doc.line(next).text)
  )
    return false;
  dispatch(
    state.update({
      selection: { anchor: state.doc.line(next).to },
      scrollIntoView: true,
      userEvent: "select",
    }),
  );
  return true;
};
