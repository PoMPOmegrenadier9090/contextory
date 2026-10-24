import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
  createSearchSchema,
  searchDocuments,
  upsertSearchDocument,
} from "./search.js";

describe("SQLite Japanese search PoC", () => {
  it("loads the native module with FTS5 trigram support", () => {
    const database = new Database(":memory:");
    try {
      createSearchSchema(database);
      const table = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search_fts'",
        )
        .get();

      expect(table).toBeDefined();
    } finally {
      database.close();
    }
  });

  it("uses trigram for long Japanese queries and a substring fallback for short ones", () => {
    const database = new Database(":memory:");
    try {
      createSearchSchema(database);
      upsertSearchDocument(database, {
        id: "entry-a",
        content: "端末間の同期方式を整理する",
      });
      upsertSearchDocument(database, {
        id: "entry-b",
        content: "AI研究2026の計画を見直す",
      });

      expect(searchDocuments(database, "同期方式").map(({ id }) => id)).toEqual(
        ["entry-a"],
      );
      expect(searchDocuments(database, "同期").map(({ id }) => id)).toEqual([
        "entry-a",
      ]);
      expect(searchDocuments(database, "研究").map(({ id }) => id)).toEqual([
        "entry-b",
      ]);
      expect(searchDocuments(database, "研究2026").map(({ id }) => id)).toEqual(
        ["entry-b"],
      );
      expect(searchDocuments(database, "A").map(({ id }) => id)).toEqual([
        "entry-b",
      ]);
      expect(searchDocuments(database, "同期 OR 研究")).toEqual([]);
    } finally {
      database.close();
    }
  });
});

describe("indexed short literal search", () => {
  it("handles case, punctuation, emoji, replacement and deletion without stale postings", () => {
    const database = new Database(":memory:");
    try {
      createSearchSchema(database);
      upsertSearchDocument(database, {
        id: "a",
        content: '日本 😀 AI [x] 引用"文',
      });
      for (const q of ["日", "日本", "😀", "ai", "[x", '"文'])
        expect(searchDocuments(database, q).map((e) => e.id)).toEqual(["a"]);
      upsertSearchDocument(database, { id: "a", content: "別の文章" });
      expect(searchDocuments(database, "日本")).toEqual([]);
      expect(searchDocuments(database, "文章").map((e) => e.id)).toEqual(["a"]);
      database.prepare("DELETE FROM search_documents WHERE id=?").run("a");
      expect(searchDocuments(database, "文章")).toEqual([]);
      expect(searchDocuments(database, "別の文章")).toEqual([]);
    } finally {
      database.close();
    }
  });
});
