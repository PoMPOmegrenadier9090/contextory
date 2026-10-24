import {
  Alert,
  Button,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { BODY_FONT_RANGE, UI_FONT_RANGE } from "./appearance.js";
import { useAppearance } from "./appearance-provider.js";
import { MarkdownBodyPreview } from "./markdown-body-preview.js";

const FontSizeInput = ({
  id,
  label,
  description,
  value,
  range,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly value: number;
  readonly range: { readonly min: number; readonly max: number };
  readonly onChange: (value: number) => void;
}): React.JSX.Element => {
  const [draft, setDraft] = useState<number | string>(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <NumberInput
      id={id}
      label={label}
      description={description}
      value={draft}
      min={range.min}
      max={range.max}
      step={1}
      decimalScale={0}
      allowNegative={false}
      suffix=" px"
      onChange={(next) => {
        setDraft(next);
        if (
          typeof next === "number" &&
          Number.isInteger(next) &&
          next >= range.min &&
          next <= range.max
        )
          onChange(next);
      }}
      onBlur={() => setDraft(value)}
    />
  );
};

export const AppearanceSettingsPanel = (): React.JSX.Element => {
  const { settings, update, reset, persistenceError } = useAppearance();
  return (
    <Stack gap="md">
      <Text fw={600}>外観</Text>
      <Text size="xs" c="dimmed">
        変更はすぐに反映され、この端末に保存されます。
      </Text>
      {persistenceError && (
        <Alert color="red" role="alert">
          {persistenceError}
        </Alert>
      )}
      <Stack gap={4}>
        <Text size="sm" id="appearance-color-scheme-label" fw={500}>
          カラーモード
        </Text>
        <SegmentedControl
          className="appearance-color-scheme"
          aria-labelledby="appearance-color-scheme-label"
          fullWidth
          value={settings.colorScheme}
          data={[
            { value: "auto", label: "OSに合わせる" },
            { value: "light", label: "ライト" },
            { value: "dark", label: "ダーク" },
          ]}
          onChange={(value) => {
            if (value === "auto" || value === "light" || value === "dark")
              update({ colorScheme: value });
          }}
        />
      </Stack>
      <FontSizeInput
        id="appearance-body-font-size"
        label="本文の文字サイズ"
        description="Live編集・Raw・本文表示・Timelineに適用します。スマホの編集欄は16px以上で表示します。"
        value={settings.bodyFontSize}
        range={BODY_FONT_RANGE}
        onChange={(value) => {
          update({ bodyFontSize: value });
        }}
      />
      <FontSizeInput
        id="appearance-ui-font-size"
        label="UIの文字サイズ"
        description="メニュー・表・設定画面の文字と、それに合わせた操作部品の大きさを調整します。"
        value={settings.uiFontSize}
        range={UI_FONT_RANGE}
        onChange={(value) => {
          update({ uiFontSize: value });
        }}
      />
      <Switch
        id="appearance-heading-colors"
        label="見出しを色分け"
        description="見出しのレベルごとに色を変えます。"
        checked={settings.headingColors}
        onChange={(event) =>
          update({ headingColors: event.currentTarget.checked })
        }
      />
      <Switch
        id="appearance-compact-headings"
        label="見出しをコンパクトに表示"
        description="見出しの文字サイズと上下の余白を小さくします。"
        checked={settings.compactHeadings}
        onChange={(event) =>
          update({ compactHeadings: event.currentTarget.checked })
        }
      />
      <Text size="xs" c="dimmed">
        見出し設定はLive編集と本文表示に適用します。
      </Text>
      <Paper
        withBorder
        p="sm"
        className="appearance-preview"
        aria-label="外観プレビュー"
      >
        <MarkdownBodyPreview
          body={
            "# 見出し1\n\n## 見出し2\n\n本文の文字サイズと、見出しの見え方を確認できます。"
          }
          onOpenEntity={() => {}}
        />
      </Paper>
      <Group justify="flex-end">
        <Button variant="light" size="xs" onClick={reset}>
          外観を初期値に戻す
        </Button>
      </Group>
    </Stack>
  );
};
