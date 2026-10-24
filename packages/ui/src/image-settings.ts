export interface ImageSettings {
  readonly webp: boolean;
  readonly quality: number;
  readonly maxDimension: number;
  readonly defaultWidth: number;
  readonly includeFiles: boolean;
}

export const IMAGE_SETTINGS_KEY = "pkm:images:v1";
export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  webp: true,
  quality: 85,
  maxDimension: 2560,
  defaultWidth: 0,
  includeFiles: false,
};
export const IMAGE_WIDTHS = [
  { label: "小", width: 240 },
  { label: "中", width: 480 },
  { label: "大", width: 800 },
  { label: "自動", width: 0 },
] as const;

export const parseImageSettings = (raw: string | null): ImageSettings => {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return DEFAULT_IMAGE_SETTINGS;
    const number = (
      key: string,
      min: number,
      max: number,
      fallback: number,
    ) => {
      const n: unknown = Reflect.get(value, key);
      return typeof n === "number" &&
        Number.isInteger(n) &&
        n >= min &&
        n <= max
        ? n
        : fallback;
    };
    return {
      webp:
        "webp" in value && typeof value.webp === "boolean" ? value.webp : true,
      quality: number("quality", 1, 100, 85),
      maxDimension: number("maxDimension", 0, 8192, 2560),
      defaultWidth: number("defaultWidth", 0, 8192, 0),
      includeFiles: "includeFiles" in value && value.includeFiles === true,
    };
  } catch {
    return DEFAULT_IMAGE_SETTINGS;
  }
};

export const readImageSettings = (): ImageSettings => {
  try {
    return parseImageSettings(window.localStorage.getItem(IMAGE_SETTINGS_KEY));
  } catch {
    return DEFAULT_IMAGE_SETTINGS;
  }
};

export const imageDimensions = (
  label: string,
): { alt: string; width: number | undefined } => {
  const match = label.match(/(?<!\\)\|(\d+)$/);
  const width = Number(match?.[1]);
  return match && width > 0 && width <= 8192
    ? { alt: label.slice(0, match.index), width }
    : { alt: label, width: undefined };
};
