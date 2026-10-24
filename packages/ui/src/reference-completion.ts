import type { EntityType } from "@pkm/contracts";
import { entityUiTitle } from "./entity-label.js";

export interface DirectReferenceCompletionOption {
  readonly id: string;
  readonly type: string;
  readonly displayName: string | null;
  readonly hierarchy?: string;
  readonly label?: string;
}

export interface ReferenceCompletionEntity extends DirectReferenceCompletionOption {
  readonly areaId: string | null;
  readonly projectId: string | null;
  readonly taskId: string | null;
  readonly resourceId: string | null;
  readonly body?: string;
  readonly createdAt?: string;
}

export const MAX_REFERENCE_COMPLETIONS = 40;

const completionEntityName = (
  entity: DirectReferenceCompletionOption,
): string => entity.label ?? (entity.displayName?.trim() || "無題のEntry");

export const parseReferenceCompletionQuery = (
  value: string,
): { query: string; type?: EntityType } => {
  const match = /^(area|project|task|entry|resource|topic):\s*/i.exec(value);
  return match
    ? {
        query: value.slice(match[0].length).trim(),
        type: match[1]!.toLowerCase() as EntityType,
      }
    : { query: value.trim() };
};

export const buildDirectReferenceCompletionOptions = (
  entities: readonly ReferenceCompletionEntity[],
): readonly DirectReferenceCompletionOption[] => {
  const labeled = entities.map((entity) => {
    return {
      id: entity.id,
      type: entity.type,
      displayName: entity.displayName,
      areaId: entity.areaId,
      projectId: entity.projectId,
      taskId: entity.taskId,
      resourceId: entity.resourceId,
      ...(entity.createdAt ? { createdAt: entity.createdAt } : {}),
      label:
        entity.displayName?.trim() ||
        (entity.createdAt
          ? entityUiTitle({
              id: entity.id,
              type: entity.type,
              displayName: null,
              body: "",
              createdAt: entity.createdAt,
            })
          : "無題のEntry"),
    };
  });
  const byId = new Map(labeled.map((entity) => [entity.id, entity]));
  const name = (id: string | null): string | null => {
    if (id === null) return null;
    const entity = byId.get(id);
    return entity === undefined ? null : completionEntityName(entity);
  };

  return labeled.map((entity) => {
    const task = entity.taskId === null ? undefined : byId.get(entity.taskId);
    const projectId = entity.projectId ?? task?.projectId ?? null;
    const project = projectId === null ? undefined : byId.get(projectId);
    const areaId = entity.areaId ?? task?.areaId ?? project?.areaId ?? null;
    const hierarchy = [
      name(areaId),
      name(projectId),
      name(entity.taskId),
      name(entity.resourceId),
    ]
      .filter((part): part is string => part !== null)
      .join(" > ");
    return {
      id: entity.id,
      type: entity.type,
      displayName: entity.displayName,
      label: entity.label,
      hierarchy: [
        hierarchy.length > 0 ? hierarchy : entity.type,
        entity.type === "entry" &&
        entity.displayName === null &&
        entity.createdAt
          ? entityUiTitle({ ...entity, body: "" })
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
};
