import type {
  AreaId,
  EntryContexts,
  Priority,
  ResourceType,
  ProjectId,
  Status,
  TopicId,
} from "@pkm/contracts";

import { entitySchema, type ParsedEntity } from "./entity-schema.js";
import { requireJournalDate } from "./journal-date.js";
import { parseMarkdownEntity } from "./markdown-parser.js";
import { serializeMarkdownEntity } from "./markdown-serializer.js";

export interface EntityMetadataPatch {
  readonly authors?: readonly string[] | null;
  readonly relatedEntityIds?: readonly string[] | null;
  readonly description?: string | null;
  readonly displayName?: string | null;
  readonly status?: Status;
  readonly priority?: Priority | null;
  readonly excludeFromAi?: boolean;
  readonly areaId?: AreaId | null;
  readonly projectId?: ProjectId | null;
  readonly topics?: readonly TopicId[] | null;
  readonly entryContexts?: EntryContexts | null;
  readonly resourceType?: ResourceType | null;
  readonly canonicalIdentifier?: string | null;
  readonly sourceUri?: string | null;
  readonly assetPath?: string | null;
  readonly journalDate?: string | null;
  readonly dueAt?: string | null;
  readonly occurredAt?: string | null;
  readonly deletedAt?: string | null;
}

export interface UpdateEntityMetadataOptions {
  readonly now?: () => Date;
}

export interface UpdatedEntityMetadata {
  readonly content: string;
  readonly entity: ParsedEntity;
}

export const normalizeEntityDisplayName = (
  value: string,
  allowEmpty = false,
): string => {
  const normalized = value.trim();
  if (!allowEmpty && normalized.length === 0) {
    throw new TypeError("Entity display name must not be empty");
  }
  if (/\r|\n/.test(normalized)) {
    throw new TypeError("Entity display name must be a single line");
  }
  return normalized;
};

export const updateEntityMetadata = (
  source: string,
  patch: EntityMetadataPatch,
  options: UpdateEntityMetadataOptions = {},
): UpdatedEntityMetadata => {
  const parsed = parseMarkdownEntity(source);
  if (!parsed.ok) {
    throw new Error(
      `Cannot edit metadata in invalid Entity Markdown: ${parsed.error.message}`,
    );
  }

  const current = parsed.value.entity;
  const next: Record<string, unknown> = { ...current };

  if (patch.description !== undefined) {
    if (current.type === "entry")
      throw new TypeError("Entry does not have a description field");
    next.description = patch.description;
  }

  if (patch.displayName !== undefined) {
    switch (current.type) {
      case "entry":
        next.title =
          patch.displayName === null || patch.displayName.trim() === ""
            ? null
            : normalizeEntityDisplayName(patch.displayName);
        break;
      case "project":
      case "task":
      case "resource":
        next.title = normalizeEntityDisplayName(patch.displayName ?? "", true);
        break;
      case "topic":
      case "area":
        next.name = normalizeEntityDisplayName(patch.displayName ?? "", true);
        break;
    }
  }

  if (patch.status !== undefined) {
    if (current.type !== "project" && current.type !== "task") {
      throw new TypeError(`${current.type} does not have a status field`);
    }
    if (patch.status !== current.status) {
      if (patch.status === "done") {
        next.completed_at =
          current.completed_at ??
          (options.now ?? (() => new Date()))().toISOString();
      } else if (current.status === "done") {
        next.completed_at = null;
      }
    }
    next.status = patch.status;
  }

  if (patch.priority !== undefined) {
    if (current.type !== "project" && current.type !== "task") {
      throw new TypeError(`${current.type} does not have a priority field`);
    }
    next.priority = patch.priority;
  }

  if (patch.excludeFromAi !== undefined) {
    if (current.type !== "entry") {
      throw new TypeError(
        `${current.type} does not have an exclude_from_ai field`,
      );
    }
    next.exclude_from_ai = patch.excludeFromAi;
  }

  if (patch.areaId !== undefined) {
    if (current.type !== "project" && current.type !== "task") {
      throw new TypeError(`${current.type} does not have an area_id field`);
    }
    next.area_id = patch.areaId;
  }

  if (patch.projectId !== undefined) {
    if (current.type !== "task") {
      throw new TypeError(`${current.type} does not have a project_id field`);
    }
    next.project_id = patch.projectId;
    if (patch.projectId !== null) next.area_id = null;
  }

  if (patch.topics !== undefined) {
    if (current.type === "topic") {
      throw new TypeError("topic does not have a topics field");
    }
    next.topics = patch.topics;
  }

  if (patch.entryContexts !== undefined) {
    if (current.type !== "entry") {
      throw new TypeError(`${current.type} does not have a contexts field`);
    }
    next.contexts = patch.entryContexts;
  }

  if (patch.authors !== undefined || patch.relatedEntityIds !== undefined) {
    if (current.type !== "resource")
      throw new TypeError(
        `${current.type} does not have Resource authors or related entities`,
      );
    if (patch.authors !== undefined) next.authors = patch.authors;
    if (patch.relatedEntityIds !== undefined)
      next.related_entity_ids = patch.relatedEntityIds;
  }

  if (patch.resourceType !== undefined) {
    if (current.type !== "resource")
      throw new TypeError(
        `${current.type} does not have a resource_type field`,
      );
    next.resource_type = patch.resourceType;
  }
  if (patch.canonicalIdentifier !== undefined) {
    if (current.type !== "resource") {
      throw new TypeError(
        `${current.type} does not have a canonical_identifier field`,
      );
    }
    next.canonical_identifier = patch.canonicalIdentifier;
  }

  if (patch.sourceUri !== undefined) {
    if (current.type !== "resource") {
      throw new TypeError(`${current.type} does not have a source_uri field`);
    }
    next.source_uri = patch.sourceUri;
  }

  if (patch.assetPath !== undefined) {
    if (current.type !== "resource") {
      throw new TypeError(`${current.type} does not have an asset_path field`);
    }
    next.asset_path = patch.assetPath;
  }

  if (patch.journalDate !== undefined) {
    if (current.type !== "entry") {
      throw new TypeError(`${current.type} does not have a journal_date field`);
    }
    next.journal_date =
      patch.journalDate === null ? null : requireJournalDate(patch.journalDate);
  }

  if (patch.occurredAt !== undefined) {
    if (current.type !== "entry") {
      throw new TypeError(`${current.type} does not have an occurred_at field`);
    }
    next.occurred_at = patch.occurredAt;
  }

  if (patch.dueAt !== undefined) {
    if (current.type !== "task") {
      throw new TypeError(`${current.type} does not have a due_at field`);
    }
    next.due_at = patch.dueAt;
  }

  if (patch.deletedAt !== undefined) {
    next.deleted_at = patch.deletedAt;
  }

  const entity = entitySchema.safeParse(next);
  if (!entity.success) {
    throw new TypeError(
      `Metadata update is invalid: ${entity.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  return {
    content: serializeMarkdownEntity(parsed.value, { entity: entity.data }),
    entity: entity.data,
  };
};
