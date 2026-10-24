import type { EntityType } from "@pkm/core";

import type { IndexDatabase } from "./index-database.js";

export type EntityScopeType = Extract<
  EntityType,
  "area" | "project" | "task" | "resource"
>;

export type EntityScopeRelation = "direct" | "inherited";

export interface IndexedEntityScope {
  readonly entityId: string;
  readonly scopeType: EntityScopeType;
  readonly scopeId: string;
  readonly relation: EntityScopeRelation;
  readonly viaEntityId: string | null;
}

interface ScopeEntityRow {
  readonly id: string;
  readonly type: EntityType;
  readonly project_id: string | null;
  readonly area_id: string | null;
  readonly task_id: string | null;
  readonly resource_id: string | null;
}

const loadEntities = (
  index: IndexDatabase,
  entityIds: ReadonlySet<string> | null,
): ReadonlyMap<string, ScopeEntityRow> =>
  new Map(
    (
      index.database
        .prepare(
          `SELECT id, type, project_id, area_id, task_id, resource_id
           FROM entities ${
             entityIds === null
               ? ""
               : `WHERE id IN (
             SELECT value FROM json_each(@ids)
             UNION SELECT project_id FROM entities WHERE id IN (SELECT value FROM json_each(@ids))
             UNION SELECT task_id FROM entities WHERE id IN (SELECT value FROM json_each(@ids))
             UNION SELECT project_id FROM entities WHERE id IN (SELECT task_id FROM entities WHERE id IN (SELECT value FROM json_each(@ids)))
           )`
           }`,
        )
        .all(
          ...(entityIds === null
            ? []
            : [{ ids: JSON.stringify([...entityIds]) }]),
        ) as ScopeEntityRow[]
    ).map((entity) => [entity.id, entity]),
  );

const scopeKey = (scope: IndexedEntityScope): string =>
  `${scope.scopeType}:${scope.scopeId}`;

const deriveEntityScopes = (
  entity: ScopeEntityRow,
  byId: ReadonlyMap<string, ScopeEntityRow>,
): readonly IndexedEntityScope[] => {
  const scopes = new Map<string, IndexedEntityScope>();
  const add = (
    scopeType: EntityScopeType,
    scopeId: string | null,
    relation: EntityScopeRelation,
    viaEntityId: string | null = null,
  ): void => {
    if (scopeId === null) return;
    const scope: IndexedEntityScope = {
      entityId: entity.id,
      scopeType,
      scopeId,
      relation,
      viaEntityId,
    };
    const key = scopeKey(scope);
    const current = scopes.get(key);
    if (current === undefined || relation === "direct") scopes.set(key, scope);
  };
  const resolvedTask =
    entity.task_id === null ? undefined : byId.get(entity.task_id);
  const task = resolvedTask?.type === "task" ? resolvedTask : undefined;

  switch (entity.type) {
    case "project":
      add("area", entity.area_id, "direct");
      break;
    case "task": {
      add("project", entity.project_id, "direct");
      if (entity.area_id !== null) {
        add("area", entity.area_id, "direct");
        break;
      }
      const project =
        entity.project_id === null ? undefined : byId.get(entity.project_id);
      if (project?.type === "project") {
        add("area", project.area_id, "inherited", project.id);
      }
      break;
    }
    case "entry": {
      add("task", entity.task_id, "direct");
      add("resource", entity.resource_id, "direct");

      let effectiveProjectId = entity.project_id;
      if (entity.project_id !== null) {
        add("project", entity.project_id, "direct");
      } else if (task?.project_id !== null && task?.project_id !== undefined) {
        effectiveProjectId = task.project_id;
        add("project", task.project_id, "inherited", task.id);
      }

      if (entity.area_id !== null) {
        add("area", entity.area_id, "direct");
        break;
      }

      const project =
        effectiveProjectId === null ? undefined : byId.get(effectiveProjectId);
      if (project?.type === "project" && project.area_id !== null) {
        add("area", project.area_id, "inherited", project.id);
        break;
      }
      if (task?.area_id !== null && task?.area_id !== undefined) {
        add("area", task.area_id, "inherited", task.id);
        break;
      }
      const taskProject =
        task?.project_id === null || task?.project_id === undefined
          ? undefined
          : byId.get(task.project_id);
      if (task !== undefined && taskProject?.type === "project") {
        add("area", taskProject.area_id, "inherited", task.id);
      }
      break;
    }
    case "area":
    case "resource":
    case "topic":
      break;
  }

  return [...scopes.values()];
};

const insertScopes = (
  index: IndexDatabase,
  entityIds: ReadonlySet<string> | null,
): void => {
  if (entityIds?.size === 0) return;
  const byId = loadEntities(index, entityIds);
  const insert = index.database.prepare(
    `INSERT INTO entity_scopes (
      entity_id, scope_type, scope_id, relation, via_entity_id
    ) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const entity of byId.values()) {
    if (entityIds !== null && !entityIds.has(entity.id)) continue;
    for (const scope of deriveEntityScopes(entity, byId)) {
      insert.run(
        scope.entityId,
        scope.scopeType,
        scope.scopeId,
        scope.relation,
        scope.viaEntityId,
      );
    }
  }
};

export const rebuildEntityScopes = (index: IndexDatabase): void => {
  index.database.prepare("DELETE FROM entity_scopes").run();
  insertScopes(index, null);
};

export const collectScopeDependents = (
  index: IndexDatabase,
  seedEntityIds: ReadonlySet<string>,
): ReadonlySet<string> => {
  if (seedEntityIds.size === 0) return new Set();
  const rows = index.database
    .prepare(
      `WITH RECURSIVE affected(id) AS (
         SELECT value FROM json_each(?)
         UNION
         SELECT entities.id
         FROM entities
         JOIN affected
           ON entities.project_id = affected.id
           OR entities.task_id = affected.id
       )
       SELECT id FROM affected`,
    )
    .all(JSON.stringify([...seedEntityIds])) as Array<{
    readonly id: string;
  }>;
  return new Set(rows.map(({ id }) => id));
};

export const refreshEntityScopes = (
  index: IndexDatabase,
  entityIds: ReadonlySet<string>,
): void => {
  const remove = index.database.prepare(
    "DELETE FROM entity_scopes WHERE entity_id = ?",
  );
  for (const entityId of entityIds) remove.run(entityId);
  insertScopes(index, entityIds);
};
