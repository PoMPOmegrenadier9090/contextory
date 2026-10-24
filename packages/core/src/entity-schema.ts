import { RESOURCE_TYPES } from "@pkm/contracts";
import { z } from "zod";

import { requireJournalDate } from "./journal-date.js";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const prefixedId = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_${UUID_V7.source.slice(1, -1)}$`, "i"));

const entryIdSchema = prefixedId("ent");
const projectIdSchema = prefixedId("prj");
const taskIdSchema = prefixedId("tsk");
const resourceIdSchema = prefixedId("res");
const topicIdSchema = prefixedId("topic");
const areaIdSchema = prefixedId("area");

export const entityIdSchema = z.union([
  entryIdSchema,
  projectIdSchema,
  taskIdSchema,
  resourceIdSchema,
  topicIdSchema,
  areaIdSchema,
]);

const isoDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
    "Expected ISO 8601 datetime with timezone",
  )
  .refine((value) => {
    try {
      requireJournalDate(value.slice(0, 10));
      return Number.isFinite(Date.parse(value));
    } catch {
      return false;
    }
  }, "Expected valid ISO 8601 datetime");

const isoDateSchema = z.string().refine((value) => {
  try {
    requireJournalDate(value);
    return true;
  } catch {
    return false;
  }
}, "Expected valid ISO 8601 date");

const statusSchema = z.enum(["not_started", "in_progress", "on_hold", "done"]);

const prioritySchema = z.enum(["lowest", "low", "normal", "high", "highest"]);

const commonFields = {
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  deleted_at: isoDateTimeSchema.nullish(),
};

export const descriptionSchema = z
  .string()
  .refine(
    (value) => !/[\r\n\u2028\u2029]/u.test(value),
    "Description must be a single line",
  )
  .transform((value) => value.trim() || null)
  .nullish();

const topicAssignments = {
  topics: z.array(topicIdSchema).nullish(),
};

export const entrySchema = z.looseObject({
  id: entryIdSchema,
  type: z.literal("entry"),
  title: z.string().trim().min(1).nullish(),
  ...commonFields,
  description: z.never().optional(),
  occurred_at: z.union([isoDateSchema, isoDateTimeSchema]).nullish(),
  journal_date: isoDateSchema.nullish(),
  origin: z.enum(["human", "ai", "system"]),
  curated_at: isoDateTimeSchema.nullish(),
  exclude_from_ai: z.boolean(),
  contexts: z
    .looseObject({
      area: areaIdSchema.nullish(),
      project: projectIdSchema.nullish(),
      task: taskIdSchema.nullish(),
      resource: resourceIdSchema.nullish(),
    })
    .nullish(),
  ...topicAssignments,
  generated_at: isoDateTimeSchema.nullish(),
  source_entity_ids: z.array(entityIdSchema).nullish(),
});

export const projectSchema = z.looseObject({
  id: projectIdSchema,
  type: z.literal("project"),
  description: descriptionSchema,
  title: z.string(),
  status: statusSchema,
  priority: prioritySchema.nullish(),
  area_id: areaIdSchema.nullish(),
  ...topicAssignments,
  completed_at: isoDateTimeSchema.nullish(),
  ...commonFields,
});

export const taskSchema = z
  .looseObject({
    id: taskIdSchema,
    type: z.literal("task"),
    description: descriptionSchema,
    title: z.string(),
    status: statusSchema,
    priority: prioritySchema.nullish(),
    project_id: projectIdSchema.nullish(),
    area_id: areaIdSchema.nullish(),
    ...topicAssignments,
    due_at: z.union([isoDateSchema, isoDateTimeSchema]).nullish(),
    completed_at: isoDateTimeSchema.nullish(),
    ...commonFields,
  })
  .superRefine((task, context) => {
    if (task.project_id != null && task.area_id != null) {
      context.addIssue({
        code: "custom",
        message: "A project task must derive its area from the project",
        path: ["area_id"],
      });
    }
  });

export const resourceAuthorsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(512)
      .refine(
        (value) => !/[\r\n\u2028\u2029]/u.test(value),
        "Author must be a single line",
      ),
  )
  .max(100)
  .refine(
    (values) => new Set(values).size === values.length,
    "Authors must be unique",
  )
  .nullish();
export const resourceRelatedIdsSchema = z
  .array(
    z.union([areaIdSchema, projectIdSchema, taskIdSchema, resourceIdSchema]),
  )
  .max(100)
  .refine(
    (values) => new Set(values).size === values.length,
    "Related entities must be unique",
  )
  .nullish();
export const resourceSchema = z
  .looseObject({
    authors: resourceAuthorsSchema,
    related_entity_ids: resourceRelatedIdsSchema,
    id: resourceIdSchema,
    type: z.literal("resource"),
    description: descriptionSchema,
    title: z.string(),
    resource_type: z.enum(RESOURCE_TYPES).nullish(),
    canonical_identifier: z.string().nullish(),
    source_uri: z.url().nullish(),
    asset_path: z
      .string()
      .regex(/^assets\/(images|files)\/[0-9a-f-]{36}\.[a-z0-9]{1,10}$/)
      .nullish(),
    version: z.string().nullish(),
    acquired_at: isoDateTimeSchema.nullish(),
    local_content_status: z.string().nullish(),
    ...topicAssignments,
    ...commonFields,
  })
  .refine((entity) => !entity.related_entity_ids?.includes(entity.id), {
    message: "Resource cannot relate to itself",
    path: ["related_entity_ids"],
  });

export const topicSchema = z.looseObject({
  id: topicIdSchema,
  type: z.literal("topic"),
  description: descriptionSchema,
  name: z.string(),
  ...commonFields,
});

export const areaSchema = z.looseObject({
  id: areaIdSchema,
  type: z.literal("area"),
  description: descriptionSchema,
  name: z.string(),
  ...topicAssignments,
  ...commonFields,
});

export const entitySchema = z.discriminatedUnion("type", [
  entrySchema,
  projectSchema,
  taskSchema,
  resourceSchema,
  topicSchema,
  areaSchema,
]);

export const vaultConfigFileSchema = z.looseObject({
  vault_id: z.string().regex(UUID_V7),
  schema_version: z.number().int().positive(),
});

export const vaultConfigSchema = vaultConfigFileSchema.extend({
  schema_version: z.literal(1),
});

export type ParsedEntity = z.infer<typeof entitySchema>;
export type ParsedVaultConfigFile = z.infer<typeof vaultConfigFileSchema>;
export type ParsedVaultConfig = z.infer<typeof vaultConfigSchema>;
