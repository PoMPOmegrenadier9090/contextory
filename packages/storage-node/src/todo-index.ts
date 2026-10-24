import type {
  IndexedTodo,
  TodoPage,
  TodoQuery,
  MarkdownTodoItem,
} from "@pkm/core";
import {
  extractMarkdownTodos,
  parseTodoQuery,
  type ParsedMarkdownEntity,
} from "@pkm/core";
import type { IndexDatabase } from "./index-database.js";
import { hashFileContent } from "./vault-file.js";

export const indexEntryTodos = (
  index: IndexDatabase,
  parsed: ParsedMarkdownEntity,
  todos: readonly MarkdownTodoItem[] = extractMarkdownTodos(parsed.body),
): void => {
  if (parsed.entity.type !== "entry") return;
  const insert = index.database.prepare(
    `INSERT INTO entry_todos (entity_id, marker_from, marker_to, text, checked, depth, source_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const sourceHash = hashFileContent(parsed.source);
  for (const todo of todos)
    insert.run(
      parsed.entity.id,
      todo.from,
      todo.to,
      todo.text,
      todo.checked ? 1 : 0,
      todo.depth,
      sourceHash,
    );
};

export const listIndexedTodos = (
  index: IndexDatabase,
  input: TodoQuery = {},
): TodoPage => {
  const query = parseTodoQuery(input);
  const state = query.state ?? "unchecked";
  const limit = query.limit ?? 50;

  const parameters: Array<string | number> = [];
  const where = ["e.type = 'entry'", "e.deleted_at IS NULL"];
  if (state !== "all") {
    where.push("t.checked = ?");
    parameters.push(state === "checked" ? 1 : 0);
  }
  if (query.scopeType !== undefined && query.scopeId !== undefined) {
    where.push(
      "EXISTS (SELECT 1 FROM entity_scopes s WHERE s.entity_id = e.id AND s.scope_type = ? AND s.scope_id = ?)",
    );
    parameters.push(query.scopeType, query.scopeId);
  }
  const queryKey = JSON.stringify([
    state,
    query.scopeType ?? null,
    query.scopeId ?? null,
  ]);
  if (query.cursor) {
    let cursor: { key: string; createdAt: string; id: string; marker: number };
    try {
      const value: unknown = JSON.parse(query.cursor);
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error();
      cursor = value as typeof cursor;
      if (
        cursor.key !== queryKey ||
        typeof cursor.createdAt !== "string" ||
        typeof cursor.id !== "string" ||
        !Number.isSafeInteger(cursor.marker) ||
        cursor.marker < 0
      )
        throw new Error();
    } catch {
      throw new TypeError("Invalid Todo cursor");
    }
    where.push(
      "(e.created_at < ? OR (e.created_at = ? AND e.id < ?) OR (e.created_at = ? AND e.id = ? AND t.marker_from > ?))",
    );
    parameters.push(
      cursor.createdAt,
      cursor.createdAt,
      cursor.id,
      cursor.createdAt,
      cursor.id,
      cursor.marker,
    );
  }
  const from = `FROM entry_todos t JOIN entities e ON e.id = t.entity_id WHERE ${where.join(" AND ")}`;
  const rows = index.database
    .prepare(
      `SELECT t.entity_id AS entryId, e.display_name AS entryTitle, e.created_at AS createdAt, t.marker_from AS markerFrom, t.marker_to AS markerTo, t.text, t.checked, t.depth, t.source_hash AS fileHash ${from} ORDER BY e.created_at DESC, e.id DESC, t.marker_from ASC LIMIT ?`,
    )
    .all(...parameters, limit + 1) as Array<
    Omit<IndexedTodo, "checked"> & { readonly checked: number }
  >;
  return {
    items: rows
      .slice(0, limit)
      .map((row) => ({ ...row, checked: row.checked === 1 })),
    nextCursor:
      rows.length > limit
        ? JSON.stringify({
            key: queryKey,
            createdAt: rows[limit - 1]!.createdAt,
            id: rows[limit - 1]!.entryId,
            marker: rows[limit - 1]!.markerFrom,
          })
        : null,
  };
};
