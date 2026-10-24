import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownBodyPreview } from "@pkm/ui";

import { MarkdownPreview, prepareMarkdownPreview } from "./markdown-preview.js";

const TASK_ID = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";

describe("prepareMarkdownPreview", () => {
  it("renders inline, display, and fenced math while preserving ordinary code", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        content:
          "式 $E=mc^2$\n\n$$\n\\frac{1}{2}\n$$\n\n```math\nx^2\n```\n\n`$literal$`",
        onOpenEntity: () => undefined,
      }),
    );
    expect(html.match(/class="katex"/g)).toHaveLength(3);
    expect(html.match(/class="katex-display"/g)).toHaveLength(2);
    expect(html).toContain("<math");
    expect(html).toContain("<code>$literal$</code>");
  });

  it("keeps invalid math readable and does not trust TeX HTML commands", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        content:
          "$\\unknowncommand{x}$\n\n$\\href{javascript:alert(1)}{click}$",
        onOpenEntity: () => undefined,
      }),
    );
    expect(html).toContain("unknowncommand");
    expect(html).not.toContain('href="javascript:');
  });
  it("removes frontmatter and turns direct references into local links", () => {
    const content = `---
id: ent_01997c2a-7b1c-7a01-8a10-000000000006
type: entry
created_at: 2026-09-23T00:00:00.000Z
updated_at: 2026-09-23T00:00:00.000Z
origin: human
exclude_from_ai: false
---
# メモ

次は [[task:${TASK_ID}|実装する]]。
`;

    expect(prepareMarkdownPreview(content)).toContain(
      `[実装する](pkm:entity/${TASK_ID})`,
    );
    expect(prepareMarkdownPreview(content)).not.toContain("frontmatter");
    expect(prepareMarkdownPreview(content)).not.toContain("created_at");
  });

  it("keeps references in code and tables as plain source", () => {
    const reference = `[[task:${TASK_ID}|実装する]]`;
    const markdown = `\`${reference}\`\n\n| Task |\n| --- |\n| ${reference} |\n`;

    expect(prepareMarkdownPreview(markdown)).toBe(markdown);
  });

  it("renders task markers as checkboxes", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        content: "- [ ] 未完了\n- [x] 完了\n",
        onOpenEntity: () => undefined,
      }),
    );

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).not.toContain("- [ ]");
  });

  it("resolves portable asset links through the Web API", () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        content: `![図](../assets/images/${id}.png)\n\n[資料](../assets/files/${id}.pdf)`,
        onOpenEntity: () => undefined,
      }),
    );
    expect(html).toContain(`/api/assets/images/${id}.png`);
    expect(html).toContain(`/api/assets/files/${id}.pdf`);
    expect(html).toContain("download=");
  });

  it("renders the supplied link label and bare URL as links", () => {
    const label =
      '(15) Leo builds on X: "Only 2% of people in the world pay for AI. What a bubble we live in." / X';
    const url = "https://x.com/LeoBuilds_/status/2106159384787345556";
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        content: `[${label}](${url})\n\nhttps://example.com\n\n---\n\n- item`,
        onOpenEntity: () => undefined,
      }),
    );
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("Only 2% of people");
    expect(html).not.toContain(`[${label}]`);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<hr");
    expect(html).toContain("<li>item</li>");
  });

  it("enables timeline checkboxes only with a save callback, even after direct-reference replacement", () => {
    const props = {
      body: `[[task:${TASK_ID}|作業]]\n\n- [ ] first\n  - [x] nested`,
      onOpenEntity: () => undefined,
    };
    const readOnly = renderToStaticMarkup(
      createElement(MarkdownBodyPreview, props),
    );
    expect(readOnly.match(/disabled=""/g)).toHaveLength(2);
    const editable = renderToStaticMarkup(
      createElement(MarkdownBodyPreview, {
        ...props,
        onToggleTodo: () => Promise.resolve(),
      }),
    );
    expect(editable).not.toContain('disabled=""');
    expect(editable.match(/type="checkbox"/g)).toHaveLength(2);
  });
});
