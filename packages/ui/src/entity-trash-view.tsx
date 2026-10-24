import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useState } from "react";

import {
  EntityDataTable,
  type EntityTableColumnDefinition,
  type EntityDataTableProps,
} from "./entity-data-table.js";
import { entityUiTitle } from "./entity-label.js";
import type {
  PkmClient,
  PkmEntityDocument,
  PkmEntitySummary,
} from "@pkm/contracts";

const TRASH_COLUMNS: readonly EntityTableColumnDefinition[] = [
  { kind: "name", label: "名前", showEntityType: true },
  { kind: "deletedAt", label: "削除日時" },
  { kind: "updatedAt", label: "最終更新" },
  { kind: "actions", label: "操作", width: 200 },
];

export interface EntityTrashViewProps {
  readonly remoteSort?: EntityDataTableProps["remoteSort"];
  readonly entities: readonly PkmEntitySummary[];
  readonly allEntities: readonly PkmEntitySummary[];
  readonly readOnly?: boolean | undefined;
  readonly loadEntity: PkmClient["loadEntity"];
  readonly onPermanentlyDeleteEntity: PkmClient["permanentlyDeleteEntity"];
  readonly onRestoreEntity: (entityId: string) => Promise<void>;
  readonly onRestoreError?: ((reason: unknown) => void) | undefined;
}

export const EntityTrashView = ({
  entities,
  allEntities,
  readOnly = false,
  onRestoreEntity,
  loadEntity,
  onPermanentlyDeleteEntity,
  onRestoreError,
  remoteSort,
}: EntityTrashViewProps): React.JSX.Element => {
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [target, setTarget] = useState<PkmEntityDocument | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoringIds, setRestoringIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const restore = (entityId: string): void => {
    setError(null);
    setRestoringIds((current) => new Set(current).add(entityId));
    void onRestoreEntity(entityId)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        onRestoreError?.(reason);
      })
      .finally(() =>
        setRestoringIds((current) => {
          const next = new Set(current);
          next.delete(entityId);
          return next;
        }),
      );
  };

  const prepareDeletion = async (entityId: string): Promise<void> => {
    setError(null);
    setPreparingId(entityId);
    try {
      setTarget(await loadEntity(entityId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPreparingId(null);
    }
  };
  const permanentlyDelete = async (): Promise<void> => {
    if (target === null || deleting || readOnly) return;
    setError(null);
    setDeleting(true);
    try {
      await onPermanentlyDeleteEntity({
        entityId: target.entity.id,
        expectedFileHash: target.fileHash,
      });
      setTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDeleting(false);
    }
  };
  const busy = deleting || preparingId !== null || restoringIds.size > 0;

  return (
    <>
      <Stack gap="md">
        <Group gap="xs">
          <Title order={2}>ゴミ箱</Title>
          <Badge color="gray" variant="light">
            {entities.length}
          </Badge>
        </Group>
        <Text c="dimmed" size="sm">
          ゴミ箱のEntityは復元できます。完全に削除すると、Markdownとこの端末の下書きが消え、アプリから復元できなくなります。
        </Text>
        {error !== null && target === null && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <EntityDataTable
          allEntities={allEntities}
          columns={TRASH_COLUMNS}
          emptyMessage="削除済みEntityはありません。"
          entities={entities}
          initialSort={{ key: "deletedAt", direction: "desc" }}
          remoteSort={remoteSort}
          readOnly={readOnly}
          renderRowActions={(entity) => (
            <Group gap="xs" wrap="nowrap">
              <Button
                disabled={readOnly || busy}
                loading={restoringIds.has(entity.id)}
                size="compact-sm"
                variant="light"
                onClick={() => restore(entity.id)}
              >
                復元
              </Button>
              <Button
                color="red"
                variant="subtle"
                size="compact-sm"
                disabled={readOnly || busy}
                loading={preparingId === entity.id}
                onClick={() => void prepareDeletion(entity.id)}
              >
                完全に削除
              </Button>
            </Group>
          )}
        />
      </Stack>
      <Modal
        centered
        opened={target !== null}
        title="完全に削除"
        closeOnEscape={!deleting}
        closeOnClickOutside={!deleting}
        withCloseButton={!deleting}
        onClose={() => {
          if (!deleting) {
            setTarget(null);
            setError(null);
          }
        }}
      >
        <Stack gap="md">
          <Text>
            {target === null
              ? ""
              : `「${entityUiTitle(target.entity)}」を完全に削除しますか？`}
          </Text>
          <Text>
            Markdownファイルとこの端末の下書きを削除します。アプリからは復元できません。
          </Text>
          <Text size="sm" c="dimmed">
            添付ファイルと他のノートは削除しません。参照が残る場合は「参照切れ」で確認できます。
          </Text>
          {error !== null && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={deleting}
              onClick={() => {
                setTarget(null);
                setError(null);
              }}
            >
              キャンセル
            </Button>
            <Button
              color="red"
              disabled={readOnly}
              loading={deleting}
              onClick={() => void permanentlyDelete()}
            >
              完全に削除する
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
