import { describe, expect, it } from "vitest";
import {
  collectMentionUnits,
  joinDocument,
  newId,
  splitDocument,
  timeFromId,
  type DocNode,
} from "./object-document.js";

const text = (value: string): DocNode => ({ type: "text", text: value });
const ref = (objectId: string): DocNode => ({
  type: "objectRef",
  attrs: { objectId },
});
const paragraph = (id: string, ...content: DocNode[]): DocNode => ({
  type: "paragraph",
  attrs: { id },
  content,
});
const block = (
  objectId: string,
  title: string,
  ...body: DocNode[]
): DocNode => ({
  type: "objectBlock",
  attrs: {
    id: `b-${objectId}`,
    objectId,
    type: "task",
    done: false,
    collapsed: true,
  },
  content: [{ type: "objectTitle", content: [text(title)] }, ...body],
});

describe("object document", () => {
  it("splits objects out of the document and joins them back", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        paragraph("p1", text("a")),
        block("t1", "親", paragraph("p2"), block("t2", "子")),
      ],
    };
    const split = splitDocument(doc);
    expect(split.host.content?.[1]).toEqual({
      type: "objectEmbed",
      attrs: { id: "b-t1", objectId: "t1", collapsed: true },
    });
    expect(split.parents).toEqual({ t1: null, t2: "t1" });
    expect(split.objects.t1?.body[1]).toMatchObject({ type: "objectEmbed" });
    expect(joinDocument(split.host, split.objects)).toEqual(doc);
  });

  it("does not expand cyclic embeds", () => {
    const embed: DocNode = { type: "objectEmbed", attrs: { objectId: "a" } };
    const joined = joinDocument(
      { type: "doc", content: [embed] },
      { a: { attrs: {}, title: [], body: [embed] } },
    );
    expect(joined.content?.[0]?.content?.[1]).toEqual(embed);
  });

  it("delivers the smallest enclosing structure of each mention", () => {
    const units = collectMentionUnits([
      { type: "heading", attrs: { id: "h" }, content: [ref("a")] },
      paragraph("p", ref("b")),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            attrs: { id: "li" },
            content: [paragraph("lp", ref("c"))],
          },
        ],
      },
    ]);
    expect(units.map((u) => [u.targetId, u.kind, u.node.attrs?.id])).toEqual([
      ["a", "section", "h"],
      ["b", "block", "p"],
      ["c", "listItem", "li"],
    ]);
  });

  it("encodes the creation time in ids", () => {
    expect(timeFromId(newId(1_700_000_000_000))).toBe(1_700_000_000_000);
    expect(timeFromId("b-ctx-1")).toBeNull();
  });
});
