import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { toggleInlineFormat } from "./markdown-formatting.js";
import {
  insertTablePart,
  markdownTableRanges,
  removeTablePart,
  tableRowCells,
} from "./markdown-table-editing.js";

let closeActionMenu: (() => void) | undefined;

const block = (view: EditorView, text: string, caret: number) => {
  const selection = view.state.selection.main;
  const before = view.state.doc.sliceString(0, selection.from);
  const after = view.state.doc.sliceString(selection.to);
  const prefix =
    before && !before.endsWith("\n\n")
      ? before.endsWith("\n")
        ? "\n"
        : "\n\n"
      : "";
  const suffix =
    after && !after.startsWith("\n\n")
      ? after.startsWith("\n")
        ? "\n"
        : "\n\n"
      : "";
  view.dispatch({
    changes: {
      from: selection.from,
      to: selection.to,
      insert: prefix + text + suffix,
    },
    selection: { anchor: selection.from + prefix.length + caret },
    scrollIntoView: true,
    userEvent: "input",
  });
};

export const openMarkdownActionMenu = (
  view: EditorView,
  x: number,
  y: number,
  target?: Element | null,
  anchor?: HTMLElement,
) => {
  if (view.state.readOnly || view.composing) return;
  closeActionMenu?.();
  const menu = document.createElement("div");
  menu.className = "pkm-markdown-action-menu";
  menu.popover = "manual";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Markdown操作");
  const viewport = window.visualViewport;
  const position = () => {
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const right = left + (viewport?.width ?? window.innerWidth) - 16;
    const bottom = Math.min(
      top + (viewport?.height ?? window.innerHeight) - 16,
      anchor ? anchor.getBoundingClientRect().top - 8 : Infinity,
    );
    menu.style.maxHeight = `${Math.max(0, Math.min(560, bottom - top))}px`;
    menu.style.maxWidth = `${right - left}px`;
    menu.style.left = `${Math.max(left, Math.min(anchor?.getBoundingClientRect().left ?? x, right - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(top, Math.min(anchor ? bottom : y, bottom - menu.offsetHeight))}px`;
  };
  const close = () => {
    closeActionMenu = undefined;
    menu.remove();
    viewport?.removeEventListener("resize", position);
    viewport?.removeEventListener("scroll", position);
    window.removeEventListener("resize", position);
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", escape, true);
  };
  closeActionMenu = close;
  const outside = (event: PointerEvent) => {
    if (!menu.contains(event.target as Node)) close();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  const item = (label: string, action: () => void, disabled = false) => {
    const button = menu.appendChild(document.createElement("button"));
    button.type = "button";
    button.textContent = label;
    button.setAttribute("role", "menuitem");
    button.disabled = disabled;
    button.addEventListener("click", () => {
      action();
      close();
      view.focus();
    });
  };
  // Keep the software keyboard and native editor selection during touch commands.
  if (anchor)
    menu.addEventListener("pointerdown", (event) => event.preventDefault());
  const separator = () => menu.appendChild(document.createElement("hr"));
  const inline = (label: string, format: "bold" | "italic" | "strike") =>
    item(label, () => toggleInlineFormat(format)(view));
  inline("太字", "bold");
  inline("斜体", "italic");
  inline("取り消し線", "strike");
  item("インラインコード", () => {
    const { from, to } = view.state.selection.main;
    const text = `\`${view.state.doc.sliceString(from, to) || "コード"}\``;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length - 1 },
      userEvent: "input",
    });
  });
  separator();
  item("見出し", () => block(view, "## 見出し", 3));
  item("箇条書き", () => block(view, "- 項目", 2));
  item("番号付きリスト", () => block(view, "1. 項目", 3));
  item("チェックリスト", () => block(view, "- [ ] 項目", 6));
  item("引用", () => block(view, "> 引用", 2));
  separator();
  item("リンク", () => {
    const { from, to } = view.state.selection.main;
    const selected = view.state.doc.sliceString(from, to);
    const text = `[${selected || "リンク"}](url)`;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: {
        anchor: from + text.length - 4,
        head: from + text.length - 1,
      },
      userEvent: "input",
    });
  });
  item("表を挿入", () =>
    block(view, "| 見出し | 見出し |\n| --- | --- |\n|  |  |", 2),
  );
  item("脚注", () => {
    const source = view.state.doc.toString();
    let number = 1;
    while (source.includes(`[^${number}]:`)) number++;
    const { from, to } = view.state.selection.main;
    const marker = `[^${number}]`;
    const definition = `\n\n${marker}: 脚注`;
    view.dispatch({
      changes: [
        { from, to, insert: marker },
        { from: view.state.doc.length, insert: definition },
      ],
      selection: { anchor: from + marker.length },
      userEvent: "input",
    });
  });
  item("コールアウト", () => block(view, "> [!NOTE]\n> 内容", 12));
  item("区切り線", () => block(view, "---", 3));
  item("コードブロック", () => block(view, "```\n\n```", 4));
  item("数式ブロック", () => block(view, "$$\n\n$$", 3));

  const cell = target?.closest(".pkm-table-preview th, .pkm-table-preview td");
  const wrapper = (cell ?? target)?.closest<HTMLElement>(".pkm-table-preview");
  const range =
    wrapper &&
    markdownTableRanges(view.state).find(
      (entry) => entry.from === Number(wrapper.dataset.from) && entry.topLevel,
    );
  if (range) {
    separator();
    const column = cell ? [...cell.parentElement!.children].indexOf(cell) : 0;
    const row = cell
      ? [...cell.parentElement!.parentElement!.children].indexOf(
          cell.parentElement!,
        ) + (cell.closest("tbody") ? 1 : 0)
      : 0;
    const rows = range.source.split("\n").length - 1;
    const columns = tableRowCells(range.source.split("\n")[1]!).length;
    const change = (edit: (source: string) => string) => {
      const current = markdownTableRanges(view.state).find(
        (entry) => entry.from === range.from,
      );
      if (!current) return;
      view.dispatch({
        changes: {
          from: current.from,
          to: current.to,
          insert: edit(current.source),
        },
        annotations: isolateHistory.of("full"),
        userEvent: "input",
      });
    };
    item("上に行を追加", () =>
      change((source) => insertTablePart(source, "row", row)),
    );
    item("下に行を追加", () =>
      change((source) => insertTablePart(source, "row", row + 1)),
    );
    item("左に列を追加", () =>
      change((source) => insertTablePart(source, "column", column)),
    );
    item("右に列を追加", () =>
      change((source) => insertTablePart(source, "column", column + 1)),
    );
    item(
      "行を削除",
      () => change((source) => removeTablePart(source, "row", row)),
      row === 0 || rows <= 2,
    );
    item(
      "列を削除",
      () => change((source) => removeTablePart(source, "column", column)),
      columns <= 1,
    );
    item("表を削除", () => change(() => ""));
  }
  view.dom.append(menu);
  menu.showPopover();
  position();
  viewport?.addEventListener("resize", position);
  viewport?.addEventListener("scroll", position);
  window.addEventListener("resize", position);
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", escape, true);
  if (!anchor)
    menu
      .querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
};
