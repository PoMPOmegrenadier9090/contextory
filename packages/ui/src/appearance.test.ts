import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  parseAppearance,
  resolveAppearanceColorScheme,
} from "./appearance.js";

describe("device appearance settings", () => {
  it("recovers malformed stores and unknown versions without accepting unbounded sizes", () => {
    for (const raw of [
      null,
      "broken",
      "null",
      "[]",
      '{"version":2,"bodyFontSize":24}',
    ])
      expect(parseAppearance(raw)).toEqual(DEFAULT_APPEARANCE);
    expect(
      parseAppearance(
        JSON.stringify({
          version: 1,
          bodyFontSize: 1000,
          uiFontSize: -1,
          headingColors: "yes",
          compactHeadings: [],
          colorScheme: "sepia",
        }),
      ),
    ).toEqual(DEFAULT_APPEARANCE);
    expect(
      parseAppearance(
        JSON.stringify({ version: 1, bodyFontSize: 16.5, uiFontSize: "18" }),
      ),
    ).toEqual(DEFAULT_APPEARANCE);
  });
  it("preserves valid preferences while supplying defaults for missing or invalid fields", () => {
    expect(
      parseAppearance(
        JSON.stringify({
          version: 1,
          bodyFontSize: 20,
          uiFontSize: 18,
          colorScheme: "dark",
          headingColors: true,
          compactHeadings: true,
          ignored: true,
        }),
      ),
    ).toEqual({
      bodyFontSize: 20,
      uiFontSize: 18,
      colorScheme: "dark",
      headingColors: true,
      compactHeadings: true,
    });
    expect(
      parseAppearance('{"version":1,"headingColors":true,"bodyFontSize":0}'),
    ).toEqual({ ...DEFAULT_APPEARANCE, headingColors: true });
  });
  it("follows the system only in automatic mode", () => {
    expect(resolveAppearanceColorScheme("auto", false)).toBe("light");
    expect(resolveAppearanceColorScheme("auto", true)).toBe("dark");
    expect(resolveAppearanceColorScheme("light", true)).toBe("light");
    expect(resolveAppearanceColorScheme("dark", false)).toBe("dark");
  });
});
