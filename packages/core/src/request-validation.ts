import { RESOURCE_TYPES } from "@pkm/contracts";
import type { PkmMetadataPatch } from "@pkm/contracts";
import { z } from "zod";
import type {
  CreateEntityRequest,
  PkmAssetUpload,
  PkmOrphanAsset,
  ResolveEntityConflictRequest,
  ResolveSyncthingConflictRequest,
  SaveEntityDocumentRequest,
  PermanentlyDeleteEntityRequest,
  SaveEntityDraftRequest,
  SaveSyncthingConflictDraftRequest,
} from "@pkm/contracts";
import { ENTITY_TYPES, type EntityType } from "@pkm/contracts";
import {
  resourceAuthorsSchema,
  resourceRelatedIdsSchema,
  descriptionSchema,
} from "./entity-schema.js";
import { requireJournalDate } from "./journal-date.js";

export const requireRequestString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
};

export const requireRequestRecord = (
  value: unknown,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Request body must be an object");
  }
  return value as Record<string, unknown>;
};

export const requireFileHash = (value: unknown): `sha256:${string}` => {
  const hash = requireRequestString(value, "expected file hash");
  if (!/^sha256:[0-9a-f]{64}$/i.test(hash)) {
    throw new TypeError("expected file hash must be a SHA-256 hash");
  }
  return hash as `sha256:${string}`;
};

export const requireNullableFileHash = (
  value: unknown,
): `sha256:${string}` | null =>
  value === null ? null : requireFileHash(value);

const requireEntityType = (value: unknown): EntityType => {
  if (!ENTITY_TYPES.some((type) => type === value)) {
    throw new TypeError("type must be a supported Entity type");
  }
  return value as EntityType;
};

export const parseCreateEntityRequest = (
  value: unknown,
): CreateEntityRequest => {
  const request = requireRequestRecord(value);
  const type = requireEntityType(request.type);
  if (request.body !== undefined && typeof request.body !== "string") {
    throw new TypeError("body must be a Markdown string");
  }
  if (request.journalDate !== undefined && type !== "entry") {
    throw new TypeError("Only Entry can have a journal date");
  }
  const description =
    request.description === undefined
      ? undefined
      : descriptionSchema.safeParse(request.description);
  if (description !== undefined && (!description.success || type === "entry"))
    throw new TypeError(
      "description must be a single-line string or null on a non-Entry Entity",
    );
  return {
    type,
    ...(request.topicNames === undefined
      ? {}
      : {
          topicNames: z
            .array(z.string().trim().min(1).max(512))
            .max(100)
            .parse(request.topicNames),
        }),
    ...(request.metadata === undefined
      ? {}
      : { metadata: parseMetadataPatch(request.metadata) }),
    ...(description?.success ? { description: description.data ?? null } : {}),
    displayName:
      request.displayName === null && type === "entry"
        ? null
        : z.string().parse(request.displayName),
    ...(request.body === undefined ? {} : { body: request.body }),
    ...(request.journalDate === undefined
      ? {}
      : {
          journalDate: requireJournalDate(
            requireRequestString(request.journalDate, "journalDate"),
          ),
        }),
  };
};

export const parseCreateAssetRequest = (value: unknown): PkmAssetUpload => {
  const request = requireRequestRecord(value);
  return {
    fileName: requireRequestString(request.fileName, "fileName"),
    dataBase64: requireRequestString(request.dataBase64, "dataBase64"),
  };
};

export const parseOrphanAssetDeletion = (
  value: unknown,
): readonly Pick<PkmOrphanAsset, "path" | "hash">[] => {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new TypeError("assets must be an array of at most 1000 items");
  }
  return value.map((item: unknown) => {
    const asset = requireRequestRecord(item);
    return {
      path: requireRequestString(asset.path, "path"),
      hash: requireFileHash(asset.hash),
    };
  });
};

export const parseResolveEntityConflictRequest = (
  value: unknown,
): ResolveEntityConflictRequest => {
  const request = requireRequestRecord(value);
  if (
    request.resolution !== "keep-external" &&
    request.resolution !== "keep-draft"
  ) {
    throw new TypeError("resolution must be keep-external or keep-draft");
  }
  if (request.content !== undefined && typeof request.content !== "string")
    throw new TypeError("content must be a string");
  return {
    ...(typeof request.content === "string"
      ? { content: request.content }
      : {}),
    entityId: requireRequestString(request.entityId, "entityId"),
    resolution: request.resolution,
    expectedExternalHash: requireNullableFileHash(request.expectedExternalHash),
  };
};

export const parseResolveSyncthingConflictRequest = (
  value: unknown,
): ResolveSyncthingConflictRequest => {
  const request = requireRequestRecord(value);
  if (
    request.resolution !== "keep-canonical" &&
    request.resolution !== "keep-conflict" &&
    request.resolution !== "manual"
  ) {
    throw new TypeError(
      "resolution must be keep-canonical, keep-conflict, or manual",
    );
  }
  if (request.content !== undefined && typeof request.content !== "string") {
    throw new TypeError("content must be a string");
  }
  if (request.resolution === "manual" && request.content === undefined) {
    throw new TypeError("Manual conflict resolution requires content");
  }
  return {
    conflictPath: requireRequestString(request.conflictPath, "conflictPath"),
    resolution: request.resolution,
    expectedCanonicalHash: requireNullableFileHash(
      request.expectedCanonicalHash,
    ),
    expectedConflictHash: requireFileHash(request.expectedConflictHash),
    ...(request.content === undefined ? {} : { content: request.content }),
  };
};

export const parseSaveSyncthingConflictDraftRequest = (
  value: unknown,
): SaveSyncthingConflictDraftRequest => {
  const request = requireRequestRecord(value);
  if (typeof request.content !== "string") {
    throw new TypeError("content must be a string");
  }
  return {
    conflictPath: requireRequestString(request.conflictPath, "conflictPath"),
    canonicalHash: requireNullableFileHash(request.canonicalHash),
    conflictHash: requireFileHash(request.conflictHash),
    content: request.content,
  };
};

export const parsePermanentlyDeleteEntityRequest = (
  value: unknown,
): PermanentlyDeleteEntityRequest => {
  const request = requireRequestRecord(value);
  return {
    entityId: requireRequestString(request.entityId, "entityId"),
    expectedFileHash: requireFileHash(request.expectedFileHash),
  };
};

export const parseSaveEntityRequest = (
  value: unknown,
): SaveEntityDocumentRequest => {
  const request = requireRequestRecord(value);
  return {
    entityId: requireRequestString(request.entityId, "entityId"),
    content: requireRequestString(request.content, "content"),
    expectedFileHash: requireFileHash(request.expectedFileHash),
  };
};

export const parseSaveDraftRequest = (
  value: unknown,
): SaveEntityDraftRequest => {
  const request = requireRequestRecord(value);
  if (typeof request.content !== "string")
    throw new TypeError("content must be a string");
  return {
    entityId: requireRequestString(request.entityId, "entityId"),
    content: request.content,
    baseHash: requireFileHash(request.baseHash),
  };
};

const metadataPatchSchema = z
  .object({
    authors: resourceAuthorsSchema,
    relatedEntityIds: resourceRelatedIdsSchema,
    description: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    status: z
      .enum(["not_started", "in_progress", "on_hold", "done"])
      .optional(),
    priority: z
      .enum(["lowest", "low", "normal", "high", "highest"])
      .nullable()
      .optional(),
    excludeFromAi: z.boolean().optional(),
    areaId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
    topics: z.array(z.string()).max(100).nullable().optional(),
    entryContexts: z
      .object({
        area: z.string().nullable().optional(),
        project: z.string().nullable().optional(),
        task: z.string().nullable().optional(),
        resource: z.string().nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    resourceType: z.enum(RESOURCE_TYPES).nullable().optional(),
    canonicalIdentifier: z.string().nullable().optional(),
    sourceUri: z.string().nullable().optional(),
    assetPath: z.string().nullable().optional(),
    journalDate: z.string().nullable().optional(),
    dueAt: z.string().nullable().optional(),
    occurredAt: z.string().nullable().optional(),
    deletedAt: z.string().nullable().optional(),
  })
  .strict();
export const parseMetadataPatch = (input: unknown): PkmMetadataPatch => {
  const result = metadataPatchSchema.safeParse(input);
  if (!result.success)
    throw new TypeError(`Invalid metadata patch: ${result.error.message}`);
  return result.data as PkmMetadataPatch;
};
