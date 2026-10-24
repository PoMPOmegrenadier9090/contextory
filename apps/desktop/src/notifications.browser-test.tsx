import "@mantine/core/styles.css";
import "../../../packages/ui/src/compact.css";
import { MantineProvider } from "@mantine/core";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  NotificationProvider,
  useNotification,
  usePersistentWarning,
} from "@pkm/ui";

export const runNotificationBrowserChecks = async (parent: HTMLElement) => {
  let checks = 0;
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected)
      throw Error(
        `Notification check ${checks}: expected ${String(expected)}, received ${String(actual)}`,
      );
    checks++;
  };
  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate: () => boolean) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > 5000)
        throw Error(`Notification check ${checks} timed out`);
      await delay(20);
    }
  };
  let success!: ReturnType<typeof useNotification>;
  let error!: ReturnType<typeof useNotification>;
  let setWarning!: (warning: boolean) => void;
  const Harness = () => {
    success = useNotification("success");
    error = useNotification("error");
    const [warning, updateWarning] = useState(false);
    setWarning = updateWarning;
    usePersistentWarning(warning ? "競合を解消してください" : null);
    return (
      <>
        <input aria-label="編集中" />
        <div style={{ height: 1800 }}>本文</div>
        <div className="floating-actions">
          <button>新規作成</button>
        </div>
      </>
    );
  };
  const cards = (kind: string) =>
    document.querySelectorAll<HTMLElement>(
      `.app-notification[data-kind="${kind}"]`,
    );
  const root = createRoot(parent);
  try {
    root.render(
      <StrictMode>
        <MantineProvider>
          <NotificationProvider>
            <Harness />
          </NotificationProvider>
        </MantineProvider>
      </StrictMode>,
    );
    await waitFor(() => parent.querySelector("input") !== null);
    const input = parent.querySelector("input")!;
    input.focus();
    input.value = "入力中の文章";
    window.scrollTo(0, 200);
    const scroll = window.scrollY;
    const height = parent.getBoundingClientRect().height;
    error("保存できませんでした");
    success("保存しました");
    setWarning(true);
    await waitFor(
      () => cards("success").length === 1 && cards("warning").length === 1,
    );
    equal(cards("error").length, 1);
    equal(document.activeElement, input);
    equal(input.value, "入力中の文章");
    equal(window.scrollY, scroll);
    equal(parent.getBoundingClientRect().height, height);
    equal(parent.querySelector(".app-notification"), null);
    const viewport = document.querySelector<HTMLElement>(".app-notifications")!;
    equal(getComputedStyle(viewport).position, "fixed");
    const rect = viewport.getBoundingClientRect();
    equal(rect.left >= 0 && rect.right <= innerWidth, true);
    const actions = document
      .querySelector(".floating-actions")!
      .getBoundingClientRect();
    equal(rect.bottom <= actions.top, true);
    const card = cards("error")[0]!;
    const message = card
      .querySelector(".app-notification-message")!
      .getBoundingClientRect();
    equal(
      card.contains(
        document.elementFromPoint(message.left + 2, message.top + 2),
      ),
      false,
    );
    const close = card.querySelector("button")!;
    const buttonRect = close.getBoundingClientRect();
    equal(
      close.contains(
        document.elementFromPoint(
          buttonRect.left + buttonRect.width / 2,
          buttonRect.top + buttonRect.height / 2,
        ),
      ),
      true,
    );

    await delay(1500);
    const first = cards("success")[0];
    success("保存しました");
    await waitFor(() => cards("success")[0] !== first);
    error("保存できませんでした");
    await delay(1700);
    equal(cards("error").length, 1);
    equal(cards("success").length, 1);
    equal(cards("warning").length, 1);
    equal(document.activeElement, input);
    setWarning(false);
    await waitFor(() => cards("warning").length === 0);
    await waitFor(
      () => parseFloat(getComputedStyle(cards("success")[0]!).opacity) < 0.9,
    );
    await waitFor(() => cards("success").length === 0);
    equal(cards("error").length, 1);
    cards("error")[0]!.querySelector<HTMLButtonElement>("button")!.click();
    await waitFor(() => cards("error").length === 0);
    error("別のエラー");
    success("再保存しました");
    await waitFor(
      () => cards("success").length === 1 && cards("error").length === 1,
    );
    cards("success")[0]!.querySelector<HTMLButtonElement>("button")!.click();
    await waitFor(() => cards("success").length === 0);
    equal(cards("error").length, 1);
    return { checks };
  } finally {
    root.unmount();
    window.scrollTo(0, 0);
  }
};
