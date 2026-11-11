import { describe, expect, it } from "vitest";
import {
  collectMentionUnits,
  joinDocument,
  newId,
  splitDocument,
  timeFromId,
  type DocNode,
} from "./document-model.js";
import {
  addContext,
  collectTimeline,
  openDocument,
  saveDocument,
  type ObjectRecord,
  type Workspace,
} from "./workspace-model.js";

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
  type: string,
  title: string,
  ...body: DocNode[]
): DocNode => ({
  type: "objectBlock",
  attrs: { id: `b-${objectId}`, objectId, type, done: false, collapsed: true },
  content: [{ type: "objectTitle", content: [text(title)] }, ...body],
});
const record = (
  id: string,
  type: ObjectRecord["type"],
  contexts: readonly string[],
  createdAt: number,
  body: readonly DocNode[] = [],
): ObjectRecord => ({
  id,
  type,
  title: [text(id)],
  body,
  done: false,
  contexts,
  createdAt,
});

const workspace: Workspace = {
  objects: {
    area: record("area", "area", [], 1),
    project: record("project", "project", ["area"], 2),
    task: record("task", "task", ["project"], 3),
    other: record("other", "project", [], 4, [
      paragraph("o1", text("比較: "), ref("task")),
    ]),
    memo: record("memo", "memo", [], 5, [paragraph("m1", ref("project"))]),
  },
  daily: [
    paragraph("d1", ref("task"), text(" を進める")),
    paragraph("d2", text("関係ない段落")),
  ],
};

describe("document model", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      paragraph("p1", text("a")),
      block("t1", "task", "親", paragraph("p2"), block("t2", "task", "子")),
    ],
  };

  it("splits objects out of the document and joins them back", () => {
    const split = splitDocument(doc);
    expect(split.host.content?.[1]).toEqual({
      type: "objectEmbed",
      attrs: { id: "b-t1", objectId: "t1", collapsed: true },
    });
    expect(split.parents).toEqual({ t1: null, t2: "t1" });
    expect(split.objects.t1?.body[1]).toMatchObject({ type: "objectEmbed" });
    expect(joinDocument(split.host, split.objects)).toEqual(doc);
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

describe("workspace model", () => {
  it("creates objects from the document with inherited contexts", () => {
    const doc: DocNode = {
      type: "doc",
      content: [block("new", "task", "新規", block("child", "task", "子"))],
    };
    const saved = saveDocument(workspace, "project", doc, 10);
    expect(saved.objects.new).toMatchObject({
      contexts: ["project"],
      createdAt: 10,
    });
    expect(saved.objects.child?.contexts).toEqual(["new"]);
    expect(openDocument(saved, "project")).toMatchObject(doc);
  });

  it("inherits the memo contexts for objects created inside a memo", () => {
    const withContext = addContext(workspace, "memo", "project");
    const saved = saveDocument(
      withContext,
      "memo",
      { type: "doc", content: [block("new", "task", "新規")] },
      10,
    );
    expect(saved.objects.new?.contexts).toEqual(["project"]);
  });

  it("keeps contexts on later saves and deletes objects removed from the document", () => {
    const doc: DocNode = { type: "doc", content: [block("new", "task", "a")] };
    const first = addContext(
      saveDocument(workspace, null, doc, 10),
      "new",
      "project",
    );
    const second = saveDocument(first, null, doc, 20);
    expect(second.objects.new).toMatchObject({
      contexts: ["project"],
      createdAt: 10,
    });
    const removed = saveDocument(
      second,
      null,
      { type: "doc", content: [] },
      30,
    );
    expect(removed.objects.new).toBeUndefined();
    expect(removed.objects.task).toBeDefined();
  });

  it("collects contexts and mentions transitively into the timeline", () => {
    const timeline = collectTimeline(workspace, "project", 100).map((entry) =>
      entry.kind === "object"
        ? [entry.object.id, entry.mentioned, entry.via]
        : [entry.unit.node.attrs?.id, entry.hostId, entry.via],
    );
    expect(timeline).toEqual([
      ["d1", null, ["task"]],
      ["memo", true, []],
      ["o1", "other", ["task"]],
      ["task", false, []],
    ]);
  });

  it("refuses contexts that would create a cycle", () => {
    expect(addContext(workspace, "area", "task")).toBe(workspace);
  });
});
