import { describe, expect, it } from "vitest";
import { markdownTodos, toggleMarkdownTodo } from "./markdown-todos.js";

describe("Markdown Todos", () => {
  it("recognizes nested and completed items, ignoring code and ordinary text", () => {
    const body =
      "- [ ] first\n  - [X] nested\n\n```md\n- [ ] code\n```\n\ntext [ ]\n";
    const todos = markdownTodos(body);
    expect(todos.map((todo) => todo.checked)).toEqual([false, true]);
    expect(todos.map((todo) => body.slice(todo.from, todo.to))).toEqual([
      "[ ]",
      "[X]",
    ]);
    expect(markdownTodos("- [ ] ")).toHaveLength(1);
  });
  it("changes only the selected marker and can undo completion", () => {
    const body = "- [ ] first\n- [ ] second\n";
    const second = markdownTodos(body)[1]!;
    const checked = toggleMarkdownTodo(body, second.from, true);
    expect(checked).toBe("- [ ] first\n- [x] second\n");
    expect(toggleMarkdownTodo(checked, second.from, false)).toBe(body);
    expect(() => toggleMarkdownTodo(body, 0, true)).toThrow(
      "チェックリストが変更",
    );
  });
});
