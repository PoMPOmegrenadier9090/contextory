import { extractDirectReferences } from "@pkm/core";
import type { PhrasingContent } from "mdast";
import { decodeString } from "micromark-util-decode-string";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { remarkPreviewLists } from "./markdown-preview-lists.js";
import { previewLinks } from "./link-preview.js";

export const ENTITY_SCHEME = "pkm:entity/";
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const renderer = unified()
  .use(remarkPreviewLists)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeKatex, { trust: false, strict: "ignore" });

export const parseMarkdownPreview = (body: string) => {
  const tree = parser.parse(body);
  visit(tree, "table", (table) => {
    visit(table, "html", (node, index, parent) => {
      if (parent && index !== undefined && /^<br\s*\/?\s*>$/i.test(node.value))
        parent.children.splice(index, 1, { type: "break" });
    });
  });
  const references = extractDirectReferences(body, tree);
  const links = previewLinks(body, tree);
  let referenceIndex = 0;
  visit(tree, "text", (node, index, parent) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (
      start === undefined ||
      end === undefined ||
      index === undefined ||
      !parent
    )
      return;
    const children: PhrasingContent[] = [];
    let cursor = 0;
    while (referenceIndex < references.length) {
      const reference = references[referenceIndex]!;
      if (reference.startOffset >= end) break;
      referenceIndex++;
      if (reference.startOffset < start) continue;
      const decodedOffset = (offset: number) =>
        decodeString(body.slice(start, offset).replace(/\r\n?/g, "\n")).length;
      const from = decodedOffset(reference.startOffset);
      const to = decodedOffset(reference.endOffset);
      children.push(
        { type: "text", value: node.value.slice(cursor, from) },
        {
          type: "link",
          url: `${ENTITY_SCHEME}${reference.targetId}`,
          children: [
            { type: "text", value: reference.label ?? "未解決の参照" },
          ],
          data: { hProperties: { dataUnlabelled: reference.label === null } },
        },
      );
      cursor = to;
    }
    if (!children.length) return;
    children.push({ type: "text", value: node.value.slice(cursor) });
    parent.children.splice(index, 1, ...children);
    return index + children.length;
  });
  visit(tree, "listItem", (node) => {
    const start = node.position?.start.offset;
    if (typeof node.checked !== "boolean" || start === undefined) return;
    // GFM has already identified this marker; keep its original source offset.
    node.data = {
      ...node.data,
      hProperties: { dataTodoFrom: body.indexOf("[", start) },
    };
  });
  const rendered = renderer.runSync(tree, { value: body });
  // Match ReactMarkdown's default: raw HTML is displayed as text, never executed.
  visit(rendered, (node, index, parent) => {
    if (node.type === "raw" && parent && index !== undefined)
      parent.children.splice(index, 1, { type: "text", value: node.value });
  });
  return { tree: rendered, references, links };
};
