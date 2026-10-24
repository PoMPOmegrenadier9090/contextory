import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseVaultConfig } from "@pkm/core";
import { initializeVault } from "./vault-init.js";
import { checkSyncthingIgnore } from "./syncthing-ignore.js";
import { openLocalVault } from "./local-vault-service.js";

const roots: string[] = [];
const emptyVault = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "pkms-vault-init-"));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
describe("initializeVault", () => {
  it("creates a usable empty Vault with a unique ID and safe sync boundary", async () => {
    const root = await emptyVault();
    await writeFile(join(root, ".DS_Store"), "finder");
    const initialized = await initializeVault(root);
    expect(initialized).toMatchObject({ created: true, vaultRoot: root });
    expect(
      parseVaultConfig(await readFile(join(root, "vault.yaml"), "utf8")),
    ).toMatchObject({
      ok: true,
      value: { vault_id: initialized.vaultId, schema_version: 1 },
    });
    expect(await readdir(root)).toEqual(
      expect.arrayContaining([
        "entries",
        "projects",
        "tasks",
        "resources",
        "topics",
        "areas",
        "assets",
        ".stignore",
      ]),
    );
    expect((await checkSyncthingIgnore(root)).ok).toBe(true);
    const service = await openLocalVault(root, { watch: false });
    try {
      expect(service.listEntities()).toEqual([]);
      expect(
        (
          await service.createEntity({
            type: "entry",
            displayName: null,
            body: "first entry",
          })
        ).entity.body,
      ).toBe("first entry");
    } finally {
      await service.close();
    }
    expect((await initializeVault(await emptyVault())).vaultId).not.toBe(
      initialized.vaultId,
    );
  });
  it("keeps existing config, data and ignore rules unchanged on repeated selection", async () => {
    const root = await emptyVault();
    const first = await initializeVault(root);
    await writeFile(join(root, ".stignore"), "custom ignore");
    const config = await readFile(join(root, "vault.yaml"), "utf8");
    expect(await initializeVault(root)).toEqual({ ...first, created: false });
    expect(await readFile(join(root, "vault.yaml"), "utf8")).toBe(config);
    expect(await readFile(join(root, ".stignore"), "utf8")).toBe(
      "custom ignore",
    );
  });
  it("rejects nonempty directories, malformed configs and linked roots without modifying them", async () => {
    const root = await emptyVault();
    await writeFile(join(root, "notes.md"), "keep me");
    await expect(initializeVault(root)).rejects.toThrow("空のフォルダ");
    expect(await readdir(root)).toEqual(["notes.md"]);
    await writeFile(join(root, "vault.yaml"), "schema_version: [");
    await expect(initializeVault(root)).rejects.toThrow("不正");
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe("keep me");
    const parent = await emptyVault();
    await symlink(root, join(parent, "link"));
    await expect(initializeVault(join(parent, "link"))).rejects.toThrow(
      "通常のディレクトリ",
    );
  });
});
