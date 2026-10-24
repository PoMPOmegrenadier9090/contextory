import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface MarkdownMathRange {
  readonly from: number;
  readonly to: number;
  readonly source: string;
  readonly displayMode: boolean;
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

// Parse Markdown so escaped dollars and formulas inside ordinary code stay literal.
export const markdownMathRanges = (
  body: string,
): readonly MarkdownMathRange[] => {
  if (!body.includes("$") && !body.includes("math")) return [];
  const ranges: MarkdownMathRange[] = [];
  const visit = (node: Root | RootContent): void => {
    if (
      node.type === "math" ||
      node.type === "inlineMath" ||
      (node.type === "code" && node.lang === "math")
    ) {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from !== undefined && to !== undefined && from < to) {
        ranges.push({
          from,
          to,
          source: node.value,
          displayMode: node.type !== "inlineMath",
        });
      }
    } else if ("children" in node) {
      node.children.forEach(visit);
    }
  };
  visit(parser.parse(body));
  return ranges;
};
