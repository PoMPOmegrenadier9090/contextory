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

  it("refuses a save made from an outdated page", () => {
    const opened = store.savePage(DAILY, doc(block("t", "task", "元")), 10);
    // 埋め込んだTaskを、そのTask自身のページから書き換える。
    const task = store.loadPage("t");
    store.savePage(
      "t",
      doc(paragraph("p", text("別の端末"))),
      11,
      task.revision,
    );

    expect(() =>
      store.savePage(
        DAILY,
        doc(block("t", "task", "古い")),
        12,
        opened.revision,
      ),
    ).toThrow(ObjectStoreError);
    expect(store.getObject("t").title).toBe("元");

    const latest = store.loadPage(DAILY);
    expect(latest.revision).not.toBe(opened.revision);
    store.savePage(DAILY, doc(block("t", "task", "新")), 13, latest.revision);
    // nullなら確かめずに上書きする。
    store.savePage(DAILY, doc(block("t", "task", "上書き")), 14, null);
    expect(store.getObject("t").title).toBe("上書き");
  });

  it("lists the day's memos with the document that holds them", () => {
    // Projectに置いたMemo、その中のMemo、Dailyに置いたMemo、どこにも置かないMemo
    store.savePage(
      "project",
      doc(block("a", "memo", "A", block("inner", "memo", "中"))),
      100,
    );
    store.savePage(DAILY, doc(block("d", "memo", "D")), 101);
    store.createObject(
      { id: "loose", type: "memo", title: "L", parentId: null },
      102,
    );
    store.createObject(
      { id: "t2", type: "task", title: "T", parentId: null },
      103,
    );

    expect(
      store
        .overview(100, 200)
        .memos.map((m) => [m.object.id, m.hostId, m.hostTitle]),
    ).toEqual([
      ["a", "project", "project"],
      ["d", DAILY, "Daily"],
      ["loose", null, ""],
    ]);
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
    expect(store.overview(0, 50).recent.map((o) => o.id)).not.toContain("x");
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
    // 種別の名前を変えても、Viewはそのまま使える。
    expect(
      store
        .queryView(renamed.views[0]!.id, null, "2026-11-12")
        .rows.map((row) => [row.object.id, row.values]),
    ).toEqual([["mtg", { place: [text("3F")] }]]);
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

  it("stores control fields, inherits fields and delivers field mentions", () => {
    store.savePage(DAILY, doc(block("mtg", "会議", "定例")), 10);
    store.updateType("会議", {
      fields: [
        { id: "when", name: "日付", kind: "date" },
        { id: "state", name: "状態", kind: "select", options: ["予定", "済"] },
      ],
    });
    store.savePage(DAILY, doc(block("sub", "1on1", "面談")), 11);
    store.updateType("1on1", {
      extends: "会議",
      fields: [{ id: "who", name: "相手", kind: "reference" }],
    });
    expect(store.types().find((type) => type.name === "1on1")).toMatchObject({
      extends: "会議",
      fields: [{ id: "context" }, { id: "who" }],
      inherited: [{ id: "when" }, { id: "state", options: ["予定", "済"] }],
    });
    expect(() => store.updateType("会議", { extends: "1on1" })).toThrow(
      TypeError,
    );

    const control = (fieldId: string, value: string): DocNode => ({
      type: "objectFieldControl",
      attrs: { fieldId, value },
    });
    store.savePage(
      DAILY,
      doc(
        block("mtg", "会議", "定例"),
        block(
          "sub",
          "1on1",
          "面談",
          field("who", ref("task")),
          control("when", "2026-11-20"),
          control("state", "予定"),
        ),
      ),
      12,
    );
    const rows = store
      .loadPage(DAILY)
      .doc.content?.[1]?.content?.map((node) => [node.type, node.attrs]);
    expect(rows?.slice(1)).toMatchObject([
      ["objectField", { fieldId: "context" }],
      ["objectField", { fieldId: "who" }],
      ["objectFieldControl", { fieldId: "when", value: "2026-11-20" }],
      [
        "objectFieldControl",
        { fieldId: "state", value: "予定", options: ["予定", "済"] },
      ],
    ]);
    // Fieldの値で指したObjectのTimelineに、Fieldの名前付きで届く。
    const fieldMentions = (): unknown[] =>
      store
        .timeline("task")
        .filter((entry) => entry.kind === "object" && entry.field);
    expect(fieldMentions()).toMatchObject([
      { object: { id: "sub" }, mentioned: true, field: "相手" },
    ]);
    store.updateType("1on1", { fields: [] });
    expect(fieldMentions()).toEqual([]);
  });

  it("gives each type a table and each object page a timeline by default", () => {
    const { views } = store.types().find((type) => type.name === "project")!;
    expect(views).toMatchObject([
      { scope: "type", layout: "table" },
      { scope: "object", layout: "timeline", reach: "all" },
    ]);
    expect(
      store
        .queryView(views[0]!.id, null, "2026-11-12")
        .rows.map((row) => row.object.id),
    ).toEqual(["other", "project"]);
    // ObjectのページのTimelineは、これまでのTimelineと同じ内容になる。
    expect(
      store.queryView(views[1]!.id, "project", "2026-11-12").entries,
    ).toEqual(store.timeline("project"));
    expect(() => store.queryView(views[1]!.id, null, "2026-11-12")).toThrow(
      ObjectStoreError,
    );
  });

  it("queries a table by reach, type, done and fields, and nests on request", () => {
    store.updateType("task", {
      fields: [
        {
          id: "state",
          name: "状態",
          kind: "select",
          options: ["未着手", "進行中"],
        },
        { id: "due", name: "期限", kind: "date" },
      ],
    });
    store.savePage(
      "task",
      doc(block("sub", "task", "子"), block("note", "memo", "メモ")),
      10,
    );
    store.createObject(
      { id: "t2", type: "task", title: "二つ目", parentId: "project" },
      11,
    );
    store.patchObject(
      "sub",
      { fields: { state: [text("進行中")], due: [text("2026-11-10")] } },
      12,
    );
    store.patchObject(
      "t2",
      { done: true, fields: { due: [text("2026-11-14")] } },
      13,
    );
    const base = {
      scope: "object",
      name: "Task",
      type: "task",
      sort: "created",
      desc: false,
    };
    const ids = (view: object): unknown[] => {
      store.updateType("project", {
        views: [{ id: "v", ...base, ...view }] as never,
      });
      return store
        .queryView("v", "project", "2026-11-12")
        .rows.map((row) => [row.object.id, row.depth]);
    };
    expect(ids({ reach: "direct" })).toEqual([
      ["task", 0],
      ["t2", 0],
    ]);
    // 配下のすべてでも、種別の違うMemoは出ない。
    expect(ids({ reach: "all" })).toEqual([
      ["task", 0],
      ["sub", 0],
      ["t2", 0],
    ]);
    expect(
      ids({ reach: "all", type: null }).map((row) => (row as unknown[])[0]),
    ).toContain("note");
    expect(ids({ nested: true })).toEqual([
      ["task", 0],
      ["sub", 1],
      ["t2", 0],
    ]);
    expect(ids({ reach: "all", done: "open" })).toEqual([
      ["task", 0],
      ["sub", 0],
    ]);
    expect(
      ids({ reach: "all", filters: [{ fieldId: "state", value: "進行中" }] }),
    ).toEqual([["sub", 0]]);
    expect(
      ids({ reach: "all", filters: [{ fieldId: "due", value: "past" }] }),
    ).toEqual([["sub", 0]]);
    expect(
      ids({ reach: "all", filters: [{ fieldId: "due", value: "week" }] }),
    ).toEqual([["t2", 0]]);
    expect(ids({ reach: "all", sort: "due", desc: true })).toEqual([
      ["t2", 0],
      ["sub", 0],
      ["task", 0],
    ]);
    // Contextも表から書き換えられる。循環になる相手は取り込まない。
    store.patchObject(
      "t2",
      { fields: { context: [ref("task"), ref("t2")] } },
      14,
    );
    expect(store.getObject("t2").contexts).toEqual(["task"]);
  });

  it("refuses contexts that would create a cycle and unknown hosts", () => {
    expect(() => store.addContext("area", "task")).toThrow("cycle");
    expect(() => store.loadPage("missing")).toThrow(ObjectStoreError);
  });
});
