export type AppearanceColorScheme = "auto" | "light" | "dark";
export interface AppearanceSettings {
  readonly colorScheme: AppearanceColorScheme;
  readonly bodyFontSize: number;
  readonly uiFontSize: number;
  readonly headingColors: boolean;
  readonly compactHeadings: boolean;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  colorScheme: "auto",
  bodyFontSize: 16,
  uiFontSize: 14,
  headingColors: false,
  compactHeadings: false,
};
export const APPEARANCE_STORAGE_KEY = "pkm:appearance:v1";
export const BODY_FONT_RANGE = { min: 12, max: 24 } as const;
export const UI_FONT_RANGE = { min: 12, max: 18 } as const;

const fontSize = (
  value: unknown,
  range: { min: number; max: number },
  fallback: number,
): number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= range.min &&
  value <= range.max
    ? value
    : fallback;

export const normalizeAppearance = (
  value: Partial<Record<keyof AppearanceSettings, unknown>>,
): AppearanceSettings => ({
  colorScheme:
    value.colorScheme === "light" ||
    value.colorScheme === "dark" ||
    value.colorScheme === "auto"
      ? value.colorScheme
      : DEFAULT_APPEARANCE.colorScheme,
  bodyFontSize: fontSize(
    value.bodyFontSize,
    BODY_FONT_RANGE,
    DEFAULT_APPEARANCE.bodyFontSize,
  ),
  uiFontSize: fontSize(
    value.uiFontSize,
    UI_FONT_RANGE,
    DEFAULT_APPEARANCE.uiFontSize,
  ),
  headingColors:
    typeof value.headingColors === "boolean"
      ? value.headingColors
      : DEFAULT_APPEARANCE.headingColors,
  compactHeadings:
    typeof value.compactHeadings === "boolean"
      ? value.compactHeadings
      : DEFAULT_APPEARANCE.compactHeadings,
});

export const parseAppearance = (raw: string | null): AppearanceSettings => {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (
      value === null ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 1
    )
      return { ...DEFAULT_APPEARANCE };
    return normalizeAppearance(
      value as Partial<Record<keyof AppearanceSettings, unknown>>,
    );
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
};

export const resolveAppearanceColorScheme = (
  scheme: AppearanceColorScheme,
  systemDark: boolean,
): "light" | "dark" =>
  scheme === "auto" ? (systemDark ? "dark" : "light") : scheme;
