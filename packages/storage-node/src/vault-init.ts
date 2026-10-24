import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  CURRENT_SCHEMA_VERSION,
  ENTITY_DIRECTORIES,
  parseVaultConfig,
} from "@pkm/core";
import { createUuidV7 } from "@pkm/contracts";

import { isMissingFileError, readVaultFile } from "./vault-file.js";
import { SYNCTHING_IGNORE_TEMPLATE } from "./syncthing-ignore.js";

export interface InitializeVaultResult {
  readonly created: boolean;
  readonly vaultRoot: string;
  readonly vaultId: string;
}

// Existing Vaults are never repaired or overwritten implicitly. A directory
// containing user files without vault.yaml is not a new Vault.
export const initializeVault = async (
  vaultRoot: string,
): Promise<InitializeVaultResult> => {
  const root = resolve(vaultRoot);
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Vaultには通常のディレクトリを選択してください。");
  }
  try {
    const config = parseVaultConfig(
      (await readVaultFile(root, "vault.yaml")).content,
    );
    if (!config.ok)
      throw new Error(`vault.yamlが不正です: ${config.error.message}`);
    return { created: false, vaultRoot: root, vaultId: config.value.vault_id };
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  const entries = await readdir(root);
  if (entries.some((name) => name !== ".DS_Store")) {
    throw new Error(
      "vault.yamlがありません。新規Vaultには空のフォルダを選択してください。既存Vaultは同期完了後に開いてください。",
    );
  }
  const vaultId = createUuidV7();
  await writeFile(
    join(root, "vault.yaml"),
    `vault_id: ${vaultId}\nschema_version: ${CURRENT_SCHEMA_VERSION}\n`,
    { flag: "wx" },
  );
  for (const directory of [...Object.values(ENTITY_DIRECTORIES), "assets"]) {
    await mkdir(join(root, directory), { recursive: true });
  }
  await writeFile(join(root, ".stignore"), SYNCTHING_IGNORE_TEMPLATE, {
    flag: "wx",
  });
  return { created: true, vaultRoot: root, vaultId };
};
