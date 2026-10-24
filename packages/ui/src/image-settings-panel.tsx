import {
  Alert,
  Button,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useState } from "react";
import {
  DEFAULT_IMAGE_SETTINGS,
  IMAGE_SETTINGS_KEY,
  IMAGE_WIDTHS,
  readImageSettings,
  type ImageSettings,
} from "./image-settings.js";

export const ImageSettingsPanel = (): React.JSX.Element => {
  const [settings, setSettings] = useState(readImageSettings);
  const [error, setError] = useState<string | null>(null);
  const update = (changes: Partial<ImageSettings>) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    try {
      window.localStorage.setItem(IMAGE_SETTINGS_KEY, JSON.stringify(next));
      setError(null);
    } catch {
      setError("画像設定を保存できませんでした。再度お試しください。");
    }
  };
  return (
    <Stack gap="md">
      <Text fw={600}>画像・添付</Text>
      <Text size="xs" c="dimmed">
        この端末に保存し、今後添付する画像に適用します。表示幅と保存時の解像度は別の設定です。
      </Text>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      <Switch
        label="貼り付け画像をWebPに変換"
        checked={settings.webp}
        onChange={(event) => update({ webp: event.currentTarget.checked })}
      />
      <NumberInput
        label="WebP品質"
        description="1〜100。高いほど画質を優先します。容量の削減率ではありません。"
        min={1}
        max={100}
        decimalScale={0}
        value={settings.quality}
        disabled={!settings.webp}
        onChange={(value) => {
          if (typeof value === "number" && value >= 1 && value <= 100)
            update({ quality: value });
        }}
      />
      <Select
        label="保存時の最大解像度（長辺）"
        value={String(settings.maxDimension)}
        disabled={!settings.webp}
        data={[
          { value: "0", label: "縮小しない" },
          ...[1280, 1920, 2560, 3840].map((value) => ({
            value: String(value),
            label: `${value}px`,
          })),
        ]}
        onChange={(value) => {
          if (value !== null) update({ maxDimension: Number(value) });
        }}
      />
      <Switch
        label="ファイル選択・ドロップにも変換を適用"
        checked={settings.includeFiles}
        disabled={!settings.webp}
        onChange={(event) =>
          update({ includeFiles: event.currentTarget.checked })
        }
      />
      <Text size="xs" c="dimmed">
        静止画像を対象に、小さくなった場合だけWebPを保存します。アニメーション画像や変換できない画像は元の形式で保存します。
      </Text>
      <Select
        label="新規画像の表示幅"
        value={String(settings.defaultWidth)}
        data={IMAGE_WIDTHS.map(({ label, width }) => ({
          value: String(width),
          label: width ? `${label}（最大${width}px）` : label,
        }))}
        onChange={(value) => {
          if (value !== null) update({ defaultWidth: Number(value) });
        }}
      />
      <Button variant="light" onClick={() => update(DEFAULT_IMAGE_SETTINGS)}>
        初期値に戻す
      </Button>
    </Stack>
  );
};
