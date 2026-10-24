import { validateVault } from "@pkm/core";

import type { IndexDatabase } from "./index-database.js";
import { rebuildEntityScopes } from "./entity-scope.js";
import { readVaultFile } from "./vault-file.js";
import { scanVault } from "./vault-scan.js";
import { createIndexProjectionWriter } from "./index-projection.js";

export interface IndexRebuildResult {
  readonly scannedFiles: number;
  readonly indexedEntities: number;
  readonly conflicts: number;
  readonly validationIssues: number;
}

export const rebuildVaultIndex = async (
  vaultRoot: string,
  index: IndexDatabase,
): Promise<IndexRebuildResult> => {
  const scan = await scanVault(vaultRoot);
  const entityFiles = scan.files.filter((file) => file.kind === "entity");
  const sources = new Array<{ path: string; source: string }>(
    entityFiles.length,
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, entityFiles.length) }, async () => {
      while (next < entityFiles.length) {
        const position = next++;
        const file = entityFiles[position]!;
        sources[position] = {
          path: file.path,
          source: (await readVaultFile(vaultRoot, file.path)).content,
        };
      }
    }),
  );
  const validation = validateVault(sources);
  const validationByPath = new Map(
    validation.files.map((file) => [file.file.path, file]),
  );
  const database = index.database;
  let indexedEntities = 0;

  database.transaction(() => {
    const projection = createIndexProjectionWriter(index);
    database.exec(`
      DELETE FROM entry_todos;
      DELETE FROM entity_scopes;
      DELETE FROM search_documents;
      DELETE FROM entity_topics;
      DELETE FROM entity_references;
      DELETE FROM validation_issues;
      DELETE FROM conflicts;
      DELETE FROM entities;
      DELETE FROM files;
    `);

    const insertFile = database.prepare(`
      INSERT INTO files (
        path, kind, hash, mtime_ms, ctime_ms, device, inode, size, entity_id, canonical_entity_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const file of scan.files) {
      const validationFile = validationByPath.get(file.path);
      const entityId =
        validationFile?.ok === true ? validationFile.parsed.entity.id : null;
      insertFile.run(
        file.path,
        file.kind,
        file.hash,
        file.mtimeMs,
        file.ctimeMs,
        file.device,
        file.inode,
        file.size,
        entityId,
        file.canonicalEntityPath ?? null,
      );
    }

    const insertConflict = database.prepare(`
      INSERT INTO conflicts (
        path, canonical_entity_path, hash, mtime_ms, size
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (const file of scan.files) {
      if (file.kind !== "conflict" || file.canonicalEntityPath === undefined) {
        continue;
      }
      insertConflict.run(
        file.path,
        file.canonicalEntityPath,
        file.hash,
        file.mtimeMs,
        file.size,
      );
    }

    const indexedIds = new Set<string>();
    for (const file of validation.files) {
      if (!file.ok || indexedIds.has(file.parsed.entity.id)) continue;
      indexedIds.add(file.parsed.entity.id);
      projection.insertEntity(file);
      indexedEntities += 1;
    }

    rebuildEntityScopes(index);

    for (const issue of validation.issues)
      projection.insertValidationIssue(issue);
  })();

  return {
    scannedFiles: scan.files.length,
    indexedEntities,
    conflicts: scan.files.filter((file) => file.kind === "conflict").length,
    validationIssues: validation.issues.length,
  };
};
