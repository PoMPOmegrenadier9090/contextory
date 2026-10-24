import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileVaultPreferences } from "./vault-preferences.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
describe("FileVaultPreferences", () => {
  it("remembers the last path across app instances with no leftover temporary files", async () => {
    const root = await mkdtemp(join(tmpdir(), "pkms-vault-preferences-"));
    roots.push(root);
    const path = join(root, "settings", "vault-preferences.json");
    const preferences = new FileVaultPreferences(() => path);
    expect(await preferences.readLastVaultRoot()).toBeNull();
    await preferences.saveLastVaultRoot(join(root, "first"));
    await preferences.saveLastVaultRoot(join(root, "last"));
    expect(await new FileVaultPreferences(() => path).readLastVaultRoot()).toBe(
      join(root, "last"),
    );
    expect(await readdir(join(root, "settings"))).toEqual([
      "vault-preferences.json",
    ]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      lastVaultRoot: join(root, "last"),
    });
    await writeFile(path, JSON.stringify({ lastVaultRoot: "relative" }));
    await expect(preferences.readLastVaultRoot()).rejects.toThrow("不正");
    await writeFile(path, "{");
    await expect(preferences.readLastVaultRoot()).rejects.toThrow();
  });
});
