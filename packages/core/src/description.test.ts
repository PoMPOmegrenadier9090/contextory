import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseMarkdownEntity } from "./markdown-parser.js";
import { updateEntityMetadata } from "./entity-metadata.js";
import { parseCreateEntityRequest } from "./request-validation.js";

const ids = {
  area: "area_01997c2a-7b1c-7a01-8a10-000000000001",
  topic: "topic_01997c2a-7b1c-7a01-8a10-000000000002",
  project: "prj_01997c2a-7b1c-7a01-8a10-000000000003",
  task: "tsk_01997c2a-7b1c-7a01-8a10-000000000004",
  resource: "res_01997c2a-7b1c-7a01-8a10-000000000005",
  entry: "ent_01997c2a-7b1c-7a01-8a10-000000000006",
};
const folders = {
  area: "areas",
  topic: "topics",
  project: "projects",
  task: "tasks",
  resource: "resources",
  entry: "entries",
};
describe("Entity description", () => {
  it("round-trips all five non-Entry types and normalizes empty descriptions", async () => {
    for (const type of [
      "area",
      "topic",
      "project",
      "task",
      "resource",
    ] as const) {
      const source = await readFile(
        new URL(
          `../../../fixtures/vault-v1/${folders[type]}/${ids[type]}.md`,
          import.meta.url,
        ),
        "utf8",
      );
      const updated = updateEntityMetadata(source, {
        description: "  **text** [[literal]]  ",
      });
      expect(updated.entity.description).toBe("**text** [[literal]]");
      const roundtrip = parseMarkdownEntity(updated.content);
      expect(roundtrip.ok).toBe(true);
      if (roundtrip.ok)
        expect(roundtrip.value.entity.description).toBe("**text** [[literal]]");
      expect(
        updateEntityMetadata(updated.content, { description: "   " }).entity
          .description,
      ).toBeNull();
      expect(() =>
        updateEntityMetadata(source, { description: "first\nsecond" }),
      ).toThrow();
    }
  });
  it("rejects Entry descriptions and invalid creation descriptions", async () => {
    const source = await readFile(
      new URL(
        `../../../fixtures/vault-v1/entries/${ids.entry}.md`,
        import.meta.url,
      ),
      "utf8",
    );
    expect(() =>
      updateEntityMetadata(source, { description: "not allowed" }),
    ).toThrow();
    expect(() =>
      parseCreateEntityRequest({
        type: "entry",
        displayName: null,
        description: null,
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseCreateEntityRequest({
        type: "task",
        displayName: "task",
        description: "a\nb",
      }),
    ).toThrow(TypeError);
    expect(
      parseCreateEntityRequest({
        type: "area",
        displayName: "area",
        description: "  hello  ",
      }),
    ).toMatchObject({ description: "hello" });
  });
});
