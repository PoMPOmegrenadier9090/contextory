import {
  Alert,
  Button,
  Code,
  Group,
  PasswordInput,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import type { SyncthingStatus } from "@pkm/storage-node";
import type { OpenDesktopVault } from "./desktop-api.js";

export const VaultSettingsPanel = ({
  vault,
  onBusyChange,
  onChooseVault,
}: {
  readonly vault: OpenDesktopVault;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onChooseVault: () => Promise<void>;
}): React.JSX.Element => {
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8384");
  const [apiKey, setApiKey] = useState("");
  const [deviceIds, setDeviceIds] = useState("");
  const [status, setStatus] = useState<SyncthingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (setup: boolean): Promise<void> => {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    setMessage(null);
    setStatus(null);
    try {
      const connection = { baseUrl, apiKey };
      if (setup) {
        const result = await window.pkm.setupSync({
          ...connection,
          deviceIds: deviceIds.split(/[\s,]+/).filter(Boolean),
        });
        setMessage(
          result.created
            ? "Vaultを同期フォルダに登録しました。サーバー側で共有を承認してください。"
            : "このVaultは登録済みです。共有先の追加・変更はSyncthingのGUIで行ってください。",
        );
      }
      setStatus(await window.pkm.syncStatus(connection));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  return (
    <Stack>
      <TextInput label="Vaultの場所" value={vault.vaultRoot} readOnly />
      <TextInput label="Vault ID" value={vault.vaultId} readOnly />
      <TextInput
        label="同期Folder ID"
        value={`pkm-${vault.vaultId}`}
        readOnly
      />
      <Button
        variant="light"
        disabled={busy}
        onClick={() => {
          void onChooseVault();
        }}
      >
        Vaultを変更
      </Button>
      <Text size="sm">
        空のフォルダを選択すると新しいVaultを初期化します。既存Vaultを同期する端末では、共有を受信してからそのフォルダを選択してください。
      </Text>
      <Text fw={600}>この端末のSyncthing</Text>
      <Text size="sm">
        Syncthingを起動し、GUIでサーバーを「リモートデバイス」として登録してください。API
        KeyはGUIの設定 → GUIで確認できます。
      </Text>
      <TextInput
        label="ローカルSyncthing URL"
        value={baseUrl}
        onChange={(event) => setBaseUrl(event.currentTarget.value)}
        disabled={busy}
      />
      <PasswordInput
        label="API Key"
        description="カテゴリを切り替えるか設定を閉じると破棄されます。"
        value={apiKey}
        onChange={(event) => setApiKey(event.currentTarget.value)}
        disabled={busy}
      />
      <Textarea
        label="共有先のDevice ID"
        description="複数の場合は改行またはカンマで区切ります。先にSyncthingのGUIで相互登録してください。"
        value={deviceIds}
        onChange={(event) => setDeviceIds(event.currentTarget.value)}
        disabled={busy}
      />
      <Group>
        <Button
          variant="light"
          disabled={busy || !apiKey.trim()}
          onClick={() => void run(false)}
        >
          接続・同期状態を確認
        </Button>
        <Button
          disabled={
            busy ||
            !apiKey.trim() ||
            !deviceIds.trim() ||
            vault.accessMode !== "read-write"
          }
          onClick={() => void run(true)}
        >
          Vaultを同期に登録
        </Button>
      </Group>
      {message && <Alert color="green">{message}</Alert>}
      {error && <Alert color="red">{error}</Alert>}
      {status && (
        <Stack gap="xs">
          {status.folder.configured &&
            status.folder.path !== vault.vaultRoot && (
              <Alert color="yellow">
                Syncthingに登録済みのパスが現在のVaultと異なります。SyncthingのGUIで同期先を確認してください。
              </Alert>
            )}
          <Text size="sm">
            接続: {status.health} / Folder:{" "}
            {status.folder.configured
              ? (status.folder.state ?? "不明")
              : "未登録"}
          </Text>
          <Text size="sm">
            ローカルDevice ID: <Code>{status.deviceId}</Code>
          </Text>
          {status.folder.configured && (
            <TextInput
              label="Syncthingに登録済みのパス"
              value={status.folder.path ?? ""}
              readOnly
            />
          )}
          {status.folder.configured && (
            <Text size="sm">
              未同期: {status.folder.needTotalItems ?? 0} 件 / エラー:{" "}
              {status.folder.pullErrors ?? 0} 件
            </Text>
          )}
        </Stack>
      )}
      <Text fw={600}>Docker Compose・Cloudflare Tunnel</Text>
      <Text size="sm">
        サーバーでComposeのSyncthingを起動し、このVaultを共有します。受信先は
        /var/syncthing/vault です。Web UIを起動したら、Cloudflare
        Accessで認証を設定し、Tunnelの接続先を http://pkm:3210 にします。
      </Text>
      <Text size="sm">
        リポジトリの docs/server-setup.md
        に起動コマンドと設定手順があります。ファイル同期はSyncthing、HTTPSでのWebアクセスはCloudflare
        Tunnelが担当します。
      </Text>
    </Stack>
  );
};
