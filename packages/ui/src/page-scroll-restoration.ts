import { useLayoutEffect } from "react";
import type { PageLocation, PageTabSnapshot } from "./page-tabs.js";

export interface PageScrollPosition {
  readonly left: number;
  readonly top: number;
}

export const pageLocationKey = (location: PageLocation): string => {
  switch (location.kind) {
    case "entity":
      return `entity:${location.entityId}`;
    case "collection":
      return `collection:${location.type}${location.resourceType ? `:${location.resourceType}` : ""}`;
    default:
      return location.kind;
  }
};

const activePageKey = (snapshot: PageTabSnapshot) => {
  const tab = snapshot.tabs.find((tab) => tab.id === snapshot.activeId)!;
  return JSON.stringify([tab.id, pageLocationKey(tab.location)]);
};

interface ScrollViewport {
  read(): PageScrollPosition;
  write(position: PageScrollPosition): void;
}

// Window scrolling is shared by every tab. Capture before React hides the old
// panel; reading afterwards can capture a position clamped by the new page.
export class PageScrollRestoration {
  private readonly positions = new Map<string, PageScrollPosition>();
  private key: string | null = null;
  private viewport: ScrollViewport | null = null;
  private scope: string | null | undefined;
  private ready = false;
  private restoring = false;
  private target: PageScrollPosition = { left: 0, top: 0 };

  attach(viewport: ScrollViewport): void {
    this.viewport = viewport;
  }
  detach(): void {
    this.viewport = null;
  }

  remember(): void {
    if (this.key && this.viewport && this.ready && !this.restoring)
      this.positions.set(this.key, this.viewport.read());
  }

  prepare(snapshot: PageTabSnapshot): void {
    this.remember();
    this.select(snapshot);
  }

  private select(snapshot: PageTabSnapshot): void {
    const next = activePageKey(snapshot);
    if (next === this.key) return;
    this.key = next;
    this.target = this.positions.get(next) ?? { left: 0, top: 0 };
    this.restoring = true;
    this.ready = false;
  }

  show(snapshot: PageTabSnapshot, scope: string | null, ready: boolean): void {
    if (scope !== this.scope) {
      this.positions.clear();
      this.key = null;
      this.scope = scope;
    }
    this.select(snapshot);
    const open = new Set(snapshot.tabs.map((tab) => tab.id));
    for (const key of this.positions.keys())
      if (!open.has((JSON.parse(key) as [string, string])[0]))
        this.positions.delete(key);
    if (!ready && this.ready) {
      this.target = this.positions.get(this.key!) ?? { left: 0, top: 0 };
      this.restoring = true;
    }
    this.ready = ready;
    this.restore();
    if (this.ready && !this.restoring) this.remember();
  }

  restore(): void {
    if (!this.restoring || !this.ready || !this.viewport) return;
    this.viewport.write(this.target);
    const actual = this.viewport.read();
    // A loading placeholder, lazy editor, or image may still make the page
    // too short. Retain the target and retry when the layout grows.
    if (
      Math.abs(actual.top - this.target.top) < 1 &&
      Math.abs(actual.left - this.target.left) < 1
    ) {
      this.restoring = false;
      this.remember();
    }
  }

  userInteraction(): void {
    // Once the user starts scrolling/typing, stop retries so late data cannot
    // drag the viewport back to the old reading position.
    this.restoring = false;
    this.remember();
  }
}

export const usePageScrollRestoration = (
  restoration: PageScrollRestoration,
  snapshot: PageTabSnapshot,
  scope: string | null,
  renderedLocation: PageLocation,
  ready: boolean,
): void => {
  const key = activePageKey(snapshot);
  const activeLocation = snapshot.tabs.find(
    (tab) => tab.id === snapshot.activeId,
  )!.location;
  const visible =
    ready &&
    pageLocationKey(activeLocation) === pageLocationKey(renderedLocation);
  useLayoutEffect(() => {
    restoration.attach({
      read: () => ({ left: window.scrollX, top: window.scrollY }),
      write: ({ left, top }) =>
        window.scrollTo({ left, top, behavior: "instant" }),
    });
    const remember = () => restoration.remember();
    const interact = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".page-tab-strip,.entity-navbar,.app-header")
      )
        return;
      restoration.userInteraction();
    };
    window.addEventListener("scroll", remember, { passive: true });
    window.addEventListener("wheel", interact, { passive: true });
    window.addEventListener("touchmove", interact, { passive: true });
    window.addEventListener("keydown", interact);
    window.addEventListener("pointerdown", interact);
    const observer = new ResizeObserver(() => restoration.restore());
    observer.observe(document.body);
    return () => {
      window.removeEventListener("scroll", remember);
      window.removeEventListener("wheel", interact);
      window.removeEventListener("touchmove", interact);
      window.removeEventListener("keydown", interact);
      window.removeEventListener("pointerdown", interact);
      observer.disconnect();
      restoration.detach();
    };
  }, [restoration]);
  useLayoutEffect(() => {
    restoration.show(snapshot, scope, visible);
  }, [restoration, key, scope, visible, snapshot]);
};
