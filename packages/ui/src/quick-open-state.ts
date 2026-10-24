import type { PkmEntitySummary, PkmQuickOpenResult } from "@pkm/contracts";
import { markdownToPlainText } from "@pkm/core";

export const QUICK_OPEN_LIMIT = 30;

export const rememberQuickOpen = (
  recentIds: readonly string[],
  entityId: string,
): readonly string[] =>
  [entityId, ...recentIds.filter((id) => id !== entityId)].slice(
    0,
    QUICK_OPEN_LIMIT,
  );

export const parseQuickOpenRecent = (
  value: string | null,
): readonly string[] => {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(parsed.filter((id): id is string => typeof id === "string")),
    ].slice(0, QUICK_OPEN_LIMIT);
  } catch {
    return [];
  }
};

export const quickOpenSuggestions = (
  entities: readonly PkmEntitySummary[],
  recentIds: readonly string[],
  pinnedIds: ReadonlySet<string>,
): readonly PkmQuickOpenResult[] => {
  const byId = new Map(
    entities
      .filter((entity) => entity.deletedAt === null)
      .map((entity) => [entity.id, entity]),
  );
  return [...new Set([...recentIds, ...pinnedIds])]
    .flatMap((id) => {
      const entity = byId.get(id);
      return entity === undefined
        ? []
        : [
            {
              id: entity.id,
              type: entity.type,
              path: entity.path,
              displayName: entity.displayName,
              updatedAt: entity.updatedAt,
              snippet: markdownToPlainText(entity.body)
                .replace(/\s+/g, " ")
                .slice(0, 160),
              breadcrumb: entity.path,
            },
          ];
    })
    .slice(0, QUICK_OPEN_LIMIT);
};

export const nextQuickOpenIndex = (
  current: number,
  direction: 1 | -1,
  count: number,
): number => (count === 0 ? 0 : (current + direction + count) % count);
