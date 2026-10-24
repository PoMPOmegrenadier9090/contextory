import { describe, expect, it } from "vitest";
import { externalWebUrl } from "./external-link.js";

describe("external web links", () => {
  it("allows HTTP(S) only and rejects credential-bearing URLs", () => {
    expect(externalWebUrl("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(externalWebUrl("http://example.com")).toBe("http://example.com/");
    for (const url of [
      "file:///tmp/a",
      "javascript:alert(1)",
      "data:text/html,test",
      "pkm-asset://vault/file",
      "not a url",
      "https://user:password@example.com",
    ])
      expect(externalWebUrl(url)).toBeNull();
  });
});
