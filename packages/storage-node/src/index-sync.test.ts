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
} from "./index-query.js";
import { rebuildVaultIndex } from "./index-rebuild.js";
import { synchronizeVaultIndex } from "./index-sync.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../../fixtures/vault-v1/", import.meta.url),
);
const temporaryDirectories: string[] = [];

const createFixtureVault = async (): Promise<string> => {
  const parent = await mkdtemp(join(tmpdir(), "pkms-sync-index-"));
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

describe("synchronizeVaultIndex", () => {
  it("includes hierarchy ancestors of explicit contexts and body references in change dependencies", async () => {
    const vaultRoot = await createFixtureVault();
    const index = openVaultIndex(vaultRoot);
    try {
      await rebuildVaultIndex(vaultRoot, index);
      const entryId = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
      const areaId = "area_01997c2a-7b1c-7a01-8a10-000000000001";
      const path = `entries/${entryId}.md`;
      const source = await readFile(join(vaultRoot, path), "utf8");
      await writeFile(
        join(vaultRoot, path),
        source
          .replace(/^contexts:\n(?: {2}.*\n)+/m, "")
          .replace("# 実装開始", "# Body reference only"),
      );
      const change = await synchronizeVaultIndex(vaultRoot, index, [path]);
      expect(change.changes.scopeIds).toContain(areaId);
      await writeFile(
        join(vaultRoot, path),
        (await readFile(join(vaultRoot, path), "utf8")) + "\nUpdated\n",
      );
      const next = await synchronizeVaultIndex(vaultRoot, index, [path]);
      expect(next.changes.scopeIds).toContain(areaId);
      expect(next.changes.scopeIds).toContain(
        "prj_01997c2a-7b1c-7a01-8a10-000000000003",
      );
    } finally {
      index.close();
    }
  });
  it("reindexes only changed files while leaving unrelated rows intact", async () => {
    const vaultRoot = await createFixtureVault();
    const index = openVaultIndex(vaultRoot);
    await rebuildVaultIndex(vaultRoot, index);
    index.database
      .prepare(
        `INSERT INTO validation_issues (
          file_path, code, severity, message
        ) VALUES ('unchanged.md', 'Sentinel', 'warning', 'keep')`,
      )
      .run();
    const taskId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    const taskPath = join(vaultRoot, "tasks", `${taskId}.md`);
    const task = await readFile(taskPath, "utf8");
    await writeFile(
      taskPath,
      task.replace(
        "title: Markdown parserを実装する",
        "title: 差分indexを実装する",
      ),
      "utf8",
    );

    const result = await synchronizeVaultIndex(vaultRoot, index, [
      `tasks/${taskId}.md`,
    ]);
    const sentinel = index.database
      .prepare("SELECT count(*) AS count FROM validation_issues WHERE code = ?")
      .get("Sentinel") as { readonly count: number };

    expect(result).toMatchObject({
      mode: "incremental",
      scannedFiles: 1,
      changes: {
        reset: false,
        countsChanged: false,
        calendarChanged: false,
      },
      addedFiles: 0,
      changedFiles: 1,
      deletedFiles: 0,
      indexedEntities: 6,
    });
    expect(result.changes.types).toContain("task");
    expect(result.changes.entities.some((e) => e.id === taskId)).toBe(true);
    expect(getIndexedEntity(index, taskId)?.displayName).toBe(
      "差分indexを実装する",
    );
    expect(sentinel.count).toBe(1);
    index.close();
  });

  it("removes deleted entities and refreshes inbound unresolved warnings", async () => {
    const vaultRoot = await createFixtureVault();
    const index = openVaultIndex(vaultRoot);
    await rebuildVaultIndex(vaultRoot, index);
    const projectId = "prj_01997c2a-7b1c-7a01-8a10-000000000003";
    await rm(join(vaultRoot, "projects", `${projectId}.md`));

    const result = await synchronizeVaultIndex(vaultRoot, index);
    const unresolved = index.database
      .prepare(
        `SELECT count(*) AS count FROM validation_issues
         WHERE code = 'UnresolvedReference' AND target_id = ?`,
      )
      .get(projectId) as { readonly count: number };

    expect(result).toMatchObject({
      mode: "incremental",
      deletedFiles: 1,
      indexedEntities: 5,
    });
    expect(getIndexedEntity(index, projectId)).toBeNull();
    expect(unresolved.count).toBe(2);
    index.close();
  });

  it("updates Direct Reference labels and search documents incrementally", async () => {
    const vaultRoot = await createFixtureVault();
    const index = openVaultIndex(vaultRoot);
    await rebuildVaultIndex(vaultRoot, index);
    const targetId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    const entryPath = join(
      vaultRoot,
      "entries",
      "ent_01997c2a-7b1c-7a01-8a10-000000000006.md",
    );
    const entry = await readFile(entryPath, "utf8");
    await writeFile(
      entryPath,
      entry.replace("Markdown parserを実装する", "差分indexを実装する"),
      "utf8",
    );

    const result = await synchronizeVaultIndex(vaultRoot, index);
    const direct = getBacklinks(index, targetId).find(
      (reference) => reference.kind === "direct",
    );
    const chunk = index.database
      .prepare("SELECT content FROM search_documents WHERE id = ?")
      .get("ent_01997c2a-7b1c-7a01-8a10-000000000006") as {
      readonly content: string;
    };

    expect(result).toMatchObject({ mode: "incremental", changedFiles: 1 });
    expect(direct?.label).toBe("差分indexを実装する");
    expect(chunk.content).toContain("差分indexを実装する");
    index.close();
  });

  it("refreshes materialized scopes only through affected dependency chains", async () => {
    const vaultRoot = await createFixtureVault();
    const entryId = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
    const taskId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    const projectId = "prj_01997c2a-7b1c-7a01-8a10-000000000003";
    const resourceId = "res_01997c2a-7b1c-7a01-8a10-000000000005";
    const originalAreaId = "area_01997c2a-7b1c-7a01-8a10-000000000001";
    const nextAreaId = "area_01997c2a-7b1c-7a01-8a10-000000000099";
    const entryPath = join(vaultRoot, "entries", `${entryId}.md`);
    const entry = await readFile(entryPath, "utf8");
    await writeFile(
      entryPath,
      entry
        .replace(`  area: ${originalAreaId}\n`, "")
        .replace(`  project: ${projectId}\n`, ""),
      "utf8",
    );
    const index = openVaultIndex(vaultRoot);
    await rebuildVaultIndex(vaultRoot, index);
    index.database
      .prepare(
        `INSERT INTO entity_scopes (
          entity_id, scope_type, scope_id, relation, via_entity_id
        ) VALUES (?, 'area', 'area_scope_sentinel', 'inherited', NULL)`,
      )
      .run(resourceId);
    const projectPath = join(vaultRoot, "projects", `${projectId}.md`);
    const project = await readFile(projectPath, "utf8");
    await writeFile(
      projectPath,
      project.replace(originalAreaId, nextAreaId),
      "utf8",
    );

    const result = await synchronizeVaultIndex(vaultRoot, index);

    expect(result).toMatchObject({
      mode: "incremental",
      changedFiles: 1,
    });
    expect(listEntityScopes(index, taskId)).toContainEqual(
      expect.objectContaining({
        scopeType: "area",
        scopeId: nextAreaId,
        relation: "inherited",
      }),
    );
    expect(listEntityScopes(index, entryId)).toContainEqual(
      expect.objectContaining({
        scopeType: "area",
        scopeId: nextAreaId,
        relation: "inherited",
      }),
    );
    expect(listEntityScopes(index, entryId)).not.toContainEqual(
      expect.objectContaining({ scopeId: originalAreaId }),
    );
    expect(listEntityScopes(index, resourceId)).toContainEqual(
      expect.objectContaining({ scopeId: "area_scope_sentinel" }),
    );
    index.close();
  });

  it("falls back to a full rebuild when a duplicate ID is introduced", async () => {
    const vaultRoot = await createFixtureVault();
    const index = openVaultIndex(vaultRoot);
    await rebuildVaultIndex(vaultRoot, index);
    const sourcePath = join(
      vaultRoot,
      "tasks",
      "tsk_01997c2a-7b1c-7a01-8a10-000000000004.md",
    );
    await writeFile(
      join(vaultRoot, "tasks", "tsk_01997c2a-7b1c-7a01-8a10-000000000099.md"),
      await readFile(sourcePath, "utf8"),
      "utf8",
    );

    const result = await synchronizeVaultIndex(vaultRoot, index, [
      "tasks/tsk_01997c2a-7b1c-7a01-8a10-000000000099.md",
    ]);

    expect(result.mode).toBe("full-rebuild");
    expect(result.validationIssues).toBeGreaterThanOrEqual(2);
    index.close();
  });

  it("uses a full rebuild to promote the remaining file when a duplicate is removed", async () => {
    const vaultRoot = await createFixtureVault();
    const index = openVaultIndex(vaultRoot);
    const entityId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    const originalPath = join(vaultRoot, "tasks", `${entityId}.md`);
    const duplicateRelativePath =
      "tasks/tsk_01997c2a-7b1c-7a01-8a10-000000000099.md";
    const duplicatePath = join(vaultRoot, duplicateRelativePath);
    await writeFile(
      duplicatePath,
      await readFile(originalPath, "utf8"),
      "utf8",
    );
    await rebuildVaultIndex(vaultRoot, index);
    await rm(originalPath);

    const result = await synchronizeVaultIndex(vaultRoot, index);

    expect(result.mode).toBe("full-rebuild");
    expect(getIndexedEntity(index, entityId)?.path).toBe(duplicateRelativePath);
    index.close();
  });
});

describe("index projection parity", () => {
  it("produces the same Entity, reference, search, Todo and scope data on sync and rebuild", async () => {
    const root = await createFixtureVault();
    const index = openVaultIndex(root);
    try {
      await rebuildVaultIndex(root, index);
      const paths = index.database
        .prepare("SELECT path, type FROM entities ORDER BY id")
        .all() as { readonly path: string; readonly type: string }[];
      for (const { path, type } of paths) {
        let source = (await readFile(join(root, path), "utf8")).replace(
          /updated_at: [^\n]+/,
          "updated_at: 2026-10-03T10:00:00+09:00",
        );
        if (type === "entry") {
          source =
            source
              .replace("journal_date: 2026-09-21", "journal_date: 2026-10-03")
              .replace("exclude_from_ai: false", "exclude_from_ai: true") +
            "\n- [ ] 新しいTodo\n- [x] 完了したTodo\n\n[[entry:ent_01997c2a-7b1c-7a01-8a10-000000000099|未到着のメモ]]\n";
        }
        if (type === "project" || type === "task") {
          source = source
            .replace(/status: [^\n]+/, "status: done")
            .replace(/priority: [^\n]+/, "priority: highest");
        }
        if (type === "resource")
          source = source.replace(
            /source_uri: [^\n]+/,
            "source_uri: https://example.com/updated",
          );
        // A repeated canonical Topic must not make incremental indexing fail.
        if (type === "project")
          source = source.replace(
            "topics:\n",
            "topics:\n  - topic_01997c2a-7b1c-7a01-8a10-000000000002\n",
          );
        await writeFile(join(root, path), source, "utf8");
      }
      const result = await synchronizeVaultIndex(root, index);
      expect(result).toMatchObject({ mode: "incremental", changedFiles: 6 });
      const projection = () =>
        Object.fromEntries(
          [
            "entities",
            "entity_topics",
            "entity_references",
            "search_documents",
            "search_fts",
            "name_fts",
            "entry_todos",
            "entity_scopes",
            "validation_issues",
          ].map((table) => {
            const rows = index.database
              .prepare(`SELECT * FROM ${table}`)
              .all() as Record<string, unknown>[];
            return [
              table,
              rows
                .map((row) =>
                  JSON.stringify(
                    Object.fromEntries(
                      Object.entries(row).filter(
                        ([key]) => key !== "reference_id" && key !== "issue_id",
                      ),
                    ),
                  ),
                )
                .sort(),
            ];
          }),
        );
      const incremental = projection();
      await rebuildVaultIndex(root, index);
      expect(projection()).toEqual(incremental);
    } finally {
      index.close();
    }
  });
});
