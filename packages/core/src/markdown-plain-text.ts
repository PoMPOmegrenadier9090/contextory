import type { Root } from "mdast";
import { parseMarkdownBody } from "./markdown-body.js";

interface MarkdownNode {
  readonly type: string;
  readonly value?: unknown;
  readonly alt?: unknown;
  readonly children?: readonly MarkdownNode[];
}

const blockNodes = new Set([
  "blockquote",
  "code",
  "definition",
  "heading",
  "list",
  "listItem",
  "paragraph",
  "table",
  "tableRow",
  "thematicBreak",
]);

const renderNode = (node: MarkdownNode): string => {
  if (
    (node.type === "text" ||
      node.type === "inlineCode" ||
      node.type === "code") &&
    typeof node.value === "string"
  ) {
    return node.value;
  }
  if (node.type === "image" && typeof node.alt === "string") {
    return node.alt;
  }
  if (node.type === "break") return "\n";

  const content = node.children?.map(renderNode).join("") ?? "";
  return blockNodes.has(node.type) && content.length > 0
    ? `${content}\n`
    : content;
};

export const markdownToPlainText = (markdown: string, tree?: Root): string => {
  if (markdown.length === 0) return "";
  tree ??= parseMarkdownBody(markdown);
  return renderNode(tree)
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n{2,}/g, "\n")
    .trim();
};
