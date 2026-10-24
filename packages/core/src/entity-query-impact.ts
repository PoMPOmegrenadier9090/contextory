import type {
  EntityPage,
  EntityPageQuery,
  PkmIndexChanges,
} from "@pkm/contracts";

// Dependencies include labels. Membership checks use old AND new scopes from the event,
// so a newly matching Entity invalidates pages that have never contained its ID.
export const entityQueryAffected = (
  query: EntityPageQuery,
  changes: PkmIndexChanges,
  page?: EntityPage,
): boolean => {
  if (changes.reset) return true;
  const ids = new Set(changes.entities.map((e) => e.id));
  if (page?.included?.some((e) => ids.has(e.id))) return true;
  if (query.ids) return query.ids.some((id) => ids.has(id));
  if (query.relatedResolution === "transitive")
    return changes.entities.length > 0;
  if (query.relatedTo)
    return (
      ids.has(query.relatedTo) ||
      page?.items.some((entity) => ids.has(entity.id)) ||
      page?.items.some((entity) =>
        entity.entryRelation?.path.some((node) => ids.has(node.id)),
      ) ||
      changes.scopeIds.includes(query.relatedTo) ||
      changes.backlinkIds.includes(query.relatedTo)
    );
  if (query.type && !changes.types.includes(query.type)) return false;
  if (query.types && !query.types.some((type) => changes.types.includes(type)))
    return false;
  if (query.scopeId && !changes.scopeIds.includes(query.scopeId)) return false;
  if (query.areaId && !changes.scopeIds.includes(query.areaId)) return false;
  if (query.projectId && !changes.scopeIds.includes(query.projectId))
    return false;
  if (
    query.topicIds?.length &&
    !query.topicIds.some((id) => changes.scopeIds.includes(id))
  )
    return false;
  return changes.entities.length > 0;
};
