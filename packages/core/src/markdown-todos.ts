import type { Root, RootContent } from "mdast";
import { parseMarkdownBody } from "./markdown-body.js";

export interface MarkdownTodoItem {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly checked: boolean;
  readonly depth: number;
}

const plainText = (node: RootContent): string => {
  if ("value" in node) return node.value;
  if (node.type === "image" || node.type === "imageReference")
    return node.alt ?? "";
  if (node.type === "break") return "\n";
  return "children" in node ? node.children.map(plainText).join("") : "";
};

// Positions are UTF-16 offsets into the Entry body, never the frontmatter.
export const extractMarkdownTodos = (
  body: string,
  tree: Root = parseMarkdownBody(body),
): readonly MarkdownTodoItem[] => {
  const result: MarkdownTodoItem[] = [];
  const walk = (node: typeof tree | RootContent, depth: number): void => {
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      const start = node.position?.start.offset;
      const match =
        start === undefined
          ? null
          : /^(?:[-+*]|\d+[.)])[\t ]+\[([ xX])\](?=[\t \r\n]|$)/.exec(
              body.slice(start),
            );
      if (start !== undefined && match !== null) {
        const from = start + match[0].length - 3;
        result.push({
          from,
          to: from + 3,
          checked: node.checked,
          text: node.children
            .filter((child) => child.type !== "list")
            .map(plainText)
            .join("\n")
            .trim(),
          depth,
        });
      }
    }
    if ("children" in node)
      for (const child of node.children)
        walk(child, depth + (child.type === "list" ? 1 : 0));
  };
  walk(tree, -1);
  return result;
};
