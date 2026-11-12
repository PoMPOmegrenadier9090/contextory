import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  normalizeObjectType,
  type DocNode,
  type ObjectRecord,
} from "@pkm/core";
import { ObjectStore, ObjectStoreError } from "./object-store.js";

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
const doc = (...content: DocNode[]): DocNode => ({ type: "doc", content });
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

const field = (fieldId: string, ...content: DocNode[]): DocNode => ({
  type: "objectField",
  attrs: { fieldId, name: fieldId },
  content,
});
/** Field行を除いた文書木。 */
const body = (node: DocNode): DocNode => ({
  ...node,
  ...(node.content
    ? {
        content: node.content
          .filter((child) => child.type !== "objectField")
          .map(body),
      }
    : {}),
});

const DAILY = "daily:2026-11-12";

describe("ObjectStore", () => {
  let store: ObjectStore;
  beforeEach(() => {
    store = new ObjectStore(":memory:");
    store.importWorkspace(
      {
        objects: [
          record("area", "area", [], 1),
          record("project", "project", ["area"], 2),
          record("task", "task", ["project"], 3),
          record("other", "project", [], 4, [
            paragraph("o1", text("比較: "), ref("task")),
          ]),
          record("memo", "memo", [], 5, [paragraph("m1", ref("project"))]),
        ],
        documents: {
          [DAILY]: [
            paragraph("d1", ref("task"), text(" を進める")),
            paragraph("d2", text("関係ない段落")),
          ],
        },
      },
      100,
    );
  });
  afterEach(() => store.close());

  it("creates objects from the document with inherited contexts", () => {
    const tree = doc(
      block("new", "task", "新規", block("child", "task", "子")),
    );
    const page = store.savePage("project", tree, 10);
    expect(page.objects.new).toMatchObject({
      title: "新規",
      contexts: ["project"],
      createdAt: 10,
    });
    expect(page.objects.child?.contexts).toEqual(["new"]);
    expect(body(store.loadPage("project").doc)).toMatchObject(tree);
    // 埋め込んだObject自身の画面では、その本文が文書になる。
    expect(body(store.loadPage("new").doc).content?.[0]).toMatchObject({
      type: "objectBlock",
      attrs: { objectId: "child" },
    });
  });

  it("inherits the memo contexts for objects created inside a memo", () => {
    store.addContext("memo", "project");
    const page = store.savePage("memo", doc(block("new", "task", "新規")), 10);
    expect(page.objects.new?.contexts).toEqual(["project"]);
  });

  it("keeps contexts on later saves and deletes objects removed from the document", () => {
    const tree = doc(block("new", "task", "a", block("child", "task", "b")));
    store.savePage(DAILY, tree, 10);
    store.addContext("new", "project");
    const again = store.savePage(DAILY, tree, 20);
    expect(again.objects.new).toMatchObject({
      contexts: ["project"],
      createdAt: 10,
    });
    store.savePage(DAILY, doc(), 30);
    expect(() => store.getObject("new")).toThrow(ObjectStoreError);
    expect(() => store.getObject("child")).toThrow(ObjectStoreError);
    expect(store.getObject("task").id).toBe("task");
  });

  it("keeps an object that is still placed in another document", () => {
    const tree = doc(block("shared", "task", "共有"));
    store.savePage(DAILY, tree, 10);
    store.savePage("other", tree, 11);
    store.savePage(DAILY, doc(), 12);
    expect(store.getObject("shared").title).toBe("共有");
  });

  it("collects contexts and mentions transitively into the timeline", () => {
    const timeline = store
      .timeline("project")
      .map((entry) =>
        entry.kind === "object"
          ? [entry.object.id, entry.mentioned, entry.via]
          : [entry.unitId, entry.hostTitle, entry.text, entry.via],
      );
    expect(timeline).toEqual([
      ["d1", "Daily", "task を進める", ["task"]],
      ["memo", true, []],
      ["o1", "other", "比較: task", ["task"]],
      ["task", false, []],
    ]);
    expect(store.timeline("area").map((entry) => entry.via)).toContainEqual([
      "task",
      "project",
    ]);
  });

  it("creates, patches and searches objects", () => {
    const created = store.createObject(
      { id: "x", type: "task", title: "検索対象", parentId: "task" },
      50,
    );
    expect(created.contexts).toEqual(["task"]);
    expect(store.patchObject("x", { done: true }, 51).done).toBe(true);
    expect(store.search("検索", null).map((o) => o.id)).toEqual(["x"]);
    expect(store.search("", "x").map((o) => o.id)).not.toContain("memo");
    expect(store.overview(50).recent.map((o) => o.id)).toEqual(["x"]);
  });

  it("keeps user-defined types and lists them", () => {
    expect(normalizeObjectType(" Task ")).toBe("task");
    expect(normalizeObjectType("会議")).toBe("会議");
    expect(normalizeObjectType("a b")).toBeNull();
    expect(normalizeObjectType("")).toBeNull();
    const page = store.savePage(DAILY, doc(block("mtg", "会議", "定例")), 10);
    expect(page.objects.mtg?.type).toBe("会議");
    expect(store.types().map((type) => type.name)).toEqual([
      "area",
      "project",
      "task",
      "decision",
      "memo",
      "会議",
    ]);
  });

  it("stores field values and treats the context row as the contexts", () => {
    store.updateType("task", {
      fields: [{ id: "due", name: "期限", kind: "text" }],
    });
    const tree = doc(
      block(
        "new",
        "task",
        "新規",
        field("context", ref("area"), ref("new"), ref("missing")),
        field("due", text("来週")),
        field("unknown", text("x")),
      ),
    );
    store.savePage("project", tree, 10);
    // 行があれば置き場所からは継がず、自分自身や存在しない相手は取り込まない。
    expect(store.getObject("new").contexts).toEqual(["area"]);
    expect(store.loadPage("project").doc.content).toMatchObject([
      { type: "objectField", attrs: { fieldId: "context", name: "Context" } },
      {
        type: "objectBlock",
        content: [
          { type: "objectTitle" },
          { type: "objectField", content: [ref("area"), text(" ")] },
          {
            type: "objectField",
            attrs: { fieldId: "due", name: "期限" },
            content: [text("来週")],
          },
        ],
      },
    ]);
    // Object自身の画面では、文書の先頭の行がそのObjectのFieldになる。
    store.savePage(
      "new",
      doc(field("context", ref("project")), field("due")),
      11,
    );
    expect(store.getObject("new").contexts).toEqual(["project"]);
    expect(store.loadPage("new").doc.content?.[1]).toEqual({
      type: "objectField",
      attrs: { fieldId: "due", name: "期限" },
    });
  });

  it("renames and recolors user-defined types and drops removed fields", () => {
    store.savePage(DAILY, doc(block("mtg", "会議", "定例")), 10);
    const fields = [{ id: "place", name: "場所", kind: "text" as const }];
    expect(store.types().filter((type) => type.checkbox)).toMatchObject([
      { name: "task" },
    ]);
    store.updateType("会議", { fields, color: "rose", checkbox: true });
    store.savePage(
      DAILY,
      doc(block("mtg", "会議", "定例", field("place", text("3F")))),
      11,
    );
    const renamed = store.updateType("会議", { name: "meeting" });
    expect(renamed).toMatchObject({
      name: "meeting",
      color: "rose",
      builtin: false,
      checkbox: true,
      fields: [{ id: "context" }, { id: "place" }],
    });
    expect(store.objectsOfType("meeting").map((o) => o.id)).toEqual(["mtg"]);
    store.updateType("meeting", { fields: [] });
    expect(
      store.loadPage(DAILY).doc.content?.[0]?.content?.map((n) => n.type),
    ).toEqual(["objectTitle", "objectField"]);
    expect(() => store.updateType("task", { name: "todo" })).toThrow(TypeError);
    expect(() => store.updateType("meeting", { name: "task" })).toThrow(
      TypeError,
    );
    expect(() => store.updateType("nope", {})).toThrow(ObjectStoreError);
  });

  it("refuses contexts that would create a cycle and unknown hosts", () => {
    expect(() => store.addContext("area", "task")).toThrow("cycle");
    expect(() => store.loadPage("missing")).toThrow(ObjectStoreError);
  });
});
