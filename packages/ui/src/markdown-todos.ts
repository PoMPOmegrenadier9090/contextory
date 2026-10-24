import { parser, TaskList } from "@lezer/markdown";

const todoParser = parser.configure([TaskList]);

export interface MarkdownTodo {
  readonly from: number;
  readonly to: number;
  readonly checked: boolean;
}

export const markdownTodos = (body: string): readonly MarkdownTodo[] => {
  const todos: MarkdownTodo[] = [];
  todoParser.parse(body).iterate({
    enter: (node) => {
      if (node.name !== "TaskMarker") return;
      todos.push({
        from: node.from,
        to: node.to,
        checked: body.slice(node.from, node.to).toLowerCase() === "[x]",
      });
    },
  });
  return todos;
};

export const toggleMarkdownTodo = (
  body: string,
  from: number,
  checked: boolean,
): string => {
  const todo = markdownTodos(body).find((item) => item.from === from);
  if (todo === undefined)
    throw new Error(
      "チェックリストが変更されています。一覧を更新してください。",
    );
  return `${body.slice(0, todo.from)}${checked ? "[x]" : "[ ]"}${body.slice(todo.to)}`;
};
