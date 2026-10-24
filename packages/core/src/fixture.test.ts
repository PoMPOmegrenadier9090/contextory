import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { vaultConfigSchema } from "./entity-schema.js";
import { parseMarkdownEntity } from "./markdown-parser.js";

const FIXTURE_ROOT = new URL("../../../fixtures/vault-v1/", import.meta.url);

const ENTITY_FIXTURES = [
  "entries/ent_01997c2a-7b1c-7a01-8a10-000000000006.md",
  "projects/prj_01997c2a-7b1c-7a01-8a10-000000000003.md",
  "tasks/tsk_01997c2a-7b1c-7a01-8a10-000000000004.md",
  "resources/res_01997c2a-7b1c-7a01-8a10-000000000005.md",
  "topics/topic_01997c2a-7b1c-7a01-8a10-000000000002.md",
  "areas/area_01997c2a-7b1c-7a01-8a10-000000000001.md",
] as const;

describe("schema v1 fixture vault", () => {
  it("contains a valid vault config", async () => {
    const source = await readFile(new URL("vault.yaml", FIXTURE_ROOT), "utf8");
    const config: unknown = parse(source);

    expect(vaultConfigSchema.safeParse(config).success).toBe(true);
  });

  it("contains one valid example of every entity type", async () => {
    const parsed = await Promise.all(
      ENTITY_FIXTURES.map(async (path) => {
        const source = await readFile(new URL(path, FIXTURE_ROOT), "utf8");
        return parseMarkdownEntity(source);
      }),
    );

    expect(parsed.every((result) => result.ok)).toBe(true);
    expect(
      parsed.flatMap((result) => (result.ok ? [result.value.entity.type] : [])),
    ).toEqual(["entry", "project", "task", "resource", "topic", "area"]);
  });
});
