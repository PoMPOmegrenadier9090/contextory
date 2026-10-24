/** UI commands are separate from Vault application-service operations. */
export interface CommandDefinition {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly scope: "workspace" | "navigation";
  readonly keys: readonly string[];
  readonly macKeys?: readonly string[];
  readonly commitInput?: boolean;
}

export const APP_COMMANDS = [
  {
    id: "document.save",
    title: "保存",
    category: "ドキュメント",
    scope: "workspace",
    keys: ["Mod+s"],
    commitInput: true,
  },
  {
    id: "quickOpen.open",
    title: "Quick Openを開く",
    category: "検索・入力",
    scope: "workspace",
    keys: ["Mod+k"],
  },
  {
    id: "capture.open",
    title: "クイックメモを開く",
    category: "検索・入力",
    scope: "workspace",
    keys: ["Mod+Shift+Enter"],
  },
  {
    id: "tab.new",
    title: "新規タブを開く",
    category: "タブ",
    scope: "workspace",
    keys: ["Mod+t"],
  },
  {
    id: "tab.close",
    title: "現在のタブを閉じる",
    category: "タブ",
    scope: "workspace",
    keys: ["Mod+w"],
  },
  {
    id: "navigation.back",
    title: "前のEntityへ戻る",
    category: "移動",
    scope: "navigation",
    keys: [],
    macKeys: ["Meta+ArrowLeft"],
  },
  {
    id: "navigation.forward",
    title: "次のEntityへ進む",
    category: "移動",
    scope: "navigation",
    keys: [],
    macKeys: ["Meta+ArrowRight"],
  },
  {
    id: "settings.open",
    title: "設定を開く",
    category: "アプリ",
    scope: "workspace",
    keys: ["Mod+,"],
  },
] as const satisfies readonly CommandDefinition[];

export type AppCommandId = (typeof APP_COMMANDS)[number]["id"];
export type KeybindingOverrides = Partial<
  Record<AppCommandId, readonly string[]>
>;
export type CommandPlatform = "mac" | "other";
export interface CommandHandler {
  readonly run: () => unknown;
  readonly isEnabled?: () => boolean;
}
export type CommandHandlers = Partial<Record<AppCommandId, CommandHandler>>;

const modifiers = ["Mod", "Ctrl", "Meta", "Alt", "Shift"] as const;
const modifierKeys = new Set([
  "Control",
  "Meta",
  "Alt",
  "Shift",
  "AltGraph",
  "Dead",
  "Unidentified",
  "Process",
]);

export const normalizeShortcut = (value: string): string | null => {
  const parts = value.split("+");
  const rawKey = parts.pop();
  if (
    !rawKey ||
    parts.some((part) => !modifiers.some((mod) => mod === part)) ||
    new Set(parts).size !== parts.length
  )
    return null;
  const key =
    rawKey === "+"
      ? "Plus"
      : rawKey.length === 1
        ? rawKey.toLowerCase()
        : rawKey;
  if (
    modifierKeys.has(key) ||
    !(
      key.length === 1 ||
      /^(Arrow(Left|Right|Up|Down)|Enter|Escape|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Space|Plus|F([1-9]|1\d|2[0-4]))$/.test(
        key,
      )
    )
  )
    return null;
  if (
    parts.includes("Mod") &&
    (parts.includes("Ctrl") || parts.includes("Meta"))
  )
    return null;
  if (
    !parts.some((part) => part !== "Shift") &&
    !/^F([1-9]|1\d|2[0-4])$/.test(key)
  )
    return null;
  return [...modifiers.filter((mod) => parts.includes(mod)), key].join("+");
};

export const resolvedShortcut = (
  shortcut: string,
  platform: CommandPlatform,
): string =>
  shortcut
    .split("+")
    .map((part) =>
      part === "Mod" ? (platform === "mac" ? "Meta" : "Ctrl") : part,
    )
    .sort()
    .join("+");

export const commandKeys = (
  command: CommandDefinition,
  overrides: KeybindingOverrides,
  platform: CommandPlatform,
): readonly string[] =>
  overrides[command.id as AppCommandId] ??
  (platform === "mac" ? (command.macKeys ?? command.keys) : command.keys);

export interface ShortcutEvent {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export const shortcutFromEvent = (
  event: ShortcutEvent,
  platform: CommandPlatform,
): string | null => {
  if (modifierKeys.has(event.key)) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push(platform === "mac" ? "Mod" : "Meta");
  if (event.ctrlKey) parts.push(platform === "other" ? "Mod" : "Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(
    event.key === " " ? "Space" : event.key === "+" ? "Plus" : event.key,
  );
  return normalizeShortcut(parts.join("+"));
};

// These remain owned by the editor / native text fields in this first version.
const editorKeys = [
  "Mod+a",
  "Mod+c",
  "Mod+v",
  "Mod+x",
  "Mod+z",
  "Mod+Shift+z",
  "Mod+y",
  "Mod+b",
  "Mod+i",
  "Mod+Shift+x",
  "Mod+f",
];
export const shortcutProblem = (
  shortcut: string,
  platform: CommandPlatform,
): string | null => {
  if (!normalizeShortcut(shortcut))
    return "修飾キーと文字キー、またはファンクションキーを指定してください。";
  if (
    editorKeys.some(
      (key) =>
        resolvedShortcut(key, platform) ===
        resolvedShortcut(shortcut, platform),
    )
  )
    return "このキーは本文編集・テキスト入力で使用するため割り当てできません。";
  return null;
};

export const conflictingCommands = (
  id: AppCommandId,
  keys: readonly string[],
  overrides: KeybindingOverrides,
  platform: CommandPlatform,
): readonly AppCommandId[] =>
  APP_COMMANDS.filter(
    (command) =>
      command.id !== id &&
      commandKeys(command, overrides, platform).some((other) =>
        keys.some(
          (key) =>
            resolvedShortcut(key, platform) ===
            resolvedShortcut(other, platform),
        ),
      ),
  ).map((command) => command.id);

export const parseKeybindingOverrides = (
  raw: string | null,
): KeybindingOverrides => {
  try {
    const data: unknown = JSON.parse(raw ?? "null");
    if (
      !data ||
      typeof data !== "object" ||
      !("version" in data) ||
      data.version !== 1 ||
      !("keybindings" in data) ||
      !data.keybindings ||
      typeof data.keybindings !== "object"
    )
      return {};
    const result: KeybindingOverrides = {};
    for (const command of APP_COMMANDS) {
      const value: unknown = (data.keybindings as Record<string, unknown>)[
        command.id
      ];
      if (
        Array.isArray(value) &&
        value.every(
          (key: unknown) =>
            typeof key === "string" && normalizeShortcut(key) !== null,
        )
      ) {
        result[command.id] = [
          ...new Set((value as string[]).map((key) => normalizeShortcut(key)!)),
        ];
      }
    }
    return result;
  } catch {
    return {};
  }
};

export const formatShortcut = (
  shortcut: string,
  platform: CommandPlatform,
): string =>
  shortcut
    .split("+")
    .map(
      (part) =>
        ({
          Mod: platform === "mac" ? "⌘" : "Ctrl",
          Meta: "⌘",
          Ctrl: "Ctrl",
          Alt: platform === "mac" ? "⌥" : "Alt",
          Shift: "Shift",
          ArrowLeft: "←",
          ArrowRight: "→",
          ArrowUp: "↑",
          ArrowDown: "↓",
          Space: "Space",
          Plus: "+",
        })[part] ?? (part.length === 1 ? part.toUpperCase() : part),
    )
    .join(" + ");
