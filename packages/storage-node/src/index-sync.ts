import type { PkmIndexSyncResult as IndexSyncResult } from "@pkm/contracts";
export type { PkmIndexSyncResult as IndexSyncResult } from "@pkm/contracts";
import { validateEntityFile, type EntityFileValidation } from "@pkm/core";

import type { IndexDatabase } from "./index-database.js";
import { collectScopeDependents, refreshEntityScopes } from "./entity-scope.js";
import { rebuildVaultIndex } from "./index-rebuild.js";
import { readVaultFile } from "./vault-file.js";
import {
  type KnownVaultFile,
  scanVault,
  scanVaultPaths,
  type ScannedVaultFile,
} from "./vault-scan.js";
import {
  createIndexProjectionWriter,
  type IndexProjectionWriter,
} from "./index-projection.js";

import {
  emptyIndexChanges,
  captureIndexImpact,
  compareIndexImpact,
} from "./index-changes.js";

interface IndexedFileRow extends KnownVaultFile {
  readonly path: string;
  readonly kind: string;
  readonly hash: string;
  readonly entity_id: string | null;
  readonly canonical_entity_path: string | null;
}

interface PreparedFile {
  readonly scanned: ScannedVaultFile;
  readonly validation: EntityFileValidation | null;
}

const deleteEntityAtPath = (index: IndexDatabase, path: string): void => {
  const row = index.database
    .prepare("SELECT id FROM entities WHERE path = ?")
    .get(path) as { readonly id: string } | undefined;
  if (row === undefined) return;
  index.database
    .prepare("DELETE FROM entry_todos WHERE entity_id = ?")
    .run(row.id);
  index.database
    .prepare("DELETE FROM entity_topics WHERE entity_id = ?")
    .run(row.id);
  index.database
    .prepare("DELETE FROM entity_references WHERE source_id = ?")
    .run(row.id);
  index.database
    .prepare("DELETE FROM search_documents WHERE id = ?")
    .run(row.id);
  index.database
    .prepare("DELETE FROM entity_scopes WHERE entity_id = ?")
    .run(row.id);
  index.database.prepare("DELETE FROM entities WHERE id = ?").run(row.id);
};

const refreshGlobalIssues = (
  index: IndexDatabase,
  projection: IndexProjectionWriter,
  changedIds: ReadonlySet<string>,
): void => {
  const ids = JSON.stringify([...changedIds]);
  const affected = `SELECT value FROM json_each(@ids) UNION SELECT source_id FROM entity_references WHERE target_id IN (SELECT value FROM json_each(@ids))`;
  index.database
    .prepare(
      `DELETE FROM validation_issues WHERE code='UnresolvedReference' AND entity_id IN (${affected})`,
    )
    .run({ ids });
  const unresolved = index.database
    .prepare(
      `SELECT source.path AS file_path, source.id AS entity_id,
              refs.target_id, refs.field_path,
              refs.start_offset, refs.end_offset
       FROM entity_references refs
       JOIN entities source ON source.id = refs.source_id
       LEFT JOIN entities target ON target.id = refs.target_id
       WHERE target.id IS NULL AND source.id IN (${affected})`,
    )
    .all({ ids }) as Array<{
    readonly file_path: string;
    readonly entity_id: string;
    readonly target_id: string;
    readonly field_path: string | null;
    readonly start_offset: number | null;
    readonly end_offset: number | null;
  }>;
  for (const reference of unresolved) {
    projection.insertValidationIssue({
      code: "UnresolvedReference",
      severity: "warning",
      message: `Referenced entity ${reference.target_id} does not exist`,
      filePath: reference.file_path,
      entityId: reference.entity_id,
      targetId: reference.target_id,
      ...(reference.field_path === null
        ? {}
        : {
            fieldPath: JSON.parse(reference.field_path) as readonly (
              string | number
            )[],
          }),
      ...(reference.start_offset === null
        ? {}
        : { startOffset: reference.start_offset }),
      ...(reference.end_offset === null
        ? {}
        : { endOffset: reference.end_offset }),
    });
  }
};

const duplicateEntityIds = (
  currentFiles: readonly IndexedFileRow[],
  changedPaths: ReadonlySet<string>,
  deletedPaths: ReadonlySet<string>,
  preparedFiles: readonly PreparedFile[],
): readonly string[] => {
  const ids = new Map<string, number>();
  for (const file of currentFiles) {
    if (
      file.entity_id === null ||
      changedPaths.has(file.path) ||
      deletedPaths.has(file.path)
    ) {
      continue;
    }
    ids.set(file.entity_id, (ids.get(file.entity_id) ?? 0) + 1);
  }
  for (const file of preparedFiles) {
    if (file.validation?.ok !== true) continue;
    const id = file.validation.parsed.entity.id;
    ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  return [...ids].filter(([, count]) => count > 1).map(([id]) => id);
};

const hasCurrentDuplicateIds = (
  currentFiles: readonly IndexedFileRow[],
): boolean => {
  const seen = new Set<string>();
  for (const file of currentFiles) {
    if (file.entity_id === null) continue;
    if (seen.has(file.entity_id)) return true;
    seen.add(file.entity_id);
  }
  return false;
};

export const synchronizeVaultIndex = async (
  vaultRoot: string,
  index: IndexDatabase,
  paths?: readonly string[],
): Promise<IndexSyncResult> => {
  if (
    paths &&
    index.database
      .prepare(
        "SELECT 1 FROM validation_issues WHERE code='DuplicateId' LIMIT 1",
      )
      .get()
  )
    return synchronizeVaultIndex(vaultRoot, index);
  const currentFiles = index.database
    .prepare(
      `SELECT path, kind, hash, mtime_ms, ctime_ms, device, inode, size, entity_id, canonical_entity_path FROM files${paths ? " WHERE path IN (SELECT value FROM json_each(?))" : ""}`,
    )
    .all(...(paths ? [JSON.stringify(paths)] : [])) as IndexedFileRow[];
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));
  const scan = paths
    ? await scanVaultPaths(vaultRoot, paths, currentByPath)
    : await scanVault(vaultRoot, currentByPath);
  const scannedByPath = new Map(scan.files.map((file) => [file.path, file]));
  const added = scan.files.filter((file) => !currentByPath.has(file.path));
  const changed = scan.files.filter((file) => {
    const current = currentByPath.get(file.path);
    return (
      current !== undefined &&
      (current.hash !== file.hash ||
        current.kind !== file.kind ||
        current.canonical_entity_path !== (file.canonicalEntityPath ?? null))
    );
  });
  const deleted = currentFiles.filter((file) => !scannedByPath.has(file.path));
  const updateStat = index.database.prepare(
    "UPDATE files SET mtime_ms=?, ctime_ms=?, device=?, inode=?, size=? WHERE path=?",
  );
  index.database.transaction(() => {
    for (const file of scan.files) {
      const old = currentByPath.get(file.path);
      if (
        old &&
        old.hash === file.hash &&
        (old.mtime_ms !== file.mtimeMs ||
          old.ctime_ms !== file.ctimeMs ||
          old.device !== file.device ||
          old.inode !== file.inode ||
          old.size !== file.size)
      )
        updateStat.run(
          file.mtimeMs,
          file.ctimeMs,
          file.device,
          file.inode,
          file.size,
          file.path,
        );
    }
  })();
  if (added.length === 0 && changed.length === 0 && deleted.length === 0) {
    const counts = index.database
      .prepare(
        `SELECT
           (SELECT count(*) FROM entities) AS entities,
           (SELECT count(*) FROM conflicts) AS conflicts,
           (SELECT count(*) FROM validation_issues) AS issues`,
      )
      .get() as {
      readonly entities: number;
      readonly conflicts: number;
      readonly issues: number;
    };
    return {
      changes: emptyIndexChanges(),
      mode: "incremental",
      scannedFiles: scan.files.length,
      addedFiles: 0,
      changedFiles: 0,
      deletedFiles: 0,
      indexedEntities: counts.entities,
      conflicts: counts.conflicts,
      validationIssues: counts.issues,
    };
  }
  const changedPaths = new Set(changed.map((file) => file.path));
  const deletedPaths = new Set(deleted.map((file) => file.path));
  const pendingFiles = [...added, ...changed];
  const preparedFiles: PreparedFile[] = new Array<PreparedFile>(
    pendingFiles.length,
  );
  let nextFile = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, pendingFiles.length) }, async () => {
      while (nextFile < pendingFiles.length) {
        const pos = nextFile++;
        const scanned = pendingFiles[pos]!;
        preparedFiles[pos] = {
          scanned,
          validation:
            scanned.kind === "entity"
              ? validateEntityFile({
                  path: scanned.path,
                  source: (await readVaultFile(vaultRoot, scanned.path))
                    .content,
                })
              : null,
        };
      }
    }),
  );

  if (paths) {
    const ids = preparedFiles.flatMap((f) =>
      f.validation?.ok ? [f.validation.parsed.entity.id] : [],
    );
    const peers = index.database
      .prepare(
        "SELECT path, entity_id FROM files WHERE entity_id IN (SELECT value FROM json_each(?)) AND path NOT IN (SELECT value FROM json_each(?))",
      )
      .all(JSON.stringify(ids), JSON.stringify(paths)) as IndexedFileRow[];
    currentFiles.push(...peers);
  }
  const previousScopeSeeds = new Set(
    [...changed, ...deleted]
      .map((file) => currentByPath.get(file.path)?.entity_id ?? null)
      .filter((id): id is string => id !== null),
  );
  const previousScopeDependents = collectScopeDependents(
    index,
    previousScopeSeeds,
  );

  const beforeIds = [...previousScopeDependents];
  const before = captureIndexImpact(index, beforeIds);
  const conflictsChanged = [...added, ...changed, ...deleted].some(
    (f) => f.kind === "conflict",
  );
  if (
    hasCurrentDuplicateIds(currentFiles) ||
    duplicateEntityIds(currentFiles, changedPaths, deletedPaths, preparedFiles)
      .length > 0
  ) {
    const result = await rebuildVaultIndex(vaultRoot, index);
    return {
      changes: {
        ...emptyIndexChanges(),
        reset: true,
        countsChanged: true,
        calendarChanged: true,
        conflictsChanged: true,
      },
      mode: "full-rebuild",
      scannedFiles: result.scannedFiles,
      addedFiles: added.length,
      changedFiles: changed.length,
      deletedFiles: deleted.length,
      indexedEntities: result.indexedEntities,
      conflicts: result.conflicts,
      validationIssues: result.validationIssues,
    };
  }

  let affectedIds = beforeIds;
  index.database.transaction(() => {
    const projection = createIndexProjectionWriter(index);
    for (const path of [...deletedPaths, ...changedPaths]) {
      deleteEntityAtPath(index, path);
      index.database
        .prepare("DELETE FROM validation_issues WHERE file_path = ?")
        .run(path);
      index.database.prepare("DELETE FROM conflicts WHERE path = ?").run(path);
      index.database.prepare("DELETE FROM files WHERE path = ?").run(path);
    }

    const insertFile = index.database.prepare(
      `INSERT INTO files (
        path, kind, hash, mtime_ms, ctime_ms, device, inode, size, entity_id, canonical_entity_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const prepared of preparedFiles) {
      const { scanned, validation } = prepared;
      const entityId =
        validation?.ok === true ? validation.parsed.entity.id : null;
      insertFile.run(
        scanned.path,
        scanned.kind,
        scanned.hash,
        scanned.mtimeMs,
        scanned.ctimeMs,
        scanned.device,
        scanned.inode,
        scanned.size,
        entityId,
        scanned.canonicalEntityPath ?? null,
      );
      if (
        scanned.kind === "conflict" &&
        scanned.canonicalEntityPath !== undefined
      ) {
        index.database
          .prepare(
            `INSERT INTO conflicts (
              path, canonical_entity_path, hash, mtime_ms, size
            ) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            scanned.path,
            scanned.canonicalEntityPath,
            scanned.hash,
            scanned.mtimeMs,
            scanned.size,
          );
      }
      if (validation !== null) {
        for (const issue of validation.issues) {
          projection.insertValidationIssue(issue);
        }
        if (validation.ok) projection.insertEntity(validation);
      }
    }
    const nextScopeSeeds = new Set(previousScopeSeeds);
    for (const prepared of preparedFiles) {
      if (prepared.validation?.ok === true) {
        nextScopeSeeds.add(prepared.validation.parsed.entity.id);
      }
    }
    const affectedScopes = new Set([
      ...previousScopeDependents,
      ...collectScopeDependents(index, nextScopeSeeds),
    ]);
    affectedIds = [...new Set([...affectedScopes, ...nextScopeSeeds])];
    refreshEntityScopes(index, affectedScopes);
    refreshGlobalIssues(index, projection, nextScopeSeeds);
  })();

  const counts = index.database
    .prepare(
      `SELECT
         (SELECT count(*) FROM entities) AS entities,
         (SELECT count(*) FROM conflicts) AS conflicts,
         (SELECT count(*) FROM validation_issues) AS issues`,
    )
    .get() as {
    readonly entities: number;
    readonly conflicts: number;
    readonly issues: number;
  };
  return {
    changes: compareIndexImpact(
      before,
      captureIndexImpact(index, affectedIds),
      conflictsChanged,
    ),
    mode: "incremental",
    scannedFiles: scan.files.length,
    addedFiles: added.length,
    changedFiles: changed.length,
    deletedFiles: deleted.length,
    indexedEntities: counts.entities,
    conflicts: counts.conflicts,
    validationIssues: counts.issues,
  };
};
