import type { PkmQuickOpenResult } from "@pkm/contracts";
import { searchMatch } from "./search.js";
import type { IndexDatabase } from "./index-database.js";

export const QUICK_OPEN_LIMIT = 30;

// Limit ranked candidates before extracting snippets or hydrating breadcrumbs.
// Both the search and hierarchy lookup run in one SQLite statement; neither the
// full Entity set nor complete matching bodies cross into JavaScript.
export const quickOpenIndexedEntities = (
  index: IndexDatabase,
  rawQuery: string,
): readonly PkmQuickOpenResult[] => {
  const query = rawQuery.trim();
  if (query.length === 0) return [];
  const normalized = query.normalize("NFKC").toLocaleLowerCase("ja");
  const codepoints = [...normalized];
  let prefixEnd = "";
  for (let i = codepoints.length - 1; i >= 0; i--) {
    const code = codepoints[i]!.codePointAt(0)!;
    if (code < 0x10ffff) {
      prefixEnd =
        codepoints.slice(0, i).join("") + String.fromCodePoint(code + 1);
      break;
    }
  }
  const results: PkmQuickOpenResult[] = [];
  for (let stage = 0; stage < 4 && results.length < QUICK_OPEN_LIMIT; stage++) {
    const nameMatch = searchMatch(normalized, true);
    const bodyMatch = searchMatch(query);
    const predicate =
      stage === 0
        ? "e.name_key=@normalized"
        : stage === 1
          ? "e.name_key >= @normalized AND (@prefixEnd = '' OR e.name_key < @prefixEnd)"
          : stage === 2
            ? `e.rowid IN (SELECT rowid FROM ${nameMatch.table} WHERE ${nameMatch.table} MATCH @phrase)`
            : `d.rowid IN (SELECT rowid FROM ${bodyMatch.table} WHERE ${bodyMatch.table} MATCH @phrase)`;
    const rows = index.database
      .prepare(
        `WITH hits AS MATERIALIZED (
      SELECT e.id,e.type,e.path,e.display_name AS displayName,e.updated_at AS updatedAt,d.rowid AS document_rowid
      FROM entities e JOIN search_documents d ON d.id=e.id WHERE e.deleted_at IS NULL AND (${predicate})
      AND e.id NOT IN (SELECT value FROM json_each(@excluded)) ORDER BY e.updated_at DESC,e.id LIMIT @limit
    ), snippets AS (
      SELECT hits.*,d.content,max(1,instr(lower(d.content),lower(@query))-45) AS snippet_start
      FROM hits JOIN search_documents d ON d.rowid=hits.document_rowid
    ) SELECT id,type,path,displayName,updatedAt,
      (CASE WHEN snippet_start>1 THEN '…' ELSE '' END)||substr(content,snippet_start,160)||(CASE WHEN length(content)>=snippet_start+160 THEN '…' ELSE '' END) AS snippet,
      COALESCE((SELECT group_concat(name,' / ') FROM (
        SELECT parent.display_name AS name FROM entity_scopes s JOIN entities parent ON parent.id=s.scope_id
        WHERE s.entity_id=snippets.id AND parent.deleted_at IS NULL
        ORDER BY CASE s.scope_type WHEN 'area' THEN 0 WHEN 'project' THEN 1 WHEN 'task' THEN 2 ELSE 3 END,parent.id
      )), '') AS breadcrumb FROM snippets ORDER BY updatedAt DESC,id`,
      )
      .all({
        normalized,
        prefixEnd,
        phrase: stage === 3 ? bodyMatch.phrase : nameMatch.phrase,
        excluded: JSON.stringify(results.map((r) => r.id)),
        limit: QUICK_OPEN_LIMIT - results.length,
        query,
      }) as PkmQuickOpenResult[];
    results.push(...rows);
  }
  const rows = results;
  return rows.map((row) => ({
    ...row,
    snippet: row.snippet.replace(/\s+/gu, " ").trim(),
  }));
};
