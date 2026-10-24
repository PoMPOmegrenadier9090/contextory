import { describe, expect, it } from "vitest";

import { assessVaultSchemaVersion } from "./schema-version.js";

describe("assessVaultSchemaVersion", () => {
  it("makes newer vaults read-only", () => {
    expect(assessVaultSchemaVersion(2, 1)).toMatchObject({
      accessMode: "read-only",
      vaultVersion: 2,
      supportedVersion: 1,
    });
  });

  it("distinguishes supported and older vaults", () => {
    expect(assessVaultSchemaVersion(1, 1).accessMode).toBe("read-write");
    expect(assessVaultSchemaVersion(1, 2).accessMode).toBe(
      "migration-required",
    );
  });
});
