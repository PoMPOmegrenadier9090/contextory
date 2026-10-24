import { Group, Text } from "@mantine/core";
import type { PkmEntitySummary } from "@pkm/contracts";

export const EntityRelationReason = ({
  entity,
  onOpenEntity,
}: {
  readonly entity: PkmEntitySummary;
  readonly onOpenEntity: (id: string) => void;
}): React.JSX.Element | null => {
  const reason = entity.relatedVia;
  if (!reason) return null;
  if (reason.relation === "direct")
    return (
      <Text size="xs" c="dimmed">
        {reason.kind === "reference" ? "本文からの直接参照" : "直接関連"}
      </Text>
    );
  return (
    <Group gap={4} wrap="wrap">
      {reason.via.map((via, i) => (
        <span key={via.id}>
          {i > 0 && " › "}
          <button
            type="button"
            className="detail-entity-link"
            onClick={() => onOpenEntity(via.id)}
          >
            {via.displayName ?? via.id}
          </button>
        </span>
      ))}
      <Text component="span" size="xs" c="dimmed">
        経由
      </Text>
    </Group>
  );
};
