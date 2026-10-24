import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { INDEX_SCHEMA_VERSION, IndexDatabase } from "./index-database.js";
import { openLocalVault } from "./local-vault-service.js";
import { listIndexedEntities } from "./index-query.js";

const temporaryDirectories: string[] = [];
const fixture = fileURLToPath(
  new URL("../../../fixtures/vault-v1/", import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const createVault = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "pkms-index-schema-"));
  temporaryDirectories.push(root);
  await cp(fixture, root, { recursive: true });
  return root;
};

describe("derived index schema", () => {
  it("rebuilds an old index from Markdown while retaining local drafts", async () => {
    const root = await createVault();
    const entryId = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
    const sourcePath = join(root, "entries", `${entryId}.md`);
    const source = await readFile(sourcePath, "utf8");
    const service = await openLocalVault(root, { watch: false });
    const document = await service.loadEntity(entryId);
    service.saveDraft({
      entityId: entryId,
      baseHash: document.fileHash,
      content: "unsaved draft",
    });
    await service.close();

    const path = join(root, ".pkm", "index.sqlite");
    const old = new Database(path);
    old.exec(
      "CREATE TABLE obsolete_projection (value TEXT); PRAGMA user_version = 7;",
    );
    old.close();

    const reopened = await openLocalVault(root, { watch: false });
    try {
      expect(reopened.listEntities()).toHaveLength(6);
      expect((await reopened.loadEntity(entryId)).draft?.content).toBe(
        "unsaved draft",
      );
      expect(await readFile(sourcePath, "utf8")).toBe(source);
    } finally {
      await reopened.close();
    }

    const index = new IndexDatabase(path);
    try {
      expect(index.database.pragma("user_version", { simple: true })).toBe(
        INDEX_SCHEMA_VERSION,
      );
      expect(
        index.database
          .prepare(
            "SELECT name FROM sqlite_master WHERE name IN ('obsolete_projection', 'search_chunks')",
          )
          .all(),
      ).toEqual([]);
      expect(listIndexedEntities(index)).toHaveLength(6);
      expect(
        index.database
          .prepare("SELECT count(*) AS count FROM search_documents")
          .get(),
      ).toEqual({ count: 6 });
    } finally {
      index.close();
    }
  });

  it("keeps an index on the current schema intact", async () => {
    const root = await createVault();
    const service = await openLocalVault(root, { watch: false });
    await service.close();
    const index = new IndexDatabase(join(root, ".pkm", "index.sqlite"));
    try {
      expect(listIndexedEntities(index)).toHaveLength(6);
    } finally {
      index.close();
    }
  });

  it("refuses newer schemas without discarding their data", async () => {
    const root = await createVault();
    const path = join(root, "newer.sqlite");
    const newer = new Database(path);
    newer.exec(
      `CREATE TABLE future_data (value TEXT); INSERT INTO future_data VALUES ('keep'); PRAGMA user_version = ${INDEX_SCHEMA_VERSION + 1};`,
    );
    newer.close();
    expect(() => new IndexDatabase(path)).toThrow("newer than supported");
    const unchanged = new Database(path);
    try {
      expect(unchanged.prepare("SELECT value FROM future_data").get()).toEqual({
        value: "keep",
      });
    } finally {
      unchanged.close();
    }
  });
});
