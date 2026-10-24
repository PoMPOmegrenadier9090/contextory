import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readdir, stat, lstat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { ENTITY_DIRECTORIES } from "@pkm/core";

import {
  type FileHash,
  resolveVaultPath,
  isMissingFileError,
} from "./vault-file.js";

export type VaultFileKind =
  "entity" | "conflict" | "vault-config" | "asset" | "unknown";

export interface ScannedVaultFile {
  readonly path: string;
  readonly kind: VaultFileKind;
  readonly hash: FileHash;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly canonicalEntityPath?: string;
}

export interface KnownVaultFile {
  readonly hash: string;
  readonly mtime_ms: number;
  readonly ctime_ms: number;
  readonly size: number;
  readonly device: number;
  readonly inode: number;
}

export interface VaultScanResult {
  readonly scannedAt: string;
  readonly files: readonly ScannedVaultFile[];
}

const ignoredDirectoryNames = new Set([
  ".git",
  ".pkm",
  ".stfolder",
  ".stversions",
  "node_modules",
]);
const ignoredFileNames = new Set([".DS_Store", ".stignore"]);
const entityDirectories = new Set<string>(Object.values(ENTITY_DIRECTORIES));
const conflictPattern =
  /^(?<base>.+)\.sync-conflict-\d{8}-\d{6}-[a-z0-9]+\.md$/i;

const classifyVaultFile = (
  path: string,
): Pick<ScannedVaultFile, "kind" | "canonicalEntityPath"> => {
  if (path === "vault.yaml") {
    return { kind: "vault-config" };
  }
  const segments = path.split("/");
  if (segments[0] === "assets") {
    return { kind: "asset" };
  }
  const directory = segments[0];
  const fileName = segments.at(-1) ?? "";
  if (
    segments.length === 2 &&
    directory !== undefined &&
    entityDirectories.has(directory)
  ) {
    const conflict = conflictPattern.exec(fileName);
    if (conflict?.groups?.base !== undefined) {
      return {
        kind: "conflict",
        canonicalEntityPath: `${segments.slice(0, -1).join("/")}/${conflict.groups.base}.md`,
      };
    }
    if (fileName.endsWith(".md")) {
      return { kind: "entity" };
    }
  }
  return { kind: "unknown" };
};

const listFiles = async (
  root: string,
  directory: string,
): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        paths.push(...(await listFiles(root, absolutePath)));
      }
    } else if (entry.isFile() && !ignoredFileNames.has(entry.name)) {
      paths.push(relative(root, absolutePath).replaceAll("\\", "/"));
    }
  }
  return paths;
};

const hashVaultFile = async (path: string): Promise<FileHash> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}`;
};

export const scanVault = async (
  vaultRoot: string,
  knownFiles: ReadonlyMap<string, KnownVaultFile> = new Map(),
): Promise<VaultScanResult> => {
  const root = resolve(vaultRoot);
  const paths = [...(await listFiles(root, root))].sort();
  const files: ScannedVaultFile[] = new Array<ScannedVaultFile>(paths.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, paths.length) }, async () => {
      while (next < paths.length) {
        const position = next++;
        const path = paths[position]!;
        const absolutePath = join(root, path);
        const metadata = await stat(absolutePath);
        const previous = knownFiles.get(path);
        const unchanged =
          previous !== undefined &&
          previous.mtime_ms === metadata.mtimeMs &&
          previous.ctime_ms === metadata.ctimeMs &&
          previous.size === metadata.size &&
          previous.device === metadata.dev &&
          previous.inode === metadata.ino;
        files[position] = {
          path,
          ...classifyVaultFile(path),
          hash: unchanged
            ? (previous.hash as FileHash)
            : await hashVaultFile(absolutePath),
          mtimeMs: metadata.mtimeMs,
          ctimeMs: metadata.ctimeMs,
          device: metadata.dev,
          inode: metadata.ino,
          size: metadata.size,
        };
      }
    }),
  );
  return { scannedAt: new Date().toISOString(), files };
};

// Watcher paths are already relative to the Vault; directory events use full reconciliation.
export const scanVaultPaths = async (
  vaultRoot: string,
  paths: readonly string[],
  knownFiles: ReadonlyMap<string, KnownVaultFile>,
): Promise<VaultScanResult> => {
  const files: ScannedVaultFile[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, paths.length) }, async () => {
      while (next < paths.length) {
        const path = paths[next++]!;
        if (
          path.split("/").some((x) => ignoredDirectoryNames.has(x)) ||
          ignoredFileNames.has(path.split("/").at(-1)!)
        )
          continue;
        const absolutePath = resolveVaultPath(vaultRoot, path);
        try {
          let current = resolve(vaultRoot);
          let linked = false;
          for (const segment of relative(current, absolutePath).split(sep)) {
            current = join(current, segment);
            if ((await lstat(current)).isSymbolicLink()) {
              linked = true;
              break;
            }
          }
          if (linked) continue;
          const metadata = await lstat(absolutePath);
          if (!metadata.isFile()) continue;
          const old = knownFiles.get(path);
          const unchanged =
            old &&
            old.mtime_ms === metadata.mtimeMs &&
            old.ctime_ms === metadata.ctimeMs &&
            old.size === metadata.size &&
            old.device === metadata.dev &&
            old.inode === metadata.ino;
          files.push({
            path,
            ...classifyVaultFile(path),
            hash: unchanged
              ? (old.hash as FileHash)
              : await hashVaultFile(absolutePath),
            mtimeMs: metadata.mtimeMs,
            ctimeMs: metadata.ctimeMs,
            device: metadata.dev,
            inode: metadata.ino,
            size: metadata.size,
          });
        } catch (error) {
          if (!isMissingFileError(error)) throw error;
        }
      }
    }),
  );
  return {
    scannedAt: new Date().toISOString(),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
};
