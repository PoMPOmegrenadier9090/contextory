import type { PkmIndexChanges, PkmFileHash } from "@pkm/contracts";
import type { IndexDatabase } from "./index-database.js";

export const emptyIndexChanges = (): PkmIndexChanges => ({
  reset: false,
  entities: [],
  types: [],
  scopeIds: [],
  backlinkIds: [],
  namesChanged: false,
  countsChanged: false,
  calendarChanged: false,
  conflictsChanged: false,
});

export const captureIndexImpact = (
  index: IndexDatabase,
  ids: readonly string[],
) => {
  const params = { ids: JSON.stringify(ids) };
  const rows = index.database
    .prepare(
      `SELECT e.id,e.type,e.display_name,e.deleted_at,e.journal_date,e.due_at,f.hash
    FROM entities e LEFT JOIN files f ON f.path=e.path WHERE e.id IN (SELECT value FROM json_each(@ids))`,
    )
    .all(params) as {
    id: string;
    type: string;
    display_name: string | null;
    deleted_at: string | null;
    journal_date: string | null;
    due_at: string | null;
    hash: PkmFileHash;
  }[];
  const scopes = index.database
    .prepare(
      `WITH RECURSIVE impacted(id) AS (
        SELECT value FROM json_each(@ids)
        UNION SELECT target_id FROM entity_references WHERE source_id IN (SELECT value FROM json_each(@ids))
        UNION SELECT r.target_id FROM entity_references r JOIN impacted i ON r.source_id=i.id WHERE r.reference_kind='parent'
      )
    SELECT id FROM impacted
    UNION SELECT scope_id AS id FROM entity_scopes WHERE entity_id IN (SELECT value FROM json_each(@ids))
    UNION SELECT topic_id FROM entity_topics WHERE entity_id IN (SELECT value FROM json_each(@ids))`,
    )
    .all(params) as { id: string }[];
  const targets = index.database
    .prepare(
      `SELECT DISTINCT target_id AS id FROM entity_references WHERE source_id IN (SELECT value FROM json_each(@ids))
       UNION SELECT source_id AS id FROM entity_references WHERE target_id IN (SELECT value FROM json_each(@ids)) AND reference_kind='related'`,
    )
    .all(params) as { id: string }[];
  return {
    rows,
    scopes: scopes.map((x) => x.id),
    targets: targets.map((x) => x.id),
  };
};

export const compareIndexImpact = (
  before: ReturnType<typeof captureIndexImpact>,
  after: ReturnType<typeof captureIndexImpact>,
  conflictsChanged: boolean,
): PkmIndexChanges => {
  const all = [...before.rows, ...after.rows];
  const membership = (impact: typeof before) =>
    JSON.stringify(
      impact.rows.map((r) => [r.id, r.type, r.deleted_at !== null]).sort(),
    );
  const calendar = (impact: typeof before) =>
    JSON.stringify(
      impact.rows
        .filter(
          (r) =>
            r.deleted_at === null &&
            (r.journal_date !== null || r.due_at !== null),
        )
        .map((r) => [r.id, r.journal_date, r.due_at])
        .sort(),
    );
  const next = new Map(after.rows.map((r) => [r.id, r]));
  const changes: PkmIndexChanges = {
    reset: false,
    entities: [...new Set(all.map((r) => r.id))].map((id) => ({
      id,
      type: (next.get(id) ?? before.rows.find((r) => r.id === id)!).type,
      fileHash: next.get(id)?.hash ?? null,
    })),
    types: [...new Set(all.map((r) => r.type))],
    scopeIds: [
      ...new Set([
        ...before.scopes,
        ...after.scopes,
        ...all.filter((r) => r.type !== "entry").map((r) => r.id),
      ]),
    ],
    backlinkIds: [...new Set([...before.targets, ...after.targets])],
    namesChanged:
      JSON.stringify(
        before.rows
          .map((r) => [r.id, r.type, r.display_name, r.deleted_at !== null])
          .sort(),
      ) !==
      JSON.stringify(
        after.rows
          .map((r) => [r.id, r.type, r.display_name, r.deleted_at !== null])
          .sort(),
      ),
    countsChanged: membership(before) !== membership(after),
    calendarChanged: calendar(before) !== calendar(after),
    conflictsChanged,
  };
  if (
    changes.entities.length > 200 ||
    changes.scopeIds.length > 400 ||
    changes.backlinkIds.length > 400
  )
    return {
      ...changes,
      reset: true,
      entities: [],
      scopeIds: [],
      backlinkIds: [],
      namesChanged: true,
      countsChanged: true,
      calendarChanged: true,
      conflictsChanged: true,
    };
  return changes;
};
