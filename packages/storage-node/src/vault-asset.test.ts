import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createVaultAsset,
  MAX_ASSET_BYTES,
  readVaultAsset,
  requireAssetPath,
} from "./vault-asset.js";

const temporaryDirectories: string[] = [];
const vault = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "pkm-assets-"));
  temporaryDirectories.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Vault assets", () => {
  it("stores verified images and arbitrary files under unique paths", async () => {
    const root = await vault();
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const image = await createVaultAsset(root, {
      fileName: "image.png",
      dataBase64: png.toString("base64"),
    });
    expect(image.path).toMatch(/^assets\/images\/[0-9a-f-]+\.png$/);
    expect(image.mimeType).toBe("image/png");
    expect((await readVaultAsset(root, image.path)).data).toEqual(png);

    const file = await createVaultAsset(root, {
      fileName: "notes.pdf",
      dataBase64: Buffer.from("PDF content").toString("base64"),
    });
    expect(file.path).toMatch(/^assets\/files\/[0-9a-f-]+\.pdf$/);
    expect(file.mimeType).toBe("application/octet-stream");
  });

  it("does not serve a falsely labeled image inline", async () => {
    const root = await vault();
    const asset = await createVaultAsset(root, {
      fileName: "unsafe.png",
      dataBase64: Buffer.from("<script>bad()</script>").toString("base64"),
    });
    expect(asset.path).toContain("assets/files/");
    expect(asset.mimeType).toBe("application/octet-stream");
  });

  it("rejects traversal, oversized uploads, and symlinked asset directories", async () => {
    expect(() => requireAssetPath("assets/../vault.yaml")).toThrow();
    expect(() => requireAssetPath("assets/files/not-an-id.pdf")).toThrow();
    const root = await vault();
    await expect(
      createVaultAsset(root, {
        fileName: "huge.pdf",
        dataBase64: Buffer.alloc(MAX_ASSET_BYTES + 1).toString("base64"),
      }),
    ).rejects.toThrow();
    await symlink(tmpdir(), join(root, "assets"));
    await expect(
      createVaultAsset(root, {
        fileName: "small.txt",
        dataBase64: Buffer.from("hello").toString("base64"),
      }),
    ).rejects.toThrow(/symbolic link/);
  });
});
