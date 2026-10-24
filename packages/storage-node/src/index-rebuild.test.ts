import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { openVaultIndex } from "./index-database.js";
import type { IndexDatabase } from "./index-database.js";
import { rebuildVaultIndex } from "./index-rebuild.js";
import { searchDocuments } from "./search.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../../fixtures/vault-v1/", import.meta.url),
);
const temporaryDirectories: string[] = [];

const createFixtureVault = async (): Promise<string> => {
  const parent = await mkdtemp(join(tmpdir(), "pkms-index-"));
  temporaryDirectories.push(parent);
  const vaultRoot = join(parent, "vault");
  await cp(FIXTURE_ROOT, vaultRoot, { recursive: true });
  await rm(join(vaultRoot, ".pkm"), { recursive: true, force: true });
  return vaultRoot;
};

const tableCount = (index: IndexDatabase, table: string): number => {
  const row = index.database
    .prepare(`SELECT count(*) AS count FROM ${table}`)
    .get() as { readonly count: number };
  return row.count;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("rebuildVaultIndex", () => {
  it("reconstructs metadata, references, validation, and search from Markdown", async () => {
    const vaultRoot = await createFixtureVault();
    let index = openVaultIndex(vaultRoot);

    const first = await rebuildVaultIndex(vaultRoot, index);

    expect(first).toEqual({
      scannedFiles: 7,
      indexedEntities: 6,
      conflicts: 0,
      validationIssues: 0,
    });
    expect(tableCount(index, "entity_topics")).toBe(5);
    expect(tableCount(index, "entity_references")).toBe(12);
    expect(tableCount(index, "entity_scopes")).toBe(7);
    expect(
      index.database
        .prepare(
          `SELECT scope_type, scope_id, relation, via_entity_id
           FROM entity_scopes
           WHERE entity_id = ?
           ORDER BY scope_type`,
        )
        .all("tsk_01997c2a-7b1c-7a01-8a10-000000000004"),
    ).toEqual([
      {
        scope_type: "area",
        scope_id: "area_01997c2a-7b1c-7a01-8a10-000000000001",
        relation: "inherited",
        via_entity_id: "prj_01997c2a-7b1c-7a01-8a10-000000000003",
      },
      {
        scope_type: "project",
        scope_id: "prj_01997c2a-7b1c-7a01-8a10-000000000003",
        relation: "direct",
        via_entity_id: null,
      },
    ]);
    expect(
      index.database
        .prepare(
          `SELECT target_type, label
           FROM entity_references
           WHERE reference_kind = 'direct'`,
        )
        .get(),
    ).toEqual({
      target_type: "task",
      label: "Markdown parserを実装する",
    });
    expect(
      searchDocuments(index.database, "実装開始").map(({ id }) => id),
    ).toEqual(["ent_01997c2a-7b1c-7a01-8a10-000000000006"]);
    index.close();

    await rm(join(vaultRoot, ".pkm", "index.sqlite"), { force: true });
    index = openVaultIndex(vaultRoot);
    const rebuilt = await rebuildVaultIndex(vaultRoot, index);

    expect(rebuilt).toEqual(first);
    expect(tableCount(index, "entities")).toBe(6);
    index.close();
  });

  it("indexes conflict copies separately from canonical entities", async () => {
    const vaultRoot = await createFixtureVault();
    const canonicalPath = join(
      vaultRoot,
      "entries",
      "ent_01997c2a-7b1c-7a01-8a10-000000000006.md",
    );
    const conflictPath = join(
      dirname(canonicalPath),
      "ent_01997c2a-7b1c-7a01-8a10-000000000006.sync-conflict-20260921-120000-ABCDEFG.md",
    );
    await writeFile(
      conflictPath,
      await readFile(canonicalPath, "utf8"),
      "utf8",
    );
    const index = openVaultIndex(vaultRoot);

    const result = await rebuildVaultIndex(vaultRoot, index);

    expect(result).toMatchObject({
      scannedFiles: 8,
      indexedEntities: 6,
      conflicts: 1,
      validationIssues: 0,
    });
    expect(tableCount(index, "conflicts")).toBe(1);
    expect(tableCount(index, "entities")).toBe(6);
    index.close();
  });

  it("rebuilds unresolved-reference warnings from changed Markdown", async () => {
    const vaultRoot = await createFixtureVault();
    const taskPath = join(
      vaultRoot,
      "tasks",
      "tsk_01997c2a-7b1c-7a01-8a10-000000000004.md",
    );
    const task = await readFile(taskPath, "utf8");
    await writeFile(
      taskPath,
      task.replace(
        "prj_01997c2a-7b1c-7a01-8a10-000000000003",
        "prj_01997c2a-7b1c-7a01-8a10-000000000099",
      ),
      "utf8",
    );
    const index = openVaultIndex(vaultRoot);

    const result = await rebuildVaultIndex(vaultRoot, index);
    const issue = index.database
      .prepare(
        "SELECT code, severity, target_id FROM validation_issues WHERE code = ?",
      )
      .get("UnresolvedReference");

    expect(result.validationIssues).toBe(1);
    expect(issue).toEqual({
      code: "UnresolvedReference",
      severity: "warning",
      target_id: "prj_01997c2a-7b1c-7a01-8a10-000000000099",
    });
    index.close();
  });
});
