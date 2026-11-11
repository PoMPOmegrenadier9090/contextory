import { describe, expect, it } from "vitest";
import {
  collectMentions,
  joinDocument,
  splitDocument,
  type DocNode,
} from "./tiptap-spike-model.js";

const ref = (objectId: string): DocNode => ({
  type: "objectRef",
  attrs: { objectId },
});
const text = (value: string): DocNode => ({ type: "text", text: value });

const doc: DocNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { id: "h1", level: 2 }, content: [ref("proj")] },
    { type: "paragraph", attrs: { id: "p1" }, content: [text("a"), ref("x")] },
    {
      type: "objectBlock",
      attrs: {
        id: "b1",
        objectId: "t1",
        type: "task",
        done: false,
        collapsed: false,
      },
      content: [
        { type: "objectTitle", content: [text("親Task")] },
        { type: "paragraph", attrs: { id: "p2" }, content: [ref("y")] },
        {
          type: "objectBlock",
          attrs: {
            id: "b2",
            objectId: "t2",
            type: "task",
            done: true,
            collapsed: true,
          },
          content: [{ type: "objectTitle" }],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          attrs: { id: "li1" },
          content: [
            { type: "paragraph", attrs: { id: "p3" }, content: [ref("z")] },
          ],
        },
      ],
    },
  ],
};

describe("tiptap spike model", () => {
  it("splits objects out of the document and joins them back", () => {
    const split = splitDocument(doc);
    expect(split.host.content?.[2]).toEqual({
      type: "objectEmbed",
      attrs: { id: "b1", objectId: "t1", collapsed: false },
    });
    expect(split.objects.t1).toMatchObject({
      attrs: { type: "task", done: false },
      title: [text("親Task")],
    });
    expect(split.objects.t1?.body[1]).toMatchObject({ type: "objectEmbed" });
    expect(split.objects.t2?.attrs).toEqual({ type: "task", done: true });
    expect(joinDocument(split)).toEqual(doc);
  });

  it("does not expand cyclic embeds", () => {
    const embed: DocNode = { type: "objectEmbed", attrs: { objectId: "a" } };
    const joined = joinDocument({
      host: { type: "doc", content: [embed] },
      objects: { a: { attrs: {}, title: [], body: [embed] } },
    });
    expect(joined.content?.[0]?.content?.[1]).toEqual(embed);
  });

  it("delivers the smallest enclosing structure of each mention", () => {
    expect(collectMentions(doc)).toEqual([
      { targetId: "proj", unit: { kind: "section", id: "h1" } },
      { targetId: "x", unit: { kind: "block", id: "p1" } },
      { targetId: "y", unit: { kind: "object", id: "t1" } },
      { targetId: "z", unit: { kind: "listItem", id: "li1" } },
    ]);
  });
});
