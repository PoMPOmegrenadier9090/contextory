import { describe, expect, it } from "vitest";
import {
  prepareMarkdownBodyPreview,
  MarkdownBodyPreview,
} from "./markdown-body-preview.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMarkdownPreview } from "./markdown-preview-tree.js";
import { visit } from "unist-util-visit";

describe("reference labels in Markdown previews", () => {
  it("renders cell line breaks without enabling arbitrary HTML", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownBodyPreview, {
        body: "| A |\n| --- |\n| one<br>two<img src=x onerror=alert(1)> |",
        onOpenEntity: () => {},
      }),
    );
    expect(html).toContain("one<br/>\ntwo");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
  const id = "ent_01997c2a-7b1c-7a01-8a10-000000000099";
  it("resolves unlabeled links, preserves explicit labels, and leaves code literal", () => {
    const labels = new Map([[id, "実験 [結果]"]]);
    expect(prepareMarkdownBodyPreview(`[[entry:${id}]]`, labels)).toBe(
      `[実験 \\[結果\\]](pkm:entity/${id})`,
    );
    expect(
      prepareMarkdownBodyPreview(`[[entry:${id}|自分のラベル]]`, labels),
    ).toBe(`[自分のラベル](pkm:entity/${id})`);
    expect(prepareMarkdownBodyPreview(`\`[[entry:${id}]]\``, labels)).toBe(
      `\`[[entry:${id}]]\``,
    );
    expect(prepareMarkdownBodyPreview(`[[entry:${id}]]`)).toBe(
      `[未解決の参照](pkm:entity/${id})`,
    );
  });
  it("keeps original Todo offsets after references, escaped punctuation and nested lists", () => {
    const body = `&amp; \\*literal\\* \\[[entry:${id}]] [[entry:${id}|リンク]]\r\n\r\n- [ ] 親\r\n  - [x] 子\r\n\r\n> 1. [ ] 引用`;
    const parsed = parseMarkdownPreview(body);
    const offsets: number[] = [];
    visit(parsed.tree, "element", (node) => {
      if (typeof node.properties.dataTodoFrom === "number")
        offsets.push(node.properties.dataTodoFrom);
    });
    expect(offsets.map((from) => body.slice(from, from + 3))).toEqual([
      "[ ]",
      "[x]",
      "[ ]",
    ]);
    expect(offsets).toEqual([
      body.indexOf("[ ] 親"),
      body.indexOf("[x] 子"),
      body.indexOf("[ ] 引用"),
    ]);
    const html = renderToStaticMarkup(
      createElement(MarkdownBodyPreview, {
        body,
        onOpenEntity: () => {},
        onToggleTodo: async () => {},
      }),
    );
    expect(html).toContain(`[[entry:${id}]]`);
    expect(html).toContain("&amp; *literal*");
    expect(html.match(/class="markdown-entity-link"/g)).toHaveLength(1);
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html).not.toContain('disabled=""');
  });

  it("preserves Markdown exclusions and escapes raw HTML and unsafe URLs", () => {
    const ref = `[[entry:${id}]]`;
    const body = `${ref}\n\n\`${ref}\`\n\n| Ref |\n| --- |\n| ${ref} |\n\n<script>alert(1)</script>\n\n[bad](javascript:alert)\n\nhttps://example.com`;
    const parsed = parseMarkdownPreview(body);
    expect(parsed.references).toHaveLength(1);
    expect(parsed.links).toEqual(["https://example.com/"]);
    const html = renderToStaticMarkup(
      createElement(MarkdownBodyPreview, {
        body,
        onOpenEntity: () => {},
        referenceOptions: [{ id, type: "entry", displayName: "表示名" }],
      }),
    );
    expect(html).toContain(">表示名</button>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html.match(/class="markdown-entity-link"/g)).toHaveLength(1);
  });
});
