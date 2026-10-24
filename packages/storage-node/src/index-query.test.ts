import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { openVaultIndex } from "./index-database.js";
import {
  getBacklinks,
  getIndexedEntity,
  listEntityScopes,
  listIndexedEntities,
  listIndexedEntitiesInScope,
  listIndexedJournalEntries,
  searchIndexedEntities,
} from "./index-query.js";
import { rebuildVaultIndex } from "./index-rebuild.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../../fixtures/vault-v1/", import.meta.url),
);
const temporaryDirectories: string[] = [];

const createFixtureVault = async (): Promise<string> => {
  const parent = await mkdtemp(join(tmpdir(), "pkms-query-"));
  temporaryDirectories.push(parent);
  const vaultRoot = join(parent, "vault");
  await cp(FIXTURE_ROOT, vaultRoot, { recursive: true });
  await rm(join(vaultRoot, ".pkm"), { recursive: true, force: true });
  return vaultRoot;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("index queries", () => {
  it("returns metadata and reverse references", async () => {
    const vaultRoot = await createFixtureVault();
    const resourcePath = join(
      vaultRoot,
      "resources",
      "res_01997c2a-7b1c-7a01-8a10-000000000005.md",
    );
    const assetPath = "assets/files/01997c2a-7b1c-7a01-8a10-000000000099.pdf";
    await writeFile(
      resourcePath,
      (await readFile(resourcePath, "utf8")).replace(
        "source_uri: null",
        `source_uri: null\nresource_type: paper\nasset_path: ${assetPath}`,
      ),
    );
    const index = openVaultIndex(vaultRoot);
    await rebuildVaultIndex(vaultRoot, index);

    expect(listIndexedEntities(index)).toHaveLength(6);
    expect(
      getIndexedEntity(index, "ent_01997c2a-7b1c-7a01-8a10-000000000006"),
    ).toMatchObject({
      type: "entry",
      origin: "human",
      taskId: "tsk_01997c2a-7b1c-7a01-8a10-000000000004",
      resourceId: "res_01997c2a-7b1c-7a01-8a10-000000000005",
      journalDate: "2026-09-21",
      occurredAt: null,
    });
    expect(
      getIndexedEntity(index, "tsk_01997c2a-7b1c-7a01-8a10-000000000004"),
    ).toMatchObject({
      type: "task",
      displayName: "Markdown parserを実装する",
      projectId: "prj_01997c2a-7b1c-7a01-8a10-000000000003",
      topicIds: ["topic_01997c2a-7b1c-7a01-8a10-000000000002"],
    });
    expect(
      listIndexedJournalEntries(index, "2026-09-21").map(({ id }) => id),
    ).toEqual(["ent_01997c2a-7b1c-7a01-8a10-000000000006"]);
    expect(
      getIndexedEntity(index, "res_01997c2a-7b1c-7a01-8a10-000000000005"),
    ).toMatchObject({
      type: "resource",
      resourceType: "paper",
      canonicalIdentifier: null,
      sourceUri: null,
      assetPath,
    });
    expect(
      getBacklinks(index, "tsk_01997c2a-7b1c-7a01-8a10-000000000004"),
    ).toMatchObject([
      {
        sourceType: "entry",
        sourceDisplayName: "実装開始",
        kind: "context",
        targetType: "task",
        label: null,
      },
      {
        sourceType: "entry",
        sourceDisplayName: "実装開始",
        kind: "direct",
        targetType: "task",
        label: "Markdown parserを実装する",
      },
    ]);
    index.close();
  });

  it("applies deleted and AI exclusions consistently", async () => {
    const vaultRoot = await createFixtureVault();
    const resourceId = "res_01997c2a-7b1c-7a01-8a10-000000000005";
    const entryId = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
    const resourcePath = join(vaultRoot, "resources", `${resourceId}.md`);
    const entryPath = join(vaultRoot, "entries", `${entryId}.md`);
    await writeFile(
      resourcePath,
      (await readFile(resourcePath, "utf8")).replace(
        "deleted_at: null",
        "deleted_at: 2026-09-21T19:00:00+09:00",
      ),
      "utf8",
    );
    await writeFile(
      entryPath,
      (await readFile(entryPath, "utf8")).replace(
        "exclude_from_ai: false",
        "exclude_from_ai: true",
      ),
      "utf8",
    );
    const index = openVaultIndex(vaultRoot);
    await rebuildVaultIndex(vaultRoot, index);

    expect(listIndexedEntities(index).map(({ id }) => id)).not.toContain(
      resourceId,
    );
    expect(getIndexedEntity(index, resourceId)).toMatchObject({
      deletedAt: "2026-09-21T10:00:00.000Z",
    });
    expect(getIndexedEntity(index, resourceId, { forAi: true })).toBeNull();
    expect(getIndexedEntity(index, entryId, { forAi: true })).toBeNull();
    expect(searchIndexedEntities(index, "実装開始")).toHaveLength(1);
    expect(searchIndexedEntities(index, "実装開始", { forAi: true })).toEqual(
      [],
    );
    index.close();
  });

  it("applies deleted and AI exclusions to backlinks", async () => {
    const vaultRoot = await createFixtureVault();
    const targetId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    const sourceId = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
    const index = openVaultIndex(vaultRoot);
    await rebuildVaultIndex(vaultRoot, index);

    expect(getBacklinks(index, targetId)).toHaveLength(2);
    index.database
      .prepare("UPDATE entities SET exclude_from_ai = 1 WHERE id = ?")
      .run(sourceId);
    expect(getBacklinks(index, targetId)).toHaveLength(2);
    expect(getBacklinks(index, targetId, { forAi: true })).toEqual([]);

    index.database
      .prepare("UPDATE entities SET deleted_at = ? WHERE id = ?")
      .run("2026-09-21T20:00:00+09:00", sourceId);
    expect(getBacklinks(index, targetId)).toEqual([]);
    expect(
      getBacklinks(index, targetId, { includeDeleted: true }),
    ).toHaveLength(2);
    index.close();
  });

  it("queries direct and inherited materialized scopes", async () => {
    const vaultRoot = await createFixtureVault();
    const entryId = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
    const taskId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    const projectId = "prj_01997c2a-7b1c-7a01-8a10-000000000003";
    const areaId = "area_01997c2a-7b1c-7a01-8a10-000000000001";
    const entryPath = join(vaultRoot, "entries", `${entryId}.md`);
    const entry = await readFile(entryPath, "utf8");
    await writeFile(
      entryPath,
      entry
        .replace(`  area: ${areaId}\n`, "")
        .replace(`  project: ${projectId}\n`, ""),
      "utf8",
    );
    const index = openVaultIndex(vaultRoot);
    await rebuildVaultIndex(vaultRoot, index);

    expect(listEntityScopes(index, entryId)).toEqual([
      {
        entityId: entryId,
        scopeType: "area",
        scopeId: areaId,
        relation: "inherited",
        viaEntityId: projectId,
      },
      {
        entityId: entryId,
        scopeType: "project",
        scopeId: projectId,
        relation: "inherited",
        viaEntityId: taskId,
      },
      expect.objectContaining({
        entityId: entryId,
        scopeType: "resource",
        relation: "direct",
      }),
      {
        entityId: entryId,
        scopeType: "task",
        scopeId: taskId,
        relation: "direct",
        viaEntityId: null,
      },
    ]);
    expect(
      listIndexedEntitiesInScope(index, "area", areaId).map(({ id }) => id),
    ).toEqual(expect.arrayContaining([projectId, taskId, entryId]));
    index.close();
  });
});
