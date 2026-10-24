import { RESOURCE_TYPES } from "@pkm/contracts";
import { entityDateRangeFields } from "./date-range.js";
import { z } from "zod";
import {
  descriptionSchema,
  entityIdSchema,
  resourceAuthorsSchema,
  resourceRelatedIdsSchema,
} from "./entity-schema.js";
import {
  ENTITY_TYPES,
  ENTITY_ID_PREFIXES,
  PRIORITIES,
  STATUSES,
  MAX_ASSET_BYTES,
} from "@pkm/contracts";

const name = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((s) => !/[\r\n]/.test(s));
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const topics = z
  .array(entityIdSchema.refine((s) => s.startsWith("topic_")))
  .max(100);
const contextId = (type: "area" | "project" | "task" | "resource") =>
  entityIdSchema.refine((s) => s.startsWith(`${ENTITY_ID_PREFIXES[type]}_`));
export const agentContextsSchema = z.strictObject({
  area: contextId("area").nullable().optional(),
  project: contextId("project").nullable().optional(),
  task: contextId("task").nullable().optional(),
  resource: contextId("resource").nullable().optional(),
});
export const agentEntryPatchSchema = z.strictObject({
  displayName: name.nullable().optional(),
  body: z
    .string()
    .max(256 * 1024)
    .optional(),
  journalDate: z.iso.date().nullable().optional(),
  occurredAt: z
    .union([z.iso.date(), z.iso.datetime({ offset: true })])
    .nullable()
    .optional(),
  entryContexts: agentContextsSchema.nullable().optional(),
});
export const agentTaskPatchSchema = z.strictObject({
  displayName: name.optional(),
  body: agentEntryPatchSchema.shape.body,
  description: z.string().max(20_000).nullable().optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).nullable().optional(),
  projectId: contextId("project").nullable().optional(),
  areaId: contextId("area").nullable().optional(),
  dueAt: z
    .union([z.iso.date(), z.iso.datetime({ offset: true })])
    .nullable()
    .optional(),
});
const namedFields = {
  displayName: name.optional(),
  body: agentEntryPatchSchema.shape.body,
  description: descriptionSchema.refine(
    (value) => value == null || value.length <= 20_000,
  ),
};
export const agentProjectPatchSchema = z.strictObject({
  ...namedFields,
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).nullable().optional(),
  areaId: contextId("area").nullable().optional(),
});
export const agentResourcePatchSchema = z.strictObject({
  ...namedFields,
  authors: resourceAuthorsSchema,
  relatedEntityIds: resourceRelatedIdsSchema,
  resourceType: z.enum(RESOURCE_TYPES).nullable().optional(),
  canonicalIdentifier: z.string().max(20_000).nullable().optional(),
  sourceUri: z.url().max(20_000).nullable().optional(),
  assetPath: z
    .string()
    .regex(/^assets\/(images|files)\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/)
    .nullable()
    .optional(),
});
export const agentTopicPatchSchema = z.strictObject(namedFields);
export const agentAreaPatchSchema = z.strictObject(namedFields);
const operation = {
  operationId: z
    .string()
    .min(8)
    .max(200)
    .regex(/^[a-zA-Z0-9_.:-]+$/),
};
const update = {
  ...operation,
  entityId: entityIdSchema,
  expectedFileHash: hash,
};
export const agentAssetUploadSchema = z.strictObject({
  ...operation,
  fileName: z.string().min(1).max(255),
  dataBase64: z
    .string()
    .min(1)
    .max(Math.ceil(MAX_ASSET_BYTES / 3) * 4),
});
export const agentCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("create_entry"),
    ...operation,
    displayName: name.nullable().default(null),
    body: z
      .string()
      .max(256 * 1024)
      .default(""),
    journalDate: z.iso.date().optional(),
    contexts: agentContextsSchema.optional(),
    topics: topics.default([]),
    sourceEntityIds: z.array(entityIdSchema).max(100).default([]),
  }),
  z.strictObject({
    kind: z.literal("create_task"),
    ...operation,
    ...agentTaskPatchSchema.shape,
    displayName: name,
    topics: topics.default([]),
  }),
  z.strictObject({
    kind: z.literal("create_project"),
    ...operation,
    ...agentProjectPatchSchema.shape,
    displayName: name,
    topics: topics.default([]),
  }),
  z.strictObject({
    kind: z.literal("create_resource"),
    ...operation,
    ...agentResourcePatchSchema.shape,
    displayName: name,
    topics: topics.default([]),
  }),
  z.strictObject({
    kind: z.literal("create_topic"),
    ...operation,
    ...agentTopicPatchSchema.shape,
    displayName: name,
  }),
  z.strictObject({
    kind: z.literal("create_area"),
    ...operation,
    ...agentAreaPatchSchema.shape,
    displayName: name,
    topics: topics.default([]),
  }),
  z.strictObject({
    kind: z.literal("update_entry"),
    ...update,
    patch: agentEntryPatchSchema,
  }),
  z.strictObject({
    kind: z.literal("update_task"),
    ...update,
    patch: agentTaskPatchSchema,
  }),
  z.strictObject({
    kind: z.literal("update_project"),
    ...update,
    patch: agentProjectPatchSchema,
  }),
  z.strictObject({
    kind: z.literal("update_resource"),
    ...update,
    patch: agentResourcePatchSchema,
  }),
  z.strictObject({
    kind: z.literal("update_topic"),
    ...update,
    patch: agentTopicPatchSchema,
  }),
  z.strictObject({
    kind: z.literal("update_area"),
    ...update,
    patch: agentAreaPatchSchema,
  }),
  z.strictObject({
    kind: z.literal("update_topics"),
    ...update,
    add: topics.default([]),
    remove: topics.default([]),
  }),
  z.strictObject({
    kind: z.literal("set_entry_context"),
    ...update,
    contexts: agentContextsSchema.nullable(),
  }),
]);
export type AgentCommand = z.infer<typeof agentCommandSchema>;
export const agentQuerySchema = z.strictObject({
  ...entityDateRangeFields,
  q: z.string().max(1000).optional(),
  type: z.enum(ENTITY_TYPES).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  projectId: contextId("project").optional(),
  areaId: contextId("area").optional(),
  topicIds: topics.optional(),
  scopeType: z.enum(["area", "project", "task", "resource"]).optional(),
  scopeId: entityIdSchema.optional(),
  relatedTo: entityIdSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().max(2000).optional(),
  sort: z.enum(["name", "updatedAt", "createdAt"]).default("updatedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});
