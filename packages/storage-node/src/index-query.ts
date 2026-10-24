import {
  resolveRelatedEntities,
  relatedEntityReason,
} from "./related-entities.js";
import { createHash } from "node:crypto";
import {
  ENTITY_TYPES,
  STATUS_ORDER,
  PRIORITY_ORDER,
  type ResourceType,
  type BacklinkPageQuery,
  type BacklinkPage,
  type BacklinkGroup,
  type EntityPageQuery,
  type EntityPage,
  type EntityCounts,
  type CalendarCount,
} from "@pkm/contracts";
import {
  parseEntityPageQuery,
  todayJournalDate,
  requireJournalDate,
} from "@pkm/core";
import type { PkmFileHash } from "@pkm/contracts";
import type {
  PkmEntitySummary as IndexedEntity,
  PkmBacklink as IndexedReference,
  PkmSearchResult as IndexedSearchResult,
  PkmSyncthingConflictSummary as IndexedConflict,
} from "@pkm/contracts";
export type {
  PkmEntitySummary as IndexedEntity,
  PkmBacklink as IndexedReference,
  PkmSearchResult as IndexedSearchResult,
  PkmSyncthingConflictSummary as IndexedConflict,
} from "@pkm/contracts";
import type { EntityType } from "@pkm/core";

import type {
  EntityScopeRelation,
  EntityScopeType,
  IndexedEntityScope,
} from "./entity-scope.js";
import type { IndexDatabase } from "./index-database.js";
import { searchMatch } from "./search.js";
import { entryRelationCte } from "./entry-relation-query.js";

export interface EntityQueryOptions {
  readonly includeBody?: boolean;
  readonly includeDeleted?: boolean;
  readonly onlyDeleted?: boolean;
  readonly forAi?: boolean;
}

interface EntityRow {
  readonly id: string;
  readonly type: string;
  readonly path: string;
  readonly display_name: string | null;
  readonly description: string | null;
  readonly authors: string;
  readonly related_entity_ids: string;
  readonly origin: string | null;
  readonly status: string | null;
  readonly priority: string | null;
  readonly project_id: string | null;
  readonly area_id: string | null;
  readonly task_id: string | null;
  readonly resource_id: string | null;
  readonly resource_type: ResourceType | null;
  readonly canonical_identifier: string | null;
  readonly source_uri: string | null;
  readonly asset_path: string | null;
  readonly journal_date: string | null;
  readonly occurred_at: string | null;
  readonly due_at: string | null;
  readonly topic_ids: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
  readonly exclude_from_ai: number;
  readonly body: string;
  readonly file_hash?: PkmFileHash;
  readonly body_truncated?: number;
}

interface ReferenceRow {
  readonly source_id: string;
  readonly source_type: EntityType;
  readonly source_display_name: string | null;
  readonly target_id: string;
  readonly target_type: EntityType | null;
  readonly reference_kind: string;
  readonly label: string | null;
  readonly field_path: string | null;
  readonly start_offset: number | null;
  readonly end_offset: number | null;
}

interface ConflictRow {
  readonly path: string;
  readonly canonical_entity_path: string;
  readonly canonical_entity_id: string | null;
  readonly canonical_display_name: string | null;
  readonly hash: PkmFileHash;
  readonly mtime_ms: number;
  readonly size: number;
}

interface EntityScopeRow {
  readonly entity_id: string;
  readonly scope_type: EntityScopeType;
  readonly scope_id: string;
  readonly relation: EntityScopeRelation;
  readonly via_entity_id: string | null;
}

const fromEntityRow = (row: EntityRow): IndexedEntity => ({
  id: row.id,
  type: row.type,
  path: row.path,
  displayName: row.display_name,
  description: row.description,
  ...(row.type === "resource"
    ? {
        resourceType: row.resource_type,
        authors: JSON.parse(row.authors) as string[],
        relatedEntityIds: JSON.parse(row.related_entity_ids) as string[],
      }
    : {}),
  origin: row.origin,
  status: row.status,
  priority: row.priority,
  projectId: row.project_id,
  areaId: row.area_id,
  taskId: row.task_id,
  resourceId: row.resource_id,
  canonicalIdentifier: row.canonical_identifier,
  sourceUri: row.source_uri,
  assetPath: row.asset_path,
  journalDate: row.journal_date,
  occurredAt: row.occurred_at,
  dueAt: row.due_at,
  topicIds: JSON.parse(row.topic_ids) as readonly string[],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  deletedAt: row.deleted_at,
  excludeFromAi: row.exclude_from_ai !== 0,
  body: row.body,
  ...(row.file_hash ? { fileHash: row.file_hash } : {}),
  ...(row.body_truncated ? { bodyTruncated: true } : {}),
});

const fromConflictRow = (row: ConflictRow): IndexedConflict => ({
  path: row.path,
  canonicalEntityPath: row.canonical_entity_path,
  canonicalEntityId: row.canonical_entity_id,
  canonicalDisplayName: row.canonical_display_name,
  hash: row.hash,
  mtimeMs: row.mtime_ms,
  size: row.size,
});

const entitySummaryColumns = (alias: string): string =>
  "id,type,path,display_name,description,authors,related_entity_ids,origin,status,priority,project_id,area_id,task_id,resource_id,resource_type,canonical_identifier,source_uri,asset_path,journal_date,occurred_at,due_at,created_at,updated_at,deleted_at,exclude_from_ai"
    .split(",")
    .map((column) => `${alias}.${column}`)
    .join(",");

const visibilityClause = (
  options: EntityQueryOptions,
  defaultIncludeDeleted: boolean,
  qualifier = "",
): string => {
  const filters: string[] = [];
  if (options.onlyDeleted === true && options.forAi !== true) {
    filters.push(`${qualifier}deleted_at IS NOT NULL`);
  } else if (options.forAi === true) {
    filters.push(
      `${qualifier}deleted_at IS NULL`,
      `${qualifier}exclude_from_ai = 0`,
    );
  } else if (!(options.includeDeleted ?? defaultIncludeDeleted)) {
    filters.push(`${qualifier}deleted_at IS NULL`);
  }
  return filters.length === 0 ? "" : ` AND ${filters.join(" AND ")}`;
};

export const getIndexedEntity = (
  index: IndexDatabase,
  entityId: string,
  options: EntityQueryOptions = {},
): IndexedEntity | null => {
  const row = index.database
    .prepare(
      `SELECT entities.*,
              COALESCE(
                (SELECT json_group_array(topic_id)
                 FROM entity_topics
                 WHERE entity_id = entities.id),
                '[]'
              ) AS topic_ids
       FROM entities
       WHERE entities.id = ?${visibilityClause(options, true, "entities.")}`,
    )
    .get(entityId) as EntityRow | undefined;
  return row === undefined ? null : fromEntityRow(row);
};

export const listIndexedEntities = (
  index: IndexDatabase,
  options: EntityQueryOptions = {},
): readonly IndexedEntity[] =>
  (
    index.database
      .prepare(
        `SELECT ${options.includeBody === false ? `${entitySummaryColumns("entities")}, '' AS body` : "entities.*"},
                COALESCE(
                  (SELECT json_group_array(topic_id)
                   FROM entity_topics
                   WHERE entity_id = entities.id),
                  '[]'
                ) AS topic_ids
         FROM entities
         WHERE 1 = 1${visibilityClause(options, false, "entities.")}
         ORDER BY updated_at DESC, id`,
      )
      .all() as EntityRow[]
  ).map(fromEntityRow);

export const listIndexedJournalEntries = (
  index: IndexDatabase,
  journalDate: string,
): readonly IndexedEntity[] =>
  (
    index.database
      .prepare(
        `SELECT entities.*,
                COALESCE(
                  (SELECT json_group_array(topic_id)
                   FROM entity_topics
                   WHERE entity_id = entities.id),
                  '[]'
                ) AS topic_ids
         FROM entities
         WHERE type = 'entry' AND deleted_at IS NULL AND journal_date = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(journalDate) as EntityRow[]
  ).map(fromEntityRow);

export const listEntityScopes = (
  index: IndexDatabase,
  entityId: string,
): readonly IndexedEntityScope[] =>
  (
    index.database
      .prepare(
        `SELECT entity_id, scope_type, scope_id, relation, via_entity_id
         FROM entity_scopes
         WHERE entity_id = ?
         ORDER BY scope_type, scope_id`,
      )
      .all(entityId) as EntityScopeRow[]
  ).map((row) => ({
    entityId: row.entity_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    relation: row.relation,
    viaEntityId: row.via_entity_id,
  }));

export const listIndexedEntitiesInScope = (
  index: IndexDatabase,
  scopeType: EntityScopeType,
  scopeId: string,
  options: EntityQueryOptions = {},
): readonly IndexedEntity[] =>
  (
    index.database
      .prepare(
        `SELECT entities.*,
                COALESCE(
                  (SELECT json_group_array(topic_id)
                   FROM entity_topics
                   WHERE entity_id = entities.id),
                  '[]'
                ) AS topic_ids
         FROM entity_scopes scopes
         JOIN entities ON entities.id = scopes.entity_id
         WHERE scopes.scope_type = ?
           AND scopes.scope_id = ?
           ${visibilityClause(options, false, "entities.")}
         ORDER BY entities.updated_at DESC, entities.id`,
      )
      .all(scopeType, scopeId) as EntityRow[]
  ).map(fromEntityRow);

export const searchIndexedEntities = (
  index: IndexDatabase,
  query: string,
  options: EntityQueryOptions = {},
): readonly IndexedSearchResult[] =>
  (() => {
    const text = query.trim();
    if (!text) return [];
    const { table, phrase } = searchMatch(text);
    const rows = index.database
      .prepare(
        `SELECT e.*, d.content AS search_content,
      COALESCE((SELECT json_group_array(topic_id) FROM entity_topics WHERE entity_id=e.id), '[]') AS topic_ids
      FROM ${table} f JOIN search_documents d ON d.rowid=f.rowid JOIN entities e ON e.id=d.id
      WHERE ${table} MATCH ?${visibilityClause(options, false, "e.")} ORDER BY f.rank, e.id`,
      )
      .all(phrase) as (EntityRow & { search_content: string })[];
    return rows.map((row) => ({
      ...fromEntityRow(row),
      searchContent: row.search_content,
    }));
  })();

export const getIndexedConflict = (
  index: IndexDatabase,
  path: string,
): IndexedConflict | null => {
  const row = index.database
    .prepare(
      `SELECT conflict.path, conflict.canonical_entity_path,
              entity.id AS canonical_entity_id,
              entity.display_name AS canonical_display_name,
              conflict.hash, conflict.mtime_ms, conflict.size
       FROM conflicts conflict
       LEFT JOIN entities entity ON entity.path = conflict.canonical_entity_path
       WHERE conflict.path = ?`,
    )
    .get(path) as ConflictRow | undefined;
  return row === undefined ? null : fromConflictRow(row);
};

export const listIndexedConflicts = (
  index: IndexDatabase,
): readonly IndexedConflict[] =>
  (
    index.database
      .prepare(
        `SELECT conflict.path, conflict.canonical_entity_path,
                entity.id AS canonical_entity_id,
                entity.display_name AS canonical_display_name,
                conflict.hash, conflict.mtime_ms, conflict.size
         FROM conflicts conflict
         LEFT JOIN entities entity ON entity.path = conflict.canonical_entity_path
         ORDER BY conflict.mtime_ms DESC, conflict.path`,
      )
      .all() as ConflictRow[]
  ).map(fromConflictRow);

export const getBacklinks = (
  index: IndexDatabase,
  targetId: string,
  options: EntityQueryOptions = {},
): readonly IndexedReference[] =>
  (
    index.database
      .prepare(
        `SELECT source_id, source.type AS source_type,
                source.display_name AS source_display_name,
                target_id, target_type, reference_kind, label,
                field_path, start_offset, end_offset
         FROM entity_references references_to_target
         JOIN entities source ON source.id = references_to_target.source_id
         WHERE target_id = ?${visibilityClause(options, false, "source.")}
         ORDER BY source_id, reference_kind, start_offset`,
      )
      .all(targetId) as ReferenceRow[]
  ).map((row) => ({
    sourceId: row.source_id,
    sourceType: row.source_type,
    sourceDisplayName: row.source_display_name,
    targetId: row.target_id,
    targetType: row.target_type,
    kind: row.reference_kind,
    label: row.label,
    fieldPath:
      row.field_path === null
        ? null
        : (JSON.parse(row.field_path) as readonly (string | number)[]),
    startOffset: row.start_offset,
    endOffset: row.end_offset,
  }));

const rankExpression = (column: string, values: readonly string[]): string =>
  `CASE ${column} ${values.map((value, index) => `WHEN '${value}' THEN '${index}'`).join(" ")} ELSE '${values.length}' END`;
const statusRank = rankExpression("e.status", STATUS_ORDER);
const priorityRank = rankExpression("e.priority", PRIORITY_ORDER);
const sortExpressions = {
  workflow: `(${statusRank}) || ':' || (${priorityRank})`,
  resourceType: "COALESCE(e.resource_type, '')",
  name: "COALESCE(e.display_name, '') COLLATE NOCASE",
  createdAt: "e.created_at",
  updatedAt: "e.updated_at",
  deletedAt: "COALESCE(e.deleted_at, '')",
  dueAt:
    "COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', CASE WHEN length(e.due_at)=10 THEN e.due_at || 'T00:00:00+09:00' ELSE e.due_at END), '')",
  status: statusRank,
  priority: priorityRank,
  project:
    "COALESCE((SELECT display_name FROM entities WHERE id=e.project_id), '') COLLATE NOCASE",
  area: "COALESCE((SELECT display_name FROM entities WHERE id=COALESCE(e.area_id, (SELECT area_id FROM entities WHERE id=e.project_id))), '') COLLATE NOCASE",
  topics:
    "COALESCE((SELECT group_concat(t.display_name) FROM entity_topics et JOIN entities t ON t.id=et.topic_id WHERE et.entity_id=e.id), '')",
  origin: "COALESCE(e.origin, '')",
  authors:
    "COALESCE((SELECT group_concat(value, ' ' ) FROM json_each(e.authors)), '') COLLATE NOCASE",
  canonicalIdentifier: "COALESCE(e.canonical_identifier, '')",
  sourceUri: "COALESCE(e.source_uri, '')",
  description: "COALESCE(e.description, '')",
} as const;

// The cursor is tied to the normalized filter and sort. Pages seek from the last
// value/ID instead of rescanning/skipping all preceding rows with OFFSET.
export const queryIndexedEntityPage = (
  index: IndexDatabase,
  input: EntityPageQuery = {},
  options: EntityQueryOptions = {},
): EntityPage => {
  const query = parseEntityPageQuery(input);
  const limit = query.limit ?? 50;
  const sort = query.sort ?? "name";
  const direction = query.direction ?? "asc";
  const expression = sortExpressions[sort];
  const order = direction === "asc" ? "ASC" : "DESC";
  const filters = [
    query.deleted === "only"
      ? "e.deleted_at IS NOT NULL"
      : "e.deleted_at IS NULL",
  ];
  if (options.forAi)
    filters.push(
      "e.exclude_from_ai = 0",
      "e.deleted_at IS NULL",
      "NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.canonical_entity_path=e.path)",
    );
  const params: Record<string, string | number> = { limit: limit + 1 };
  const equals = (
    column: string,
    key: string,
    value: string | undefined,
  ): void => {
    if (value !== undefined) {
      filters.push(`${column} = @${key}`);
      params[key] = value;
    }
  };
  // Compare instants rather than ISO text: stored offsets and fractional
  // second formatting may differ. Journal dates remain calendar strings.
  for (const [key, column, datetime] of [
    ["createdAt", "e.created_at", true],
    ["updatedAt", "e.updated_at", true],
    ["occurredAt", "e.occurred_at", true],
    ["dueAt", "e.due_at", true],
    ["journalDateRange", "e.journal_date", false],
  ] as const) {
    const range = query[key];
    for (const boundary of ["from", "to"] as const) {
      const value = range?.[boundary];
      if (value === undefined) continue;
      const parameter = `${key}_${boundary}`;
      const expression = datetime
        ? `julianday(CASE WHEN length(${column})=10 THEN ${column} || 'T00:00:00+09:00' ELSE ${column} END)`
        : column;
      const bound = datetime ? `julianday(@${parameter})` : `@${parameter}`;
      filters.push(
        `${expression} ${boundary === "from" ? ">=" : "<"} ${bound}`,
      );
      params[parameter] = value;
    }
  }
  equals("e.type", "type", query.type);
  equals("e.status", "status", query.status);
  equals("e.resource_type", "resourceType", query.resourceType);
  if (query.activeOnly)
    filters.push(
      "(e.type NOT IN ('project', 'task') OR e.status NOT IN ('done', 'on_hold'))",
    );
  equals("e.priority", "priority", query.priority);
  equals("e.origin", "origin", query.origin);
  equals("e.journal_date", "journalDate", query.journalDate);
  equals("e.project_id", "projectId", query.projectId);
  if (query.nameKeys !== undefined) {
    filters.push("e.name_key IN (SELECT value FROM json_each(@nameKeys))");
    params.nameKeys = JSON.stringify(query.nameKeys);
  }
  if (query.types !== undefined) {
    filters.push("e.type IN (SELECT value FROM json_each(@types))");
    params.types = JSON.stringify(query.types);
  }
  if (query.ids !== undefined) {
    filters.push("e.id IN (SELECT value FROM json_each(@ids))");
    params.ids = JSON.stringify(query.ids);
  }
  if (query.areaId !== undefined) {
    filters.push(
      "EXISTS (SELECT 1 FROM entity_scopes WHERE entity_id=e.id AND scope_type='area' AND scope_id=@areaId)",
    );
    params.areaId = query.areaId;
  }
  if (query.scopeId !== undefined) {
    filters.push(
      "EXISTS (SELECT 1 FROM entity_scopes WHERE entity_id=e.id AND scope_type=@scopeType AND scope_id=@scopeId)",
    );
    params.scopeId = query.scopeId;
    params.scopeType = query.scopeType!;
  }
  if (query.topicIds?.length) {
    filters.push(
      "NOT EXISTS (SELECT 1 FROM json_each(@topicIds) requested WHERE NOT EXISTS (SELECT 1 FROM entity_topics WHERE entity_id=e.id AND topic_id=requested.value))",
    );
    params.topicIds = JSON.stringify(query.topicIds);
  }
  if (query.todosOnly)
    filters.push("EXISTS (SELECT 1 FROM entry_todos WHERE entity_id=e.id)");
  const relatedGraph =
    query.relatedTo !== undefined && query.relatedResolution !== undefined
      ? resolveRelatedEntities(
          index,
          query.relatedTo,
          query.relatedResolution,
          options.forAi,
        )
      : undefined;
  if (query.entryRelationMode !== undefined) {
    params.relatedTo = query.relatedTo!;
    filters.push(
      "e.id != @relatedTo AND EXISTS (SELECT 1 FROM entry_matches m WHERE m.entry_id=e.id)",
    );
  } else if (relatedGraph !== undefined) {
    params.relatedIds = JSON.stringify([...relatedGraph.nodes.keys()]);
    filters.push("e.id IN (SELECT value FROM json_each(@relatedIds))");
  } else if (query.relatedTo !== undefined) {
    params.relatedTo = query.relatedTo;
    filters.push(`e.id != @relatedTo AND (
      EXISTS (SELECT 1 FROM entity_scopes WHERE entity_id=e.id AND scope_id=@relatedTo)
      OR EXISTS (SELECT 1 FROM entity_topics WHERE entity_id=e.id AND topic_id=@relatedTo)
      OR EXISTS (SELECT 1 FROM entity_references WHERE source_id=e.id AND target_id=@relatedTo)
      OR EXISTS (SELECT 1 FROM entity_references WHERE source_id=@relatedTo AND target_id=e.id AND reference_kind='related')
    )`);
  }
  const text = query.q?.trim() ?? "";
  if (text !== "") {
    if (query.nameOnly) {
      const normalized = text.normalize("NFKC").toLocaleLowerCase("ja");
      const { table, phrase } = searchMatch(normalized, true);
      filters.push(
        `(e.rowid IN (SELECT rowid FROM ${table} WHERE ${table} MATCH @phrase) OR e.id >= @text AND e.id < @idEnd)`,
      );
      params.text = normalized;
      params.phrase = phrase;
      params.idEnd = normalized + "\uffff";
    } else {
      const { table, phrase } = searchMatch(text);
      filters.push(
        `e.id IN (SELECT d.id FROM ${table} f JOIN search_documents d ON d.rowid=f.rowid WHERE ${table} MATCH @phrase)`,
      );
      params.phrase = phrase;
    }
  }
  if (query.deadline === "unscheduled") filters.push("e.due_at IS NULL");
  else if (query.deadline !== undefined || query.dueDate !== undefined) {
    filters.push("e.type = 'task' AND e.due_at IS NOT NULL");
    if (query.deadline === "overdue") {
      filters.push(
        "e.status != 'done' AND CASE WHEN length(e.due_at)=10 THEN julianday(e.due_at || 'T00:00:00+09:00', '+1 day') <= julianday(@now) ELSE julianday(e.due_at) < julianday(@now) END",
      );
      params.now = new Date().toISOString();
    } else if (
      query.dueDate !== undefined ||
      query.deadline === "today" ||
      query.deadline === "next7days"
    ) {
      const start = new Date(
        `${query.dueDate ?? todayJournalDate()}T00:00:00+09:00`,
      );
      filters.push(
        "julianday(CASE WHEN length(e.due_at)=10 THEN e.due_at || 'T00:00:00+09:00' ELSE e.due_at END) >= julianday(@start) AND julianday(CASE WHEN length(e.due_at)=10 THEN e.due_at || 'T00:00:00+09:00' ELSE e.due_at END) < julianday(@end)",
      );
      params.start = start.toISOString();
      params.end = new Date(
        start.getTime() + (query.deadline === "next7days" ? 7 : 1) * 86400000,
      ).toISOString();
    }
  }
  const queryKey = createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries({
          ...query,
          forAi: options.forAi ?? false,
          cursor: undefined,
          limit: undefined,
          view: undefined,
        })
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest("hex");
  if (query.cursor !== undefined) {
    let cursor: { key: string; value: string; id: string };
    try {
      cursor = JSON.parse(query.cursor) as typeof cursor;
      if (
        cursor.key !== queryKey ||
        typeof cursor.value !== "string" ||
        typeof cursor.id !== "string"
      )
        throw new Error();
    } catch {
      throw new TypeError("Invalid Entity cursor for this query");
    }
    const comparison = direction === "asc" ? ">" : "<";
    filters.push(`((${expression}), e.id) ${comparison} (@value, @lastId)`);
    params.value = cursor.value;
    params.lastId = cursor.id;
  }
  // List/table summaries carry only a short preview. Timeline explicitly requests
  // bodies for its visible page; document editing always loads the Markdown file.
  const columns = entitySummaryColumns("e");
  const rows = index.database
    .prepare(
      `${query.entryRelationMode ? entryRelationCte(query.entryRelationMode === "scoped", options.forAi === true) : ""}
    SELECT ${columns}, ${query.view === "timeline" ? "substr(e.body,1,1200)" : "''"} AS body,
    ${query.entryRelationMode ? "(SELECT m.path FROM entry_matches m WHERE m.entry_id=e.id ORDER BY m.depth,m.path LIMIT 1)" : "NULL"} AS relation_path,
    ${query.view === "timeline" ? "length(e.body)>1200" : "0"} AS body_truncated,
    (SELECT hash FROM files WHERE path=e.path) AS file_hash,
    COALESCE((SELECT json_group_array(topic_id) FROM entity_topics WHERE entity_id=e.id), '[]') AS topic_ids,
    (${expression}) AS cursor_value FROM entities e WHERE ${filters.join(" AND ")}
    ORDER BY (${expression}) ${order}, e.id ${order} LIMIT @limit`,
    )
    .all(params) as (EntityRow & {
    cursor_value: string;
    relation_path: string | null;
  })[];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  let remaining = 128 * 1024;
  const pathIds = page.map((row) =>
    row.relation_path ? (JSON.parse(row.relation_path) as string[]) : [],
  );
  const labels = new Map(
    (query.entryRelationMode
      ? (index.database
          .prepare(
            "SELECT id,type,display_name FROM entities WHERE id IN (SELECT value FROM json_each(?))",
          )
          .all(JSON.stringify([...new Set(pathIds.flat())])) as {
          id: string;
          type: string;
          display_name: string | null;
        }[])
      : []
    ).map((row) => [
      row.id,
      { id: row.id, type: row.type, displayName: row.display_name },
    ]),
  );
  const items = page
    .map((row, i) => ({
      ...fromEntityRow(row),
      ...(query.entryRelationMode
        ? {
            entryRelation: {
              kind:
                pathIds[i]!.length === 1
                  ? ("direct" as const)
                  : ("inherited" as const),
              path: pathIds[i]!.flatMap((id) =>
                labels.has(id) ? [labels.get(id)!] : [],
              ),
            },
          }
        : {}),
    }))
    .map((item) => {
      if (relatedGraph !== undefined)
        item = {
          ...item,
          relatedVia: relatedEntityReason(relatedGraph, item.id),
        };
      if (query.view !== "timeline") return item;
      let body = item.body;
      while (Buffer.byteLength(body) > remaining)
        body = body.slice(0, Math.max(0, Math.floor(body.length * 0.75)));
      remaining -= Buffer.byteLength(body);
      return {
        ...item,
        body,
        bodyTruncated: item.bodyTruncated === true || body !== item.body,
      };
    });
  return {
    items,
    nextCursor:
      hasMore && last
        ? JSON.stringify({
            key: queryKey,
            value: last.cursor_value,
            id: last.id,
          })
        : null,
  };
};

export const countIndexedEntities = (index: IndexDatabase): EntityCounts => {
  const types = Object.fromEntries(
    ENTITY_TYPES.map((type) => [type, 0]),
  ) as Record<EntityType, number>;
  for (const row of index.database
    .prepare(
      "SELECT type, count(*) AS count FROM entities WHERE deleted_at IS NULL GROUP BY type",
    )
    .all() as { type: EntityType; count: number }[])
    types[row.type] = row.count;
  const deleted = index.database
    .prepare(
      "SELECT count(*) AS count FROM entities WHERE deleted_at IS NOT NULL",
    )
    .get() as { count: number };
  return { types, deleted: deleted.count };
};

export const countIndexedCalendarDays = (
  index: IndexDatabase,
  from: string,
  to: string,
): readonly CalendarCount[] => {
  requireJournalDate(from);
  requireJournalDate(to);
  const start = new Date(`${from}T00:00:00+09:00`).toISOString();
  const end = new Date(`${to}T00:00:00+09:00`).toISOString();
  if (from >= to || Date.parse(end) - Date.parse(start) > 62 * 86400000)
    throw new TypeError("Calendar range must span 1–62 days");
  return index.database
    .prepare(
      `SELECT date, sum(entries) AS entries, sum(tasks) AS tasks FROM (
    SELECT journal_date AS date, count(*) AS entries, 0 AS tasks FROM entities
    WHERE type='entry' AND deleted_at IS NULL AND journal_date >= @from AND journal_date < @to GROUP BY journal_date
    UNION ALL
    SELECT CASE WHEN length(due_at)=10 THEN due_at ELSE date(due_at, '+9 hours') END AS date, 0 AS entries, count(*) AS tasks FROM entities
    WHERE type='task' AND deleted_at IS NULL AND julianday(CASE WHEN length(due_at)=10 THEN due_at || 'T00:00:00+09:00' ELSE due_at END) >= julianday(@start) AND julianday(CASE WHEN length(due_at)=10 THEN due_at || 'T00:00:00+09:00' ELSE due_at END) < julianday(@end) GROUP BY CASE WHEN length(due_at)=10 THEN due_at ELSE date(due_at, '+9 hours') END
  ) GROUP BY date ORDER BY date`,
    )
    .all({ from, to, start, end }) as CalendarCount[];
};

export const queryIndexedBacklinkPage = (
  index: IndexDatabase,
  targetId: string,
  query: BacklinkPageQuery = {},
  options: EntityQueryOptions = {},
): BacklinkPage => {
  const limit = query.limit ?? 50;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (query.cursor !== undefined &&
      (typeof query.cursor !== "string" || query.cursor.length > 200))
  )
    throw new TypeError("Invalid backlink page");
  const rows = index.database
    .prepare(
      `SELECT source.id AS sourceId, source.type AS sourceType, source.display_name AS sourceDisplayName,
    count(*) AS count, json_group_array(DISTINCT refs.reference_kind) AS kinds,
    (SELECT json_group_array(label) FROM (SELECT DISTINCT substr(label,1,160) AS label FROM entity_references WHERE target_id=@targetId AND source_id=source.id AND label IS NOT NULL ORDER BY label LIMIT 3)) AS labels
    FROM entity_references refs JOIN entities source ON source.id=refs.source_id
    WHERE refs.target_id=@targetId AND source.deleted_at IS NULL ${options.forAi ? "AND source.exclude_from_ai = 0 AND NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.canonical_entity_path=source.path)" : ""} ${query.cursor === undefined ? "" : "AND source.id > @cursor"}
    GROUP BY source.id ORDER BY source.id LIMIT @limit`,
    )
    .all({
      targetId,
      limit: limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    }) as (Omit<BacklinkGroup, "kinds" | "labels"> & {
    kinds: string;
    labels: string;
  })[];
  const items = rows.slice(0, limit).map((row) => ({
    ...row,
    kinds: JSON.parse(row.kinds) as string[],
    labels: JSON.parse(row.labels) as string[],
  }));
  return {
    items,
    nextCursor: rows.length > limit ? items.at(-1)!.sourceId : null,
  };
};

export const queryEntityLabels = (
  index: IndexDatabase,
  ids: readonly string[],
) => {
  if (!ids.length) return [];
  const rows = index.database
    .prepare(
      `WITH RECURSIVE related(id,depth) AS (
    SELECT value,0 FROM json_each(@ids) UNION
    SELECT value,0 FROM entities e, json_each(e.related_entity_ids)
      WHERE e.id IN (SELECT value FROM json_each(@ids)) UNION
    SELECT value,r.depth+1 FROM related r JOIN entities e ON e.id=r.id,
      json_each(json_array(e.area_id,e.project_id,e.task_id,e.resource_id)) WHERE r.depth<3 AND value IS NOT NULL
  ) SELECT DISTINCT id FROM related`,
    )
    .all({ ids: JSON.stringify(ids) }) as { id: string }[];
  const entities = index.database
    .prepare(
      `SELECT e.id,e.type,e.path,e.display_name,e.description,e.authors,e.related_entity_ids,e.origin,e.status,e.priority,e.project_id,e.area_id,e.task_id,e.resource_id,e.resource_type,e.canonical_identifier,e.source_uri,e.asset_path,e.journal_date,e.occurred_at,e.due_at,e.created_at,e.updated_at,e.deleted_at,e.exclude_from_ai, '' AS body,
    (SELECT hash FROM files WHERE path=e.path) AS file_hash,
    COALESCE((SELECT json_group_array(topic_id) FROM entity_topics WHERE entity_id=e.id),'[]') AS topic_ids
    FROM entities e WHERE e.id IN (SELECT value FROM json_each(?)) AND e.deleted_at IS NULL`,
    )
    .all(JSON.stringify(rows.map((row) => row.id))) as EntityRow[];
  return entities.map(fromEntityRow);
};
