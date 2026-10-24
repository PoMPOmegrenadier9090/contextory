import { describe, expect, it } from "vitest";

import {
  assetPathFromMarkdownUrl,
  assetUrl,
  markdownForAsset,
  referencedAssets,
  referencedAssetPaths,
} from "./asset-links.js";

const path = "assets/images/12345678-1234-1234-1234-123456789abc.png";

describe("Markdown asset links", () => {
  it("uses portable relative paths and resolves them for each renderer", () => {
    expect(
      markdownForAsset({
        path,
        fileName: "図.png",
        mimeType: "image/png",
        size: 10,
      }),
    ).toBe(`![図.png](../${path})`);
    expect(assetUrl(`../${path}`, "/api/")).toBe(`/api/${path}`);
    expect(assetUrl(`../${path}`, "pkm-asset://vault/")).toBe(
      `pkm-asset://vault/${path}`,
    );
    expect(assetPathFromMarkdownUrl("../assets/../vault.yaml")).toBeNull();
  });

  it("finds linked assets without duplicating them", () => {
    expect(
      referencedAssetPaths(`![image](../${path})\n[again](../${path})`),
    ).toEqual([path]);
    expect(referencedAssets(`![図\\[1\\].png](../${path})`)).toEqual([
      { path, label: "図[1].png" },
    ]);
  });
});
