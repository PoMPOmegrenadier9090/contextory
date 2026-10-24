import { Group, Text } from "@mantine/core";

import { entityUiTitle } from "./entity-label.js";
import type { PkmEntitySummary } from "@pkm/contracts";

export const entityParentTrail = (
  entity: PkmEntitySummary,
  entities: readonly PkmEntitySummary[],
): readonly PkmEntitySummary[] => {
  const byId = new Map(entities.map((candidate) => [candidate.id, candidate]));
  if (entity.type === "project") {
    const area = entity.areaId === null ? undefined : byId.get(entity.areaId);
    return area === undefined ? [] : [area];
  }
  if (entity.type === "entry") {
    const task = entity.taskId === null ? undefined : byId.get(entity.taskId);
    const projectId = entity.projectId ?? task?.projectId;
    const project = projectId == null ? undefined : byId.get(projectId);
    const areaId = entity.areaId ?? task?.areaId ?? project?.areaId;
    const area = areaId == null ? undefined : byId.get(areaId);
    const resource =
      entity.resourceId === null ? undefined : byId.get(entity.resourceId);
    return [area, project, task, resource].filter(
      (candidate): candidate is PkmEntitySummary => candidate !== undefined,
    );
  }
  if (entity.type !== "task") return [];
  const project =
    entity.projectId === null ? undefined : byId.get(entity.projectId);
  const areaId = entity.areaId ?? project?.areaId ?? null;
  const area = areaId === null ? undefined : byId.get(areaId);
  return [area, project].filter(
    (candidate): candidate is PkmEntitySummary => candidate !== undefined,
  );
};

export const EntityParentLinks = ({
  entity,
  entities,
  onOpenEntity,
}: {
  readonly entity: PkmEntitySummary;
  readonly entities: readonly PkmEntitySummary[];
  readonly onOpenEntity: (entityId: string) => void;
}): React.JSX.Element | null => {
  const parents = entityParentTrail(entity, entities);
  if (parents.length === 0) return null;
  return (
    <Group
      className="entity-parent-trail"
      gap={4}
      wrap="nowrap"
      aria-label="親階層"
    >
      {parents.map((parent, index) => (
        <Group gap={4} key={parent.id} wrap="nowrap">
          {index > 0 && <Text c="dimmed">/</Text>}
          <button
            type="button"
            title={entityUiTitle(parent)}
            data-open-entity={parent.id}
            onClick={() => onOpenEntity(parent.id)}
          >
            {entityUiTitle(parent)}
          </button>
        </Group>
      ))}
    </Group>
  );
};
