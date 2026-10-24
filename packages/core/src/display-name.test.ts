import { describe, expect, it } from "vitest";

import { getEntityDisplayName } from "./display-name.js";

describe("getEntityDisplayName", () => {
  it("uses only the explicit Entry title", () => {
    expect(getEntityDisplayName({ type: "entry", title: "明示タイトル" })).toBe(
      "明示タイトル",
    );
    expect(getEntityDisplayName({ type: "entry" })).toBeNull();
    expect(getEntityDisplayName({ type: "entry", title: null })).toBeNull();
  });
});
