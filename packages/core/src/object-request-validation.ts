import type { DocNode } from "./object-document.js";
import {
  normalizeObjectType,
  type FieldKind,
  type ObjectRecord,
} from "./object-model.js";
import type { ObjectTypePatch } from "./object-client.js";

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

const requireType = (value: unknown): ObjectRecord["type"] => {
  const type = normalizeObjectType(value);
  if (!type) throw new TypeError("type is not a valid object type");
  return type;
};

export const parseObjectPageSave = (
  value: unknown,
): { doc: DocNode; baseRevision: string | null } => {
  const body = requireRequestRecord(value);
  const doc = requireRequestRecord(body.doc);
  if (doc.type !== "doc") throw new TypeError("doc must be a document node");
  const base = body.baseRevision ?? null;
  if (base !== null && typeof base !== "string")
    throw new TypeError("baseRevision must be a string");
  return { doc, baseRevision: base };
};

export const parseObjectCreate = (
  value: unknown,
): {
  id: string;
  type: ObjectRecord["type"];
  title: string;
  parentId: string | null;
} => {
  const body = requireRequestRecord(value);
  const parentId = body.parentId ?? null;
  return {
    id: requireRequestString(body.id, "id"),
    type: requireType(body.type),
    title: typeof body.title === "string" ? body.title : "",
    parentId:
      parentId === null ? null : requireRequestString(parentId, "parentId"),
  };
};

export const parseObjectPatch = (
  value: unknown,
): { title?: string; done?: boolean } => {
  const body = requireRequestRecord(value);
  return {
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(typeof body.done === "boolean" ? { done: body.done } : {}),
  };
};

export const parseObjectTypePatch = (value: unknown): ObjectTypePatch => {
  const body = requireRequestRecord(value);
  return {
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    ...(typeof body.color === "string" || body.color === null
      ? { color: body.color }
      : {}),
    ...(typeof body.checkbox === "boolean" ? { checkbox: body.checkbox } : {}),
    ...(typeof body.extends === "string" || body.extends === null
      ? { extends: body.extends }
      : {}),
    ...(Array.isArray(body.fields)
      ? {
          fields: (body.fields as unknown[]).map((value) => {
            const field = requireRequestRecord(value);
            return {
              id: requireRequestString(field.id, "id"),
              name: requireRequestString(field.name, "name"),
              kind: requireRequestString(field.kind, "kind") as FieldKind,
              ...(Array.isArray(field.options)
                ? {
                    options: (field.options as unknown[]).map((option) =>
                      requireRequestString(option, "option"),
                    ),
                  }
                : {}),
            };
          }),
        }
      : {}),
  };
};

export const parseObjectOverviewRange = (
  value: unknown,
): { from: number; to: number } => {
  const input = requireRequestRecord(value);
  const from = Number(input.from ?? 0);
  const to = Number(input.to ?? Number.MAX_SAFE_INTEGER);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to)
    throw new TypeError("from and to must be a valid range");
  return { from, to };
};
