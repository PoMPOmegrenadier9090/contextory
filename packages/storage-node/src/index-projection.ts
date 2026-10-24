import {
  collectEntityReferences,
  type ParsedEntity,
  type ValidEntityFile,
  type ValidationIssue,
} from "@pkm/core";
import type { IndexDatabase } from "./index-database.js";
import { createSearchDocumentWriter, shortTerms } from "./search.js";
import { indexEntryTodos } from "./todo-index.js";

// The projection of a canonical Entity is shared by full rebuild and incremental sync.
// Callers own validation, deletion, scope refresh and the enclosing transaction.
interface EntityMetadata {
  readonly origin: string | null;
  readonly status: string | null;
  readonly priority: string | null;
  readonly projectId: string | null;
  readonly areaId: string | null;
  readonly taskId: string | null;
  readonly resourceId: string | null;
  readonly resourceType: string | null;
  readonly canonicalIdentifier: string | null;
  readonly sourceUri: string | null;
  readonly assetPath: string | null;
  readonly journalDate: string | null;
  readonly occurredAt: string | null;
  readonly dueAt: string | null;
  readonly excludeFromAi: number;
}

const entityMetadata = (entity: ParsedEntity): EntityMetadata => {
  let status: string | null = null;
  let origin: string | null = null;
  let priority: string | null = null;
  let projectId: string | null = null;
  let areaId: string | null = null;
  let taskId: string | null = null;
  let resourceId: string | null = null;
  let resourceType: string | null = null;
  let canonicalIdentifier: string | null = null;
  let sourceUri: string | null = null;
  let assetPath: string | null = null;
  let journalDate: string | null = null;
  let occurredAt: string | null = null;
  let dueAt: string | null = null;
  let excludeFromAi = 0;

  switch (entity.type) {
    case "entry":
      origin = entity.origin;
      projectId = entity.contexts?.project ?? null;
      areaId = entity.contexts?.area ?? null;
      taskId = entity.contexts?.task ?? null;
      resourceId = entity.contexts?.resource ?? null;
      excludeFromAi = entity.exclude_from_ai ? 1 : 0;
      journalDate = entity.journal_date ?? null;
      occurredAt = entity.occurred_at ?? null;
      break;
    case "project":
      status = entity.status;
      priority = entity.priority ?? null;
      areaId = entity.area_id ?? null;
      break;
    case "task":
      dueAt = entity.due_at ?? null;
      status = entity.status;
      priority = entity.priority ?? null;
      projectId = entity.project_id ?? null;
      areaId = entity.area_id ?? null;
      break;
    case "resource":
      resourceType = entity.resource_type ?? null;
      canonicalIdentifier = entity.canonical_identifier ?? null;
      sourceUri = entity.source_uri ?? null;
      assetPath = entity.asset_path ?? null;
      break;
    case "topic":
    case "area":
      break;
  }
  return {
    origin,
    status,
    priority,
    projectId,
    areaId,
    taskId,
    resourceId,
    resourceType,
    canonicalIdentifier,
    sourceUri,
    assetPath,
    journalDate,
    occurredAt,
    dueAt,
    excludeFromAi,
  };
};

const entityTopics = (entity: ParsedEntity): readonly string[] => {
  if (!("topics" in entity) || !Array.isArray(entity.topics)) return [];
  return entity.topics.filter(
    (topic): topic is string => typeof topic === "string",
  );
};

export const createIndexProjectionWriter = (index: IndexDatabase) => {
  const insertIssueStatement = index.database
    .prepare(`INSERT INTO validation_issues (
        file_path, entity_id, target_id, code, severity, message,
        field_path, start_offset, end_offset
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertEntityStatement = index.database.prepare(`INSERT INTO entities (
        id, type, path, display_name, description, authors, related_entity_ids, name_key, origin, status, priority,
        project_id, area_id, task_id, resource_id,
        resource_type, canonical_identifier, source_uri, asset_path, journal_date, occurred_at, due_at,
        created_at, updated_at, deleted_at, exclude_from_ai, body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const entityRow = index.database.prepare(
    "SELECT rowid FROM entities WHERE id=?",
  );
  const insertNameShort = index.database.prepare(
    "INSERT INTO name_short_fts(rowid,terms) VALUES(?,?)",
  );
  const insertTopicStatement = index.database.prepare(
    "INSERT OR IGNORE INTO entity_topics (entity_id, topic_id) VALUES (?, ?)",
  );
  const insertReferenceStatement = index.database
    .prepare(`INSERT INTO entity_references (
      source_id, target_id, target_type, reference_kind, label,
      field_path, start_offset, end_offset
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const writeSearchDocument = createSearchDocumentWriter(index.database);
  const insertValidationIssue = (issue: ValidationIssue): void => {
    insertIssueStatement.run(
      issue.filePath,
      issue.entityId ?? null,
      issue.targetId ?? null,
      issue.code,
      issue.severity,
      issue.message,
      issue.fieldPath === undefined ? null : JSON.stringify(issue.fieldPath),
      issue.startOffset ?? null,
      issue.endOffset ?? null,
    );
  };

  const insertIndexedEntity = (file: ValidEntityFile): void => {
    const entity = file.parsed.entity;
    const metadata = entityMetadata(entity);
    insertEntityStatement.run(
      entity.id,
      entity.type,
      file.file.path,
      file.displayName,
      entity.type === "entry" ? null : (entity.description ?? null),
      JSON.stringify(entity.type === "resource" ? (entity.authors ?? []) : []),
      JSON.stringify(
        entity.type === "resource" ? (entity.related_entity_ids ?? []) : [],
      ),
      file.displayName?.normalize("NFKC").trim().toLocaleLowerCase("ja") ??
        null,
      metadata.origin,
      metadata.status,
      metadata.priority,
      metadata.projectId,
      metadata.areaId,
      metadata.taskId,
      metadata.resourceId,
      metadata.resourceType,
      metadata.canonicalIdentifier,
      metadata.sourceUri,
      metadata.assetPath,
      metadata.journalDate,
      metadata.occurredAt,
      metadata.dueAt === null || metadata.dueAt.length === 10
        ? metadata.dueAt
        : new Date(metadata.dueAt).toISOString(),
      new Date(entity.created_at).toISOString(),
      new Date(entity.updated_at).toISOString(),
      entity.deleted_at == null
        ? null
        : new Date(entity.deleted_at).toISOString(),
      metadata.excludeFromAi,
      file.parsed.body,
    );
    const row = entityRow.get(entity.id) as { rowid: number };
    insertNameShort.run(
      row.rowid,
      shortTerms(
        file.displayName?.normalize("NFKC").trim().toLocaleLowerCase("ja") ??
          "",
      ),
    );
    indexEntryTodos(index, file.parsed, file.todos);
    for (const topicId of entityTopics(entity)) {
      insertTopicStatement.run(entity.id, topicId);
    }
    for (const reference of collectEntityReferences(entity)) {
      insertReferenceStatement.run(
        entity.id,
        reference.targetId,
        reference.targetType,
        reference.kind,
        null,
        reference.fieldPath === undefined
          ? null
          : JSON.stringify(reference.fieldPath),
        null,
        null,
      );
    }
    for (const reference of file.references) {
      insertReferenceStatement.run(
        entity.id,
        reference.targetId,
        reference.targetType,
        "direct",
        reference.label,
        null,
        reference.startOffset,
        reference.endOffset,
      );
    }
    const searchContent = [
      file.displayName ?? "",
      ...(entity.type === "resource" ? (entity.authors ?? []) : []),
      file.plainText,
    ].join("\n");
    writeSearchDocument({ id: entity.id, content: searchContent });
  };

  return { insertEntity: insertIndexedEntity, insertValidationIssue };
};
export type IndexProjectionWriter = ReturnType<
  typeof createIndexProjectionWriter
>;
