import type {
  PkmOrphanAsset as OrphanAsset,
  PkmOrphanAssetCleanupResult as OrphanAssetCleanupResult,
} from "@pkm/contracts";
export type {
  PkmOrphanAsset as OrphanAsset,
  PkmOrphanAssetCleanupResult as OrphanAssetCleanupResult,
} from "@pkm/contracts";
import { readFile, unlink } from "node:fs/promises";

import {
  assertVaultWritePathSafe,
  hashFileContent,
  resolveVaultPath,
  type FileHash,
} from "./vault-file.js";
import { requireAssetPath } from "./vault-asset.js";
import { scanVault, type ScannedVaultFile } from "./vault-scan.js";

export const ORPHAN_ASSET_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ASSET_REFERENCE =
  /assets\/(?:images|files)\/[0-9a-f-]{36}\.[a-z0-9]{1,10}/g;

const isCandidate = (
  file: ScannedVaultFile,
  nowMs: number,
): file is ScannedVaultFile & { readonly kind: "asset" } => {
  if (file.kind !== "asset" || file.mtimeMs > nowMs - ORPHAN_ASSET_MIN_AGE_MS)
    return false;
  try {
    requireAssetPath(file.path);
    return true;
  } catch {
    return false;
  }
};

export const listOrphanAssets = async (
  vaultRoot: string,
  localContents: readonly string[],
  nowMs: number,
): Promise<readonly OrphanAsset[]> => {
  const scanned = await scanVault(vaultRoot);
  const contents = [...localContents];
  // Any Markdown, including invalid entities, deleted entities and Syncthing
  // conflict copies, can still carry a valid asset reference.
  for (const file of scanned.files) {
    if (!file.path.endsWith(".md")) continue;
    contents.push(
      await readFile(resolveVaultPath(vaultRoot, file.path), "utf8"),
    );
  }
  const referenced = new Set(
    contents.flatMap((content) =>
      [...content.matchAll(ASSET_REFERENCE)].map(([path]) => path),
    ),
  );
  return scanned.files
    .filter((file) => isCandidate(file, nowMs))
    .filter((file) => !referenced.has(file.path))
    .map(({ path, hash, size, mtimeMs }) => ({ path, hash, size, mtimeMs }));
};

export const deleteOrphanAssets = async (
  vaultRoot: string,
  requested: readonly Pick<OrphanAsset, "path" | "hash">[],
  localContents: readonly string[],
  nowMs: number,
): Promise<OrphanAssetCleanupResult> => {
  if (requested.length > 1000)
    throw new TypeError("Too many assets in one cleanup");
  const eligible = new Map(
    (await listOrphanAssets(vaultRoot, localContents, nowMs)).map((asset) => [
      asset.path,
      asset,
    ]),
  );
  const deleted: string[] = [];
  const skipped: string[] = [];
  const visited = new Set<string>();
  for (const item of requested) {
    const path = requireAssetPath(item.path);
    if (visited.has(path)) continue;
    visited.add(path);
    const candidate = eligible.get(path);
    if (candidate?.hash !== item.hash) {
      skipped.push(path);
      continue;
    }
    await assertVaultWritePathSafe(vaultRoot, path);
    let currentHash: FileHash;
    try {
      currentHash = hashFileContent(
        await readFile(resolveVaultPath(vaultRoot, path)),
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        skipped.push(path);
        continue;
      }
      throw error;
    }
    if (currentHash !== candidate.hash) {
      skipped.push(path);
      continue;
    }
    try {
      await unlink(resolveVaultPath(vaultRoot, path));
      deleted.push(path);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        skipped.push(path);
      } else {
        throw error;
      }
    }
  }
  return { deleted, skipped };
};
