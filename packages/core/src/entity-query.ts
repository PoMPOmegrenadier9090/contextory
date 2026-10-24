import { entityDateRangeFields } from "./date-range.js";
import { z } from "zod";
import {
  ENTITY_TYPES,
  RESOURCE_TYPES,
  type BacklinkPageQuery,
  type EntityPageQuery,
} from "@pkm/contracts";
import { requireJournalDate } from "./journal-date.js";

const bool = z
  .preprocess(
    (v) => (v === "true" ? true : v === "false" ? false : v),
    z.boolean(),
  )
  .optional();
const array = z
  .preprocess(
    (v) => (typeof v === "string" ? (JSON.parse(v) as unknown) : v),
    z.array(z.string().min(1)).max(100),
  )
  .optional();
const date = z
  .string()
  .refine((v) => {
    try {
      requireJournalDate(v);
      return true;
    } catch {
      return false;
    }
  })
  .optional();
const schema = z
  .object({
    ...Object.fromEntries(
      Object.entries(entityDateRangeFields).map(([key, range]) => [
        key,
        z.preprocess(
          (value) =>
            typeof value === "string" ? (JSON.parse(value) as unknown) : value,
          range,
        ),
      ]),
    ),
    type: z.enum(ENTITY_TYPES).optional(),
    types: z
      .preprocess(
        (v) => (typeof v === "string" ? (JSON.parse(v) as unknown) : v),
        z.array(z.enum(ENTITY_TYPES)).max(6),
      )
      .optional(),
    q: z.string().max(500).optional(),
    nameOnly: bool,
    ids: array,
    nameKeys: array,
    deleted: z.literal("only").optional(),
    journalDate: date,
    todosOnly: bool,
    activeOnly: bool,
    resourceType: z.enum(RESOURCE_TYPES).optional(),
    status: z.string().optional(),
    priority: z.string().optional(),
    origin: z.string().optional(),
    areaId: z.string().optional(),
    projectId: z.string().optional(),
    topicIds: array,
    scopeType: z.enum(["area", "project", "task", "resource"]).optional(),
    scopeId: z.string().min(1).optional(),
    relatedTo: z.string().min(1).optional(),
    entryRelationMode: z.enum(["direct", "scoped"]).optional(),
    relatedResolution: z.enum(["direct", "transitive"]).optional(),
    deadline: z
      .enum(["overdue", "today", "next7days", "scheduled", "unscheduled"])
      .optional(),
    dueDate: date,
    view: z.literal("timeline").optional(),
    sort: z
      .enum([
        "name",
        "workflow",
        "resourceType",
        "createdAt",
        "updatedAt",
        "deletedAt",
        "dueAt",
        "status",
        "priority",
        "project",
        "area",
        "topics",
        "origin",
        "authors",
        "canonicalIdentifier",
        "sourceUri",
        "description",
      ])
      .optional(),
    direction: z.enum(["asc", "desc"]).optional(),
    limit: z
      .preprocess(
        (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v),
        z.number().int().min(1).max(100),
      )
      .optional(),
    cursor: z.string().max(4000).optional(),
  })
  .strict()
  .refine(
    (q) => (q.scopeType === undefined) === (q.scopeId === undefined),
    "scopeType and scopeId must be supplied together",
  )
  .refine(
    (q) =>
      q.entryRelationMode === undefined ||
      (q.type === "entry" &&
        q.relatedTo !== undefined &&
        q.deleted === undefined),
    "entryRelationMode requires type=entry, relatedTo and live entities",
  )
  .refine(
    (q) =>
      q.relatedResolution === undefined ||
      (q.relatedTo !== undefined && q.deleted === undefined),
    "relatedResolution requires relatedTo and visible Entities",
  );
export const parseEntityPageQuery = (value: unknown): EntityPageQuery => {
  try {
    return Object.fromEntries(
      Object.entries(schema.parse(value)).filter(([, v]) => v !== undefined),
    );
  } catch (error) {
    throw new TypeError(`Invalid Entity query: ${String(error)}`, {
      cause: error,
    });
  }
};

export const parseBacklinkPageQuery = (value: unknown): BacklinkPageQuery => {
  const result = z
    .object({
      limit: z
        .preprocess(
          (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v),
          z.number().int().min(1).max(100),
        )
        .optional(),
      cursor: z.string().max(200).optional(),
    })
    .strict()
    .safeParse(value);
  if (!result.success) throw new TypeError("Invalid backlink page query");
  return Object.fromEntries(
    Object.entries(result.data).filter(([, v]) => v !== undefined),
  );
};
