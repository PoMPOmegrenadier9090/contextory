export const CURRENT_SCHEMA_VERSION = 1;

export type VaultAccessMode = "read-write" | "migration-required" | "read-only";

export interface VaultSchemaCompatibility {
  readonly vaultVersion: number;
  readonly supportedVersion: number;
  readonly accessMode: VaultAccessMode;
  readonly message: string;
}

export const assessVaultSchemaVersion = (
  vaultVersion: number,
  supportedVersion = CURRENT_SCHEMA_VERSION,
): VaultSchemaCompatibility => {
  if (!Number.isSafeInteger(vaultVersion) || vaultVersion < 1) {
    throw new RangeError("Vault schema version must be a positive integer");
  }
  if (!Number.isSafeInteger(supportedVersion) || supportedVersion < 1) {
    throw new RangeError("Supported schema version must be a positive integer");
  }
  if (vaultVersion > supportedVersion) {
    return {
      vaultVersion,
      supportedVersion,
      accessMode: "read-only",
      message: `Vault schema v${vaultVersion} is newer than supported v${supportedVersion}`,
    };
  }
  if (vaultVersion < supportedVersion) {
    return {
      vaultVersion,
      supportedVersion,
      accessMode: "migration-required",
      message: `Vault schema v${vaultVersion} must migrate to v${supportedVersion}`,
    };
  }
  return {
    vaultVersion,
    supportedVersion,
    accessMode: "read-write",
    message: `Vault schema v${vaultVersion} is supported`,
  };
};
