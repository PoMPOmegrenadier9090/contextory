import type { EntityType, ResourceType } from "@pkm/contracts";

export type PageLocation =
  | { readonly kind: "entity"; readonly entityId: string }
  | { readonly kind: "workspace" }
  | {
      readonly kind: "collection";
      readonly type: EntityType;
      readonly resourceType?: ResourceType;
    }
  | { readonly kind: "timeline" }
  | { readonly kind: "todos" };

export interface PageTab {
  readonly id: string;
  readonly location: PageLocation;
}
export interface PageTabSnapshot {
  readonly tabs: readonly PageTab[];
  readonly activeId: string;
}
export interface PageTabOpenOptions {
  readonly newTab?: boolean;
  readonly reuse?: boolean;
  readonly activate?: boolean;
  readonly tabId?: string;
}
export type PageTabAction =
  | { readonly kind: "new" }
  | { readonly kind: "select"; readonly id: string }
  | { readonly kind: "close"; readonly id: string };

// Page identities survive navigation. An Entity has at most one open editor.
export class PageTabs {
  private sequence = 1;
  private state: PageTabSnapshot = {
    tabs: [{ id: "page-1", location: { kind: "workspace" } }],
    activeId: "page-1",
  };
  constructor(private readonly changed: (state: PageTabSnapshot) => void) {}
  snapshot(): PageTabSnapshot {
    return this.state;
  }
  private publish(state: PageTabSnapshot): void {
    this.state = state;
    this.changed(state);
  }
  navigate(location: PageLocation, options: PageTabOpenOptions = {}): void {
    const sameLocation = (candidate: PageLocation): boolean => {
      if (candidate.kind !== location.kind) return false;
      if (candidate.kind === "entity" && location.kind === "entity")
        return candidate.entityId === location.entityId;
      if (candidate.kind === "collection" && location.kind === "collection")
        return (
          candidate.type === location.type &&
          candidate.resourceType === location.resourceType
        );
      return true;
    };
    const existing =
      location.kind === "entity"
        ? this.state.tabs.find(
            (tab) =>
              tab.location.kind === "entity" &&
              tab.location.entityId === location.entityId,
          )
        : options.reuse
          ? this.state.tabs.find((tab) => sameLocation(tab.location))
          : undefined;
    if (existing) {
      if (options.activate !== false)
        this.publish({ ...this.state, activeId: existing.id });
      return;
    }
    if (options.newTab === true && options.tabId === undefined) {
      const tab = { id: `page-${++this.sequence}`, location };
      const position =
        this.state.tabs.findIndex((item) => item.id === this.state.activeId) +
        1;
      const tabs = [...this.state.tabs];
      tabs.splice(position, 0, tab);
      this.publish({
        tabs,
        activeId: options.activate === false ? this.state.activeId : tab.id,
      });
    } else {
      const id = options.tabId ?? this.state.activeId;
      if (!this.state.tabs.some((tab) => tab.id === id)) return;
      this.publish({
        tabs: this.state.tabs.map((tab) =>
          tab.id === id ? { ...tab, location } : tab,
        ),
        activeId: id,
      });
    }
  }
  activate(id: string): void {
    if (this.state.tabs.some((tab) => tab.id === id))
      this.publish({ ...this.state, activeId: id });
  }
  closeTarget(id: string): PageTab | undefined {
    const position = this.state.tabs.findIndex((tab) => tab.id === id);
    if (position < 0 || id !== this.state.activeId) return undefined;
    return this.state.tabs[position + 1] ?? this.state.tabs[position - 1];
  }
  close(id: string): void {
    if (!this.state.tabs.some((tab) => tab.id === id)) return;
    const target = this.closeTarget(id);
    const tabs = this.state.tabs.filter((tab) => tab.id !== id);
    if (!tabs.length) {
      const home = {
        id: `page-${++this.sequence}`,
        location: { kind: "workspace" },
      } as const;
      this.publish({ tabs: [home], activeId: home.id });
    } else this.publish({ tabs, activeId: target?.id ?? this.state.activeId });
  }
  move(id: string, beforeId: string): void {
    if (id === beforeId) return;
    const tab = this.state.tabs.find((item) => item.id === id);
    if (!tab || !this.state.tabs.some((item) => item.id === beforeId)) return;
    const tabs = this.state.tabs.filter((item) => item.id !== id);
    tabs.splice(
      tabs.findIndex((item) => item.id === beforeId),
      0,
      tab,
    );
    this.publish({ ...this.state, tabs });
  }
  reset(): void {
    const tab = {
      id: `page-${++this.sequence}`,
      location: { kind: "workspace" },
    } as const;
    this.publish({ tabs: [tab], activeId: tab.id });
  }
}
