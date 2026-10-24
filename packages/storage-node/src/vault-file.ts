import { createHash } from "node:crypto";
import { lstat, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { PkmFileHash as FileHash, PkmFileSnapshot } from "@pkm/contracts";
export type { PkmFileHash as FileHash } from "@pkm/contracts";

export interface VaultFileSnapshot extends PkmFileSnapshot {
  readonly mtimeMs: number;
  readonly size: number;
}

export const hashFileContent = (content: string | Uint8Array): FileHash =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

export const resolveVaultPath = (
  vaultRoot: string,
  relativePath: string,
): string => {
  if (isAbsolute(relativePath) || relativePath.length === 0) {
    throw new Error("Vault path must be a non-empty relative path");
  }
  const root = resolve(vaultRoot);
  const absolutePath = resolve(root, relativePath);
  const pathFromRoot = relative(root, absolutePath);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Path escapes the vault root: ${relativePath}`);
  }
  return absolutePath;
};

export const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

export const assertVaultWritePathSafe = async (
  vaultRoot: string,
  relativePath: string,
): Promise<void> => {
  const root = resolve(vaultRoot);
  const absolutePath = resolveVaultPath(root, relativePath);
  const segments = relative(root, absolutePath).split(sep);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new Error(
          `Vault write path contains a symbolic link: ${relativePath}`,
        );
      }
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }
  }
};

export const readVaultFile = async (
  vaultRoot: string,
  relativePath: string,
): Promise<VaultFileSnapshot> => {
  const absolutePath = resolveVaultPath(vaultRoot, relativePath);
  const [content, metadata] = await Promise.all([
    readFile(absolutePath, "utf8"),
    stat(absolutePath),
  ]);
  return {
    path: relativePath.replaceAll("\\", "/"),
    content,
    hash: hashFileContent(content),
    mtimeMs: metadata.mtimeMs,
    size: metadata.size,
  };
};

export const readVaultFileIfExists = async (
  vaultRoot: string,
  path: string,
): Promise<VaultFileSnapshot | null> => {
  try {
    return await readVaultFile(vaultRoot, path);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
};
