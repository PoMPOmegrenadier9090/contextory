import { expect, it } from "vitest";
import { entityFromUrl, urlForEntity } from "./entity-url.js";
const id = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
it("preserves the requested Entity across reload/auth redirect URLs", () => {
  const url = urlForEntity("https://pkm.example/app/?view=notes", id);
  expect(entityFromUrl(url)).toBe(id);
  expect(url).toContain("view=notes");
  expect(entityFromUrl(urlForEntity(url, null))).toBeNull();
});
it("ignores untrusted IDs instead of attempting file-path navigation", () => {
  expect(entityFromUrl("https://pkm.example/?entity=../../secret")).toBeNull();
  expect(() => urlForEntity("https://pkm.example/", "../../secret")).toThrow();
});
