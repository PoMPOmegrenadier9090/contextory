import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

export const SYNCTHING_IGNORE_FILE = ".stignore";
export const REQUIRED_SYNCTHING_IGNORE_RULES = ["/.pkm", "/.git"] as const;

export const SYNCTHING_IGNORE_TEMPLATE = `// PKM device-local state (managed by pkms)
${REQUIRED_SYNCTHING_IGNORE_RULES.join("\n")}
`;

export type SyncthingIgnoreIssueCode =
  | "MISSING_IGNORE_FILE"
  | "IGNORE_FILE_NOT_REGULAR"
  | "INVALID_IGNORE_ENCODING"
  | "MISSING_REQUIRED_RULE"
  | "UNMANAGED_IGNORE_RULE";

export interface SyncthingIgnoreIssue {
  readonly code: SyncthingIgnoreIssueCode;
  readonly message: string;
  readonly rule?: string;
}

export interface SyncthingIgnoreCheckResult {
  readonly ok: boolean;
  readonly path: string;
  readonly requiredRules: readonly string[];
  readonly configuredRules: readonly string[];
  readonly syncedExamples: readonly string[];
  readonly excludedExamples: readonly string[];
  readonly issues: readonly SyncthingIgnoreIssue[];
}

const syncedExamples = [
  "vault.yaml",
  "entries/ent_<uuid>.md",
  "tasks/tsk_<uuid>.sync-conflict-<timestamp>-<device>.md",
  "assets/images/example.png",
] as const;

const excludedExamples = [
  ".pkm/index.sqlite",
  ".pkm/local-state.sqlite",
  ".pkm/index.sqlite-wal",
  ".git/objects/...",
] as const;

const isMissingFileError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "ENOENT";

const parseRules = (source: string): readonly string[] =>
  source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));

const resultWithIssues = (
  configuredRules: readonly string[],
  issues: readonly SyncthingIgnoreIssue[],
): SyncthingIgnoreCheckResult => ({
  ok: issues.length === 0,
  path: SYNCTHING_IGNORE_FILE,
  requiredRules: REQUIRED_SYNCTHING_IGNORE_RULES,
  configuredRules,
  syncedExamples,
  excludedExamples,
  issues,
});

export const checkSyncthingIgnore = async (
  vaultRoot: string,
): Promise<SyncthingIgnoreCheckResult> => {
  const path = join(vaultRoot, SYNCTHING_IGNORE_FILE);
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return resultWithIssues(
      [],
      [
        {
          code: "MISSING_IGNORE_FILE",
          message:
            ".stignore is required on every Syncthing peer; it is not synchronized between peers",
        },
      ],
    );
  }

  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    return resultWithIssues(
      [],
      [
        {
          code: "IGNORE_FILE_NOT_REGULAR",
          message: ".stignore must be a regular file inside the Vault root",
        },
      ],
    );
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(
      await readFile(path),
    );
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return resultWithIssues(
      [],
      [
        {
          code: "INVALID_IGNORE_ENCODING",
          message: ".stignore must be valid UTF-8",
        },
      ],
    );
  }
  const configuredRules = parseRules(source);
  const required = new Set<string>(REQUIRED_SYNCTHING_IGNORE_RULES);
  const issues: SyncthingIgnoreIssue[] = [];
  for (const rule of REQUIRED_SYNCTHING_IGNORE_RULES) {
    if (!configuredRules.includes(rule)) {
      issues.push({
        code: "MISSING_REQUIRED_RULE",
        message: `Required Syncthing ignore rule is missing: ${rule}`,
        rule,
      });
    }
  }
  for (const rule of configuredRules) {
    if (!required.has(rule)) {
      issues.push({
        code: "UNMANAGED_IGNORE_RULE",
        message: `Unmanaged ignore rule could exclude canonical Vault data: ${rule}`,
        rule,
      });
    }
  }
  return resultWithIssues(configuredRules, issues);
};
