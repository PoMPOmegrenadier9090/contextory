import { ActionIcon, CopyButton } from "@mantine/core";

export const EntityIdCopyButton = ({
  entityId,
  entityType,
}: {
  readonly entityId: string;
  readonly entityType: string;
}) => (
  <CopyButton value={`[[${entityType}:${entityId}]]`}>
    {({ copied, copy }) => (
      <ActionIcon
        variant="subtle"
        aria-label={copied ? "リンクをコピーしました" : "Entityリンクをコピー"}
        title={copied ? "コピー済み" : "内部リンクをコピー"}
        onClick={copy}
      >
        {copied ? "✓" : "ID"}
      </ActionIcon>
    )}
  </CopyButton>
);
