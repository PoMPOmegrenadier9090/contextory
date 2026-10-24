import type Database from "better-sqlite3";

export interface SearchResult {
  readonly id: string;
  readonly content: string;
}

// Hex tokens let FTS index literal one/two-code-point substrings, including
// punctuation and emoji, without interpreting them as query syntax.
const shortToken = (points: readonly string[]): string =>
  `g${points.map((point) => point.codePointAt(0)!.toString(16)).join("x")}`;

export const shortTerms = (content: string): string => {
  const points = Array.from(content.toLowerCase());
  const terms = new Set<string>();
  for (let i = 0; i < points.length; i++) {
    terms.add(shortToken([points[i]!]));
    if (i + 1 < points.length)
      terms.add(shortToken([points[i]!, points[i + 1]!]));
  }
  return [...terms].join(" ");
};

export const searchMatch = (
  query: string,
  nameOnly = false,
): { table: string; phrase: string } => {
  const points = Array.from(query.toLowerCase());
  return points.length < 3
    ? {
        table: nameOnly ? "name_short_fts" : "search_short_fts",
        phrase: shortToken(points),
      }
    : {
        table: nameOnly ? "name_fts" : "search_fts",
        phrase: `"${query.replaceAll('"', '""')}"`,
      };
};

export const createSearchSchema = (database: Database.Database): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS search_documents (
      rowid INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      content, content='search_documents', content_rowid='rowid', tokenize='trigram'
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS search_short_fts USING fts5(
      terms, content='', contentless_delete=1
    );
    CREATE TRIGGER IF NOT EXISTS search_documents_insert AFTER INSERT ON search_documents BEGIN
      INSERT INTO search_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS search_documents_delete AFTER DELETE ON search_documents BEGIN
      INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      DELETE FROM search_short_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS search_documents_update AFTER UPDATE ON search_documents BEGIN
      INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO search_fts(rowid, content) VALUES (new.rowid, new.content);
      DELETE FROM search_short_fts WHERE rowid = old.rowid;
    END;
  `);
};

export const createSearchDocumentWriter = (database: Database.Database) => {
  const write =
    database.prepare(`INSERT INTO search_documents(id, content) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET content=excluded.content RETURNING rowid`);
  const insertShort = database.prepare(
    "INSERT INTO search_short_fts(rowid, terms) VALUES (?, ?)",
  );
  return (document: SearchResult): void => {
    const row = write.get(document.id, document.content) as { rowid: number };
    insertShort.run(row.rowid, shortTerms(document.content));
  };
};

export const upsertSearchDocument = (
  database: Database.Database,
  document: SearchResult,
): void => {
  database.transaction(createSearchDocumentWriter(database))(document);
};

export const searchDocuments = (
  database: Database.Database,
  rawQuery: string,
): readonly SearchResult[] => {
  const query = rawQuery.trim();
  if (query.length === 0) return [];
  const { table, phrase } = searchMatch(query);
  return database
    .prepare(
      `SELECT d.id, d.content FROM ${table} f
    JOIN search_documents d ON d.rowid = f.rowid
    WHERE ${table} MATCH ? ORDER BY f.rank, d.id`,
    )
    .all(phrase) as SearchResult[];
};

export const createNameSearchSchema = (database: Database.Database): void => {
  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS name_fts USING fts5(name_key, content='entities', content_rowid='rowid', tokenize='trigram');
    CREATE VIRTUAL TABLE IF NOT EXISTS name_short_fts USING fts5(terms, content='', contentless_delete=1);
    CREATE TRIGGER IF NOT EXISTS entities_name_insert AFTER INSERT ON entities BEGIN
      INSERT INTO name_fts(rowid,name_key) VALUES(new.rowid,new.name_key);
    END;
    CREATE TRIGGER IF NOT EXISTS entities_name_delete AFTER DELETE ON entities BEGIN
      INSERT INTO name_fts(name_fts,rowid,name_key) VALUES('delete',old.rowid,old.name_key);
      DELETE FROM name_short_fts WHERE rowid=old.rowid;
    END;
`);
};
