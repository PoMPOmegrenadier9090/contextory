import { FRONTMATTER_KEY_ORDER } from "@pkm/contracts";
import { Document, isMap, isScalar } from "yaml";

import type { ParsedEntity } from "./entity-schema.js";
import type { ParsedMarkdownEntity } from "./markdown-parser.js";

export interface SerializeMarkdownEntityOptions {
  readonly entity?: ParsedEntity;
  readonly body?: string;
}

export interface SerializeNewMarkdownEntityOptions {
  readonly body?: string;
  readonly lineEnding?: "\n" | "\r\n";
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const valuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.hasOwn(right, key) && valuesEqual(left[key], right[key]),
      )
    );
  }
  return false;
};

const pairKey = (key: unknown): string | null => {
  if (typeof key === "string") {
    return key;
  }
  if (isScalar(key) && typeof key.value === "string") {
    return key.value;
  }
  return null;
};

const orderedEntityEntries = (
  entity: ParsedEntity,
): readonly (readonly [string, unknown])[] => {
  const data = entity as unknown as Record<string, unknown>;
  const knownKeys: readonly string[] = FRONTMATTER_KEY_ORDER[entity.type];
  return [
    ...knownKeys
      .filter((key) => Object.hasOwn(data, key))
      .map((key) => [key, data[key]] as const),
    ...Object.entries(data).filter(([key]) => !knownKeys.includes(key)),
  ];
};

export const serializeNewMarkdownEntity = (
  entity: ParsedEntity,
  options: SerializeNewMarkdownEntityOptions = {},
): string => {
  const lineEnding = options.lineEnding ?? "\n";
  const document = new Document();
  for (const [key, value] of orderedEntityEntries(entity)) {
    document.set(key, value);
  }
  const yaml = document
    .toString({ indent: 2, lineWidth: 0 })
    .replaceAll("\n", lineEnding);
  return `---${lineEnding}${yaml}---${lineEnding}${options.body ?? ""}`;
};

export const serializeMarkdownEntity = (
  parsed: ParsedMarkdownEntity,
  options: SerializeMarkdownEntityOptions = {},
): string => {
  const entity = options.entity ?? parsed.entity;
  if (entity.id !== parsed.entity.id || entity.type !== parsed.entity.type) {
    throw new Error("Serializer cannot change an entity identity");
  }

  const document = parsed.document.clone();
  const currentData = document.toJS() as Record<string, unknown>;
  const nextData = entity as unknown as Record<string, unknown>;
  const knownKeys: readonly string[] = FRONTMATTER_KEY_ORDER[entity.type];

  for (const key of knownKeys) {
    if (!Object.hasOwn(nextData, key)) {
      document.delete(key);
    } else if (!valuesEqual(currentData[key], nextData[key])) {
      document.set(key, nextData[key]);
    }
  }

  for (const [key, value] of Object.entries(nextData)) {
    if (!Object.hasOwn(currentData, key) && !knownKeys.includes(key)) {
      document.set(key, value);
    }
  }

  if (!isMap(document.contents)) {
    throw new Error("Entity frontmatter must remain a YAML mapping");
  }

  const keyOrder = new Map(knownKeys.map((key, index) => [key, index]));
  document.contents.items.sort((left, right) => {
    const leftKey = pairKey(left.key);
    const rightKey = pairKey(right.key);
    const leftRank = leftKey === null ? undefined : keyOrder.get(leftKey);
    const rightRank = rightKey === null ? undefined : keyOrder.get(rightKey);
    if (leftRank === undefined && rightRank === undefined) return 0;
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    return leftRank - rightRank;
  });

  const yaml = document
    .toString({ indent: 2, lineWidth: 0 })
    .replaceAll("\n", parsed.lineEnding);
  const body = options.body ?? parsed.body;
  return `---${parsed.lineEnding}${yaml}---${parsed.lineEnding}${body}`;
};
