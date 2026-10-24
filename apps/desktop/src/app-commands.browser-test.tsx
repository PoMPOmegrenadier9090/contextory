import "@mantine/core/styles.css";
import "./renderer.css";
import { runUnresolvedReferencesBrowserChecks } from "./unresolved-references.browser-test.js";
import "../../../packages/ui/src/compact.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppSettingsDialog } from "../../../packages/ui/src/app-settings-dialog.js";
import {
  useAppCommands,
  type AppCommands,
} from "../../../packages/ui/src/use-app-commands.js";
import { AppearanceProvider } from "../../../packages/ui/src/appearance-provider.js";

export const runAppCommandsBrowserChecks = async (parent: HTMLElement) => {
  let checks = 0;
  const equal = (actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(
        `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    checks++;
  };
  const settle = async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  };
  const storageKey = `pkm:test:commands:${crypto.randomUUID()}`;
  const errors: unknown[] = [];
  const counts = {
    save: 0,
    quickOpen: 0,
    capture: 0,
    newTab: 0,
    closeTab: 0,
    back: 0,
    forward: 0,
  };
  let savedProperty = "";
  let blurCount = 0;
  let commands!: AppCommands;
  let configure!: (state: {
    enabled?: boolean;
    writable?: boolean;
    mobile?: boolean;
    platform?: "mac" | "other";
  }) => void;
  let markSettingsBusy!: (busy: boolean) => void;
  let closeSettings!: () => void;
  let showSettings!: () => void;
  const Harness = () => {
    const [state, setState] = useState({
      enabled: true,
      writable: true,
      mobile: false,
      platform: "mac" as "mac" | "other",
    });
    const [opened, setOpened] = useState(false);
    const [settingsBusy, setSettingsBusy] = useState(false);
    markSettingsBusy = setSettingsBusy;
    const [property, setProperty] = useState("");
    configure = (next) => setState((previous) => ({ ...previous, ...next }));
    closeSettings = () => setOpened(false);
    showSettings = () => setOpened(true);
    commands = useAppCommands({
      enabled: state.enabled && !opened,
      platform: state.platform,
      storageKey,
      onError: (reason) => errors.push(reason),
      handlers: {
        "document.save": {
          isEnabled: () => state.writable,
          run: () => {
            counts.save++;
            savedProperty = property;
          },
        },
        "quickOpen.open": {
          run: () => {
            counts.quickOpen++;
          },
        },
        "capture.open": {
          isEnabled: () => state.writable,
          run: () => {
            counts.capture++;
          },
        },
        "tab.new": {
          isEnabled: () => !state.mobile,
          run: () => {
            counts.newTab++;
          },
        },
        "tab.close": {
          isEnabled: () => !state.mobile,
          run: () => {
            counts.closeTab++;
          },
        },
        "navigation.back": {
          run: () => {
            counts.back++;
          },
        },
        "navigation.forward": {
          run: () => {
            counts.forward++;
          },
        },
        "settings.open": { run: () => setOpened(true) },
      },
    });
    return (
      <AppearanceProvider storageKey={`${storageKey}:appearance`}>
        <button
          id="command-save"
          onClick={() => commands.execute("document.save")}
        >
          保存
        </button>
        <input
          id="command-property"
          onBlur={(event) => {
            blurCount++;
            setProperty(event.currentTarget.value);
          }}
        />
        <textarea id="command-textarea" />
        <div
          id="command-editable"
          contentEditable
          suppressContentEditableWarning
        >
          本文
        </div>
        <AppSettingsDialog
          opened={opened}
          onClose={closeSettings}
          commands={commands}
          busy={settingsBusy}
          sections={[
            {
              id: "extension",
              label: "拡張設定",
              content: <p>追加カテゴリ</p>,
            },
          ]}
        />
      </AppearanceProvider>
    );
  };
  let root = createRoot(parent);
  const mount = async () => {
    root.render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    await settle();
  };
  const key = (
    value: string,
    options: KeyboardEventInit = {},
    target: EventTarget = window,
  ) => {
    const event = new KeyboardEvent("keydown", {
      key: value,
      metaKey: true,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    target.dispatchEvent(event);
    return event;
  };
  const button = (label: string) => {
    const element = document.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    if (!element) throw new Error(`Missing button: ${label}`);
    return element;
  };
  try {
    await mount();
    equal(key("s").defaultPrevented, true);
    key("k");
    key("Enter", { shiftKey: true });
    key("t");
    key("w");
    key("ArrowLeft");
    key("ArrowRight");
    equal(counts, {
      save: 1,
      quickOpen: 1,
      capture: 1,
      newTab: 1,
      closeTab: 1,
      back: 1,
      forward: 1,
    });
    key("s", { repeat: true });
    key("s", { isComposing: true });
    key("s", { keyCode: 229 });
    equal(counts.save, 1);
    const prevented = new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      cancelable: true,
    });
    prevented.preventDefault();
    window.dispatchEvent(prevented);
    equal(counts.save, 1);
    const property =
      document.querySelector<HTMLInputElement>("#command-property")!;
    property.focus();
    equal(document.activeElement?.id, "command-property");
    property.value = "確定したプロパティ";
    key("s", {}, property);
    await settle();
    equal(blurCount, 1);
    equal(savedProperty, "確定したプロパティ");
    equal(counts.save, 2);
    for (const selector of [
      "#command-property",
      "#command-textarea",
      "#command-editable",
    ]) {
      const target = document.querySelector<HTMLElement>(selector)!;
      target.focus();
      equal(key("ArrowLeft", {}, target).defaultPrevented, false);
    }
    equal(counts.back, 1);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    key("k");
    equal(counts.quickOpen, 1);
    dialog.remove();
    // Quick Capture stays mounted while closed in the real app.
    dialog.style.display = "none";
    document.body.append(dialog);
    key("k");
    equal(counts.quickOpen, 2);
    dialog.remove();
    counts.quickOpen = 1;
    configure({ enabled: false });
    await settle();
    equal(commands.execute("document.save"), false);
    key("k");
    equal(counts.quickOpen, 1);
    configure({ enabled: true, writable: false, mobile: true });
    await settle();
    for (const id of [
      "document.save",
      "capture.open",
      "tab.new",
      "tab.close",
    ] as const)
      equal(commands.execute(id), false);
    configure({ writable: true, mobile: false });
    await settle();
    equal(commands.setKeys("quickOpen.open", ["Mod+j"]), null);
    await settle();
    equal(key("k").defaultPrevented, false);
    key("j");
    equal(counts.quickOpen, 2);
    equal(commands.label("quickOpen.open"), "⌘ + J");
    equal(
      commands.setKeys("document.save", ["Meta+j"])?.includes("重複"),
      true,
    );
    equal(
      commands.setKeys("document.save", ["Mod+f"])?.includes("本文編集"),
      true,
    );
    equal(commands.setKeys("quickOpen.open", []), null);
    await settle();
    equal(key("j").defaultPrevented, false);
    // An explicit empty override survives a remount.
    root.unmount();
    root = createRoot(parent);
    await mount();
    equal(commands.keys("quickOpen.open"), []);
    equal(commands.setKeys("document.save", ["Mod+k"]), null);
    await settle();
    equal(commands.reset("quickOpen.open")?.includes("初期キー"), true);
    equal(commands.reset(), null);
    await settle();
    equal(commands.keys("quickOpen.open"), ["Mod+k"]);
    configure({ platform: "other" });
    await settle();
    equal(key("s").defaultPrevented, false);
    equal(key("s", { metaKey: false, ctrlKey: true }).defaultPrevented, true);
    equal(commands.label("document.save"), "Ctrl + S");
    configure({ platform: "mac" });
    await settle();
    key(",");
    await settle();
    equal(
      document
        .querySelector('[role="dialog"]')
        ?.textContent?.includes("キーボードショートカット"),
      true,
    );
    const capture = button("Quick Openを開くのキーを変更");
    capture.focus();
    capture.click();
    await settle();
    key("s", {}, capture);
    await settle();
    equal(
      document.querySelector('[role="alert"]')?.textContent?.includes("重複"),
      true,
    );
    const before = counts.quickOpen;
    key("j", {}, capture);
    await settle();
    equal(commands.keys("quickOpen.open"), ["Mod+j"]);
    equal(counts.quickOpen, before);
    button("Quick Openを開くの割り当てを解除").click();
    await settle();
    equal(commands.keys("quickOpen.open"), []);
    button("Quick Openを開くを初期値に戻す").click();
    await settle();
    equal(commands.keys("quickOpen.open"), ["Mod+k"]);
    const escapeCapture = button("Quick Openを開くのキーを変更");
    escapeCapture.focus();
    escapeCapture.click();
    await settle();
    key("Escape", { metaKey: false }, escapeCapture);
    await settle();
    equal(document.querySelector('[role="dialog"]') !== null, true);
    equal(escapeCapture.textContent?.includes("キーを入力"), false);
    const extension =
      document.querySelector<HTMLButtonElement>(
        '[role="tab"][data-value="extension"]',
      ) ??
      [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        (tab) => tab.textContent === "拡張設定",
      );
    extension!.click();
    await settle();
    equal(document.body.textContent?.includes("追加カテゴリ"), true);
    markSettingsBusy(true);
    await settle();
    key("Escape", { metaKey: false }, document.body);
    await settle();
    equal(document.querySelector('[role="dialog"]') !== null, true);
    equal(
      [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].every(
        (tab) => tab.disabled,
      ),
      true,
    );
    equal(
      document.querySelector('[role="dialog"] button:not([role="tab"])') ===
        null,
      true,
    );
    markSettingsBusy(false);
    await settle();
    closeSettings();
    await settle();
    // Wait for Mantine's exit animation before testing the next workspace key.
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    key("k");
    equal(counts.quickOpen, before + 1);
    equal(errors, []);
    // Verify a corrupted store cannot cause two actions to execute.
    root.unmount();
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        keybindings: { "document.save": ["Mod+k"] },
      }),
    );
    root = createRoot(parent);
    await mount();
    const saves = counts.save;
    const opens = counts.quickOpen;
    equal(key("k").defaultPrevented, false);
    equal(counts.save, saves);
    equal(counts.quickOpen, opens);
    commands.reset();
    await settle();
    showSettings();
    await settle();
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    equal(document.documentElement.scrollWidth <= window.innerWidth, true);
    equal(
      document.querySelector('[role="dialog"]')!.getBoundingClientRect()
        .width <= window.innerWidth,
      true,
    );
    equal(
      document.querySelector('[role="dialog"]')!.getBoundingClientRect()
        .width >= Math.min(1200, window.innerWidth * 0.95),
      true,
    );
    root.unmount();
    const references = await runUnresolvedReferencesBrowserChecks(parent);
    return { checks: checks + references.checks };
  } finally {
    localStorage.removeItem(storageKey);
  }
};
