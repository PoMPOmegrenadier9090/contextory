import { describe, expect, it } from "vitest";
import { extractMarkdownTodos } from "./markdown-todos.js";
import { parseTodoQuery, parseToggleTodoRequest } from "./todo-contract.js";

describe("Todo extraction", () => {
  it("extracts ordered, nested, quoted and repeated items without indexing code", () => {
    const body =
      "😀 メモ\r\n\r\n- [ ] 親 **項目**\r\n  - [x] 子 [リンク](https://example.com)\r\n\r\n1. [ ] 同じ\r\n2. [X] 同じ\r\n\r\n> - [ ] 引用\r\n\r\n```md\r\n- [ ] code\r\n```\r\n\r\n`- [ ] inline`\r\n";
    const todos = extractMarkdownTodos(body);
    expect(todos.map((todo) => todo.text)).toEqual([
      "親 項目",
      "子 リンク",
      "同じ",
      "同じ",
      "引用",
    ]);
    expect(todos.map((todo) => todo.depth)).toEqual([0, 1, 0, 0, 0]);
    expect(todos.map((todo) => body.slice(todo.from, todo.to))).toEqual([
      "[ ]",
      "[x]",
      "[ ]",
      "[X]",
      "[ ]",
    ]);
    expect(todos.map((todo) => todo.checked)).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
  });
  it("keeps continuation text on its own item and skips escaped markers", () => {
    expect(
      extractMarkdownTodos(
        "- [ ] first\n  continuation\n\n- \\[ ] escaped",
      ).map((todo) => todo.text),
    ).toEqual(["first\ncontinuation"]);
  });
});

describe("Todo boundary validation", () => {
  it("accepts bounded HTTP query numbers and requires a complete scope", () => {
    expect(
      parseTodoQuery({ limit: "50", cursor: "next", state: "all" }),
    ).toEqual({
      limit: 50,
      cursor: "next",
      state: "all",
    });
    for (const query of [
      { limit: 0 },
      { limit: 101 },
      { offset: -1 },
      { state: "invalid" },
      { scopeType: "area" },
      { limit: true },
      { other: "x" },
    ])
      expect(() => parseTodoQuery(query)).toThrow(TypeError);
  });
  it("requires a real boolean, position and snapshot hash", () => {
    const request = {
      entryId: "ent-example",
      checked: true,
      markerFrom: 2,
      expectedFileHash: `sha256:${"a".repeat(64)}`,
    };
    expect(parseToggleTodoRequest(request)).toEqual(request);
    for (const patch of [
      { checked: "false" },
      { markerFrom: -1 },
      { markerFrom: 0.5 },
      { expectedFileHash: "wrong" },
    ])
      expect(() => parseToggleTodoRequest({ ...request, ...patch })).toThrow(
        TypeError,
      );
  });
});
