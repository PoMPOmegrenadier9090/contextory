import type { PkmEntitySummary } from "@pkm/contracts";
import type { IndexDatabase } from "./index-database.js";

interface Node {
  id: string;
  type: string;
  displayName: string | null;
  parentId: string | null;
  depth: number;
  kind: "structured" | "reference";
}
export interface RelatedEntityGraph {
  readonly nodes: ReadonlyMap<string, Node>;
  readonly structured: ReadonlyMap<string, Node>;
}
const MAX_NODES = 20_000;
const caches = new WeakMap<
  IndexDatabase,
  {
    revision: string;
    graphs: Map<string, RelatedEntityGraph>;
  }
>();

// Only structured inbound edges expand the graph. Body links and outgoing
// Resource relations are terminal results and never enter the frontier.
export const resolveRelatedEntities = (
  index: IndexDatabase,
  rootId: string,
  resolution: "direct" | "transitive",
  forAi = false,
): RelatedEntityGraph => {
  const changes = index.database
    .prepare("SELECT total_changes() AS n")
    .get() as { n: number };
  const revision = `${changes.n}:${String(index.database.pragma("data_version", { simple: true }))}`;
  let cache = caches.get(index);
  if (cache?.revision !== revision) {
    cache = { revision, graphs: new Map() };
    caches.set(index, cache);
  }
  const key = JSON.stringify([rootId, resolution, forAi]);
  const cached = cache.graphs.get(key);
  if (cached) return cached;
  const visible = `e.deleted_at IS NULL ${forAi ? "AND e.exclude_from_ai=0 AND NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.canonical_entity_path=e.path)" : ""}`;
  const root = index.database
    .prepare(
      `SELECT e.id,e.type,e.display_name AS displayName FROM entities e WHERE e.id=? AND ${visible}`,
    )
    .get(rootId) as Pick<Node, "id" | "type" | "displayName"> | undefined;
  const structured = new Map<string, Node>();
  if (!root) return { nodes: structured, structured };
  structured.set(rootId, {
    ...root,
    parentId: null,
    depth: 0,
    kind: "structured",
  });
  const incoming = index.database
    .prepare(`SELECT DISTINCT e.id,e.type,e.display_name AS displayName,r.target_id AS parentId
    FROM entity_references r JOIN entities e ON e.id=r.source_id
    WHERE r.target_id IN (SELECT value FROM json_each(?)) AND ${visible}
      AND ((r.reference_kind='context' AND e.type='entry')
        OR (r.reference_kind='parent' AND e.type IN ('project','task'))
        OR r.reference_kind='topic'
        OR (r.reference_kind='related' AND e.type='resource'))
    ORDER BY e.id,r.target_id`);
  let frontier = root.type === "entry" ? [] : [rootId];
  while (frontier.length) {
    const next: string[] = [];
    for (let offset = 0; offset < frontier.length; offset += 500) {
      const rows = incoming.all(
        JSON.stringify(frontier.slice(offset, offset + 500)),
      ) as Pick<Node, "id" | "type" | "displayName" | "parentId">[];
      for (const row of rows) {
        if (structured.has(row.id)) continue;
        const parent = structured.get(row.parentId!)!;
        structured.set(row.id, {
          ...row,
          depth: parent.depth + 1,
          kind: "structured",
        });
        if (structured.size > MAX_NODES)
          throw new RangeError(
            "関連Entityが多すぎるため取得できません。直接のみへ切り替えてください。",
          );
        if (resolution === "transitive" && row.type !== "entry")
          next.push(row.id);
      }
    }
    frontier = next;
  }
  const nodes = new Map(structured);
  nodes.delete(rootId);
  const terminal = index.database
    .prepare(
      `SELECT DISTINCT e.id,e.type,e.display_name AS displayName,r.reference_kind AS referenceKind
    FROM entity_references r JOIN entities e ON e.id=CASE WHEN r.target_id=@root THEN r.source_id ELSE r.target_id END
    WHERE ${visible} AND e.id!=@root AND (
      r.target_id=@root AND r.reference_kind='direct'
      OR r.source_id=@root AND r.reference_kind='related') ORDER BY e.id`,
    )
    .all({ root: rootId }) as (Pick<Node, "id" | "type" | "displayName"> & {
    referenceKind: string;
  })[];
  for (const row of terminal) {
    const current = nodes.get(row.id);
    if (current?.depth === 1 && current.kind === "structured") continue;
    nodes.set(row.id, {
      id: row.id,
      type: row.type,
      displayName: row.displayName,
      parentId: rootId,
      depth: 1,
      kind: row.referenceKind === "direct" ? "reference" : "structured",
    });
  }
  if (nodes.size > MAX_NODES)
    throw new RangeError("関連Entityが多すぎるため取得できません。");
  const graph = { nodes, structured };
  cache.graphs.set(key, graph);
  if (cache.graphs.size > 16)
    cache.graphs.delete(cache.graphs.keys().next().value!);
  return graph;
};

export const relatedEntityReason = (
  graph: RelatedEntityGraph,
  id: string,
): NonNullable<PkmEntitySummary["relatedVia"]> => {
  const node = graph.nodes.get(id)!;
  const via: { id: string; type: string; displayName: string | null }[] = [];
  let parentId = node.parentId;
  if (node.depth > 1)
    while (parentId !== null) {
      const parent = graph.structured.get(parentId)!;
      if (parent.depth === 0) break;
      via.unshift({
        id: parent.id,
        type: parent.type,
        displayName: parent.displayName,
      });
      parentId = parent.parentId;
    }
  return {
    relation: node.depth === 1 ? "direct" : "transitive",
    kind: node.kind,
    via,
  };
};
