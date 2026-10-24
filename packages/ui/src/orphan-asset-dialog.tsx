import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { useEffect, useState } from "react";

import type { PkmClient, PkmOrphanAsset } from "@pkm/contracts";

export interface OrphanAssetDialogProps {
  readonly opened: boolean;
  readonly onClose: () => void;
  readonly readOnly: boolean;
  readonly client: Pick<PkmClient, "listOrphanAssets" | "deleteOrphanAssets">;
}

export const OrphanAssetDialog = ({
  opened,
  onClose,
  readOnly,
  client,
}: OrphanAssetDialogProps) => {
  const [assets, setAssets] = useState<readonly PkmOrphanAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selected = assets.slice(0, 1000);

  useEffect(() => {
    if (!opened) return;
    let active = true;
    setLoading(true);
    setConfirmed(false);
    setError(null);
    setMessage(null);
    void client
      .listOrphanAssets()
      .then((found) => {
        if (active) setAssets(found);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [opened, client]);

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setError(null);
    try {
      const result = await client.deleteOrphanAssets(
        selected.map(({ path, hash }) => ({ path, hash })),
      );
      setMessage(
        `${result.deleted.length}件を削除しました。${result.skipped.length > 0 ? `${result.skipped.length}件は参照・変更が見つかり保留しました。` : ""}`,
      );
      setAssets(await client.listOrphanAssets());
      setConfirmed(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="未参照添付を整理" size="lg">
      <Stack gap="sm">
        <Text size="sm">
          7日以上前の添付で、ノート・Resource・下書き・同期競合から参照されていないものを表示します。削除は同期先にも伝播し、元に戻せません。保存中のノートがないことを確認してください。
        </Text>
        {assets.length > 1000 && (
          <Text size="sm">一度に削除できるのは先頭の1000件です。</Text>
        )}
        {error !== null && <Alert color="red">{error}</Alert>}
        {message !== null && <Alert color="green">{message}</Alert>}
        <ScrollArea mah={300}>
          {loading ? (
            <Text size="sm">確認中…</Text>
          ) : assets.length === 0 ? (
            <Text size="sm">削除候補はありません。</Text>
          ) : (
            <Stack gap={4}>
              {assets.map((asset) => (
                <Text key={asset.path} size="sm">
                  {asset.path} ({(asset.size / 1024).toFixed(1)} KiB)
                </Text>
              ))}
            </Stack>
          )}
        </ScrollArea>
        {assets.length > 0 && !readOnly && (
          <Checkbox
            checked={confirmed}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
            label="上記ファイルを完全に削除することを確認しました"
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            閉じる
          </Button>
          <Button
            color="red"
            disabled={readOnly || loading || assets.length === 0 || !confirmed}
            loading={deleting}
            onClick={() => void remove()}
          >
            {selected.length}件を削除
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
