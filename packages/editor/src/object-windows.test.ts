import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { removedWindows } from "./object-windows.js";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    objectBlock: {
      group: "block",
      content: "paragraph block*",
      attrs: { objectId: { default: "" } },
    },
  },
});
const { doc, paragraph, objectBlock } = schema.nodes;
const para = (value: string): PMNode =>
  paragraph.create(null, schema.text(value));
const object = (id: string, ...body: PMNode[]): PMNode =>
  objectBlock.create({ objectId: id }, [para(id), ...body]);

const start = (...blocks: PMNode[]): EditorState =>
  EditorState.create({ doc: doc.create(null, blocks) });
const at = (state: EditorState, id: string): [number, PMNode] => {
  let found: [number, PMNode] | null = null;
  state.doc.descendants((node, pos) => {
    if (!found && node.attrs.objectId === id) found = [pos, node];
  });
  return found!;
};

describe("removedWindows", () => {
  it("reports only the outermost removed window with the body that held it", () => {
    const state = start(
      para("前"),
      object("outer", object("inner")),
      object("host", object("child")),
    );
    const [outerPos, outer] = at(state, "outer");
    const [childPos, child] = at(state, "child");
    const tr = state.tr
      .delete(childPos, childPos + child.nodeSize)
      .delete(outerPos, outerPos + outer.nodeSize);
    expect(
      removedWindows(tr, "page").map(({ id, hostId, pos }) => ({
        id,
        hostId,
        pos,
      })),
    ).toEqual([
      // 子は外側のObjectの本文にあったので、そのObjectを持ち主にする。
      {
        id: "child",
        hostId: "host",
        pos: at(state, "child")[0] - outer.nodeSize,
      },
      { id: "outer", hostId: "page", pos: outerPos },
    ]);
  });

  it("ignores a window moved within the same transaction", () => {
    const state = start(object("moved"), para("後"));
    const [pos, node] = at(state, "moved");
    const tr = state.tr.delete(pos, pos + node.nodeSize);
    tr.insert(tr.doc.content.size, node);
    expect(removedWindows(tr, "page")).toEqual([]);
  });

  it("finds a window replaced by typing over a selection", () => {
    const state = start(para("前"), object("typed"), para("後"));
    const tr = state.tr.setSelection(
      TextSelection.create(state.doc, 2, state.doc.content.size - 2),
    );
    tr.insertText("x");
    expect(removedWindows(tr, "page").map((item) => item.id)).toEqual([
      "typed",
    ]);
  });
});
