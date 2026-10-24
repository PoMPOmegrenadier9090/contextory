import {
  ENTITY_DIRECTORIES,
  ENTITY_ID_PREFIXES,
  ENTITY_TYPES,
  type EntityId,
  type EntityType,
} from "@pkm/contracts";
import type { ZodIssue } from "zod";
import { parseMarkdownBody } from "./markdown-body.js";
import {
  extractMarkdownTodos,
  type MarkdownTodoItem,
} from "./markdown-todos.js";
import { markdownToPlainText } from "./markdown-plain-text.js";

import {
  analyzeDirectReferences,
  type DirectReference,
} from "./direct-reference.js";
import { getEntityDisplayName } from "./display-name.js";
import type { ParsedEntity } from "./entity-schema.js";
import {
  parseMarkdownEntity,
  type MarkdownParseError,
  type ParsedMarkdownEntity,
} from "./markdown-parser.js";

export type ValidationSeverity = "error" | "warning";

export type ValidationIssueCode =
  | "ParseError"
  | "MissingField"
  | "InvalidType"
  | "InvalidValue"
  | "DuplicateId"
  | "IdentityMismatch"
  | "UnresolvedReference"
  | "UnsupportedTableReference"
  | "MissingVaultConfig"
  | "InvalidVaultConfig"
  | "UnsupportedSchemaVersion";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly severity: ValidationSeverity;
  readonly message: string;
  readonly filePath: string;
  readonly entityId?: string;
  readonly targetId?: string;
  readonly fieldPath?: readonly (string | number)[];
  readonly startOffset?: number;
  readonly endOffset?: number;
}

export interface VaultSourceFile {
  readonly path: string;
  readonly source: string;
}

export interface ValidEntityFile {
  readonly ok: true;
  readonly file: VaultSourceFile;
  readonly parsed: ParsedMarkdownEntity;
  readonly todos: readonly MarkdownTodoItem[];
  readonly plainText: string;
  readonly displayName: string | null;
  readonly references: readonly DirectReference[];
  readonly issues: readonly ValidationIssue[];
}

export interface InvalidEntityFile {
  readonly ok: false;
  readonly file: VaultSourceFile;
  readonly issues: readonly ValidationIssue[];
}

export type EntityFileValidation = ValidEntityFile | InvalidEntityFile;

export interface VaultValidationResult {
  readonly files: readonly EntityFileValidation[];
  readonly issues: readonly ValidationIssue[];
}

export type EntityReferenceKind =
  "topic" | "context" | "parent" | "source" | "related";

export interface EntityReferenceTarget {
  readonly targetId: string;
  readonly targetType: EntityType;
  readonly kind: EntityReferenceKind | "direct";
  readonly fieldPath?: readonly (string | number)[];
  readonly startOffset?: number;
  readonly endOffset?: number;
}

const entityTypeFromId = (targetId: string): EntityType => {
  for (const type of ENTITY_TYPES) {
    if (targetId.startsWith(`${ENTITY_ID_PREFIXES[type]}_`)) return type;
  }
  throw new Error(`Unknown Entity ID prefix: ${targetId}`);
};

const pathSegments = (path: string): readonly string[] =>
  path.replaceAll("\\", "/").split("/").filter(Boolean);

const identityIssue = (
  filePath: string,
  entity: ParsedEntity,
): ValidationIssue | null => {
  const segments = pathSegments(filePath);
  const fileName = segments.at(-1);
  const directory = segments.at(-2);
  const expectedDirectory = ENTITY_DIRECTORIES[entity.type];
  const expectedFileName = `${entity.id}.md`;
  if (directory === expectedDirectory && fileName === expectedFileName) {
    return null;
  }
  return {
    code: "IdentityMismatch",
    severity: "error",
    message: `Expected ${expectedDirectory}/${expectedFileName}, received ${filePath}`,
    filePath,
    entityId: entity.id,
  };
};

const hasPath = (value: unknown, path: readonly PropertyKey[]): boolean => {
  let current = value;
  for (const part of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.hasOwn(current, part)
    ) {
      return false;
    }
    current = (current as Record<PropertyKey, unknown>)[part];
  }
  return true;
};

const normalizeIssuePath = (issue: ZodIssue): readonly (string | number)[] =>
  issue.path.filter(
    (part): part is string | number =>
      typeof part === "string" || typeof part === "number",
  );

const zodIssueCode = (
  issue: ZodIssue,
  frontmatter: unknown,
): "MissingField" | "InvalidType" | "InvalidValue" => {
  if (issue.path.length > 0 && !hasPath(frontmatter, issue.path)) {
    return "MissingField";
  }
  return issue.code === "invalid_type" ? "InvalidType" : "InvalidValue";
};

const parseIssues = (
  filePath: string,
  error: MarkdownParseError,
): readonly ValidationIssue[] => {
  if (error.code !== "INVALID_ENTITY" || error.issues === undefined) {
    return [
      {
        code: "ParseError",
        severity: "error",
        message: error.message,
        filePath,
      },
    ];
  }

  return error.issues.map((issue) => ({
    code: zodIssueCode(issue, error.frontmatter),
    severity: "error",
    message: issue.message,
    filePath,
    fieldPath: normalizeIssuePath(issue),
  }));
};

export const validateEntityFile = (
  file: VaultSourceFile,
): EntityFileValidation => {
  const result = parseMarkdownEntity(file.source);
  if (!result.ok) {
    return { ok: false, file, issues: parseIssues(file.path, result.error) };
  }

  const parsed = result.value;
  const displayName = getEntityDisplayName(parsed.entity);
  const markdownTree = parseMarkdownBody(parsed.body);
  const referenceAnalysis = analyzeDirectReferences(parsed.body, markdownTree);
  const issues: ValidationIssue[] = [];
  const mismatch = identityIssue(file.path, parsed.entity);
  if (mismatch !== null) {
    issues.push(mismatch);
  }
  for (const issue of referenceAnalysis.issues) {
    issues.push({
      code: "UnsupportedTableReference",
      severity: "warning",
      message: issue.message,
      filePath: file.path,
      entityId: parsed.entity.id,
      startOffset: issue.startOffset,
      endOffset: issue.endOffset,
    });
  }

  return {
    ok: true,
    file,
    parsed,
    todos:
      parsed.entity.type === "entry"
        ? extractMarkdownTodos(parsed.body, markdownTree)
        : [],
    plainText: markdownToPlainText(parsed.body, markdownTree),
    displayName,
    references: referenceAnalysis.references,
    issues,
  };
};

const fieldReference = (
  targetId: string | null | undefined,
  kind: EntityReferenceKind,
  ...fieldPath: readonly (string | number)[]
): readonly EntityReferenceTarget[] =>
  targetId == null
    ? []
    : [{ targetId, targetType: entityTypeFromId(targetId), kind, fieldPath }];

const arrayReferences = (
  targetIds: readonly string[] | null | undefined,
  kind: EntityReferenceKind,
  fieldName: string,
): readonly EntityReferenceTarget[] =>
  targetIds?.map((targetId, index) => ({
    targetId,
    targetType: entityTypeFromId(targetId),
    kind,
    fieldPath: [fieldName, index],
  })) ?? [];

export const collectEntityReferences = (
  entity: ParsedEntity,
): readonly EntityReferenceTarget[] => {
  const references: EntityReferenceTarget[] = [];
  const topics =
    "topics" in entity && Array.isArray(entity.topics)
      ? entity.topics.filter(
          (topic): topic is string => typeof topic === "string",
        )
      : undefined;
  if (topics !== undefined) {
    references.push(...arrayReferences(topics, "topic", "topics"));
  }

  switch (entity.type) {
    case "entry":
      references.push(
        ...fieldReference(entity.contexts?.area, "context", "contexts", "area"),
        ...fieldReference(
          entity.contexts?.project,
          "context",
          "contexts",
          "project",
        ),
        ...fieldReference(entity.contexts?.task, "context", "contexts", "task"),
        ...fieldReference(
          entity.contexts?.resource,
          "context",
          "contexts",
          "resource",
        ),
        ...arrayReferences(
          entity.source_entity_ids,
          "source",
          "source_entity_ids",
        ),
      );
      break;
    case "project":
      references.push(...fieldReference(entity.area_id, "parent", "area_id"));
      break;
    case "task":
      references.push(
        ...fieldReference(entity.project_id, "parent", "project_id"),
        ...fieldReference(entity.area_id, "parent", "area_id"),
      );
      break;
    case "resource":
      references.push(
        ...arrayReferences(
          entity.related_entity_ids,
          "related",
          "related_entity_ids",
        ),
      );
      break;
    case "topic":
    case "area":
      break;
  }
  return references;
};

export const validateVault = (
  sourceFiles: readonly VaultSourceFile[],
): VaultValidationResult => {
  const files = sourceFiles.map(validateEntityFile);
  const validFiles = files.filter((file): file is ValidEntityFile => file.ok);
  const issues: ValidationIssue[] = files.flatMap((file) => file.issues);
  const byId = new Map<string, ValidEntityFile[]>();

  for (const file of validFiles) {
    const id = file.parsed.entity.id;
    const duplicates = byId.get(id) ?? [];
    duplicates.push(file);
    byId.set(id, duplicates);
  }

  for (const [entityId, duplicates] of byId) {
    if (duplicates.length < 2) continue;
    for (const file of duplicates) {
      issues.push({
        code: "DuplicateId",
        severity: "error",
        message: `Entity ID ${entityId} occurs in ${duplicates.length} files`,
        filePath: file.file.path,
        entityId,
      });
    }
  }

  const knownIds = new Set<EntityId>(
    validFiles.map((file) => file.parsed.entity.id as EntityId),
  );
  for (const file of validFiles) {
    const entity = file.parsed.entity;
    const frontmatterReferences = collectEntityReferences(entity);
    const bodyReferences: readonly EntityReferenceTarget[] =
      file.references.map((reference) => ({
        targetId: reference.targetId,
        targetType: reference.targetType,
        kind: "direct",
        startOffset: reference.startOffset,
        endOffset: reference.endOffset,
      }));
    for (const reference of [...frontmatterReferences, ...bodyReferences]) {
      if (knownIds.has(reference.targetId as EntityId)) continue;
      issues.push({
        code: "UnresolvedReference",
        severity: "warning",
        message: `Referenced entity ${reference.targetId} does not exist`,
        filePath: file.file.path,
        entityId: entity.id,
        targetId: reference.targetId,
        ...(reference.fieldPath === undefined
          ? {}
          : { fieldPath: reference.fieldPath }),
        ...(reference.startOffset === undefined
          ? {}
          : { startOffset: reference.startOffset }),
        ...(reference.endOffset === undefined
          ? {}
          : { endOffset: reference.endOffset }),
      });
    }
  }

  return { files, issues };
};
