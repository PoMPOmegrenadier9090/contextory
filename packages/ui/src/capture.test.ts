import { describe, expect, it } from "vitest";
import type { DocNode } from "@pkm/core";
import { captureDoc, captureMemo } from "./capture.js";

const text = (value: string): DocNode => ({ type: "text", text: value });
const paragraph = (...content: DocNode[]): DocNode => ({
  type: "paragraph",
  content,
});
/** 書き始めのMemoのTitleと本文を差し替える。 */
const write = (title: DocNode[], ...body: DocNode[]): DocNode => {
  const memo = captureDoc("project").content![0]!;
  const [, field] = memo.content!;
  return {
    type: "doc",
    content: [
      {
        ...memo,
        content: [{ type: "objectTitle", content: title }, field!, ...body],
      },
    ],
  };
};

describe("Quick Capture", () => {
  it("starts with an empty Memo carrying the Context", () => {
    const doc = captureDoc("project");
    expect(JSON.stringify(doc)).toContain('"objectId":"project"');
    expect(captureMemo(doc)).toBeNull();
    expect(captureMemo(captureDoc(null))).toBeNull();
  });

  it("keeps the written Memo and drops empty paragraphs", () => {
    const list: DocNode = {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph(text("項目"))] }],
    };
    const memo = captureMemo(write([text("考え")], paragraph(), list))!;
    expect(memo.attrs?.collapsed).toBe(false);
    expect(memo.content?.map((node) => node.type)).toEqual([
      "objectTitle",
      "objectField",
      "bulletList",
    ]);
    // Titleだけなら畳んで置く。
    expect(
      captureMemo(write([text("Titleだけ")], paragraph()))?.attrs,
    ).toMatchObject({ collapsed: true });
  });

  it("wraps text written after removing the Object", () => {
    const memo = captureMemo({
      type: "doc",
      content: [paragraph(text("解除して書いた")), paragraph()],
    })!;
    expect(memo.type).toBe("objectBlock");
    expect(memo.attrs?.type).toBe("memo");
    expect(memo.content?.map((node) => node.type)).toEqual([
      "objectTitle",
      "paragraph",
    ]);
  });
});
