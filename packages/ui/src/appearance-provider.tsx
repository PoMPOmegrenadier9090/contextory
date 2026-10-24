import { MantineProvider } from "@mantine/core";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  parseAppearance,
  resolveAppearanceColorScheme,
  type AppearanceSettings,
} from "./appearance.js";
import { compactTheme } from "./theme.js";

interface AppearanceContextValue {
  readonly settings: AppearanceSettings;
  readonly persistenceError: string | null;
  update(this: void, changes: Partial<AppearanceSettings>): void;
  reset(this: void): void;
}
const AppearanceContext = createContext<AppearanceContextValue | null>(null);
const subscribeSystemScheme = (callback: () => void): (() => void) => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
};
const systemDarkSnapshot = () =>
  window.matchMedia("(prefers-color-scheme: dark)").matches;
const readAppearance = (key: string): AppearanceSettings => {
  try {
    return parseAppearance(window.localStorage.getItem(key));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
};

export const AppearanceProvider = ({
  children,
  storageKey = APPEARANCE_STORAGE_KEY,
}: {
  readonly children: ReactNode;
  readonly storageKey?: string;
}): React.JSX.Element => {
  const [settings, setSettings] = useState(() => readAppearance(storageKey));
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const current = useRef(settings);
  current.current = settings;
  const systemDark = useSyncExternalStore(
    subscribeSystemScheme,
    systemDarkSnapshot,
    () => false,
  );

  useLayoutEffect(() => {
    const root = document.documentElement;
    const properties = [
      "font-size",
      "--pkm-body-font-size",
      "--pkm-ui-font-scale",
    ];
    const previous = properties.map((property) =>
      root.style.getPropertyValue(property),
    );
    const previousColors = root.dataset.pkmHeadingColors;
    const previousCompact = root.dataset.pkmCompactHeadings;
    root.style.fontSize = `${(16 * settings.uiFontSize) / DEFAULT_APPEARANCE.uiFontSize}px`;
    root.style.setProperty(
      "--pkm-body-font-size",
      `${settings.bodyFontSize}px`,
    );
    root.style.setProperty(
      "--pkm-ui-font-scale",
      String(settings.uiFontSize / DEFAULT_APPEARANCE.uiFontSize),
    );
    root.dataset.pkmHeadingColors = String(settings.headingColors);
    root.dataset.pkmCompactHeadings = String(settings.compactHeadings);
    return () => {
      properties.forEach((property, index) => {
        const value = previous[index];
        if (value) root.style.setProperty(property, value);
        else root.style.removeProperty(property);
      });
      if (previousColors === undefined) delete root.dataset.pkmHeadingColors;
      else root.dataset.pkmHeadingColors = previousColors;
      if (previousCompact === undefined) delete root.dataset.pkmCompactHeadings;
      else root.dataset.pkmCompactHeadings = previousCompact;
    };
  }, [
    settings.bodyFontSize,
    settings.uiFontSize,
    settings.headingColors,
    settings.compactHeadings,
  ]);

  useEffect(() => {
    const storage = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      const next =
        event.key === null
          ? { ...DEFAULT_APPEARANCE }
          : parseAppearance(event.newValue);
      current.current = next;
      setSettings(next);
      setPersistenceError(null);
    };
    window.addEventListener("storage", storage);
    return () => window.removeEventListener("storage", storage);
  }, [storageKey]);

  const update = (changes: Partial<AppearanceSettings>): void => {
    const next = normalizeAppearance({ ...current.current, ...changes });
    current.current = next;
    setSettings(next);
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, ...next }),
      );
      setPersistenceError(null);
    } catch {
      setPersistenceError(
        "外観設定を保存できませんでした。再読み込みすると変更が失われます。",
      );
    }
  };
  return (
    <AppearanceContext.Provider
      value={{
        settings,
        persistenceError,
        update,
        reset: () => update(DEFAULT_APPEARANCE),
      }}
    >
      <MantineProvider
        theme={compactTheme}
        forceColorScheme={resolveAppearanceColorScheme(
          settings.colorScheme,
          systemDark,
        )}
      >
        {children}
      </MantineProvider>
    </AppearanceContext.Provider>
  );
};

export const useAppearance = (): AppearanceContextValue => {
  const context = useContext(AppearanceContext);
  if (!context)
    throw new Error("AppearanceProvider is required for appearance settings");
  return context;
};
