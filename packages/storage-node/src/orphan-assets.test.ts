import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createVaultAsset } from "./vault-asset.js";
import {
  deleteOrphanAssets,
  listOrphanAssets,
  ORPHAN_ASSET_MIN_AGE_MS,
} from "./orphan-assets.js";

const roots: string[] = [];
const nowMs = Date.parse("2026-09-27T00:00:00.000Z");

const newVault = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "pkm-orphan-assets-"));
  roots.push(root);
  await mkdir(join(root, "entries"));
  await mkdir(join(root, "resources"));
  return root;
};

const addAsset = async (root: string, old = true) => {
  const asset = await createVaultAsset(root, {
    fileName: "document.pdf",
    dataBase64: Buffer.from("example PDF").toString("base64"),
  });
  const timestamp = new Date(
    nowMs - (old ? ORPHAN_ASSET_MIN_AGE_MS + 60_000 : 60_000),
  );
  await utimes(join(root, asset.path), timestamp, timestamp);
  return asset;
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("orphan asset cleanup", () => {
  it("keeps files referenced by Markdown, Resource metadata, drafts, and recent uploads", async () => {
    const root = await newVault();
    const orphan = await addAsset(root);
    const markdown = await addAsset(root);
    const resource = await addAsset(root);
    const draft = await addAsset(root);
    await addAsset(root, false);
    await writeFile(
      join(root, "entries", "note.md"),
      `![picture](../${markdown.path})`,
    );
    await writeFile(
      join(root, "resources", "source.md"),
      `asset_path: ${resource.path}\n`,
    );

    const candidates = await listOrphanAssets(
      root,
      [`[draft](../${draft.path})`],
      nowMs,
    );
    expect(candidates.map((asset) => asset.path)).toEqual([orphan.path]);
  });

  it("rechecks references and hashes before deleting selected candidates", async () => {
    const root = await newVault();
    const referencedLater = await addAsset(root);
    const changedLater = await addAsset(root);
    const removable = await addAsset(root);
    const initial = await listOrphanAssets(root, [], nowMs);
    await writeFile(
      join(root, "entries", "note.md"),
      `../${referencedLater.path}`,
    );
    await writeFile(join(root, changedLater.path), "changed after preview");
    const old = new Date(nowMs - ORPHAN_ASSET_MIN_AGE_MS - 60_000);
    await utimes(join(root, changedLater.path), old, old);

    const result = await deleteOrphanAssets(
      root,
      initial.map(({ path, hash }) => ({ path, hash })),
      [],
      nowMs,
    );
    expect(result.deleted).toEqual([removable.path]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped).toEqual(
      expect.arrayContaining([changedLater.path, referencedLater.path]),
    );
    await expect(readFile(join(root, removable.path))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(root, referencedLater.path)),
    ).resolves.toBeDefined();
    await expect(
      readFile(join(root, changedLater.path)),
    ).resolves.toBeDefined();
  });
});
