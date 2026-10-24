import { useCallback, useEffect, useState } from "react";
import type React from "react";

const readStoredNumber = (key: string, fallback: number): number => {
  const stored = globalThis.localStorage?.getItem(key);
  if (stored === null || stored === undefined) return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? value : fallback;
};

const readStoredBoolean = (key: string, fallback: boolean): boolean => {
  const value = globalThis.localStorage?.getItem(key);
  return value === null || value === undefined ? fallback : value === "true";
};

export interface ResizableSidebarState {
  readonly mobile: boolean;
  readonly width: number;
  readonly collapsed: boolean;
  readonly overlayOpen: boolean;
  readonly setCollapsed: (collapsed: boolean) => void;
  readonly toggleCollapsed: () => void;
  readonly startResize: React.PointerEventHandler<HTMLDivElement>;
  readonly closeOnNavigate: () => void;
}

export const useMobileLayout = (): boolean => {
  const [mobile, setMobile] = useState(
    () => globalThis.matchMedia?.("(max-width: 47.99em)").matches ?? false,
  );
  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const query = globalThis.matchMedia("(max-width: 47.99em)");
    const update = (): void => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
};

export const useResizableSidebar = (
  storageKey: string,
  initialWidth = 216,
): ResizableSidebarState => {
  const [width, setWidth] = useState(() =>
    Math.min(
      560,
      Math.max(184, readStoredNumber(`${storageKey}:width`, initialWidth)),
    ),
  );
  const [desktopCollapsed, setCollapsedState] = useState(() =>
    readStoredBoolean(`${storageKey}:collapsed`, false),
  );
  const [mobileCollapsed, setMobileCollapsed] = useState(true);
  const mobile = useMobileLayout();
  const collapsed = mobile ? mobileCollapsed : desktopCollapsed;

  const setCollapsed = useCallback(
    (next: boolean): void => {
      if (mobile) {
        setMobileCollapsed(next);
        return;
      }
      setCollapsedState(next);
      globalThis.localStorage?.setItem(`${storageKey}:collapsed`, String(next));
    },
    [mobile, storageKey],
  );

  const startResize = useCallback<React.PointerEventHandler<HTMLDivElement>>(
    (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      const move = (moveEvent: PointerEvent): void => {
        const next = Math.min(
          560,
          Math.max(184, startWidth + moveEvent.clientX - startX),
        );
        setWidth(next);
      };
      const stop = (): void => {
        globalThis.removeEventListener("pointermove", move);
        globalThis.removeEventListener("pointerup", stop);
        setWidth((current) => {
          globalThis.localStorage?.setItem(
            `${storageKey}:width`,
            String(current),
          );
          return current;
        });
      };
      globalThis.addEventListener("pointermove", move);
      globalThis.addEventListener("pointerup", stop, { once: true });
    },
    [storageKey, width],
  );

  return {
    mobile,
    width,
    collapsed,
    overlayOpen: mobile && !mobileCollapsed,
    setCollapsed,
    toggleCollapsed: () => setCollapsed(!collapsed),
    startResize,
    closeOnNavigate: () => {
      if (mobile) setMobileCollapsed(true);
    },
  };
};

const readPinnedIds = (storageKey: string | null): readonly string[] => {
  if (storageKey === null) return [];
  try {
    const parsed = JSON.parse(
      globalThis.localStorage?.getItem(storageKey) ?? "[]",
    ) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
};

export interface PinnedEntitiesState {
  readonly pinnedIds: ReadonlySet<string>;
  readonly togglePinned: (entityId: string) => void;
}

export const usePinnedEntities = (
  storageKey: string | null,
  validEntityIds?: readonly string[],
): PinnedEntitiesState => {
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(new Set());
  const validKey = validEntityIds?.join("|");

  useEffect(() => {
    const valid =
      validKey === undefined
        ? null
        : new Set(validKey.length === 0 ? [] : validKey.split("|"));
    setPinnedIds(
      new Set(
        readPinnedIds(storageKey).filter(
          (id) => valid === null || valid.has(id),
        ),
      ),
    );
  }, [storageKey, validKey]);

  const togglePinned = useCallback(
    (entityId: string): void => {
      setPinnedIds((current) => {
        const next = new Set(current);
        if (next.has(entityId)) next.delete(entityId);
        else next.add(entityId);
        if (storageKey !== null) {
          globalThis.localStorage?.setItem(
            storageKey,
            JSON.stringify([...next]),
          );
        }
        return next;
      });
    },
    [storageKey],
  );

  return { pinnedIds, togglePinned };
};
