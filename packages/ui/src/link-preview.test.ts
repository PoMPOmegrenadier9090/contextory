import { describe, expect, it } from "vitest";
import { previewLinks, singlePreviewUrl } from "./link-preview.js";

describe("previewLinks", () => {
  it("finds bare URLs, Markdown and reference links while ignoring images and code", () => {
    expect(
      previewLinks(`https://example.com/a
[article](https://example.com/b) [again](https://example.com/a)
![image](https://example.com/image.png)
\`https://example.com/code\`
\`\`\`text
https://example.com/fenced
\`\`\`
[reference][ref]
[ref]: https://example.com/c
`),
    ).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);
  });
  it("excludes other protocols and credentials and bounds the number of cards", () => {
    expect(
      previewLinks(
        "[bad](javascript:alert) [local](file:///tmp/a) https://user:pass@example.com",
      ),
    ).toEqual([]);
    expect(
      previewLinks(
        Array.from({ length: 5 }, (_, i) => `https://example.com/${i}`).join(
          "\n",
        ),
      ),
    ).toHaveLength(3);
    expect(previewLinks("普通のメモ")).toEqual([]);
  });
});

describe("singlePreviewUrl", () => {
  it("recognizes a single bare URL or autolink with surrounding whitespace", () => {
    expect(
      singlePreviewUrl("  \nhttps://example.com/article?a=1#section\n "),
    ).toBe("https://example.com/article?a=1#section");
    expect(singlePreviewUrl("<https://example.com>")).toBe(
      "https://example.com/",
    );
  });
  it("preserves prose, lists, labelled links, code, multiple URLs and invalid URLs", () => {
    for (const body of [
      "参考 https://example.com",
      "https://example.com メモ",
      "https://example.com\nhttps://other.example.com",
      "[記事](https://example.com)",
      "- https://example.com",
      "`https://example.com`",
      "<https://example.com",
      "javascript:alert(1)",
      "https://user:pass@example.com",
      "http://",
      "",
    ])
      expect(singlePreviewUrl(body), body).toBeNull();
  });
});
