import { describe, expect, it } from "vitest";
import type { DocNode } from "@pkm/core";
import { captureMemo, emptyBody } from "./capture.js";

const text = (value: string): DocNode => ({ type: "text", text: value });
const paragraph = (...content: DocNode[]): DocNode => ({
  type: "paragraph",
  content,
});
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });

describe("Quick Capture", () => {
  it("does nothing until something is written", () => {
    expect(
      captureMemo({ title: " ", context: "project", body: emptyBody() }),
    ).toBeNull();
  });

  it("builds a Memo with the Context and the written body", () => {
    const list: DocNode = {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph(text("項目"))] }],
    };
    const memo = captureMemo({
      title: " 考え ",
      context: "project",
      body: doc(paragraph(), list),
    })!;
    expect(memo.attrs).toMatchObject({ type: "memo", collapsed: false });
    expect(memo.content?.map((node) => node.type)).toEqual([
      "objectTitle",
      "objectField",
      "bulletList",
    ]);
    expect(memo.content?.[0]?.content).toEqual([text("考え")]);
    expect(JSON.stringify(memo.content?.[1])).toContain('"objectId":"project"');
  });

  it("folds a title-only Memo and keeps an untitled one", () => {
    expect(
      captureMemo({ title: "Titleだけ", context: null, body: emptyBody() })
        ?.attrs,
    ).toMatchObject({ collapsed: true });
    const untitled = captureMemo({
      title: "",
      context: null,
      body: doc(paragraph(text("本文だけ"))),
    })!;
    expect(untitled.content?.map((node) => node.type)).toEqual([
      "objectTitle",
      "paragraph",
    ]);
  });
});
