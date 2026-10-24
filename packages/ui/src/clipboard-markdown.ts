import { EditorSelection, type EditorState } from "@codemirror/state";
import {
  clipboardTableMarkdown,
  tableClipboardCells,
} from "./table-clipboard.js";
import { markdownListLine } from "./markdown-list-context.js";

const escapeText = (text: string): string =>
  text.replace(/([\\`*_[\]<>#~])/g, "\\$1");
const safeUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const fenceFor = (text: string, character: string): string => {
  const runs = text.match(character === "`" ? /`+/g : /~+/g) ?? [];
  return character.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
};

const wrapInline = (content: string, delimiter: string): string => {
  const trimmed = content.trim();
  if (!trimmed) return content;
  const start = content.indexOf(trimmed);
  return (
    content.slice(0, start) +
    delimiter +
    trimmed +
    delimiter +
    content.slice(start + trimmed.length)
  );
};

export interface ClipboardMarkdown {
  readonly text: string;
  readonly block: boolean;
}

// Parse into an inert document. Never insert clipboard HTML into the page.
export const readClipboardMarkdown = (
  html: string,
  plainText?: string,
): ClipboardMarkdown | null => {
  const table = (requireTabs = true): ClipboardMarkdown | null => {
    if (
      plainText === undefined ||
      plainText.length > 2_000_000 ||
      (requireTabs && !plainText.includes("\t"))
    )
      return null;
    const rows = tableClipboardCells(plainText);
    const width = rows[0]!.length;
    if ((requireTabs && width < 2) || rows.some((row) => row.length !== width))
      return null;
    return {
      text: clipboardTableMarkdown(rows),
      block: true,
    };
  };
  if (html.length === 0) return table();
  if (html.length > 2_000_000) return null;
  const body = new DOMParser().parseFromString(html, "text/html").body;
  if (body.querySelector("table[data-pkm-table]") && plainText !== undefined)
    return table(false);
  if (!body.querySelector("table,pre,code")) {
    const tsv = table();
    if (tsv) return tsv;
  }
  if (
    !body.querySelector(
      "h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,table,strong,b,em,i,a,code,del,s,hr,[style]",
    )
  )
    return table();
  type Formatting = { bold?: boolean; italic?: boolean; strike?: boolean };
  const renderChildren = (element: Node, inherited: Formatting = {}): string =>
    [...element.childNodes]
      .map((child) => render(child, inherited))
      .reduce(
        (result, fragment) =>
          result.endsWith("\n") && fragment.startsWith("\n")
            ? result + fragment.replace(/^\n+/, "")
            : result + fragment,
        "",
      );
  const renderList = (element: Element): string => {
    let number = Number(element.getAttribute("start") ?? 1);
    return [...element.children]
      .filter((child) => child.tagName === "LI")
      .map((item) => {
        const value = item.getAttribute("value");
        if (value !== null) number = Number(value);
        const prefix = element.tagName === "OL" ? `${number++}. ` : "- ";
        const checkbox = [
          ...item.querySelectorAll('input[type="checkbox"]'),
        ].find((input) => input.closest("li") === item);
        const task =
          checkbox === undefined
            ? ""
            : checkbox.hasAttribute("checked")
              ? "[x] "
              : "[ ] ";
        const rendered = renderChildren(item).trim();
        // Web checklists may use literal task markers instead of input elements.
        const content =
          checkbox === undefined
            ? rendered.replace(/^\\\[([ xX])\\\](?=[ \t]|$)/, "[$1]")
            : rendered;
        const lines = content.split("\n");
        return (
          prefix +
          task +
          lines
            .map((line, index) =>
              index === 0 ? line : " ".repeat(prefix.length) + line,
            )
            .join("\n")
        );
      })
      .join("\n");
  };
  const renderTable = (table: Element): string | null => {
    const rows = [...table.querySelectorAll("tr")].filter(
      (row) => row.closest("table") === table,
    );
    if (
      rows.length === 0 ||
      table.querySelector(
        '[rowspan]:not([rowspan="1"]),[colspan]:not([colspan="1"]),table',
      )
    )
      return null;
    const cells = rows.map((row) =>
      [...row.children]
        .filter((cell) => ["TH", "TD"].includes(cell.tagName))
        .map((cell) =>
          renderChildren(cell)
            .trim()
            .replace(/\n+/g, "<br>")
            .replace(/(?<!\\)\|/g, "\\|"),
        ),
    );
    const width = Math.max(...cells.map((row) => row.length));
    if (width === 0) return null;
    const line = (row: readonly string[]): string =>
      `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
    const header = cells.shift()!;
    return [
      line(header),
      line(Array<string>(width).fill("---")),
      ...cells.map(line),
    ].join("\n");
  };
  let unsupported = false;
  function render(node: Node, inherited: Formatting = {}): string {
    if (node.nodeType === Node.TEXT_NODE) {
      // Pretty-printed HTML often has whitespace between blocks. It is not a
      // paragraph and must not add a stray space between Markdown list items.
      const isBlock = (sibling: Node | null) =>
        sibling instanceof Element &&
        /^(P|DIV|SECTION|ARTICLE|UL|OL|LI|H[1-6]|PRE|BLOCKQUOTE|TABLE|HR)$/.test(
          sibling.tagName,
        );
      if (
        /^[\t\r\n ]*$/.test(node.textContent ?? "") &&
        /[\r\n]/.test(node.textContent ?? "") &&
        (isBlock(node.previousSibling) || isBlock(node.nextSibling))
      )
        return "";
      return escapeText((node.textContent ?? "").replace(/\s+/g, " "));
    }
    if (!(node instanceof Element)) return "";
    const tag = node.tagName;
    if (
      [
        "SCRIPT",
        "STYLE",
        "META",
        "LINK",
        "NOSCRIPT",
        "IFRAME",
        "OBJECT",
        "BUTTON",
        "INPUT",
      ].includes(tag)
    )
      return "";
    if (tag === "PRE") {
      const text = (node.textContent ?? "").replace(/\n$/, "");
      const fence = fenceFor(text, "`");
      const language =
        node
          .querySelector("code")
          ?.className.match(/(?:^|\s)language-([\w+-]+)/)?.[1] ?? "";
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    }
    if (tag === "UL" || tag === "OL") return `\n\n${renderList(node)}\n\n`;
    if (tag === "TABLE") {
      const table = renderTable(node);
      if (table === null) unsupported = true;
      return table === null ? "" : `\n\n${table}\n\n`;
    }
    const weight = (node as HTMLElement).style.fontWeight;
    const bold =
      weight === "bold" ||
      weight === "bolder" ||
      Number.parseInt(weight, 10) >= 600 ||
      (["STRONG", "B"].includes(tag) &&
        weight !== "normal" &&
        !(Number.parseInt(weight, 10) < 600));
    const italic =
      (node as HTMLElement).style.fontStyle === "italic" ||
      ["EM", "I"].includes(tag);
    const strike =
      ["DEL", "S"].includes(tag) ||
      /line-through/.test(
        (node as HTMLElement).style.textDecoration +
          " " +
          (node as HTMLElement).style.textDecorationLine,
      );
    let content = renderChildren(node, {
      bold: inherited.bold || bold,
      italic: inherited.italic || italic,
      strike: inherited.strike || strike,
    });
    if (strike && !inherited.strike) content = wrapInline(content, "~~");
    if (italic && !inherited.italic) content = wrapInline(content, "*");
    if (bold && !inherited.bold) content = wrapInline(content, "**");
    if (/^H[1-6]$/.test(tag))
      return `\n\n${"#".repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (["P", "DIV", "SECTION", "ARTICLE"].includes(tag))
      return `\n\n${content.trim()}\n\n`;
    if (tag === "BR") return "\n";
    if (tag === "HR") return "\n\n---\n\n";
    if (["STRONG", "B", "EM", "I", "DEL", "S"].includes(tag)) return content;
    if (tag === "CODE") {
      const text = (node.textContent ?? "").replace(/\n/g, " ");
      const fence = "`".repeat(
        Math.max(
          1,
          ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1),
        ),
      );
      const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
      return `${fence}${pad}${text}${pad}${fence}`;
    }
    if (tag === "BLOCKQUOTE")
      return `\n\n${content
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    if (tag === "A") {
      const url = safeUrl(node.getAttribute("href") ?? "");
      return url === null
        ? content
        : `[${content.trim()}](<${url.replace(/>/g, "%3E")}>)`;
    }
    if (tag === "IMG") return escapeText(node.getAttribute("alt") ?? "");
    return content;
  }
  const result = renderChildren(body).trim();
  const block =
    result.includes("\n") ||
    body.querySelector("h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,table,hr") !==
      null;
  return unsupported || result.length === 0
    ? null
    : {
        text:
          !block && plainText
            ? (plainText.match(/^[ \t]+/)?.[0] ?? "") +
              result +
              (plainText.match(/[ \t]+$/)?.[0] ?? "")
            : result,
        // A browser often wraps a copied inline selection in a single <p>/<div>.
        // Such a selection should paste at the cursor without splitting its block.
        block,
      };
};

export const clipboardHtmlToMarkdown = (html: string): string | null =>
  readClipboardMarkdown(html)?.text ?? null;

export const clipboardMarkdownChanges = (
  state: EditorState,
  clipboard: ClipboardMarkdown,
) => {
  if (!clipboard.block) return state.replaceSelection(clipboard.text);
  return state.changeByRange((range) => {
    const context = markdownListLine(state, range.from);
    let from = range.from;
    let to = range.to;
    let insert = clipboard.text;
    if (context && from >= context.contentFrom && to <= context.line.to) {
      const empty = !state.doc
        .sliceString(context.contentFrom, context.line.to)
        .trim();
      const list = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/.test(insert);
      if (empty && list) {
        from = context.line.from;
        to = context.line.to;
        insert = insert
          .split("\n")
          .map((line) => context.leading + line)
          .join("\n");
      } else {
        const indentation = context.continuationPrefix;
        const structural = /^(?:#{1,6} |>|```|~~~|[-*+] |\d+[.)] |\|)/.test(
          insert,
        );
        if (structural && from > context.contentFrom) insert = "\n\n" + insert;
        if (to < context.line.to) insert += "\n\n";
        insert = insert.replace(/\n/g, "\n" + indentation);
      }
    } else {
      const before = state.doc.sliceString(Math.max(0, from - 2), from);
      const after = state.doc.sliceString(
        to,
        Math.min(state.doc.length, to + 2),
      );
      insert =
        (before === "" || before.endsWith("\n\n")
          ? ""
          : before.endsWith("\n")
            ? "\n"
            : "\n\n") +
        insert +
        (after === "" || after.startsWith("\n\n")
          ? ""
          : after.startsWith("\n")
            ? "\n"
            : "\n\n");
    }
    return {
      changes: { from, to, insert },
      range: EditorSelection.cursor(from + insert.length),
    };
  });
};
