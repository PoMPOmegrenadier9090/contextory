import "@mantine/core/styles.css";
import "../../../packages/ui/src/compact.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { PkmQuickOpenResult } from "@pkm/contracts";
import { AppearanceProvider } from "../../../packages/ui/src/appearance-provider.js";
import { QuickOpenDialog } from "../../../packages/ui/src/quick-open-dialog.js";

export const runQuickOpenBrowserChecks = async (
  parent: HTMLElement,
  nativeInput = false,
) => {
  let checks = 0;
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected)
      throw new Error(
        `Quick Open: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
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
  const results: PkmQuickOpenResult[] = Array.from(
    { length: 30 },
    (_, index) => ({
      id: `result-${index}`,
      type: "note",
      path: `notes/result-${index}.md`,
      displayName: `候補 ${index}`,
      updatedAt: "2026-10-18T00:00:00.000Z",
      breadcrumb: "テスト / ノート",
      snippet: "スクロール確認用の検索結果です。",
    }),
  );
  const entities: [] = [];
  const pinnedIds = new Set<string>();
  const recentIds: [] = [];
  const search = () => Promise.resolve(results);
  const opened: string[] = [];
  let show!: () => void;
  const Harness = () => {
    const [visible, setVisible] = useState(true);
    show = () => setVisible(true);
    return (
      <AppearanceProvider>
        <QuickOpenDialog
          opened={visible}
          onClose={() => setVisible(false)}
          onOpenEntity={(id) => {
            opened.push(id);
            return Promise.resolve();
          }}
          search={search}
          entities={entities}
          pinnedIds={pinnedIds}
          recentIds={recentIds}
        />
      </AppearanceProvider>
    );
  };
  const root = createRoot(parent);
  const input = () =>
    document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const query = async () => {
    for (let frame = 0; frame < 120 && !input(); frame++) await settle();
    const field = input();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, "候補");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    for (let frame = 0; frame < 120; frame++) {
      await settle();
      if (document.querySelectorAll('[role="option"]').length === 30) return;
    }
    throw new Error("Quick Open results did not load");
  };
  const key = async (value: string) => {
    input().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
  };
  try {
    root.render(<Harness />);
    await settle();
    await query();
    const viewport = document.querySelector<HTMLDivElement>(
      ".quick-open-results",
    )!;
    equal(viewport.clientHeight <= 360, true);
    equal(viewport.scrollHeight > viewport.clientHeight, true);
    viewport.scrollTop = 155;
    await settle();
    equal(viewport.scrollTop, 155);
    const partial = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((option) => {
      const row = option.getBoundingClientRect();
      const bounds = viewport.getBoundingClientRect();
      return row.top < bounds.top && row.bottom > bounds.top;
    })!;
    equal(partial !== undefined, true);
    partial.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await settle();
    equal(partial.getAttribute("aria-selected"), "true");
    equal(viewport.scrollTop, 155);
    for (let index = 0; index < 10; index++) await key("ArrowDown");
    equal(viewport.scrollTop > 155, true);
    const selected = document.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    )!;
    const row = selected.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    equal(row.top >= bounds.top - 1 && row.bottom <= bounds.bottom + 1, true);
    const selectedId = selected.id.replace(
      `${document.querySelector('[role="listbox"]')!.id}-`,
      "",
    );
    await key("Enter");
    equal(opened[0], selectedId);
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    show();
    await settle();
    await query();
    const last =
      document.querySelectorAll<HTMLButtonElement>('[role="option"]')[29]!;
    last.click();
    await settle();
    equal(opened[1], "result-29");
    if (nativeInput) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      show();
      await settle();
      await query();
      document.querySelector<HTMLDivElement>(".quick-open-results")!.scrollTop =
        0;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    return { checks };
  } finally {
    if (!nativeInput) root.unmount();
  }
};
