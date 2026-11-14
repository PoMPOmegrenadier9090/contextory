import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { conversionAt } from "./object-conversion.js";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 } },
    },
    bulletList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph block*" },
  },
});
const { doc, paragraph: p, heading, bulletList, listItem } = schema.nodes;
const text = (value: string) => schema.text(value);
const para = (value: string) => p.create(null, value ? text(value) : null);

/** valueを含む行の中のpos。 */
const posIn = (root: PMNode, value: string): number => {
  let found = -1;
  root.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent === value)
      found = pos + 1;
  });
  return found;
};
const bodyText = (root: PMNode, value: string, end: number | null = null) => {
  const target = conversionAt(root.resolve(posIn(root, value)), end);
  return (
    target && {
      title: target.title.textBetween(0, target.title.size),
      body: target.body.map((node) => node.textContent),
      replaced: root.textBetween(target.from, target.to, "|"),
    }
  );
};

describe("conversionAt", () => {
  it("drops trailing spaces left before the #", () => {
    expect(bodyText(doc.create(null, [para("会議 ")]), "会議 ")).toEqual({
      title: "会議",
      body: [],
      replaced: "会議 ",
    });
  });

  it("takes a heading's section up to the next heading of the same level", () => {
    const root = doc.create(null, [
      heading.create({ level: 2 }, text("設計")),
      para("本文"),
      heading.create({ level: 3 }, text("小見出し")),
      para("詳細"),
      heading.create({ level: 2 }, text("次")),
    ]);
    expect(bodyText(root, "設計")?.body).toEqual(["本文", "小見出し", "詳細"]);
  });

  it("keeps a list item in its list and takes its children", () => {
    const root = doc.create(null, [
      bulletList.create(null, [
        listItem.create(null, [
          para("親"),
          bulletList.create(null, [listItem.create(null, [para("子")])]),
        ]),
        listItem.create(null, [para("隣")]),
      ]),
    ]);
    expect(bodyText(root, "親")).toEqual({
      title: "親",
      body: ["子"],
      replaced: "親|子",
    });
  });

  it("takes the selected following blocks as the body", () => {
    const root = doc.create(null, [
      para("タイトル"),
      para("一"),
      para("二"),
      para("残す"),
    ]);
    const end = posIn(root, "二") + 2;
    expect(bodyText(root, "タイトル", end)?.body).toEqual(["一", "二"]);
  });
});
