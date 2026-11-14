import type { DocNode } from "./object-document.js";
import {
  normalizeObjectType,
  type FieldKind,
  type ObjectRecord,
  type ViewDefinition,
} from "./object-model.js";
import type { ObjectPatch, ObjectTypePatch } from "./object-client.js";

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

export const parseObjectPatch = (value: unknown): ObjectPatch => {
  const body = requireRequestRecord(value);
  return {
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(typeof body.done === "boolean" ? { done: body.done } : {}),
    ...(body.fields === undefined
      ? {}
      : {
          fields: Object.fromEntries(
            Object.entries(requireRequestRecord(body.fields)).map(
              ([id, nodes]) => {
                if (!Array.isArray(nodes))
                  throw new TypeError("field value must be an array");
                return [id, nodes as DocNode[]];
              },
            ),
          ),
        }),
  };
};

const oneOf = <T extends string>(value: unknown, options: readonly T[]): T =>
  options.find((option) => option === value) ?? options[0]!;

/** Viewを読む。欠けた項目は既定にする。保存済みのViewを読むときにも使う。 */
export const parseView = (value: unknown): ViewDefinition => {
  const view = requireRequestRecord(value);
  const list = (items: unknown): unknown[] =>
    Array.isArray(items) ? (items as unknown[]) : [];
  return {
    id: requireRequestString(view.id, "id"),
    scope: oneOf(view.scope, ["type", "object"]),
    name:
      (typeof view.name === "string" ? view.name.trim().slice(0, 40) : "") ||
      "View",
    layout: oneOf(view.layout, ["table", "timeline"]),
    type: normalizeObjectType(view.type),
    reach: oneOf(view.reach, ["direct", "all"]),
    done: oneOf(view.done, ["all", "open", "done"]),
    filters: list(view.filters).flatMap((item) => {
      const filter = requireRequestRecord(item);
      return typeof filter.fieldId === "string" &&
        typeof filter.value === "string" &&
        filter.value
        ? [{ fieldId: filter.fieldId, value: filter.value }]
        : [];
    }),
    sort: typeof view.sort === "string" && view.sort ? view.sort : "created",
    desc: view.desc !== false,
    hidden: list(view.hidden).filter(
      (id): id is string => typeof id === "string",
    ),
    nested: view.nested === true,
  };
};

export const parseViewQuery = (
  value: unknown,
): { anchorId: string | null; today: string } => {
  const query = requireRequestRecord(value);
  const today = requireRequestString(query.today, "today");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today))
    throw new TypeError("today must be a date");
  return {
    anchorId: typeof query.anchor === "string" ? query.anchor : null,
    today,
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
    ...(Array.isArray(body.views)
      ? { views: (body.views as unknown[]).map(parseView) }
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
