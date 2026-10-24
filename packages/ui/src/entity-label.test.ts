import { describe, expect, it } from "vitest";

import { entityUiTitle, entryBodyPreview } from "./entity-label.js";

describe("untitled Entry labels", () => {
  const entry = {
    id: "ent_example",
    type: "entry",
    displayName: null,
    createdAt: "2026-09-26T15:05:00Z",
    body: "- [ ] [資料を読む](https://example.com)\n",
  };

  it("shows its creation time separately from a body preview", () => {
    expect(entityUiTitle(entry)).toBe("2026/09/27 00:05");
    expect(entryBodyPreview(entry)).toBe("資料を読む");
  });

  it("never treats the first heading as a title", () => {
    expect(entryBodyPreview({ ...entry, body: "# 見出し\n本文" })).toBe(
      "見出し 本文",
    );
    expect(entityUiTitle({ ...entry, body: "# 見出し\n本文" })).toBe(
      "2026/09/27 00:05",
    );
  });
});
