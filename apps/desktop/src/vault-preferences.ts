import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

export interface VaultPreferences {
  readLastVaultRoot(): Promise<string | null>;
  saveLastVaultRoot(vaultRoot: string): Promise<void>;
}

// Device-local preferences belong in Electron userData, outside synced Vaults.
export class FileVaultPreferences implements VaultPreferences {
  constructor(private readonly path: () => string) {}

  async readLastVaultRoot(): Promise<string | null> {
    let source: string;
    try {
      source = await readFile(this.path(), "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return null;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new Error(
        "保存されたVault設定が不正です。Vaultを選択し直してください。",
        { cause: error },
      );
    }
    if (
      typeof value !== "object" ||
      value === null ||
      !("lastVaultRoot" in value) ||
      typeof value.lastVaultRoot !== "string" ||
      !isAbsolute(value.lastVaultRoot)
    ) {
      throw new Error(
        "保存されたVault設定が不正です。Vaultを選択し直してください。",
      );
    }
    return value.lastVaultRoot;
  }

  async saveLastVaultRoot(vaultRoot: string): Promise<void> {
    if (!isAbsolute(vaultRoot))
      throw new TypeError("Vault path must be absolute");
    const path = this.path();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ lastVaultRoot: vaultRoot }, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
