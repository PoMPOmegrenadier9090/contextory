import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { remarkPreviewLists } from "./markdown-preview-lists.js";

const parse = (source: string) => {
  const processor = unified().use(remarkParse).use(remarkPreviewLists);
  return processor.runSync(processor.parse(source), { value: source });
};

describe("preview list interpretation", () => {
  it("keeps an empty nested hyphen from making its parent text a heading", () => {
    for (const suffix of ["", " ", "\n- 次の項目"]) {
      const tree = parse("- できていなかった活動の実現\n  -" + suffix);
      expect(
        tree.children[0]?.type === "list" && tree.children[0].children[0],
      ).toMatchObject({
        type: "listItem",
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "できていなかった活動の実現" }],
          },
          { type: "list", children: [{ type: "listItem", children: [] }] },
        ],
      });
    }
  });
  it("preserves explicit headings, emphasis and fenced code", () => {
    expect(parse("- 見出し\n  --").children[0]).toMatchObject({
      type: "list",
      children: [{ children: [{ type: "heading", depth: 2 }] }],
    });
    expect(parse("見出し\n-").children[0]).toMatchObject({
      type: "heading",
      depth: 2,
    });
    expect(parse("- **太字**").children[0]).toMatchObject({
      type: "list",
      children: [{ children: [{ children: [{ type: "strong" }] }] }],
    });
    expect(parse("```\n- text\n  -\n```").children[0]).toMatchObject({
      type: "code",
      value: "- text\n  -",
    });
  });
});
