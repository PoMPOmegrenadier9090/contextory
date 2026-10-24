import { describe, expect, it } from "vitest";
import { PageTabs, type PageTabSnapshot } from "./page-tabs.js";
import { PageScrollRestoration } from "./page-scroll-restoration.js";

const setup = () => {
  const scroll = new PageScrollRestoration();
  let position = { left: 0, top: 0 };
  let height = 4000;
  const pages = new PageTabs((snapshot) => scroll.prepare(snapshot));
  scroll.attach({
    read: () => position,
    write: (next) => {
      position = { ...next, top: Math.min(next.top, height) };
    },
  });
  const show = (ready = true, scope = "vault-a") =>
    scroll.show(pages.snapshot(), scope, ready);
  show();
  return {
    scroll,
    pages,
    show,
    get position() {
      return position;
    },
    move(top: number) {
      position = { left: 0, top };
      scroll.remember();
    },
    shrink(heightTo: number) {
      height = heightTo;
      position = { left: 0, top: Math.min(position.top, height) };
    },
    grow() {
      height = 4000;
      scroll.restore();
    },
  };
};

describe("page scroll restoration", () => {
  it("keeps independent positions and captures the outgoing page before layout clamps it", () => {
    const target = setup();
    const first = target.pages.snapshot().activeId;
    target.move(1300);
    target.pages.navigate({ kind: "entity", entityId: "b" }, { newTab: true });
    target.shrink(0);
    target.show();
    expect(target.position.top).toBe(0);
    target.grow();
    target.move(600);
    target.pages.activate(first);
    target.show();
    expect(target.position.top).toBe(1300);
  });

  it("waits for loading and retries when the document grows", () => {
    const target = setup();
    const first = target.pages.snapshot().activeId;
    target.move(1600);
    target.pages.navigate({ kind: "entity", entityId: "b" }, { newTab: true });
    target.show();
    target.pages.activate(first);
    target.shrink(0);
    target.show(false);
    target.scroll.remember();
    target.show();
    expect(target.position.top).toBe(0);
    target.grow();
    expect(target.position.top).toBe(1600);
  });

  it("keeps a saved position through a same-page loading placeholder", () => {
    const target = setup();
    target.move(900);
    target.scroll.prepare(target.pages.snapshot());
    target.shrink(0);
    target.show(false);
    target.grow();
    target.show();
    expect(target.position.top).toBe(900);
  });

  it("does not reset positions on background tab creation, reordering or closing", () => {
    const target = setup();
    target.move(800);
    const first = target.pages.snapshot().activeId;
    target.pages.navigate(
      { kind: "entity", entityId: "b" },
      { newTab: true, activate: false },
    );
    const second = target.pages.snapshot().tabs[1]!.id;
    target.show();
    expect(target.position.top).toBe(800);
    target.pages.move(second, first);
    target.show();
    expect(target.position.top).toBe(800);
    target.pages.close(second);
    target.show();
    expect(target.position.top).toBe(800);
  });

  it("starts new destinations at the top and remembers history destinations within the same tab", () => {
    const target = setup();
    target.move(700);
    target.pages.navigate({ kind: "collection", type: "entry" });
    target.show();
    expect(target.position.top).toBe(0);
    target.move(400);
    target.pages.navigate({ kind: "workspace" });
    target.show();
    expect(target.position.top).toBe(700);
  });

  it("restores the neighboring tab when the active tab closes and clears a new Vault", () => {
    const target = setup();
    target.move(1100);
    target.pages.navigate({ kind: "timeline" }, { newTab: true });
    target.show();
    target.pages.close(target.pages.snapshot().activeId);
    target.show();
    expect(target.position.top).toBe(1100);
    target.show(true, "vault-b");
    expect(target.position.top).toBe(0);
  });

  it("does not pull the user back after interacting with a partially restored page", () => {
    const target = setup();
    target.move(1000);
    const first = target.pages.snapshot().activeId;
    target.pages.navigate({ kind: "timeline" }, { newTab: true });
    target.show();
    target.pages.activate(first);
    target.shrink(300);
    target.show();
    target.scroll.userInteraction();
    target.move(100);
    target.grow();
    expect(target.position.top).toBe(100);
  });

  it("prunes closed tabs rather than reusing their scroll positions", () => {
    const target = setup();
    const first = target.pages.snapshot().tabs[0]!;
    target.move(1400);
    target.pages.navigate({ kind: "timeline" }, { newTab: true });
    target.show();
    target.pages.close(first.id);
    target.show();
    const reopened: PageTabSnapshot = {
      tabs: [...target.pages.snapshot().tabs, first],
      activeId: first.id,
    };
    target.scroll.prepare(reopened);
    target.scroll.show(reopened, "vault-a", true);
    expect(target.position.top).toBe(0);
  });
});
