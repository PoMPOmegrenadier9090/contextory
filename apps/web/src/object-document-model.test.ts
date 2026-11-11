import { describe, expect, it } from "vitest";
import {
  assignContext,
  collectMentions,
  collectTimeline,
  convertBlockToObject,
  displayTitle,
  refToken,
  type DemoState,
  type DocObject,
} from "./object-document-model.js";

const object = (
  id: string,
  type: DocObject["type"],
  contexts: readonly string[],
  createdAt = 0,
): DocObject => ({
  id,
  type,
  title: id,
  status: type === "task" ? "未着手" : null,
  contexts,
  derivedFrom: null,
  createdAt,
  body: [],
});

const state: DemoState = {
  objects: {
    area: object("area", "area", []),
    project: object("project", "project", ["area"], 1),
    task: object("task", "task", ["project"], 2),
    sub: object("sub", "task", ["task"], 3),
    memo: {
      ...object("memo", "memo", ["project"], 4),
      body: [{ id: "m1", kind: "p", text: "メモ本文" }],
    },
  },
  daily: [
    { id: "d1", kind: "p", text: `${refToken("task")} を見直す` },
    { id: "d2", kind: "p", text: "未分類の段落" },
  ],
};

describe("object document model", () => {
  it("collects the timeline through transitive contexts", () => {
    const timeline = collectTimeline(state.objects, "area");
    expect(timeline.map((entry) => entry.object.id)).toEqual([
      "memo",
      "sub",
      "task",
      "project",
    ]);
    expect(timeline.find((e) => e.object.id === "sub")?.via).toEqual([
      "task",
      "project",
    ]);
  });

  it("keeps references separate from contexts", () => {
    expect(collectMentions(state, "task")).toMatchObject([
      { hostId: null, block: { id: "d1" }, via: [] },
    ]);
    // 配下のTaskへの言及は、経路付きでProjectにも集まる。
    expect(collectMentions(state, "project")).toMatchObject([
      { hostId: null, block: { id: "d1" }, via: ["task"] },
    ]);
    expect(
      collectTimeline(state.objects, "task").map((e) => e.object.id),
    ).toEqual(["sub"]);
  });

  it("inherits the memo context when converting a block inside a memo", () => {
    const next = convertBlockToObject(
      state,
      "memo",
      "m1",
      "task",
      "new",
      "b",
      5,
    );
    expect(next.objects.new).toMatchObject({
      title: "メモ本文",
      contexts: ["project"],
      derivedFrom: "memo",
    });
    expect(next.objects.memo?.body).toEqual([
      { id: "embed-new", kind: "embed", objectId: "new", collapsed: true },
    ]);
  });

  it("uses the host object itself as context inside a project", () => {
    const withBody: DemoState = {
      ...state,
      objects: {
        ...state.objects,
        project: {
          ...state.objects.project!,
          body: [{ id: "p1", kind: "p", text: "Taskにしたい" }],
        },
      },
    };
    const next = convertBlockToObject(
      withBody,
      "project",
      "p1",
      "task",
      "t",
      "b",
      5,
    );
    expect(next.objects.t?.contexts).toEqual(["project"]);
  });

  it("turns a daily paragraph into a memo before assigning context", () => {
    const next = assignContext(state, null, "d2", "project", "m", 5);
    expect(next.daily[1]).toMatchObject({ kind: "embed", objectId: "m" });
    expect(next.objects.m).toMatchObject({
      type: "memo",
      contexts: ["project"],
    });
    expect(displayTitle(next.objects.m, next.objects)).toBe("未分類の段落");
  });

  it("refuses contexts that would create a cycle", () => {
    const next = assignContext(state, "project", "x", "sub", "m", 5);
    expect(next).toBe(state);
  });
});
