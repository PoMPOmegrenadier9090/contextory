import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Tabs,
  Text,
  TextInput,
} from "@mantine/core";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  APP_COMMANDS,
  formatShortcut,
  shortcutFromEvent,
  type AppCommandId,
} from "./app-commands.js";
import type { AppCommands } from "./use-app-commands.js";
import { AppearanceSettingsPanel } from "./appearance-settings-panel.js";
import { ImageSettingsPanel } from "./image-settings-panel.js";
import { isComposingKey } from "./input-keyboard.js";

const subscribeWidth = (callback: () => void): (() => void) => {
  const media = window.matchMedia("(max-width: 48em)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};
const narrowSnapshot = () => window.matchMedia("(max-width: 48em)").matches;

/** Add future settings pages here without coupling them to keybinding storage. */
export interface AppSettingsSection {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

export const AppSettingsDialog = ({
  opened,
  onClose,
  commands,
  sections = [],
  busy = false,
}: {
  readonly opened: boolean;
  readonly onClose: () => void;
  readonly commands: AppCommands;
  readonly sections?: readonly AppSettingsSection[];
  readonly busy?: boolean;
}): React.JSX.Element => {
  const narrow = useSyncExternalStore(
    subscribeWidth,
    narrowSnapshot,
    () => false,
  );
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<AppCommandId | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (busy) return;
        setRecording(null);
        setError(null);
        onClose();
      }}
      title="設定"
      size="1200px"
      xOffset="2vw"
      closeOnEscape={!busy && recording === null}
      closeOnClickOutside={!busy}
      withCloseButton={!busy}
    >
      <Tabs
        defaultValue="shortcuts"
        keepMounted={false}
        orientation={narrow ? "horizontal" : "vertical"}
        className="app-settings"
      >
        <Tabs.List aria-label="設定カテゴリ" mb={narrow ? "md" : 0}>
          <Tabs.Tab
            value="shortcuts"
            disabled={busy}
            onClick={() => {
              setRecording(null);
              setError(null);
            }}
          >
            ショートカット
          </Tabs.Tab>
          <Tabs.Tab
            value="appearance"
            disabled={busy}
            onClick={() => {
              setRecording(null);
              setError(null);
            }}
          >
            外観
          </Tabs.Tab>
          <Tabs.Tab
            value="images"
            disabled={busy}
            onClick={() => {
              setRecording(null);
              setError(null);
            }}
          >
            画像・添付
          </Tabs.Tab>
          {sections.map((section) => (
            <Tabs.Tab
              key={section.id}
              value={section.id}
              disabled={busy}
              onClick={() => {
                setRecording(null);
                setError(null);
              }}
            >
              {section.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="shortcuts" pl={narrow ? 0 : "md"}>
          <Stack gap="sm">
            <Text fw={600}>キーボードショートカット</Text>
            <Text size="xs" c="dimmed">
              この端末に保存します。本文の基本編集キーはエディタ側で管理します。OSやブラウザーが使用するキーはアプリに届かない場合があります。タブ操作はPC表示のみです。
            </Text>
            <TextInput
              aria-label="操作を検索"
              placeholder="操作名・カテゴリで検索"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            {commands.persistenceError && (
              <Alert color="red" role="alert">
                {commands.persistenceError}
              </Alert>
            )}
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            {APP_COMMANDS.filter((command) =>
              `${command.title} ${command.category}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ).map((command) => (
              <div className="shortcut-setting-row" key={command.id}>
                <div>
                  <Text size="sm" fw={500}>
                    {command.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {command.category}
                    {command.scope === "navigation" ? " · 入力欄の外" : ""}
                  </Text>
                </div>
                <Group gap={4} className="shortcut-setting-controls">
                  <Button
                    variant={recording === command.id ? "filled" : "default"}
                    size="xs"
                    aria-label={`${command.title}のキーを変更`}
                    onBlur={() =>
                      setRecording((value) =>
                        value === command.id ? null : value,
                      )
                    }
                    onClick={() => {
                      setRecording(command.id);
                      setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (
                        recording !== command.id ||
                        isComposingKey(event.nativeEvent)
                      )
                        return;
                      if (event.key === "Tab") {
                        setRecording(null);
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      if (event.key === "Escape") {
                        setRecording(null);
                        return;
                      }
                      const key = shortcutFromEvent(
                        event.nativeEvent,
                        commands.platform,
                      );
                      if (!key) return;
                      const problem = commands.setKeys(command.id, [key]);
                      setError(problem);
                      if (!problem) setRecording(null);
                    }}
                  >
                    {recording === command.id
                      ? "キーを入力（Escで取消）"
                      : commands
                          .keys(command.id)
                          .map((key) => formatShortcut(key, commands.platform))
                          .join(" / ") || "未割り当て"}
                  </Button>
                  <Button
                    variant="subtle"
                    size="xs"
                    aria-label={`${command.title}の割り当てを解除`}
                    disabled={commands.keys(command.id).length === 0}
                    onClick={() => {
                      commands.setKeys(command.id, []);
                      setError(null);
                      setRecording(null);
                    }}
                  >
                    解除
                  </Button>
                  <Button
                    variant="subtle"
                    size="xs"
                    aria-label={`${command.title}を初期値に戻す`}
                    disabled={commands.overrides[command.id] === undefined}
                    onClick={() => {
                      setError(commands.reset(command.id));
                      setRecording(null);
                    }}
                  >
                    初期値
                  </Button>
                </Group>
              </div>
            ))}
            <Group justify="flex-end">
              <Button
                variant="light"
                size="xs"
                onClick={() => {
                  setError(commands.reset());
                  setRecording(null);
                }}
              >
                すべて初期化
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="appearance" pl={narrow ? 0 : "md"}>
          <AppearanceSettingsPanel />
        </Tabs.Panel>
        <Tabs.Panel value="images" pl={narrow ? 0 : "md"}>
          <ImageSettingsPanel />
        </Tabs.Panel>
        {sections.map((section) => (
          <Tabs.Panel
            key={section.id}
            value={section.id}
            pl={narrow ? 0 : "md"}
          >
            {section.content}
          </Tabs.Panel>
        ))}
      </Tabs>
    </Modal>
  );
};
