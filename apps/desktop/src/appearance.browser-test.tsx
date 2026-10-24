import "@mantine/core/styles.css";
import "./renderer.css";
import "../../../packages/ui/src/compact.css";
import { Text } from "@mantine/core";
import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppearanceProvider,
  useAppearance,
} from "../../../packages/ui/src/appearance-provider.js";
import { DEFAULT_APPEARANCE } from "../../../packages/ui/src/appearance.js";
import { AppSettingsDialog } from "../../../packages/ui/src/app-settings-dialog.js";
import { useAppCommands } from "../../../packages/ui/src/use-app-commands.js";
import { MarkdownBodyPreview } from "../../../packages/ui/src/markdown-body-preview.js";
import {
  createMarkdownBodyEditor,
  type MarkdownBodyEditorHandle,
} from "../../../packages/ui/src/markdown-live-editor.js";

const sample =
  "# 見出し1\n\n## 見出し2\n\n### 見出し3\n\n#### 見出し4\n\n##### 見出し5\n\n###### 見出し6\n\n本文の **強調** と `コード`。\n\nSetextの見出し\n================\n\n```js\nconst count = 1;\n```\n\n## まとめ\n- できていなかった活動の実現\n  - \n- **明示的な太字**\n\n本文終端";
export const runAppearanceBrowserChecks = async (parent: HTMLElement) => {
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
  const waitFor = async (predicate: () => boolean) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > 5000)
        throw new Error("Appearance browser check timed out");
      await settle();
    }
  };
  const storageKey = `pkm:test:appearance:${crypto.randomUUID()}`;
  const setItemDescriptor = Object.getOwnPropertyDescriptor(
    Storage.prototype,
    "setItem",
  )!;
  const originalSetItem = localStorage.setItem.bind(localStorage);
  let appearance!: ReturnType<typeof useAppearance>;
  let editor!: MarkdownBodyEditorHandle;
  const errors: unknown[] = [];
  const Harness = () => {
    appearance = useAppearance();
    const mount = useRef<HTMLDivElement>(null);
    const [opened, setOpened] = useState(true);
    const commands = useAppCommands({
      enabled: !opened,
      handlers: { "settings.open": { run: () => setOpened(true) } },
      onError: (reason) => errors.push(reason),
      storageKey: `${storageKey}:commands`,
    });
    useLayoutEffect(() => {
      const handle = createMarkdownBodyEditor({
        parent: mount.current!,
        document: sample,
      });
      editor = handle;
      return () => handle.destroy();
    }, []);
    return (
      <>
        <Text size="md" id="appearance-ui-sample">
          UIの文字
        </Text>
        <div id="appearance-live" className="entity-editor" ref={mount} />
        <div id="appearance-read">
          <MarkdownBodyPreview body={sample} onOpenEntity={() => {}} />
        </div>
        <div id="appearance-timeline" className="timeline-entry-body">
          <MarkdownBodyPreview body={sample} onOpenEntity={() => {}} />
        </div>
        <div className="entity-editor-raw">
          <textarea id="appearance-raw" readOnly defaultValue={sample} />
        </div>
        <AppSettingsDialog
          opened={opened}
          onClose={() => setOpened(false)}
          commands={commands}
        />
      </>
    );
  };
  let root = createRoot(parent);
  const mount = async () => {
    root.render(
      <StrictMode>
        <AppearanceProvider storageKey={storageKey}>
          <Harness />
        </AppearanceProvider>
      </StrictMode>,
    );
    await waitFor(
      () =>
        editor !== undefined &&
        document.querySelector("#appearance-read h1") !== null,
    );
    await settle();
  };
  const element = (selector: string): HTMLElement => {
    const found = document.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`Missing appearance element: ${selector}`);
    return found;
  };
  const css = (selector: string) => getComputedStyle(element(selector));
  const size = (selector: string) =>
    Math.round(parseFloat(css(selector).fontSize) * 100) / 100;
  const chooseAppearance = async () => {
    const tab = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((item) => item.textContent === "外観");
    if (!tab) throw new Error("Appearance category is missing");
    tab.click();
    await settle();
  };
  const scheme = () => document.documentElement.dataset.mantineColorScheme;
  const assertReadable = (selector: string) => {
    const channels = (value: string) => {
      const rgb = value
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number);
      if (!rgb || rgb.length !== 3)
        throw new Error(`Unsupported computed color: ${value}`);
      return rgb.map((part) => {
        const s = part / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
    };
    const luminance = (value: string) => {
      const c = channels(value);
      return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
    };
    const foreground = luminance(css(selector).color);
    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    const backgroundColor =
      bodyBackground === "rgba(0, 0, 0, 0)"
        ? getComputedStyle(document.documentElement).backgroundColor
        : bodyBackground;
    const background = luminance(backgroundColor);
    const ratio =
      (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05);
    if (ratio < 4.5)
      throw new Error(
        `Unreadable heading ${selector}: foreground ${css(selector).color}, background ${backgroundColor}, contrast ${ratio}`,
      );
    checks++;
  };
  try {
    await mount();
    equal(appearance.settings, DEFAULT_APPEARANCE);
    equal(size("#appearance-read .pkm-markdown-content"), 16);
    equal(size("#appearance-live .cm-content"), 16);
    equal(size("#appearance-ui-sample"), 14);
    equal(
      css("#appearance-read h1").color,
      css("#appearance-read .pkm-markdown-content").color,
    );
    equal(
      css("#appearance-live .cm-header-1").color,
      css("#appearance-read h1").color,
    );
    // The same Markdown keeps list typography and code presentation in both views.
    equal(document.querySelector("#appearance-timeline li h2"), null);
    equal(element("#appearance-timeline li li").textContent, "");
    equal(css("#appearance-timeline li").fontWeight, "400");
    equal(
      css("#appearance-timeline li").fontFamily,
      css("#appearance-live .cm-content").fontFamily,
    );
    equal(css("#appearance-timeline li strong").fontWeight, "700");
    const previewPre = "#appearance-timeline .pkm-preview-code-body";
    const editorPre = "#appearance-live .cm-codeblock-widget pre";
    for (const property of [
      "fontFamily",
      "fontSize",
      "lineHeight",
      "whiteSpace",
      "overflowWrap",
    ] as const)
      equal(css(previewPre)[property], css(editorPre)[property]);
    equal(
      css("#appearance-timeline .pkm-code-header").borderRadius,
      css("#appearance-live .pkm-code-header").borderRadius,
    );
    equal(
      element(previewPre).scrollWidth <= element(previewPre).clientWidth + 1,
      true,
    );

    // Entering the body or either fence must leave the following text in place.
    const editorHost = element("#appearance-live");
    for (const width of [640, 280]) {
      editorHost.style.width = `${Math.min(width, window.innerWidth - 16)}px`;
      for (const body of [
        "const x = 1;",
        "日本語と長い行 ".repeat(25) + "\n\n\tindented",
        "",
        null,
      ]) {
        const source = `before\n\n\`\`\`js\n${body === null ? "" : body + "\n"}\`\`\`\n\nafter`;
        editor.updateDocument(source);
        editor.view.dispatch({ selection: { anchor: 0 } });
        await settle();
        const afterTop = () =>
          element(
            "#appearance-live .cm-line:last-child",
          ).getBoundingClientRect().top;
        const top = afterTop();
        for (const anchor of [
          source.indexOf("\n", source.indexOf("```")) + 1,
          source.indexOf("```"),
          source.lastIndexOf("```"),
        ]) {
          editor.view.dispatch({ selection: { anchor } });
          await settle();
          if (Math.abs(afterTop() - top) > 1)
            throw new Error(
              `Code height shifted at width ${width}, anchor ${anchor}: ${top} -> ${afterTop()}`,
            );
          checks++;
        }
        editor.view.dispatch({ selection: { anchor: 0 } });
        await settle();
        equal(Math.abs(afterTop() - top) <= 1, true);
      }
    }
    editorHost.style.width = "";
    editor.updateDocument(sample);
    editor.view.dispatch({ selection: { anchor: 0 } });
    await settle();
    await chooseAppearance();
    equal(
      document.querySelector('[aria-label="外観プレビュー"]') !== null,
      true,
    );
    // Each control affects the rendered UI immediately.
    element("#appearance-heading-colors").click();
    await settle();
    equal(appearance.settings.headingColors, true);
    element("#appearance-compact-headings").click();
    await settle();
    equal(appearance.settings.compactHeadings, true);
    element('input[value="dark"]').click();
    await settle();
    equal(scheme(), "dark");
    const bodyControl = element("#appearance-body-font-size");
    bodyControl.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    equal(appearance.settings.bodyFontSize, 17);
    const changeNumber = (input: HTMLElement, value: string) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    changeNumber(bodyControl, "2");
    await settle();
    equal(appearance.settings.bodyFontSize, 17);
    changeNumber(bodyControl, "20");
    await settle();
    equal(appearance.settings.bodyFontSize, 20);
    const uiControl = element("#appearance-ui-font-size");
    uiControl.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowUp",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    equal(appearance.settings.uiFontSize, 15);
    const reset = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "外観を初期値に戻す")!;
    reset.click();
    await settle();
    equal(appearance.settings, DEFAULT_APPEARANCE);

    appearance.update({ bodyFontSize: 20 });
    await settle();
    for (const selector of [
      "#appearance-live .cm-content",
      "#appearance-read .pkm-markdown-content",
      "#appearance-timeline .pkm-markdown-content",
      "#appearance-raw",
      '[aria-label="外観プレビュー"] .pkm-markdown-content',
    ])
      equal(size(selector), 20);
    equal(size("#appearance-ui-sample"), 14);
    appearance.update({ uiFontSize: 18 });
    await settle();
    equal(size("#appearance-ui-sample"), 18);
    equal(document.documentElement.scrollWidth <= window.innerWidth, true);
    equal(
      element('[role="dialog"]').getBoundingClientRect().width <=
        window.innerWidth,
      true,
    );
    equal(size("#appearance-live .cm-content"), 20);
    equal(size("#appearance-read .pkm-markdown-content"), 20);
    appearance.update({ bodyFontSize: 12 });
    await settle();
    equal(size("#appearance-read .pkm-markdown-content"), 12);
    equal(
      size("#appearance-live .cm-content"),
      window.matchMedia("(max-width: 47.99em)").matches ? 16 : 12,
    );
    appearance.reset();
    await settle();

    const view = editor.view;
    const end = view.state.doc.length;
    view.dispatch({
      changes: { from: end, insert: "追記" },
      selection: { anchor: end + 2 },
    });
    const anchor = view.state.selection.main.anchor;
    const normalHeading = size("#appearance-read h1");
    const normalMargin = parseFloat(css("#appearance-read h2").marginTop);
    appearance.update({
      colorScheme: "light",
      headingColors: true,
      compactHeadings: true,
    });
    await settle();
    equal(editor.view === view, true);
    equal(view.state.doc.toString(), sample + "追記");
    equal(view.state.selection.main.anchor, anchor);
    equal(size("#appearance-read h1") < normalHeading, true);
    equal(
      parseFloat(css("#appearance-read h2").marginTop) < normalMargin,
      true,
    );
    equal(size("#appearance-live .cm-header-1"), size("#appearance-read h1"));
    const undoEvent = new KeyboardEvent("keydown", {
      key: "z",
      metaKey: navigator.platform.startsWith("Mac"),
      ctrlKey: !navigator.platform.startsWith("Mac"),
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(undoEvent);
    equal(undoEvent.defaultPrevented, true);
    equal(view.state.doc.toString(), sample);
    const lightHeading = css("#appearance-read h1").color;
    equal(lightHeading !== css("#appearance-read h2").color, true);
    equal(css("#appearance-live .cm-header-1").color, lightHeading);
    for (let level = 1; level <= 6; level++)
      assertReadable(`#appearance-read h${level}`);
    appearance.update({ colorScheme: "dark" });
    await settle();
    equal(scheme(), "dark");
    equal(css("#appearance-read h1").color !== lightHeading, true);
    equal(
      css("#appearance-live .cm-header-1").color,
      css("#appearance-read h1").color,
    );
    equal(
      css("#appearance-live .cm-strong").color,
      css("#appearance-live .cm-content").color,
    );
    for (let level = 1; level <= 6; level++)
      assertReadable(`#appearance-read h${level}`);
    // Setext headings share the level-one appearance.
    const liveHeadings = document.querySelectorAll<HTMLElement>(
      "#appearance-live .cm-header-1",
    );
    equal(liveHeadings.length >= 2, true);
    equal(
      getComputedStyle(liveHeadings[liveHeadings.length - 1]!).color,
      css("#appearance-read h1").color,
    );
    // OS changes propagate only when following the system.
    appearance.update({ colorScheme: "auto" });
    await settle();
    await fetch("/__appearance_scheme/dark");
    await waitFor(() => scheme() === "dark");
    equal(scheme(), "dark");
    await fetch("/__appearance_scheme/light");
    await waitFor(() => scheme() === "light");
    equal(scheme(), "light");
    appearance.update({ colorScheme: "dark" });
    await settle();
    await fetch("/__appearance_scheme/light");
    await settle();
    equal(scheme(), "dark");

    const saved = {
      colorScheme: "dark" as const,
      bodyFontSize: 20,
      uiFontSize: 16,
      headingColors: true,
      compactHeadings: true,
    };
    appearance.update(saved);
    await settle();
    root.unmount();
    root = createRoot(parent);
    await mount();
    equal(appearance.settings, saved);
    equal(size("#appearance-read .pkm-markdown-content"), 20);
    equal(size("#appearance-ui-sample"), 16);
    await chooseAppearance();
    Storage.prototype.setItem = function (key, value) {
      if (key === storageKey)
        throw new DOMException("Fixture storage failure", "QuotaExceededError");
      originalSetItem(key, value);
    };
    appearance.update({ colorScheme: "light" });
    await settle();
    equal(scheme(), "light");
    equal(appearance.persistenceError !== null, true);
    equal(
      document
        .querySelector('[role="alert"]')
        ?.textContent?.includes("保存できません"),
      true,
    );
    Object.defineProperty(Storage.prototype, "setItem", setItemDescriptor);
    appearance.update({ colorScheme: "dark" });
    await settle();
    equal(appearance.persistenceError, null);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: storageKey,
        newValue: JSON.stringify({ version: 1, ...DEFAULT_APPEARANCE }),
      }),
    );
    await settle();
    equal(appearance.settings, DEFAULT_APPEARANCE);
    appearance.update({
      colorScheme: "dark",
      headingColors: true,
      compactHeadings: true,
      bodyFontSize: 18,
    });
    await settle();
    equal(document.documentElement.scrollWidth <= window.innerWidth, true);
    equal(
      element('[role="dialog"]').getBoundingClientRect().width <=
        window.innerWidth,
      true,
    );
    equal(errors, []);
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    return { checks };
  } finally {
    Object.defineProperty(Storage.prototype, "setItem", setItemDescriptor);
    localStorage.removeItem(storageKey);
    localStorage.removeItem(`${storageKey}:commands`);
    await fetch("/__appearance_scheme/system");
  }
};
