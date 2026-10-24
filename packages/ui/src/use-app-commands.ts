import { useEffect, useRef, useState } from "react";
import {
  APP_COMMANDS,
  commandKeys,
  conflictingCommands,
  formatShortcut,
  parseKeybindingOverrides,
  resolvedShortcut,
  shortcutFromEvent,
  shortcutProblem,
  type AppCommandId,
  type CommandDefinition,
  type CommandHandlers,
  type CommandPlatform,
  type KeybindingOverrides,
} from "./app-commands.js";
import { isComposingKey } from "./input-keyboard.js";

export const APP_SETTINGS_STORAGE_KEY = "pkm:app-settings:v1";
const readOverrides = (key: string): KeybindingOverrides => {
  try {
    return parseKeybindingOverrides(window.localStorage.getItem(key));
  } catch {
    return {};
  }
};

export interface AppCommands {
  readonly platform: CommandPlatform;
  readonly overrides: KeybindingOverrides;
  readonly persistenceError: string | null;
  execute(id: AppCommandId): boolean;
  keys(id: AppCommandId): readonly string[];
  label(id: AppCommandId): string;
  setKeys(id: AppCommandId, keys: readonly string[]): string | null;
  reset(id?: AppCommandId): string | null;
}

export const useAppCommands = ({
  handlers,
  enabled,
  onError,
  storageKey = APP_SETTINGS_STORAGE_KEY,
  platform = navigator.platform.startsWith("Mac") ? "mac" : "other",
}: {
  readonly handlers: CommandHandlers;
  readonly enabled: boolean;
  readonly onError: (reason: unknown) => void;
  readonly storageKey?: string;
  readonly platform?: CommandPlatform;
}): AppCommands => {
  const [overrides, setOverrides] = useState(() => readOverrides(storageKey));
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const current = useRef({ handlers, enabled, onError, overrides });
  current.current = { handlers, enabled, onError, overrides };

  const execute = (id: AppCommandId): boolean => {
    const state = current.current;
    const handler = state.handlers[id];
    if (!state.enabled || !handler || handler.isEnabled?.() === false)
      return false;
    const run = () => {
      const latest = current.current;
      const action = latest.handlers[id];
      if (!latest.enabled || !action || action.isEnabled?.() === false) return;
      try {
        void Promise.resolve(action.run()).catch(latest.onError);
      } catch (reason) {
        latest.onError(reason);
      }
    };
    if (
      (
        APP_COMMANDS.find((command) => command.id === id) as
          CommandDefinition | undefined
      )?.commitInput &&
      document.activeElement instanceof HTMLInputElement
    ) {
      // Let property fields commit their blur updates before saving.
      document.activeElement.blur();
      requestAnimationFrame(run);
    } else run();
    return true;
  };
  const executeRef = useRef(execute);
  executeRef.current = execute;

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isComposingKey(event) ||
        !current.current.enabled ||
        [
          ...document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
        ].some((dialog) => dialog.getClientRects().length > 0)
      )
        return;
      const shortcut = shortcutFromEvent(event, platform);
      if (!shortcut) return;
      const editable =
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        );
      const candidates = APP_COMMANDS.filter(
        (command) =>
          !(command.scope === "navigation" && editable) &&
          commandKeys(command, current.current.overrides, platform).some(
            (key) =>
              resolvedShortcut(key, platform) ===
              resolvedShortcut(shortcut, platform),
          ),
      );
      // Never depend on registration order when stored settings conflict.
      if (candidates.length !== 1) return;
      const command = candidates[0]!;
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      if (executeRef.current(command.id)) event.preventDefault();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [platform]);

  const persist = (next: KeybindingOverrides): void => {
    current.current.overrides = next;
    setOverrides(next);
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, keybindings: next }),
      );
      setPersistenceError(null);
    } catch {
      setPersistenceError(
        "設定を保存できませんでした。この画面を再読み込みすると変更が失われます。",
      );
    }
  };
  return {
    platform,
    overrides,
    persistenceError,
    execute,
    keys: (id) =>
      commandKeys(
        APP_COMMANDS.find((command) => command.id === id)!,
        overrides,
        platform,
      ),
    label: (id) =>
      commandKeys(
        APP_COMMANDS.find((command) => command.id === id)!,
        overrides,
        platform,
      )
        .map((key) => formatShortcut(key, platform))
        .join(" / "),
    setKeys: (id, keys) => {
      for (const key of keys) {
        const problem = shortcutProblem(key, platform);
        if (problem) return problem;
      }
      const conflicts = conflictingCommands(
        id,
        keys,
        current.current.overrides,
        platform,
      );
      if (conflicts.length)
        return `「${APP_COMMANDS.filter((command) =>
          conflicts.includes(command.id),
        )
          .map((command) => command.title)
          .join(
            "、",
          )}」とキーが重複しています。先にその割り当てを解除してください。`;
      persist({ ...current.current.overrides, [id]: keys });
      return null;
    },
    reset: (id) => {
      const next = { ...current.current.overrides };
      if (id) delete next[id];
      // Restoring a default must not silently introduce an ambiguous binding.
      if (id) {
        const command = APP_COMMANDS.find((item) => item.id === id)!;
        const defaults = commandKeys(command, {}, platform);
        const conflicts = conflictingCommands(id, defaults, next, platform);
        if (conflicts.length) {
          return "初期キーが他の操作に割り当てられています。その割り当てを解除するか、すべて初期化してください。";
        }
      }
      persist(id ? next : {});
      return null;
    },
  };
};
