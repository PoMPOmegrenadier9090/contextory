import { describe, expect, it } from "vitest";

import { markdownToPlainText } from "./markdown-plain-text.js";

describe("markdownToPlainText", () => {
  it("removes Markdown structure while preserving searchable text", () => {
    expect(
      markdownToPlainText(
        "# 見出し\n\n**強調**と[リンク](https://example.com)\n\n- 項目1\n- 項目2",
      ),
    ).toBe("見出し\n強調とリンク\n項目1\n項目2");
  });
});
