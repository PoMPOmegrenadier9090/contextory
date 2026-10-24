import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_SETTINGS,
  imageDimensions,
  parseImageSettings,
} from "./image-settings.js";
import { referencedAssets } from "./asset-links.js";

describe("image metadata and settings", () => {
  it("reads only a valid trailing width and keeps escaped pipes literal", () => {
    expect(imageDimensions("図.png|480")).toEqual({
      alt: "図.png",
      width: 480,
    });
    for (const label of [
      "図\\|480",
      "図|0",
      "図|-1",
      "図|Infinity",
      "図|99999",
    ])
      expect(imageDimensions(label)).toEqual({ alt: label, width: undefined });
    const path = "assets/images/12345678-1234-1234-1234-123456789abc.png";
    expect(referencedAssets(`![図\\[1\\].png|480](../${path})`)).toEqual([
      { path, label: "図[1].png" },
    ]);
    expect(referencedAssets(`[資料|480](../${path})`)).toEqual([
      { path, label: "資料|480" },
    ]);
  });

  it("uses safe defaults for invalid or stale settings", () => {
    for (const raw of [null, "{", "null", "false", "[]"])
      expect(parseImageSettings(raw)).toEqual(DEFAULT_IMAGE_SETTINGS);
    expect(
      parseImageSettings(
        JSON.stringify({
          webp: false,
          quality: 60,
          maxDimension: 0,
          defaultWidth: 480,
          includeFiles: true,
        }),
      ),
    ).toEqual({
      webp: false,
      quality: 60,
      maxDimension: 0,
      defaultWidth: 480,
      includeFiles: true,
    });
    expect(
      parseImageSettings(
        JSON.stringify({
          quality: 0,
          maxDimension: -1,
          defaultWidth: "800",
          webp: "yes",
        }),
      ),
    ).toEqual(DEFAULT_IMAGE_SETTINGS);
  });
});
