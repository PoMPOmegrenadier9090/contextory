import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { objectConversionTargetAt } from "./object-editor.js";

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
    orderedList: {
      group: "block",
      content: "listItem+",
      attrs: { start: { default: 1 } },
    },
    listItem: { content: "paragraph block*" },
  },
});

const text = (value: string): PMNode => schema.text(value);
const paragraph = (value: string): PMNode =>
  schema.node("paragraph", null, text(value));
const heading = (level: number, value: string): PMNode =>
  schema.node("heading", { level }, text(value));
const item = (value: string, ...body: PMNode[]): PMNode =>
  schema.node("listItem", null, [paragraph(value), ...body]);
const bulletList = (...items: PMNode[]): PMNode =>
  schema.node("bulletList", null, items);

const inside = (doc: PMNode, type: string, value: string): number => {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (
      found === null &&
      node.type.name === type &&
      node.textContent === value
    ) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  if (found === null) throw new Error(`${type} ${value} was not found`);
  return found;
};

describe("objectConversionTargetAt", () => {
  it("moves a heading section into one Object", () => {
    const doc = schema.node("doc", null, [
      heading(1, "対象"),
      paragraph("本文"),
      heading(2, "小見出し"),
      paragraph("小見出しの本文"),
      heading(1, "次"),
      paragraph("次の本文"),
    ]);

    const target = objectConversionTargetAt(
      doc.resolve(inside(doc, "heading", "対象")),
    );

    expect(target?.title.textBetween(0, target.title.size)).toBe("対象");
    expect(target?.body.map((node) => node.textContent)).toEqual([
      "本文",
      "小見出し",
      "小見出しの本文",
    ]);
    expect(target?.toIndex).toBe(4);
  });

  it("moves a whole list item and keeps its siblings", () => {
    const doc = schema.node("doc", null, [
      bulletList(item("前"), item("対象", bulletList(item("子"))), item("後")),
    ]);

    const target = objectConversionTargetAt(
      doc.resolve(inside(doc, "paragraph", "対象")),
    );

    expect(target?.title.textBetween(0, target.title.size)).toBe("対象");
    expect(target?.body.map((node) => node.textContent)).toEqual(["子"]);
    expect(target?.before.map((node) => node.textContent)).toEqual(["前"]);
    expect(target?.after.map((node) => node.textContent)).toEqual(["後"]);
    expect(target?.receiverDepth).toBe(0);
  });
});
