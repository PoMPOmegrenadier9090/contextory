import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RemoteEntityPage } from "@pkm/contracts";
import { openServerApp } from "./http-api.js";

const fixtureRoot = fileURLToPath(
  new URL("../../../fixtures/vault-v1/", import.meta.url),
);
const area = "area_01997c2a-7b1c-7a01-8a10-000000000001";
const project = "prj_01997c2a-7b1c-7a01-8a10-000000000003";
const task = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
const entry = "ent_01997c2a-7b1c-7a01-8a10-000000000006";

describe("Entity Entry Timeline HTTP", () => {
  it("returns scoped previews and paths through the shared query, and validates relation cursors", async () => {
    const root = await mkdtemp(join(tmpdir(), "pkms-entry-timeline-"));
    try {
      await cp(fixtureRoot, root, { recursive: true });
      await rm(join(root, ".pkm"), { recursive: true, force: true });
      const path = join(root, "entries", `${entry}.md`);
      const source = (await readFile(path, "utf8"))
        .replace(`  area: ${area}`, "  area: null")
        .replace(`  project: ${project}`, "  project: null");
      await writeFile(path, source);
      const second = "ent_01997c2a-7b1c-7a01-8a10-000000000099";
      await writeFile(
        join(root, "entries", `${second}.md`),
        source.replaceAll(entry, second),
      );
      const app = await openServerApp(root, { vault: { watch: false } });
      try {
        const request = (mode: string, extra: Record<string, string> = {}) =>
          app.inject({
            method: "GET",
            url: `/api/entities?${new URLSearchParams({ type: "entry", relatedTo: area, entryRelationMode: mode, sort: "createdAt", direction: "desc", ...extra })}`,
          });
        const direct = await request("direct");
        expect(direct.statusCode).toBe(200);
        expect(direct.json<RemoteEntityPage>().items).toEqual([]);
        const scoped = await request("scoped", {
          view: "timeline",
          limit: "1",
        });
        expect(scoped.statusCode).toBe(200);
        const page = scoped.json<RemoteEntityPage>();
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({
          entryRelation: {
            kind: "inherited",
            path: [{ id: area }, { id: project }, { id: task }],
          },
        });
        expect(page.items[0]?.preview).toContain("実装開始");
        expect(page.items[0]).not.toHaveProperty("body");
        expect(page.nextCursor).not.toBeNull();
        const next = await request("scoped", {
          view: "timeline",
          limit: "1",
          cursor: page.nextCursor!,
        });
        expect(next.statusCode).toBe(200);
        expect(next.json<RemoteEntityPage>().items[0]?.id).not.toBe(
          page.items[0]?.id,
        );
        expect(
          (await request("direct", { cursor: page.nextCursor! })).statusCode,
        ).toBe(400);
        expect((await request("unknown")).statusCode).toBe(400);
        const detail = await request("scoped");
        expect(detail.json<RemoteEntityPage>().items).toHaveLength(2);
        expect(detail.json<RemoteEntityPage>().items[0]).not.toHaveProperty(
          "preview",
        );
      } finally {
        await app.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
