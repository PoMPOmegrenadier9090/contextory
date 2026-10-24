/** Bounded hierarchy traversal; explicit contexts are independent edges here. */
export const entryRelationCte = (scoped: boolean, forAi: boolean): string => {
  const visible = (alias: string) =>
    `${alias}.deleted_at IS NULL${
      forAi
        ? ` AND ${alias}.exclude_from_ai=0 AND NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.canonical_entity_path=${alias}.path)`
        : ""
    }`;
  return `WITH RECURSIVE entry_contexts(id,type,path,depth) AS (
    SELECT id,type,json_array(id),0 FROM entities root
    WHERE id=@relatedTo AND ${visible("root")}
    UNION ALL
    SELECT child.id,child.type,json_insert(parent.path,'$[#]',child.id),parent.depth+1
    FROM entry_contexts parent JOIN entities child ON child.area_id=parent.id
    WHERE parent.type='area' AND child.type IN ('project','task')
      AND ${scoped ? "parent.depth<2" : "0"} AND ${visible("child")}
    UNION ALL
    SELECT child.id,child.type,json_insert(parent.path,'$[#]',child.id),parent.depth+1
    FROM entry_contexts parent JOIN entities child ON child.project_id=parent.id
    WHERE parent.type='project' AND child.type='task'
      AND ${scoped ? "parent.depth<2" : "0"} AND ${visible("child")}
  ), entry_matches(entry_id,path,depth) AS (
    SELECT e.id,s.path,s.depth FROM entry_contexts s JOIN entities e ON e.area_id=s.id WHERE s.type='area' AND e.type='entry'
    UNION
    SELECT e.id,s.path,s.depth FROM entry_contexts s JOIN entities e ON e.project_id=s.id WHERE s.type='project' AND e.type='entry'
    UNION
    SELECT e.id,s.path,s.depth FROM entry_contexts s JOIN entities e ON e.task_id=s.id WHERE s.type='task' AND e.type='entry'
    UNION
    SELECT e.id,s.path,s.depth FROM entry_contexts s JOIN entities e ON e.resource_id=s.id WHERE s.type='resource' AND e.type='entry'
    UNION
    SELECT t.entity_id,s.path,s.depth FROM entry_contexts s JOIN entity_topics t ON t.topic_id=s.id WHERE s.type='topic'
    UNION
    SELECT r.source_id,s.path,s.depth FROM entry_contexts s JOIN entity_references r ON r.target_id=s.id WHERE r.reference_kind='direct'
    UNION
    SELECT r.target_id,s.path,s.depth FROM entry_contexts s JOIN entity_references r ON r.source_id=s.id WHERE s.type='resource' AND r.reference_kind='related'
  )`;
};
