import { describe, expect, it, vi } from "vitest";
import { pageTabLabel } from "./page-tab-bar.js";
import { pageLocationKey } from "./page-scroll-restoration.js";
import { PageTabs } from "./page-tabs.js";

describe("page tabs", () => {
  it("keeps Resource kinds separate from the full collection and reuses each view", () => {
    const pages = new PageTabs(vi.fn());
    const all = { kind: "collection", type: "resource" } as const;
    const books = { ...all, resourceType: "book" } as const;
    const papers = { ...all, resourceType: "paper" } as const;
    const ids = [all, books, papers].map((location) => {
      pages.navigate(location, { newTab: true, reuse: true });
      return pages.snapshot().activeId;
    });
    expect(new Set(ids).size).toBe(3);
    for (const [index, location] of [all, books, papers].entries()) {
      pages.navigate(location, { newTab: true, reuse: true });
      expect(pages.snapshot().activeId).toBe(ids[index]);
    }
    expect(pages.snapshot().tabs).toHaveLength(4);
    expect([all, books, papers].map(pageLocationKey)).toEqual([
      "collection:resource",
      "collection:resource:book",
      "collection:resource:paper",
    ]);
    expect(
      [all, books, papers].map((location) =>
        pageTabLabel({ id: "tab", location }, []),
      ),
    ).toEqual(["Resources", "Resources / 書籍", "Resources / 論文"]);
  });
  it("opens sidebar views separately and navigates their contents in the same tab", () => {
    const pages = new PageTabs(vi.fn());
    const home = pages.snapshot().activeId;
    pages.navigate({ kind: "entity", entityId: "project" }, { newTab: true });
    const project = pages.snapshot().activeId;
    const openResources = () =>
      pages.navigate(
        { kind: "collection", type: "resource" },
        { newTab: true, reuse: true },
      );
    openResources();
    const resources = pages.snapshot().activeId;
    pages.navigate({ kind: "entity", entityId: "resource-a" });
    expect(pages.snapshot().activeId).toBe(resources);
    pages.navigate({ kind: "entity", entityId: "resource-b" });
    expect(pages.snapshot().tabs).toHaveLength(3);
    expect(pages.snapshot().activeId).toBe(resources);
    pages.navigate({ kind: "collection", type: "resource" });
    pages.activate(project);
    openResources();
    expect(pages.snapshot().activeId).toBe(resources);
    expect(pages.snapshot().tabs).toHaveLength(3);
    expect(
      pages.snapshot().tabs.find((tab) => tab.id === project)?.location,
    ).toEqual({ kind: "entity", entityId: "project" });
    pages.navigate({ kind: "workspace" }, { newTab: true, reuse: true });
    expect(pages.snapshot().activeId).toBe(home);
  });
  it("supports explicit replacement for mobile navigation and history", () => {
    const pages = new PageTabs(vi.fn());
    const home = pages.snapshot().activeId;
    pages.navigate({ kind: "entity", entityId: "a" }, { newTab: false });
    expect(pages.snapshot().tabs).toEqual([
      { id: home, location: { kind: "entity", entityId: "a" } },
    ]);
  });
  it("opens a background tab without changing the current page and reuses Entity tabs", () => {
    const pages = new PageTabs(vi.fn());
    const home = pages.snapshot().activeId;
    pages.navigate(
      { kind: "entity", entityId: "a" },
      { newTab: true, activate: false },
    );
    expect(pages.snapshot().activeId).toBe(home);
    const entityTab = pages.snapshot().tabs[1]!;
    pages.navigate({ kind: "entity", entityId: "a" }, { newTab: true });
    expect(pages.snapshot().tabs).toHaveLength(2);
    expect(pages.snapshot().activeId).toBe(entityTab.id);
    pages.navigate({ kind: "entity", entityId: "a" }, { newTab: true });
    expect(pages.snapshot().tabs).toHaveLength(2);
  });
  it("treats Home as a closable, reorderable page and supports multiple new tabs", () => {
    const pages = new PageTabs(vi.fn());
    const original = pages.snapshot().activeId;
    pages.navigate({ kind: "workspace" }, { newTab: true });
    const second = pages.snapshot().activeId;
    pages.move(second, original);
    expect(pages.snapshot().tabs.map((tab) => tab.id)).toEqual([
      second,
      original,
    ]);
    pages.close(original);
    expect(pages.snapshot().activeId).toBe(second);
    pages.close(second);
    expect(pages.snapshot().tabs).toHaveLength(1);
    expect(pages.snapshot().tabs[0]!.location).toEqual({ kind: "workspace" });
    expect(pages.snapshot().activeId).not.toBe(second);
  });
  it("selects the neighbor only for an active close and preserves background tab selection", () => {
    const pages = new PageTabs(vi.fn());
    const first = pages.snapshot().activeId;
    pages.navigate({ kind: "collection", type: "task" }, { newTab: true });
    const second = pages.snapshot().activeId;
    pages.navigate({ kind: "timeline" }, { newTab: true });
    const third = pages.snapshot().activeId;
    pages.close(second);
    expect(pages.snapshot().activeId).toBe(third);
    expect(pages.closeTarget(third)?.id).toBe(first);
    pages.close(third);
    expect(pages.snapshot().activeId).toBe(first);
  });
  it("retains an existing tab location on activation and resets the session for a new Vault", () => {
    const pages = new PageTabs(vi.fn());
    const first = pages.snapshot().activeId;
    pages.navigate({ kind: "collection", type: "resource" }, { newTab: false });
    pages.navigate({ kind: "workspace" }, { newTab: true });
    pages.activate(first);
    expect(pages.snapshot().tabs[0]!.location).toEqual({
      kind: "collection",
      type: "resource",
    });
    pages.reset();
    expect(pages.snapshot().tabs).toHaveLength(1);
    expect(pages.snapshot().tabs[0]!.location.kind).toBe("workspace");
  });
});
