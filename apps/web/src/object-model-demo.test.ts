import { describe, expect, it } from "vitest";
import {
  filterDemoMemos,
  getVisibleDemoTasks,
  type DemoMemo,
  type DemoTask,
} from "./object-model-demo.js";

const memos: readonly DemoMemo[] = [
  {
    id: "new",
    body: "new",
    context: "Project",
    createdAt: "now",
    pinned: false,
    embedded: false,
  },
  {
    id: "pinned",
    body: "pinned",
    context: "Task",
    createdAt: "earlier",
    pinned: true,
    embedded: false,
  },
  {
    id: "third",
    body: "third",
    context: "Project",
    createdAt: "earlier",
    pinned: false,
    embedded: false,
  },
  {
    id: "old",
    body: "old",
    context: "Project",
    createdAt: "old",
    pinned: false,
    embedded: false,
  },
];

const tasks: readonly DemoTask[] = [
  {
    id: "root",
    title: "Root",
    status: "進行中",
    due: null,
    parentId: null,
    body: "",
  },
  {
    id: "child",
    title: "Child",
    status: "未着手",
    due: null,
    parentId: "root",
    body: "",
  },
  {
    id: "grandchild",
    title: "Grandchild",
    status: "未着手",
    due: null,
    parentId: "child",
    body: "",
  },
  {
    id: "second-root",
    title: "Second root",
    status: "保留",
    due: null,
    parentId: null,
    body: "",
  },
];

describe("object model demo", () => {
  it("keeps recent and pinned Memo views independent", () => {
    expect(filterDemoMemos(memos, "recent").map((memo) => memo.id)).toEqual([
      "new",
      "pinned",
      "third",
    ]);
    expect(filterDemoMemos(memos, "pinned").map((memo) => memo.id)).toEqual([
      "pinned",
    ]);
    expect(filterDemoMemos(memos, "all")).toHaveLength(4);
  });

  it("reveals recursive subtasks one expanded level at a time", () => {
    expect(
      getVisibleDemoTasks(tasks, "nested", new Set(["root"])).map(
        ({ task }) => task.id,
      ),
    ).toEqual(["root", "child", "second-root"]);
    expect(
      getVisibleDemoTasks(tasks, "nested", new Set(["root", "child"])).map(
        ({ task, depth }) => [task.id, depth],
      ),
    ).toEqual([
      ["root", 0],
      ["child", 1],
      ["grandchild", 2],
      ["second-root", 0],
    ]);
  });

  it("shows every descendant with its path in the flat view", () => {
    const visible = getVisibleDemoTasks(tasks, "flat", new Set());
    expect(visible).toHaveLength(4);
    expect(visible[2]?.path).toBe("Root › Child › Grandchild");
  });
});
