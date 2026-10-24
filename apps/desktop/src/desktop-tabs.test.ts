import { describe, expect, it, vi } from "vitest";
import type { PkmEntityDocument } from "@pkm/contracts";
import {
  DesktopTabs,
  updateDesktopTabChanges,
  type DesktopEntityTab,
} from "./desktop-tabs.js";
import type { PkmIndexChanges } from "@pkm/contracts";

it("retains each tab's document and backlink invalidations across batched events", () => {
  const event: PkmIndexChanges = {
    reset: false,
    entities: [{ id: "a", type: "entry", fileHash: "sha256:a" }],
    types: ["entry"],
    scopeIds: [],
    backlinkIds: [],
    namesChanged: false,
    countsChanged: false,
    calendarChanged: false,
    conflictsChanged: false,
  };
  const first = updateDesktopTabChanges(new Map(), event, ["a", "b"]);
  const next = updateDesktopTabChanges(
    first,
    {
      ...event,
      entities: [{ id: "b", type: "entry", fileHash: "sha256:b" }],
      backlinkIds: ["a"],
    },
    ["a", "b"],
  );
  expect(next.get("a")).toEqual({
    document: 1,
    backlinks: 1,
    fileHash: "sha256:a",
  });
  expect(next.get("b")).toEqual({
    document: 1,
    backlinks: 0,
    fileHash: "sha256:b",
  });
  const reset = updateDesktopTabChanges(
    next,
    { ...event, reset: true, entities: [] },
    ["a"],
  );
  expect(reset.get("a")).toEqual({
    document: 2,
    backlinks: 2,
    fileHash: undefined,
  });
  expect(reset.has("b")).toBe(false);
});

const documentFor = (id: string): PkmEntityDocument => ({
  entity: {
    id,
    type: "entry",
    path: `entries/${id}.md`,
    displayName: id,
    origin: "manual",
    status: null,
    priority: null,
    projectId: null,
    areaId: null,
    taskId: null,
    resourceId: null,
    canonicalIdentifier: null,
    sourceUri: null,
    assetPath: null,
    journalDate: null,
    occurredAt: null,
    dueAt: null,
    topicIds: [],
    createdAt: "2026-10-03T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
    deletedAt: null,
    excludeFromAi: false,
    body: "body",
  },
  content: "body",
  fileHash: "sha256:initial",
  draft: null,
  hasExternalChange: false,
});
const tabFor = (id: string): DesktopEntityTab => ({
  id,
  document: documentFor(id),
  backlinks: [],
});
const setup = () => {
  const load = vi.fn<(id: string) => Promise<DesktopEntityTab>>((id) =>
    Promise.resolve(tabFor(id)),
  );
  const tabs = new DesktopTabs(load, vi.fn());
  return { tabs, load };
};

describe("Desktop Entity tab navigation", () => {
  it("prepares a background editor without saving or leaving the current draft", async () => {
    const { tabs, load } = setup();
    await tabs.open("a");
    const save = vi.fn().mockResolvedValue(false);
    tabs.register("a", { save, document: () => documentFor("a") });
    expect(await tabs.prepare("b")).toBe(true);
    expect(tabs.snapshot().activeId).toBe("a");
    expect(save).not.toHaveBeenCalled();
    await tabs.prepare("b");
    expect(load.mock.calls).toEqual([["a"], ["b"]]);
    expect(await tabs.open("b")).toBe(false);
    expect(tabs.snapshot().activeId).toBe("a");
  });
  it("serializes concurrent opens and reuses a single editor without reloading its draft", async () => {
    const { tabs, load } = setup();
    await Promise.all([
      tabs.open("a"),
      tabs.open("a"),
      tabs.open("b"),
      tabs.open("a"),
    ]);
    expect(load.mock.calls).toEqual([["a"], ["b"]]);
    expect(tabs.snapshot().tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
    const draft = { ...documentFor("a"), content: "unsaved buffer" };
    const save = vi.fn(() => Promise.resolve(true));
    tabs.register("a", { save, document: () => draft });
    await tabs.open("a");
    expect(save).not.toHaveBeenCalled();
    expect(tabs.currentDocument()).toBe(draft);
    await tabs.workspace();
    expect(save).toHaveBeenCalledTimes(1);
    await tabs.open("a");
    expect(tabs.currentDocument()).toBe(draft);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("waits for the current editor's pending save before loading or selecting another tab", async () => {
    const { tabs, load } = setup();
    await tabs.open("a");
    let finish!: (saved: boolean) => void;
    const saving = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    tabs.register("a", {
      save: () => saving,
      document: () => documentFor("a"),
    });
    const opening = tabs.open("b");
    await Promise.resolve();
    expect(tabs.snapshot().activeId).toBe("a");
    expect(load).toHaveBeenCalledTimes(1);
    finish(true);
    await opening;
    expect(tabs.snapshot().activeId).toBe("b");
  });

  it("blocks switching and closing on save/hash conflict, retaining the editor until resolved", async () => {
    const { tabs } = setup();
    await tabs.open("a");
    const save = vi.fn().mockResolvedValue(false);
    tabs.register("a", { save, document: () => documentFor("a") });
    expect(await tabs.open("b")).toBe(false);
    expect(await tabs.workspace()).toBe(false);
    expect(await tabs.close("a")).toBe(false);
    expect(tabs.snapshot().tabs.map((tab) => tab.id)).toEqual(["a"]);
    expect(tabs.snapshot().activeId).toBe("a");
    save.mockResolvedValue(true);
    expect(await tabs.close("a")).toBe(true);
    expect(tabs.snapshot()).toEqual({ tabs: [], activeId: null });
  });

  it("keeps the active tab when closing a background tab, focuses a failed background close, and selects the adjacent tab on success", async () => {
    const { tabs } = setup();
    await tabs.open("a");
    await tabs.open("b");
    await tabs.open("c");
    const save = vi.fn().mockResolvedValue(false);
    tabs.register("b", { save, document: () => documentFor("b") });
    expect(await tabs.close("b")).toBe(false);
    expect(tabs.snapshot().activeId).toBe("b");
    save.mockResolvedValue(true);
    await tabs.close("b");
    expect(tabs.snapshot().activeId).toBe("c");
    await tabs.close("a");
    expect(tabs.snapshot().activeId).toBe("c");
    await tabs.close("c");
    expect(tabs.snapshot().activeId).toBeNull();
  });

  it("does not create broken tabs on load failure and allows the next queued open", async () => {
    const { tabs, load } = setup();
    await tabs.open("a");
    load.mockRejectedValueOnce(new Error("file missing"));
    await expect(tabs.open("missing")).rejects.toThrow("file missing");
    expect(tabs.snapshot().activeId).toBe("a");
    await tabs.open("b");
    expect(tabs.snapshot().tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
  });

  it("invalidates pending old-Vault loads and resets without storing tabs for restoration", async () => {
    const { tabs, load } = setup();
    let finish!: (tab: DesktopEntityTab) => void;
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = tabs.open("old");
    const queued = tabs.open("also-old");
    await Promise.resolve();
    await Promise.resolve();
    tabs.reset();
    finish(tabFor("old"));
    expect(await pending).toBe(false);
    expect(await queued).toBe(false);
    expect(tabs.snapshot()).toEqual({ tabs: [], activeId: null });
    await tabs.open("new");
    expect(tabs.snapshot().tabs.map((tab) => tab.id)).toEqual(["new"]);
  });

  it("saves every open Entity before changing Vault and focuses any failing editor", async () => {
    const { tabs } = setup();
    await tabs.open("a");
    await tabs.open("b");
    const saveA = vi.fn(() => Promise.resolve(false));
    const saveB = vi.fn(() => Promise.resolve(true));
    tabs.register("a", { save: saveA, document: () => documentFor("a") });
    tabs.register("b", { save: saveB, document: () => documentFor("b") });
    expect(await tabs.saveAll()).toBe(false);
    expect(tabs.snapshot().activeId).toBe("a");
    expect(saveB).not.toHaveBeenCalled();
    saveA.mockResolvedValue(true);
    expect(await tabs.saveAll()).toBe(true);
    expect(saveB).toHaveBeenCalledTimes(1);
  });
});
