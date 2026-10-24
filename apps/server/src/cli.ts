import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

import {
  parseVaultConfig,
  validateVault,
  type ValidationIssue,
  type VaultSourceFile,
} from "@pkm/core";
import {
  checkSyncthingIgnore,
  initializeVault,
  DEFAULT_SYNCTHING_URL,
  openVaultIndex,
  readVaultFile,
  rebuildVaultIndex,
  scanVault,
  synchronizeVaultIndex,
  SYNCTHING_IGNORE_TEMPLATE,
  SyncthingClient,
} from "@pkm/storage-node";

export interface CliIo {
  readonly stdout: (message: string) => void;
  readonly stderr: (message: string) => void;
}

export interface CliEnvironment {
  readonly PKM_SYNCTHING_API_KEY?: string;
  readonly PKM_SYNCTHING_DEVICE_IDS?: string;
  readonly PKM_SYNCTHING_URL?: string;
}

interface CliOptions {
  readonly command: string;
  readonly vaultRoot: string;
  readonly json: boolean;
}

const USAGE = `Usage: pkm <command> <vault-path> [--json]

Commands:
  init           Initialize an empty Vault directory
  validate       Validate all entity Markdown files
  rebuild-index  Recreate .pkm/index.sqlite from the vault
  sync-index     Update .pkm/index.sqlite using content hash differences
  check-sync     Verify the per-peer Syncthing ignore boundary
  sync-status    Read Syncthing health and Vault folder status
  bootstrap-sync Register the Vault as a Syncthing send-receive folder`;

const defaultIo: CliIo = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

const parseOptions = (args: readonly string[]): CliOptions | null => {
  const json = args.includes("--json");
  const positional = args.filter((argument) => argument !== "--json");
  const [command, vaultPath, ...rest] = positional;
  if (
    command === undefined ||
    vaultPath === undefined ||
    rest.length > 0 ||
    ![
      "init",
      "validate",
      "rebuild-index",
      "sync-index",
      "check-sync",
      "sync-status",
      "bootstrap-sync",
    ].includes(command)
  ) {
    return null;
  }
  return { command, vaultRoot: resolve(vaultPath), json };
};

const elapsedMilliseconds = (startedAt: number): number =>
  Math.round((performance.now() - startedAt) * 100) / 100;

const formatIssue = (issue: ValidationIssue): string =>
  `[${issue.severity}] ${issue.code} ${issue.filePath}: ${issue.message}`;

const readEntitySources = async (
  vaultRoot: string,
): Promise<{
  readonly sources: readonly VaultSourceFile[];
  readonly conflicts: number;
  readonly vaultConfigSource: string | null;
}> => {
  const scan = await scanVault(vaultRoot);
  const entityFiles = scan.files.filter((file) => file.kind === "entity");
  const sources = await Promise.all(
    entityFiles.map(async (file) => ({
      path: file.path,
      source: (await readVaultFile(vaultRoot, file.path)).content,
    })),
  );
  const vaultConfig = scan.files.find((file) => file.kind === "vault-config");
  return {
    sources,
    conflicts: scan.files.filter((file) => file.kind === "conflict").length,
    vaultConfigSource:
      vaultConfig === undefined
        ? null
        : (await readVaultFile(vaultRoot, vaultConfig.path)).content,
  };
};

const validateCommand = async (
  options: CliOptions,
  io: CliIo,
): Promise<number> => {
  const startedAt = performance.now();
  const { sources, conflicts, vaultConfigSource } = await readEntitySources(
    options.vaultRoot,
  );
  const validation = validateVault(sources);
  const configIssues: ValidationIssue[] = [];
  let schemaVersion: number | null = null;
  let accessMode: string | null = null;
  if (vaultConfigSource === null) {
    configIssues.push({
      code: "MissingVaultConfig",
      severity: "error",
      message: "vault.yaml is required",
      filePath: "vault.yaml",
    });
  } else {
    const config = parseVaultConfig(vaultConfigSource);
    if (!config.ok) {
      configIssues.push({
        code: "InvalidVaultConfig",
        severity: "error",
        message: config.error.message,
        filePath: "vault.yaml",
      });
    } else {
      schemaVersion = config.value.schema_version;
      accessMode = config.compatibility.accessMode;
      if (config.compatibility.accessMode !== "read-write") {
        configIssues.push({
          code: "UnsupportedSchemaVersion",
          severity: "error",
          message: config.compatibility.message,
          filePath: "vault.yaml",
        });
      }
    }
  }
  const issues = [...configIssues, ...validation.issues];
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const result = {
    command: "validate",
    vaultRoot: options.vaultRoot,
    entityFiles: sources.length,
    conflicts,
    schemaVersion,
    accessMode,
    errors,
    warnings,
    durationMs: elapsedMilliseconds(startedAt),
    issues,
  };

  if (options.json) {
    io.stdout(JSON.stringify(result, null, 2));
  } else {
    for (const issue of issues) io.stdout(formatIssue(issue));
    io.stdout(
      `Validated ${result.entityFiles} entity files: ${errors} errors, ${warnings} warnings, ${conflicts} conflicts (${result.durationMs} ms)`,
    );
  }
  return errors === 0 ? 0 : 1;
};

const rebuildIndexCommand = async (
  options: CliOptions,
  io: CliIo,
): Promise<number> => {
  const startedAt = performance.now();
  const index = openVaultIndex(options.vaultRoot);
  try {
    const rebuild = await rebuildVaultIndex(options.vaultRoot, index);
    const result = {
      command: "rebuild-index",
      vaultRoot: options.vaultRoot,
      ...rebuild,
      durationMs: elapsedMilliseconds(startedAt),
    };
    io.stdout(
      options.json
        ? JSON.stringify(result, null, 2)
        : `Rebuilt index: ${result.indexedEntities} entities, ${result.validationIssues} validation issues, ${result.conflicts} conflicts (${result.durationMs} ms)`,
    );
    return 0;
  } finally {
    index.close();
  }
};

const syncIndexCommand = async (
  options: CliOptions,
  io: CliIo,
): Promise<number> => {
  const startedAt = performance.now();
  const index = openVaultIndex(options.vaultRoot);
  try {
    const sync = await synchronizeVaultIndex(options.vaultRoot, index);
    const result = {
      command: "sync-index",
      vaultRoot: options.vaultRoot,
      ...sync,
      durationMs: elapsedMilliseconds(startedAt),
    };
    io.stdout(
      options.json
        ? JSON.stringify(result, null, 2)
        : `Synchronized index (${result.mode}): ${result.addedFiles} added, ${result.changedFiles} changed, ${result.deletedFiles} deleted; ${result.indexedEntities} entities (${result.durationMs} ms)`,
    );
    return 0;
  } finally {
    index.close();
  }
};

const checkSyncCommand = async (
  options: CliOptions,
  io: CliIo,
): Promise<number> => {
  const check = await checkSyncthingIgnore(options.vaultRoot);
  const result = {
    command: "check-sync",
    vaultRoot: options.vaultRoot,
    ...check,
  };
  if (options.json) {
    io.stdout(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    io.stdout(
      `Syncthing boundary is valid: ${result.syncedExamples.length} synced examples, ${result.excludedExamples.length} excluded examples`,
    );
  } else {
    for (const issue of result.issues) {
      io.stdout(`[error] ${issue.code}: ${issue.message}`);
    }
    io.stdout(`Expected ${result.path}:\n${SYNCTHING_IGNORE_TEMPLATE}`);
  }
  return result.ok ? 0 : 1;
};

const syncthingContext = async (
  options: CliOptions,
  environment: CliEnvironment,
): Promise<{
  readonly client: SyncthingClient;
  readonly folderId: string;
  readonly label: string;
  readonly deviceIds: readonly string[];
}> => {
  const boundary = await checkSyncthingIgnore(options.vaultRoot);
  if (!boundary.ok) {
    throw new Error(
      `Syncthing boundary is invalid; run check-sync first (${boundary.issues.map((issue) => issue.code).join(", ")})`,
    );
  }
  const config = parseVaultConfig(
    (await readVaultFile(options.vaultRoot, "vault.yaml")).content,
  );
  if (!config.ok)
    throw new Error(`Invalid vault.yaml: ${config.error.message}`);
  const apiKey = environment.PKM_SYNCTHING_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("PKM_SYNCTHING_API_KEY is required");
  }
  const vaultId = config.value.vault_id;
  return {
    client: new SyncthingClient({
      apiKey,
      baseUrl: environment.PKM_SYNCTHING_URL ?? DEFAULT_SYNCTHING_URL,
    }),
    folderId: `pkm-${vaultId}`,
    label: `PKM ${vaultId}`,
    deviceIds: (environment.PKM_SYNCTHING_DEVICE_IDS ?? "")
      .split(",")
      .map((deviceId) => deviceId.trim())
      .filter((deviceId) => deviceId.length > 0),
  };
};

const syncStatusCommand = async (
  options: CliOptions,
  io: CliIo,
  environment: CliEnvironment,
): Promise<number> => {
  const { client, folderId } = await syncthingContext(options, environment);
  const status = await client.getStatus(folderId);
  const result = {
    command: "sync-status",
    vaultRoot: options.vaultRoot,
    ...status,
  };
  if (options.json) {
    io.stdout(JSON.stringify(result, null, 2));
  } else {
    io.stdout(
      status.folder.configured
        ? `Syncthing ${status.health}: device ${status.deviceId}, folder ${folderId} is ${status.folder.state ?? "unknown"}, ${status.folder.needTotalItems ?? 0} items needed, ${status.folder.pullErrors ?? 0} pull errors`
        : `Syncthing ${status.health}: device ${status.deviceId}, folder ${folderId} is not configured`,
    );
  }
  return status.health === "OK" && status.folder.configured ? 0 : 1;
};

const bootstrapSyncCommand = async (
  options: CliOptions,
  io: CliIo,
  environment: CliEnvironment,
): Promise<number> => {
  const { client, folderId, label, deviceIds } = await syncthingContext(
    options,
    environment,
  );
  const system = await client.getSystemStatus();
  if (deviceIds.includes(system.myID)) {
    throw new Error(
      "PKM_SYNCTHING_DEVICE_IDS must contain remote devices only",
    );
  }
  const bootstrap = await client.bootstrapFolder({
    folderId,
    label,
    path: options.vaultRoot,
    deviceIds,
  });
  const result = {
    command: "bootstrap-sync",
    vaultRoot: options.vaultRoot,
    localDeviceId: system.myID,
    ...bootstrap,
  };
  io.stdout(
    options.json
      ? JSON.stringify(result, null, 2)
      : bootstrap.created
        ? `Created Syncthing folder ${folderId} for ${bootstrap.path}; local device ${system.myID}`
        : `Syncthing folder ${folderId} already uses ${bootstrap.path}; no changes made`,
  );
  return 0;
};

export const runCli = async (
  args: readonly string[],
  io: CliIo = defaultIo,
  environment: CliEnvironment = process.env,
): Promise<number> => {
  const options = parseOptions(args);
  if (options === null) {
    io.stderr(USAGE);
    return 2;
  }

  try {
    switch (options.command) {
      case "init": {
        const result = await initializeVault(options.vaultRoot);
        io.stdout(
          options.json
            ? JSON.stringify({ command: "init", ...result }, null, 2)
            : `${result.created ? "Initialized" : "Opened existing"} Vault ${result.vaultId} at ${result.vaultRoot}`,
        );
        return 0;
      }
      case "validate":
        return await validateCommand(options, io);
      case "rebuild-index":
        return await rebuildIndexCommand(options, io);
      case "sync-index":
        return await syncIndexCommand(options, io);
      case "check-sync":
        return await checkSyncCommand(options, io);
      case "sync-status":
        return await syncStatusCommand(options, io, environment);
      case "bootstrap-sync":
        return await bootstrapSyncCommand(options, io, environment);
      default:
        io.stderr(USAGE);
        return 2;
    }
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
};
