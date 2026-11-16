import type { DocNode } from "@pkm/core";

/** 本文から指すObject。pathは書き出す側のファイルからの相対パス。 */
export interface MarkdownLink {
  readonly title: string;
  readonly path: string;
  /** 完了のチェックボックスを持つ種別なら、その状態。持たなければnull */
  readonly done: boolean | null;
}

export type MarkdownLookup = (id: string) => MarkdownLink | undefined;

/** ファイル名に使えない文字を置き換える。 */
export const safeName = (name: string): string =>
  name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "_")
    .trim()
    .slice(0, 60) || "無題";

const linkText = (text: string): string => text.replace(/[[\]]/g, "\\$&");
/** ファイル名の#や空白も、リンク先として読めるように符号化する。 */
const href = (path: string): string =>
  path.split("/").map(encodeURIComponent).join("/");

const inline = (nodes: readonly DocNode[], link: MarkdownLookup): string =>
  nodes
    .map((node) => {
      if (node.type === "text") {
        let text = node.text ?? "";
        for (const mark of (node.marks ?? []) as readonly DocNode[])
          text =
            mark.type === "bold"
              ? `**${text}**`
              : mark.type === "italic"
                ? `*${text}*`
                : mark.type === "strike"
                  ? `~~${text}~~`
                  : mark.type === "code"
                    ? `\`${text}\``
                    : mark.type === "link"
                      ? `[${text}](${typeof mark.attrs?.href === "string" ? mark.attrs.href : ""})`
                      : text;
        return text;
      }
      if (node.type === "hardBreak") return "  \n";
      if (node.type === "objectRef") {
        const target = link(String(node.attrs?.objectId));
        return target
          ? `[${linkText(target.title)}](${href(target.path)})`
          : "（削除されたObject）";
      }
      return inline(node.content ?? [], link);
    })
    .join("");

const listItem = (
  item: DocNode,
  marker: string,
  link: MarkdownLookup,
): string => {
  const pad = " ".repeat(marker.length + 1);
  return (item.content ?? [])
    .map((child) => block(child, link))
    .join("\n")
    .split("\n")
    .map((line, i) => (i === 0 ? `${marker} ${line}` : line && pad + line))
    .join("\n");
};

const block = (node: DocNode, link: MarkdownLookup): string => {
  const content = node.content ?? [];
  switch (node.type) {
    case "paragraph":
      return inline(content, link);
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level) || 1)} ${inline(content, link)}`;
    case "bulletList":
      return content.map((item) => listItem(item, "-", link)).join("\n");
    case "orderedList":
      return content
        .map((item, i) => listItem(item, `${i + 1}.`, link))
        .join("\n");
    case "taskList":
      return content
        .map((item) =>
          listItem(item, item.attrs?.checked ? "- [x]" : "- [ ]", link),
        )
        .join("\n");
    case "blockquote":
      return toMarkdown(content, link)
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "codeBlock":
      return `\`\`\`\n${inline(content, link)}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "objectField":
      return "";
    case "objectEmbed": {
      const target = link(String(node.attrs?.objectId));
      if (!target) return "";
      const box =
        target.done === null ? "- " : target.done ? "- [x] " : "- [ ] ";
      return `${box}[${linkText(target.title)}](${href(target.path)})`;
    }
    default:
      return toMarkdown(content, link);
  }
};

/** 文書の本文をMarkdownにする。Objectの埋め込みと参照は、そのファイルへのリンクにする。 */
export const toMarkdown = (
  nodes: readonly DocNode[],
  link: MarkdownLookup,
): string =>
  nodes
    .map((node) => block(node, link))
    .filter((text) => text !== "")
    .join("\n\n");
