import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  normalizeObjectType,
  parseView,
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

  it("round-trips and exports a Daily document without a date", () => {
    const doc: DocNode = {
      type: "doc",
      content: [paragraph("p", text("Undated body"))],
    };
    store.savePage("daily:undated", doc, 1);
    expect(store.loadPage("daily:undated").doc).toEqual(doc);
    expect(store.exportMarkdown()).toContainEqual({
      path: "daily/undated.md",
      text: "# 日付なし\n\nUndated body\n",
    });
  });

  it("preserves embedded View references in a document", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        { type: "viewEmbed", attrs: { viewId: "table-view", anchorId: null } },
      ],
    };
    store.savePage("daily:2026-11-12", doc, 1);
    expect(store.loadPage("daily:2026-11-12").doc).toEqual(doc);
    expect(
      store.exportMarkdown().find((file) => file.path === "daily/2026-11-12.md")
        ?.text,
    ).toContain("<!-- Contextory View -->");
  });

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

  it("keeps contexts on later saves and marks objects cut from where they were written", () => {
    const tree = doc(block("new", "task", "a", block("child", "task", "b")));
    store.savePage(DAILY, tree, 10);
    store.addContext("new", "project");
    const again = store.savePage(DAILY, tree, 20);
    expect(again.objects.new).toMatchObject({
      contexts: ["project"],
      createdAt: 10,
      origin: DAILY,
    });
    expect(again.objects.child?.origin).toBe("new");
    store.savePage(DAILY, doc(), 30);
    // 外れてもゴミ箱へは送らず、置き場所をなくした印だけ付ける。
    // 子は書いた場所（newの本文）に残っているので、印は付かない。
    expect(store.trash()).toEqual([]);
    const [lost, ...rest] = store.overview(0).homeless;
    expect(rest).toEqual([]);
    expect(lost).toMatchObject({
      object: { id: "new" },
      originId: DAILY,
      originTitle: "Daily",
    });
    // 元の場所へ貼り直すと、印が外れる。作成日時とContextも残る。
    store.savePage(DAILY, tree, 40);
    expect(store.overview(0).homeless).toEqual([]);
    expect(store.getObject("new")).toMatchObject({
      contexts: ["project"],
      createdAt: 10,
      origin: DAILY,
    });
    expect(store.getObject("child").title).toBe("b");
  });

  it("makes the page an object is pasted into its new origin", () => {
    store.savePage(DAILY, doc(block("cut", "task", "切り取り")), 10);
    store.savePage(DAILY, doc(), 11);
    store.savePage("project", doc(block("cut", "task", "切り取り")), 12);
    expect(store.getObject("cut").origin).toBe("project");
    expect(store.overview(0).homeless).toEqual([]);
    // 新しい書いた場所から外れれば、また印が付く。元のDailyの保存では付かない。
    store.savePage(DAILY, doc(paragraph("p", text("別の段落"))), 13);
    expect(store.overview(0).homeless).toEqual([]);
    store.savePage("project", doc(), 14);
    expect(store.overview(0).homeless.map((h) => h.originId)).toEqual([
      "project",
    ]);
  });

  it("follows a written window moved within one page without marking it", () => {
    store.savePage(
      DAILY,
      doc(block("outer", "task", "外", block("inner", "task", "中"))),
      10,
    );
    store.savePage(
      DAILY,
      doc(block("outer", "task", "外"), block("inner", "task", "中")),
      11,
    );
    expect(store.getObject("inner").origin).toBe(DAILY);
    expect(store.overview(0).homeless).toEqual([]);
  });

  it("does not mark other windows or objects made without a written place", () => {
    store.createObject(
      { id: "fromView", type: "task", title: "表から", parentId: null },
      10,
    );
    expect(store.getObject("fromView").origin).toBeNull();
    store.savePage(DAILY, doc(block("written", "task", "書いた")), 11);
    const both = doc(
      block("fromView", "task", "表から"),
      block("written", "task", "書いた"),
    );
    store.savePage("project", both, 12);
    // 窓を足しても、書いた場所は変わらない。
    expect(store.getObject("written").origin).toBe(DAILY);
    store.savePage("project", doc(), 13);
    expect(store.overview(0).homeless).toEqual([]);
    expect(store.trash()).toEqual([]);
  });

  it("keeps or restores an object without a place", () => {
    store.savePage(DAILY, doc(block("lost", "task", "なくした")), 10);
    store.savePage(DAILY, doc(), 11);
    store.patchObject("lost", { origin: null }, 12);
    expect(store.getObject("lost").origin).toBeNull();
    expect(store.overview(0).homeless).toEqual([]);

    store.savePage(DAILY, doc(block("binned", "task", "捨てた")), 13);
    store.trashObject("binned", 14);
    // ゴミ箱から戻すと、書いた場所の窓も戻る。
    store.restoreObject("binned");
    expect(store.overview(0).homeless).toEqual([]);
    expect(body(store.loadPage(DAILY).doc).content?.[0]?.attrs?.objectId).toBe(
      "binned",
    );
  });

  it("opens an object page with its title for embedding elsewhere", () => {
    store.savePage(
      DAILY,
      doc(block("t", "task", "題", paragraph("p", text("本文")))),
      10,
    );
    const page = store.loadPage("t");
    expect(page.title).toEqual([text("題")]);
    expect(store.loadPage(DAILY).title).toBeUndefined();
  });

  it("keeps an object moved from the Daily to a project in either save order", () => {
    store.savePage(DAILY, doc(block("moved", "memo", "メモ")), 10);
    store.addContext("moved", "area");
    // 切り取った側の保存が先に走っても、Objectは残る。
    store.savePage(DAILY, doc(), 11);
    const page = store.savePage(
      "project",
      doc(block("moved", "memo", "メモ")),
      12,
    );
    expect(page.objects.moved).toMatchObject({
      contexts: ["area"],
      createdAt: 10,
    });
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

  it("lists objects without a parent in the inbox", () => {
    const make = (id: string, type: string, parentId: string | null) =>
      store.createObject({ id, type, title: id, parentId }, 60);
    make("ia", "area", null);
    make("ip", "project", null);
    make("it", "task", "ip");
    make("im", "memo", null);
    make("person", "person", null);
    make("gone", "project", null);
    make("orphan", "task", "gone");
    store.trashObject("gone", 61);
    const inbox = store.overview(0).inbox.map((o) => o.id);
    expect(inbox).toEqual(expect.arrayContaining(["ip", "im", "orphan"]));
    for (const id of ["ia", "it", "person", "gone"])
      expect(inbox).not.toContain(id);
  });

  it("searches type names, titles and full Object and Daily text", () => {
    const token = "照合１００％";
    const body = paragraph(
      "nested",
      text("続き".repeat(180)),
      text(token),
      text(" 値を保存"),
    );
    store.savePage(
      "daily:undated",
      doc(
        paragraph("daily-text", text("Dailyだけの照合100%")),
        block("search-object", "会議", "検索対象", {
          type: "bulletList",
          content: [{ type: "listItem", content: [body] }],
        }),
      ),
      60,
    );
    expect(store.searchWorkspace("#会議")).toEqual([
      { kind: "type", id: "会議" },
    ]);
    expect(store.searchWorkspace("検索対象")).toMatchObject([
      { kind: "object", id: "search-object", title: "検索対象" },
    ]);
    expect(store.searchWorkspace("検索対象 値を保存")[0]).toMatchObject({
      id: "search-object",
    });
    const hits = store.searchWorkspace("照合100%");
    expect(hits).toHaveLength(2);
    const object = hits.find(
      (hit) => hit.kind === "object" && hit.id === "search-object",
    );
    expect(object?.kind === "object" ? object.excerpt : undefined).toContain(
      token,
    );
    expect(hits).toContainEqual(
      expect.objectContaining({
        kind: "daily",
        id: "daily:undated",
        title: "日付なしのDaily",
      }),
    );
    store.trashObject("search-object", 61);
    expect(store.searchWorkspace("照合100%").map((hit) => hit.id)).toEqual([
      "daily:undated",
    ]);
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
      { type: "objectField", attrs: { fieldId: "related", name: "参照" } },
      {
        type: "objectBlock",
        content: [
          { type: "objectTitle" },
          { type: "objectField", content: [ref("area"), text(" ")] },
          { type: "objectField", attrs: { fieldId: "related" } },
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
    expect(store.loadPage("new").doc.content?.[2]).toEqual({
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
      // 具象はContextを持たない。
      fields: [{ id: "related" }, { id: "place" }],
    });
    // 種別の名前を変えても、Viewはそのまま使える。
    expect(
      store
        .queryView(renamed.views[0]!.id, null, "2026-11-12")
        .rows.map((row) => [row.object.id, row.titleEditable, row.values]),
    ).toEqual([["mtg", true, { place: [text("3F")] }]]);
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

  it("moves a placed object to the trash, hides it and restores it", () => {
    store.savePage(
      "project",
      doc(block("t1", "task", "片付ける", block("inner", "task", "中"))),
      10,
    );
    store.savePage(DAILY, doc(paragraph("p", ref("t1"))), 11);
    store.trashObject("t1", 20);
    // 置かれていた文書の本文から外れる。中のObjectは生きている。
    expect(body(store.loadPage("project").doc).content).toEqual([]);
    expect(store.getObject("inner").title).toBe("中");
    expect(() => store.getObject("t1")).toThrow(ObjectStoreError);
    expect(store.search("片付", null).map((o) => o.id)).toEqual([]);
    expect(store.loadPage(DAILY).objects.t1).toBeUndefined();
    expect(
      store.timeline("project").map((e) => e.kind === "object" && e.object.id),
    ).not.toContain("t1");
    expect(store.trash().map((o) => o.id)).toEqual(["t1"]);
    expect(() => store.purgeObject("task")).toThrow(ObjectStoreError);

    expect(store.restoreObject("t1")).toMatchObject({
      contexts: ["project"],
      createdAt: 10,
    });
    expect(store.trash()).toEqual([]);
    // 戻したObjectの本文には、中のObjectが置かれたまま。
    expect(body(store.loadPage("t1").doc).content?.[0]).toMatchObject({
      type: "objectBlock",
      attrs: { objectId: "inner" },
    });
  });

  it("restores a trashed object placed again by a save and purges the trash", () => {
    store.savePage(DAILY, doc(block("t1", "task", "a")), 10);
    store.addContext("t1", "area");
    store.trashObject("t1", 11);
    // 古い画面の内容で上書きすると、ゴミ箱から戻る。Contextはそのまま。
    store.savePage(DAILY, doc(block("t1", "task", "a")), 12);
    expect(store.getObject("t1").contexts).toEqual(["area"]);

    store.trashObject("t1", 13);
    store.trashObject("other", 14);
    store.purgeObject("t1");
    expect(store.trash().map((o) => o.id)).toEqual(["other"]);
    store.emptyTrash();
    expect(store.trash()).toEqual([]);
    expect(() => store.restoreObject("other")).toThrow(ObjectStoreError);
  });

  it("deletes a user-defined type only when nothing uses it", () => {
    store.savePage(
      DAILY,
      doc(block("mtg", "会議", "定例"), block("one", "1on1", "面談")),
      10,
    );
    store.updateType("会議", {
      fields: [{ id: "place", name: "場所", kind: "text" }],
    });
    store.updateType("1on1", { extends: "会議" });
    const [taskView] = store.types().find((t) => t.name === "task")!.views;
    store.updateType("task", {
      views: [{ ...taskView!, nestTypes: ["task", "会議"] }],
    });
    expect(() => store.deleteType("task")).toThrow(TypeError);
    expect(() => store.deleteType("会議")).toThrow("1件");
    store.trashObject("mtg", 11);
    // ゴミ箱の分も数える。
    expect(() => store.deleteType("会議")).toThrow("1件");
    store.purgeObject("mtg");
    expect(() => store.deleteType("会議")).toThrow("#1on1");
    store.updateType("1on1", { extends: null });
    store.deleteType("会議");
    expect(store.types().map((t) => t.name)).not.toContain("会議");
    expect(
      store.types().find((t) => t.name === "task")!.views[0]!.nestTypes,
    ).toEqual(["task"]);
    expect(() => store.deleteType("会議")).toThrow(ObjectStoreError);
  });

  it("stores control fields, inherits fields and delivers field mentions", () => {
    store.savePage(
      DAILY,
      doc(block("mtg", "会議", "定例"), block("one", "1on1", "面談")),
      10,
    );
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
      fields: [{ id: "related" }, { id: "who" }],
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
      ["objectField", { fieldId: "related" }],
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
      {
        scope: "object",
        name: "Task",
        layout: "table",
        type: "task",
        reach: "all",
        done: "open",
      },
      {
        scope: "object",
        name: "Memo",
        layout: "timeline",
        type: "memo",
        reach: "all",
      },
    ]);
    expect(
      store
        .queryView(views[0]!.id, null, "2026-11-12")
        .rows.map((row) => row.object.id),
    ).toEqual(["other", "project"]);
    // ObjectのページのTimelineは、これまでのTimelineに本文の先頭を足したものになる。
    const entries = store.queryView(
      views[1]!.id,
      "project",
      "2026-11-12",
    ).entries;
    expect(entries).toMatchObject(store.timeline("project"));
    expect(
      entries.find((e) => e.kind === "object" && e.object.id === "memo"),
    ).toMatchObject({ excerpt: "project" });
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
      ids({
        reach: "all",
        filters: [{ fieldId: "state", values: ["進行中", "未着手"] }],
      }),
    ).toEqual([["sub", 0]]);
    expect(
      ids({ reach: "all", filters: [{ fieldId: "due", values: ["past"] }] }),
    ).toEqual([["sub", 0]]);
    expect(
      ids({ reach: "all", filters: [{ fieldId: "due", values: ["week"] }] }),
    ).toEqual([["t2", 0]]);
    expect(
      ids({ reach: "all", filters: [{ fieldId: "due", presence: "unset" }] }),
    ).toEqual([["task", 0]]);
    // 入れ子に出す種別は選べる。別の種別には、Fieldの条件を掛けない。
    expect(
      ids({
        nested: true,
        nestTypes: ["memo"],
        filters: [{ fieldId: "due", presence: "unset" }],
      }),
    ).toEqual([
      ["task", 0],
      ["note", 1],
    ]);
    expect(ids({ reach: "all", sort: "due", desc: true })).toEqual([
      ["t2", 0],
      ["sub", 0],
      ["task", 0],
    ]);
    // 同じ値の行は、二つ目の並べ替えで並べる。
    expect(ids({ reach: "all", sort: "state" })).toEqual([
      ["t2", 0],
      ["task", 0],
      ["sub", 0],
    ]);
    expect(
      ids({ reach: "all", sort: "state", thenBy: [{ by: "due" }] }),
    ).toEqual([
      ["task", 0],
      ["t2", 0],
      ["sub", 0],
    ]);
    // Contextも表から書き換えられる。循環になる相手は取り込まない。
    store.patchObject(
      "t2",
      { fields: { context: [ref("task"), ref("t2")] } },
      14,
    );
    expect(store.getObject("t2").contexts).toEqual(["task"]);
  });

  it("exports the Daily and objects as Markdown with front matter", () => {
    store.updateType("task", {
      fields: [{ id: "due", name: "期限", kind: "text" }],
    });
    store.savePage(
      "project",
      doc(block("t1", "task", "やる/こと", field("due", text("明日")))),
      10,
    );
    store.trashObject("memo", 11);
    const files = store.exportMarkdown();
    const byPath = new Map(files.map((file) => [file.path, file.text]));
    expect([...byPath.keys()]).not.toContain("objects/memo/memo-memo.md");
    expect(byPath.get("objects/task/やる_こと-t1.md")).toBe(
      [
        "---",
        'id: "t1"',
        'type: "task"',
        `created: ${new Date(10).toISOString()}`,
        "done: false",
        'contexts: ["project"]',
        '"期限": "明日"',
        "---",
        "",
        "# やる/こと",
        "",
      ].join("\n"),
    );
    expect(byPath.get("objects/project/project-project.md")).toContain(
      "- [ ] [やる/こと](../../objects/task/%E3%82%84%E3%82%8B_%E3%81%93%E3%81%A8-t1.md)",
    );
    expect(byPath.get("daily/2026-11-12.md")).toBe(
      "# 2026-11-12\n\n[task](../objects/task/task-task.md) を進める\n\n関係ない段落\n",
    );
  });

  it("changes an object's type and drops fields the new type lacks", () => {
    store.updateType("task", {
      fields: [{ id: "due", name: "期限", kind: "text" }],
    });
    store.patchObject("task", { fields: { due: [text("明日")] } }, 10);
    expect(store.patchObject("task", { type: "decision" }, 11)).toMatchObject({
      type: "decision",
      contexts: ["project"],
    });
    store.patchObject("task", { type: "task" }, 12);
    expect(
      store
        .loadPage("task")
        .doc.content?.find((node) => node.attrs?.fieldId === "due")?.content,
    ).toBeUndefined();
  });

  it("keeps the shared UI state", () => {
    store.setUiState("view:task:type", "v1");
    store.setUiState("fold:v1", ["a"]);
    store.setUiState("view:task:type", "v2");
    expect(store.uiState()).toEqual({
      "view:task:type": "v2",
      "fold:v1": ["a"],
    });
  });

  it("refuses contexts that would create a cycle and unknown hosts", () => {
    expect(() => store.addContext("area", "task")).toThrow("cycle");
    expect(() => store.loadPage("missing")).toThrow(ObjectStoreError);
  });

  /** 参照の行が指すObject。 */
  const related = (id: string): string[] =>
    store
      .loadPage(id)
      .doc.content?.find((node) => node.attrs?.fieldId === "related")
      ?.content?.flatMap((node) =>
        node.type === "objectRef" ? [String(node.attrs?.objectId)] : [],
      ) ?? [];

  it("keeps one parent per object and moves the rest to the references", () => {
    store.savePage(
      DAILY,
      doc(
        block("person", "Person", "田中さん", field("context", ref("project"))),
        block(
          "memoB",
          "memo",
          "B",
          field("context", ref("person"), ref("project")),
        ),
      ),
      10,
    );
    // 具象はContextを持たない。Contextは常に活動を指す。
    expect(store.getObject("person").contexts).toEqual([]);
    expect(related("person")).toEqual(["project"]);
    expect(store.getObject("memoB").contexts).toEqual(["project"]);
    expect(related("memoB")).toEqual(["person"]);

    expect(() => store.addContext("task", "person")).toThrow("not allowed");
    expect(() => store.addContext("area", "project")).toThrow(ObjectStoreError);
    // Area→Project→Taskの順を守れば、Area直下のTaskも置ける。
    store.addContext("task", "area");
    expect(store.getObject("task").contexts).toEqual(["area"]);
    // Projectの中で作った具象は、所属なしになる。
    expect(
      store.savePage("project", doc(block("co", "Company", "A社")), 11).objects
        .co?.contexts,
    ).toEqual([]);
    // 具象の中で作ったものは、所属なしで、その具象を参照に残す。
    store.savePage("person", doc(block("note", "memo", "人のメモ")), 12);
    expect(store.getObject("note").contexts).toEqual([]);
    expect(related("note")).toEqual(["person"]);
    store.createObject(
      { id: "todo", type: "task", title: "お礼", parentId: "person" },
      12,
    );
    expect(related("todo")).toEqual(["person"]);
    // 種別が変わって親になれなくなったら、所属を参照へ移す。
    store.patchObject("task", { type: "area" }, 13);
    expect(store.getObject("task").contexts).toEqual([]);
    expect(related("task")).toEqual(["area"]);
  });

  it("does not aggregate memos through a shared entity", () => {
    store.importWorkspace(
      {
        objects: [
          record("areaA", "area", [], 1),
          record("areaB", "area", [], 2),
          record("projectB", "project", ["areaB"], 3),
          record("person", "Person", ["areaA", "projectB"], 4),
          record("memoB", "memo", ["person"], 5),
        ],
        documents: {},
      },
      10,
    );
    const ids = (id: string): string[] =>
      store
        .timeline(id)
        .flatMap((entry) => (entry.kind === "object" ? [entry.object.id] : []));
    // Personは参照で両方の活動に現れるが、配下のMemoは流れ込まない。
    expect(ids("areaA")).toEqual(["person"]);
    expect(ids("areaB")).toEqual(["person", "projectB"]);
    expect(ids("person")).toContain("memoB");
  });

  it("uses an explicit creation context and keeps an entity parent as a reference", () => {
    store.createObject(
      { id: "person", type: "Person", title: "人", parentId: null },
      10,
    );
    const make = (id: string, parentId: string, contextId?: string | null) =>
      store.createObject(
        {
          id,
          type: "memo",
          title: id,
          parentId,
          ...(contextId === undefined ? {} : { contextId }),
        },
        11,
      );
    expect(make("explicit", "person", "task").contexts).toEqual(["task"]);
    expect(related("explicit")).toEqual(["person"]);
    expect(store.timeline("person")).toContainEqual(
      expect.objectContaining({
        kind: "object",
        object: store.getObject("explicit"),
      }),
    );
    expect(make("override", "project", "other").contexts).toEqual(["other"]);
    expect(make("invalid", "project", "person").contexts).toEqual([]);
    expect(make("missing", "project", "missing").contexts).toEqual([]);
    expect(make("inherited", "project", null).contexts).toEqual(["project"]);
    expect(make("unspecified", "project").contexts).toEqual(["project"]);
    expect(
      store.createObject(
        {
          id: "entity",
          type: "Person",
          title: "具象",
          parentId: null,
          contextId: "project",
        },
        12,
      ).contexts,
    ).toEqual([]);
  });

  it("keeps objects confirmed without activity out of the inbox until assigned", () => {
    const inbox = () => store.overview(0).inbox.map((object) => object.id);
    expect(store.getObject("memo").noActivity).toBe(false);
    expect(store.patchObject("memo", { noActivity: true }, 10).noActivity).toBe(
      true,
    );
    expect(inbox()).not.toContain("memo");
    store.patchObject("memo", { title: "残す" }, 11);
    expect(store.getObject("memo").noActivity).toBe(true);
    store.patchObject("memo", { noActivity: false }, 12);
    expect(inbox()).toContain("memo");
    store.patchObject(
      "memo",
      { noActivity: true, fields: { context: [ref("project")] } },
      13,
    );
    expect(store.getObject("memo").noActivity).toBe(false);
    store.removeContext("memo", "project");
    store.patchObject("memo", { noActivity: true }, 14);
    store.addContext("memo", "project");
    expect(store.getObject("memo").noActivity).toBe(false);
    store.removeContext("memo", "project");
    store.patchObject("memo", { noActivity: true }, 15);
    store.savePage("memo", doc(field("context", ref("task"))), 16);
    expect(store.getObject("memo").noActivity).toBe(false);
  });

  it("loads the entire context chain for breadcrumbs", () => {
    store.createObject(
      { id: "sub", type: "task", title: "子", parentId: "task" },
      10,
    );
    store.createObject(
      { id: "note", type: "memo", title: "メモ", parentId: "sub" },
      11,
    );
    const page = store.loadPage("note");
    expect(Object.keys(page.objects).sort()).toEqual([
      "area",
      "note",
      "project",
      "sub",
      "task",
    ]);
    expect(page.objects.area?.title).toBe("area");
  });

  it("returns timeline activities and their titles for both layouts of entry", () => {
    const view = store.types().find((type) => type.name === "project")!
      .views[1]!;
    const result = store.queryView(view.id, "project", "2026-11-12");
    expect(result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "object",
          object: store.getObject("task"),
          activity: "project",
        }),
        expect.objectContaining({
          kind: "object",
          object: store.getObject("memo"),
          activity: null,
        }),
        expect.objectContaining({
          kind: "unit",
          hostId: "other",
          activity: "other",
        }),
        expect.objectContaining({
          kind: "unit",
          hostId: DAILY,
          activity: null,
        }),
      ]),
    );
    expect(result.objects.project?.title).toBe("project");
    expect(result.objects.other?.title).toBe("other");
    store.createObject(
      { id: "person", type: "Person", title: "人", parentId: null },
      10,
    );
    store.savePage(
      "task",
      doc(
        block(
          "decision",
          "decision",
          "判断",
          paragraph("mention", ref("person")),
        ),
      ),
      11,
    );
    expect(store.timeline("person")).toContainEqual(
      expect.objectContaining({
        kind: "unit",
        hostId: "decision",
        activity: "task",
      }),
    );
    const typeView = store.types().find((type) => type.name === "task")!
      .views[0]!;
    store.updateType("task", { views: [{ ...typeView, layout: "timeline" }] });
    const typed = store.queryView(typeView.id, null, "2026-11-12");
    expect(typed.entries[0]).toMatchObject({ activity: "project" });
    expect(typed.objects.project?.title).toBe("project");
  });

  it.each(["table", "timeline"] as const)(
    "collects referenced entities in an activity's %s view",
    (layout) => {
      store.savePage(
        DAILY,
        doc(
          ...["a", "b", "c", "outside", "gone", "fromTrash"].map((id) =>
            block(id, "Company", id),
          ),
        ),
        10,
      );
      store.updateType("project", {
        fields: [{ id: "company", name: "企業", kind: "reference" }],
      });
      store.patchObject(
        "project",
        { fields: { company: [ref("a")], related: [ref("b")] } },
        11,
      );
      store.savePage(
        "task",
        doc(paragraph("mention", ref("c"), ref("c"), ref("gone"))),
        12,
      );
      store.savePage("other", doc(paragraph("outside", ref("outside"))), 13);
      store.savePage(
        "project",
        doc(
          block(
            "trashedSource",
            "memo",
            "メモ",
            paragraph("ref", ref("fromTrash")),
          ),
        ),
        14,
      );
      store.trashObject("trashedSource", 15);
      store.trashObject("gone", 16);
      const view = parseView({
        id: "companies",
        scope: "object",
        name: "企業",
        layout,
        type: "Company",
        reach: "direct",
      });
      store.updateType("project", { views: [view] });
      const result = store.queryView(view.id, "project", "2026-11-12");
      const ids =
        layout === "table"
          ? result.rows.map((row) => row.object.id)
          : result.entries.flatMap((entry) =>
              entry.kind === "object" ? [entry.object.id] : [],
            );
      expect(ids.sort()).toEqual(["a", "b", "c"]);
      for (const id of ids) expect(store.getObject(id).contexts).toEqual([]);
      store.updateType("project", {
        views: [
          {
            ...view,
            filters: [{ fieldId: "related", presence: "set", values: [] }],
          },
        ],
      });
      const filtered = store.queryView(view.id, "project", "2026-11-12");
      expect(filtered.rows).toEqual([]);
      expect(filtered.entries).toEqual([]);
    },
  );

  it("adds Task and Memo views to every built-in activity type", () => {
    for (const name of ["area", "project", "task"]) {
      const views = store.types().find((type) => type.name === name)!.views;
      expect(views.map((view) => view.name)).toEqual([
        "すべて",
        "Timeline",
        "Task",
        "Memo",
      ]);
      expect(views[2]).toMatchObject({
        scope: "object",
        layout: "table",
        type: "task",
        reach: "all",
        done: "open",
      });
      expect(views[3]).toMatchObject({
        scope: "object",
        layout: "timeline",
        type: "memo",
        reach: "all",
      });
    }
    expect(
      store.types().find((type) => type.name === "memo")!.views,
    ).toHaveLength(2);
    const views = store.types().find((type) => type.name === "project")!.views;
    expect(
      store
        .queryView(views[2]!.id, "project", "2026-11-12")
        .rows.map((row) => row.object.id),
    ).toEqual(["task"]);
    store.patchObject("task", { done: true }, 10);
    expect(store.queryView(views[2]!.id, "project", "2026-11-12").rows).toEqual(
      [],
    );
  });

  it("revalidates contexts and references for a changed type and its derived types", () => {
    store.createObject(
      { id: "work", type: "Work", title: "活動", parentId: null },
      10,
    );
    store.createObject(
      { id: "derived", type: "Derived", title: "継承", parentId: null },
      11,
    );
    store.updateType("Work", { extends: "project" });
    store.updateType("Derived", { extends: "Work" });
    store.addContext("work", "area");
    store.addContext("derived", "project");
    store.createObject(
      { id: "child", type: "memo", title: "子", parentId: "work" },
      12,
    );
    store.createObject(
      {
        id: "trashed",
        type: "Derived",
        title: "削除済み",
        parentId: "project",
      },
      13,
    );
    store.trashObject("trashed", 14);
    store.updateType("Work", { extends: null });
    for (const id of ["work", "derived", "child"])
      expect(store.getObject(id).contexts).toEqual([]);
    expect(related("work")).toEqual(["area"]);
    expect(related("derived")).toEqual(["project"]);
    expect(related("child")).toEqual(["work"]);
    expect(
      store.trash().find((object) => object.id === "trashed")?.contexts,
    ).toEqual([]);
    expect(store.timeline("project")).toContainEqual(
      expect.objectContaining({
        kind: "object",
        object: store.getObject("derived"),
      }),
    );
  });

  it("restores all windows with their attributes and sibling/container positions", () => {
    const first = block("lost", "memo", "メモ");
    const second = {
      ...first,
      attrs: { ...first.attrs, id: "second", collapsed: false },
    };
    const tree = doc(
      paragraph("before", text("前")),
      {
        type: "bulletList",
        attrs: { id: "list" },
        content: [
          {
            type: "listItem",
            attrs: { id: "item" },
            content: [
              paragraph("lead", text("項目")),
              first,
              paragraph("tail", text("後")),
            ],
          },
        ],
      },
      second,
      paragraph("after", text("末尾")),
    );
    store.savePage(DAILY, tree, 10);
    const expected = store.loadPage(DAILY).doc;
    store.savePage("project", doc(first), 11);
    const project = store.loadPage("project").doc;
    store.trashObject("lost", 12);
    expect(store.loadPage(DAILY).objects.lost).toBeUndefined();
    store.restoreObject("lost");
    expect(store.loadPage(DAILY).doc).toEqual(expected);
    expect(store.loadPage("project").doc).toEqual(project);
    expect(store.overview(0).homeless).toEqual([]);
  });

  it("restores other hosts once when a save undoes trashing a window", () => {
    const tree = doc(block("lost", "memo", "メモ"));
    store.savePage(DAILY, tree, 10);
    store.savePage("project", tree, 11);
    store.trashObject("lost", 12);
    store.savePage("project", tree, 13);
    for (const host of [DAILY, "project"])
      expect(body(store.loadPage(host).doc).content).toHaveLength(1);
    expect(store.getObject("lost").origin).toBe(DAILY);
    expect(store.overview(0).homeless).toEqual([]);
    store.savePage(DAILY, doc(), 14);
    store.trashObject("lost", 15);
    store.restoreObject("lost");
    expect(body(store.loadPage(DAILY).doc).content).toEqual([]);
    expect(store.overview(0).homeless.map((entry) => entry.object.id)).toEqual([
      "lost",
    ]);
  });

  it("restores every window even when block ids are absent", () => {
    const window: DocNode = {
      type: "objectEmbed",
      attrs: { objectId: "memo", collapsed: true },
    };
    store.savePage(DAILY, doc(window, window), 10);
    const before = store.loadPage(DAILY).doc;
    store.trashObject("memo", 11);
    store.restoreObject("memo");
    expect(store.loadPage(DAILY).doc).toEqual(before);
  });

  it("appends windows when their recorded sibling or container is gone", () => {
    const tree = doc(
      paragraph("before", text("前")),
      block("lost", "memo", "メモ"),
    );
    store.savePage(DAILY, tree, 10);
    store.savePage(
      "project",
      doc({
        type: "blockquote",
        attrs: { id: "container" },
        content: [block("lost", "memo", "メモ")],
      }),
      11,
    );
    store.trashObject("lost", 12);
    for (const host of [DAILY, "project"])
      store.savePage(host, doc(paragraph("replacement", text("残す"))), 13);
    store.restoreObject("lost");
    for (const host of [DAILY, "project"])
      expect(
        body(store.loadPage(host).doc).content?.map((node) => node.type),
      ).toEqual(["paragraph", "objectBlock"]);
  });

  it("restores a trashed object placed as an unexpanded window", () => {
    const tree = doc(block("lost", "memo", "メモ"));
    store.savePage(DAILY, tree, 10);
    store.savePage("project", tree, 11);
    store.trashObject("lost", 12);
    const page = store.savePage(
      DAILY,
      doc({
        type: "objectEmbed",
        attrs: { id: "b-lost", objectId: "lost", collapsed: true },
      }),
      13,
    );
    expect(page.objects.lost?.title).toBe("メモ");
    expect(body(page.doc).content).toHaveLength(1);
    expect(body(store.loadPage("project").doc).content).toHaveLength(1);
    expect(store.overview(0).homeless).toEqual([]);
  });

  it("skips trashed or purged hosts and clears records on purge", () => {
    const tree = doc(block("lost", "memo", "メモ"));
    store.savePage("project", tree, 10);
    store.savePage("other", tree, 11);
    store.trashObject("lost", 12);
    store.trashObject("project", 13);
    store.trashObject("other", 14);
    store.purgeObject("other");
    store.restoreObject("lost");
    expect(store.overview(0).homeless.map((entry) => entry.object.id)).toEqual([
      "lost",
    ]);
    store.restoreObject("project");
    expect(body(store.loadPage("project").doc).content).toEqual([]);
    store.savePage(DAILY, tree, 15);
    store.trashObject("lost", 16);
    store.purgeObject("lost");
    store.createObject(
      { id: "lost", type: "memo", title: "別のメモ", parentId: null },
      17,
    );
    store.trashObject("lost", 18);
    store.restoreObject("lost");
    expect(body(store.loadPage(DAILY).doc).content).toEqual([]);
  });

  it("migrates multiple contexts to one parent and references", () => {
    const dir = mkdtempSync(join(tmpdir(), "pkm-store-"));
    try {
      const path = join(dir, "objects.sqlite");
      const old = new ObjectStore(path);
      old.importWorkspace(
        {
          objects: [
            record("area", "area", [], 1),
            record("project", "project", ["area"], 2),
            record("person", "Person", [], 3),
            record("memo", "memo", [], 4),
            record("note", "memo", [], 5),
          ],
          documents: {},
        },
        10,
      );
      old.close();
      // v7までは、Contextを複数持てた。
      const raw = new Database(path);
      raw.exec(`
        INSERT INTO contexts VALUES ('person', 'area', 0), ('person', 'project', 1),
          ('memo', 'person', 0), ('memo', 'project', 1), ('note', 'person', 0);
        ALTER TABLE objects DROP COLUMN origin;
        ALTER TABLE objects DROP COLUMN homeless;
        ALTER TABLE objects DROP COLUMN no_activity;
        DROP TABLE removed_windows;
        PRAGMA user_version = 7;
      `);
      raw.close();
      const migrated = new ObjectStore(path);
      expect(migrated.getObject("person").contexts).toEqual([]);
      expect(migrated.getObject("memo").contexts).toEqual(["project"]);
      // 具象を所属にしていたものは所属なしになり、Inboxで振り分け直す。
      expect(migrated.getObject("note").contexts).toEqual([]);
      expect(migrated.overview(0).inbox.map((o) => o.id)).toContain("note");
      // 外れたContextは参照に残り、参照先のTimelineに届く。
      expect(
        migrated
          .timeline("area")
          .some(
            (entry) => entry.kind === "object" && entry.object.id === "person",
          ),
      ).toBe(true);
      migrated.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes the origin of existing objects from where they are placed", () => {
    const dir = mkdtempSync(join(tmpdir(), "pkm-store-"));
    try {
      const path = join(dir, "objects.sqlite");
      const old = new ObjectStore(path);
      old.savePage(DAILY, doc(block("placed", "task", "置いた")), 10);
      old.createObject(
        { id: "loose", type: "task", title: "どこにもない", parentId: null },
        11,
      );
      old.close();
      const raw = new Database(path);
      raw.exec(`
        ALTER TABLE objects DROP COLUMN origin;
        ALTER TABLE objects DROP COLUMN homeless;
        ALTER TABLE objects DROP COLUMN no_activity;
        DROP TABLE removed_windows;
        PRAGMA user_version = 9;
      `);
      raw.close();
      const migrated = new ObjectStore(path);
      expect(migrated.getObject("placed").origin).toBe(DAILY);
      expect(migrated.getObject("loose").origin).toBeNull();
      migrated.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates v10 views without duplicating custom filters and persists v11 state", () => {
    const dir = mkdtempSync(join(tmpdir(), "pkm-store-"));
    try {
      const path = join(dir, "objects.sqlite");
      const old = new ObjectStore(path);
      old.createObject(
        { id: "note", type: "memo", title: "残す", parentId: null },
        10,
      );
      for (const name of ["area", "project", "task"]) {
        const views = old
          .types()
          .find((type) => type.name === name)!
          .views.slice(0, 2);
        if (name === "project")
          views.push(
            parseView({
              id: "custom-task",
              scope: "object",
              name: "独自Task",
              type: "task",
              done: "done",
            }),
          );
        if (name === "task")
          views.push(
            parseView({
              id: "custom-memo",
              scope: "object",
              name: "独自Memo",
              type: "memo",
              layout: "table",
            }),
          );
        old.updateType(name, { views });
      }
      old.close();
      const raw = new Database(path);
      raw.exec(
        "ALTER TABLE objects DROP COLUMN no_activity; DROP TABLE removed_windows; PRAGMA user_version = 10;",
      );
      raw.close();
      const migrated = new ObjectStore(path);
      expect(migrated.getObject("note").noActivity).toBe(false);
      for (const name of ["area", "project", "task"]) {
        const views = migrated
          .types()
          .find((type) => type.name === name)!.views;
        expect(views).toHaveLength(4);
        for (const type of ["task", "memo"])
          expect(
            views.filter(
              (view) => view.scope === "object" && view.type === type,
            ),
          ).toHaveLength(1);
      }
      expect(
        migrated.types().find((type) => type.name === "project")!.views[2],
      ).toMatchObject({ id: "custom-task", done: "done" });
      expect(
        migrated.types().find((type) => type.name === "task")!.views[2],
      ).toMatchObject({ id: "custom-memo", layout: "table" });
      migrated.patchObject("note", { noActivity: true }, 11);
      migrated.savePage(DAILY, doc(block("placed", "task", "戻す")), 12);
      migrated.trashObject("placed", 13);
      migrated.close();
      const reopened = new ObjectStore(path);
      expect(reopened.getObject("note").noActivity).toBe(true);
      expect(reopened.overview(0).inbox).toEqual([]);
      reopened.restoreObject("placed");
      expect(
        body(reopened.loadPage(DAILY).doc).content?.[0]?.attrs?.objectId,
      ).toBe("placed");
      expect(reopened.overview(0).homeless).toEqual([]);
      expect(
        reopened.types().find((type) => type.name === "area")!.views,
      ).toHaveLength(4);
      reopened.close();
      const verified = new Database(path);
      expect(verified.pragma("user_version", { simple: true })).toBe(11);
      expect(
        verified.prepare("SELECT count(*) FROM removed_windows").pluck().get(),
      ).toBe(0);
      verified.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
