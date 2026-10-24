import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useState } from "react";

export interface EntityDeleteConfirmationProps {
  readonly opened: boolean;
  readonly entityName: string;
  readonly deleting?: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export const EntityDeleteConfirmation = ({
  opened,
  entityName,
  deleting = false,
  onClose,
  onConfirm,
}: EntityDeleteConfirmationProps): React.JSX.Element => (
  <Modal centered opened={opened} title="Entityを削除" onClose={onClose}>
    <Stack gap="md">
      <Text>{`「${entityName}」を削除しますか？通常の一覧、検索、AI参照から除外されます。`}</Text>
      <Text c="dimmed" size="sm">
        Markdownファイルは同期可能な削除記録として残ります。完全消去は行いません。
      </Text>
      <Group justify="flex-end">
        <Button disabled={deleting} variant="default" onClick={onClose}>
          キャンセル
        </Button>
        <Button color="red" loading={deleting} onClick={onConfirm}>
          削除する
        </Button>
      </Group>
    </Stack>
  </Modal>
);

export interface EntityDeleteButtonProps {
  readonly entityName: string;
  readonly disabled?: boolean;
  readonly onDelete: () => Promise<void>;
  readonly onDeleteError?: ((reason: unknown) => void) | undefined;
}

export const EntityDeleteButton = ({
  entityName,
  disabled = false,
  onDelete,
  onDeleteError,
}: EntityDeleteButtonProps): React.JSX.Element => {
  const [opened, setOpened] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirm = (): void => {
    setDeleting(true);
    void onDelete()
      .then(() => setOpened(false))
      .catch((reason: unknown) => onDeleteError?.(reason))
      .finally(() => setDeleting(false));
  };
  return (
    <>
      <Button
        color="red"
        disabled={disabled}
        size="compact-sm"
        variant="subtle"
        onClick={() => setOpened(true)}
      >
        削除
      </Button>
      <EntityDeleteConfirmation
        deleting={deleting}
        entityName={entityName}
        opened={opened}
        onClose={() => {
          if (!deleting) setOpened(false);
        }}
        onConfirm={confirm}
      />
    </>
  );
};
