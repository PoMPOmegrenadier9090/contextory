import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import type * as NodeFs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  scanVault,
  type KnownVaultFile,
  type ScannedVaultFile,
} from "./vault-scan.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) };
});

const known = (files: readonly ScannedVaultFile[]) =>
  new Map(
    files.map((file) => [
      file.path,
      {
        hash: file.hash,
        mtime_ms: file.mtimeMs,
        ctime_ms: file.ctimeMs,
        device: file.device,
        inode: file.inode,
        size: file.size,
      } satisfies KnownVaultFile,
    ]),
  );
describe("incremental Vault scan", () => {
  it("does not reread unchanged assets and detects same-size writes with preserved mtime", async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "pkms-scan-"));
    try {
      await fs.mkdir(join(root, "assets"));
      await fs.writeFile(
        join(root, "assets", "large.bin"),
        Buffer.alloc(1024 * 1024),
      );
      const path = join(root, "memo.md");
      await fs.writeFile(path, "old value");
      const first = await scanVault(root);
      const originalStat = await fs.stat(path);
      vi.mocked(createReadStream).mockClear();
      const unchanged = await scanVault(root, known(first.files));
      expect(createReadStream).not.toHaveBeenCalled();
      expect(unchanged.files).toEqual(first.files);
      await fs.writeFile(path, "new value");
      await fs.utimes(path, originalStat.atime, originalStat.mtime);
      const changed = await scanVault(root, known(first.files));
      expect(createReadStream).toHaveBeenCalledTimes(1);
      expect(
        changed.files.find((file) => file.path === "memo.md")?.hash,
      ).not.toBe(first.files.find((file) => file.path === "memo.md")?.hash);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
