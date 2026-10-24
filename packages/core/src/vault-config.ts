import { parseDocument } from "yaml";

import {
  vaultConfigFileSchema,
  type ParsedVaultConfigFile,
} from "./entity-schema.js";
import {
  assessVaultSchemaVersion,
  type VaultSchemaCompatibility,
} from "./schema-version.js";

export type VaultConfigParseErrorCode =
  "INVALID_YAML" | "NON_OBJECT_CONFIG" | "INVALID_CONFIG";

export interface VaultConfigParseError {
  readonly code: VaultConfigParseErrorCode;
  readonly message: string;
}

export type ParseVaultConfigResult =
  | {
      readonly ok: true;
      readonly value: ParsedVaultConfigFile;
      readonly compatibility: VaultSchemaCompatibility;
    }
  | { readonly ok: false; readonly error: VaultConfigParseError };

export const parseVaultConfig = (source: string): ParseVaultConfigResult => {
  const document = parseDocument(source, { prettyErrors: true });
  if (document.errors.length > 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_YAML",
        message: document.errors.map((error) => error.message).join("; "),
      },
    };
  }

  const data: unknown = document.toJS();
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {
      ok: false,
      error: {
        code: "NON_OBJECT_CONFIG",
        message: "vault.yaml must contain a YAML mapping",
      },
    };
  }

  const parsed = vaultConfigFileSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_CONFIG",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
      },
    };
  }

  return {
    ok: true,
    value: parsed.data,
    compatibility: assessVaultSchemaVersion(parsed.data.schema_version),
  };
};
