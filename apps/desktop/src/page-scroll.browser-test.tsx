import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PageTabs,
  type PageTabSnapshot,
} from "../../../packages/ui/src/page-tabs.js";
import {
  PageScrollRestoration,
  usePageScrollRestoration,
} from "../../../packages/ui/src/page-scroll-restoration.js";

export const runPageScrollBrowserChecks = async (parent: HTMLElement) => {
  let checks = 0;
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected)
      throw new Error(
        `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    checks++;
  };
  const frame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const settle = async () => {
    await frame();
    await frame();
  };
  let controls:
    | {
        pages: PageTabs;
        load(ready: boolean): void;
        height(height: number): void;
        keepAlive(value: boolean): void;
        scope(value: string): void;
      }
    | undefined;
  const TestPages = () => {
    const [snapshot, setSnapshot] = useState<PageTabSnapshot>(() =>
      new PageTabs(() => {}).snapshot(),
    );
    const restoration = useRef(new PageScrollRestoration());
    const pages = useMemo(
      () =>
        new PageTabs((next) => {
          restoration.current.prepare(next);
          setSnapshot(next);
        }),
      [],
    );
    const [ready, setReady] = useState(true);
    const [height, setHeight] = useState(3200);
    const [keepAlive, setKeepAlive] = useState(false);
    const [scope, setScope] = useState("vault-a");
    const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeId)!;
    usePageScrollRestoration(
      restoration.current,
      snapshot,
      scope,
      active.location,
      ready,
    );
    controls = {
      pages,
      load: setReady,
      height: setHeight,
      keepAlive: setKeepAlive,
      scope: setScope,
    };
    return (
      <>
        <nav className="page-tab-strip" style={{ position: "fixed", top: 0 }}>
          {snapshot.tabs.map((tab) => (
            <button
              key={tab.id}
              id={`scroll-tab-${tab.id}`}
              onClick={() => pages.activate(tab.id)}
            >
              {tab.id}
            </button>
          ))}
        </nav>
        {keepAlive ? (
          snapshot.tabs.map((tab) => (
            <section
              key={tab.id}
              hidden={tab.id !== active.id}
              style={{ height: ready ? height : 80 }}
            >
              {tab.id}
            </section>
          ))
        ) : (
          <section key={active.id} style={{ height: ready ? height : 80 }}>
            {active.id}
          </section>
        )}
      </>
    );
  };
  const root = createRoot(parent);
  root.render(
    <StrictMode>
      <TestPages />
    </StrictMode>,
  );
  await settle();
  for (let frameNumber = 0; !controls && frameNumber < 60; frameNumber++)
    await frame();
  if (!controls) throw new Error("Scroll test pages did not mount");
  const target = controls;
  const move = async (top: number) => {
    window.scrollTo({ top, left: 0, behavior: "instant" });
    await settle();
    equal(window.scrollY, top);
  };
  const activate = async (id: string) => {
    parent.querySelector<HTMLButtonElement>(`#scroll-tab-${id}`)!.click();
    await settle();
  };
  for (const keepAlive of [false, true]) {
    target.keepAlive(keepAlive);
    target.height(3200);
    target.load(true);
    await settle();
    const first = target.pages.snapshot().activeId;
    await move(1100);
    target.pages.navigate(
      { kind: "entity", entityId: keepAlive ? "kept-b" : "loaded-b" },
      { newTab: true },
    );
    await settle();
    const second = target.pages.snapshot().activeId;
    equal(window.scrollY, 0);
    await move(500);
    await activate(first);
    equal(window.scrollY, 1100);
    await activate(second);
    equal(window.scrollY, 500);

    // Web-like loading replaces the page by a short placeholder. Returning to
    // it must retain the target until the saved document is displayed.
    target.load(false);
    target.pages.activate(first);
    await settle();
    equal(window.scrollY, 0);
    target.load(true);
    await settle();
    equal(window.scrollY, 1100);

    // Ready content can still be too short until an editor/image/data mounts.
    await activate(second);
    target.height(80);
    target.pages.activate(first);
    await settle();
    equal(window.scrollY, 0);
    target.height(3200);
    await settle();
    equal(window.scrollY, 1100);

    target.pages.navigate(
      { kind: "timeline" },
      { newTab: true, activate: false },
    );
    await settle();
    equal(window.scrollY, 1100);
    const background = target.pages
      .snapshot()
      .tabs.find((tab) => tab.location.kind === "timeline")!.id;
    target.pages.move(background, first);
    await settle();
    equal(window.scrollY, 1100);
    target.pages.close(background);
    await settle();
    equal(window.scrollY, 1100);
    await activate(second);
    target.pages.close(second);
    await settle();
    equal(window.scrollY, 1100);
  }

  const first = target.pages.snapshot().activeId;
  await move(1000);
  target.pages.navigate({ kind: "todos" }, { newTab: true });
  await settle();
  target.height(800);
  target.pages.activate(first);
  await settle();
  parent.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  await move(100);
  target.height(3200);
  await settle();
  equal(window.scrollY, 100);
  target.scope("vault-b");
  await settle();
  equal(window.scrollY, 0);
  root.unmount();
  return { checks };
};
