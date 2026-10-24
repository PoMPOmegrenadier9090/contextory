import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SYNCTHING_IGNORE_TEMPLATE } from "@pkm/storage-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli, type CliIo } from "./cli.js";

const FIXTURE_ROOT = new URL("../../../fixtures/vault-v1/", import.meta.url);
const temporaryDirectories: string[] = [];

const copyFixtureVault = async (): Promise<string> => {
  const parent = await mkdtemp(join(tmpdir(), "pkms-cli-"));
  temporaryDirectories.push(parent);
  const vaultRoot = join(parent, "vault");
  await cp(FIXTURE_ROOT, vaultRoot, { recursive: true });
  await rm(join(vaultRoot, ".pkm"), { recursive: true, force: true });
  await rm(join(vaultRoot, ".stignore"), { force: true });
  return vaultRoot;
};

const captureIo = (): {
  readonly io: CliIo;
  readonly stdout: string[];
  readonly stderr: string[];
} => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    },
    stdout,
    stderr,
  };
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const mockGlobalFetch = (responses: readonly Response[]): void => {
  const queue = [...responses];
  vi.stubGlobal("fetch", () => {
    const response = queue.shift();
    if (response === undefined) throw new Error("Unexpected HTTP request");
    return Promise.resolve(response);
  });
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("runCli", () => {
  it("initializes an empty Vault in JSON mode and refuses non-Vault data", async () => {
    const root = await mkdtemp(join(tmpdir(), "pkms-cli-init-"));
    temporaryDirectories.push(root);
    const output = captureIo();
    expect(await runCli(["init", root, "--json"], output.io)).toBe(0);
    const initialized = JSON.parse(output.stdout[0] ?? "") as {
      vaultId: string;
    };
    expect(initialized).toMatchObject({
      command: "init",
      created: true,
      vaultRoot: root,
    });
    const validation = captureIo();
    expect(await runCli(["validate", root, "--json"], validation.io)).toBe(0);
    expect(await runCli(["check-sync", root], captureIo().io)).toBe(0);
    const again = captureIo();
    expect(await runCli(["init", root, "--json"], again.io)).toBe(0);
    expect(JSON.parse(again.stdout[0] ?? "")).toMatchObject({
      created: false,
      vaultId: initialized.vaultId,
    });
    await unlink(join(root, "vault.yaml"));
    expect(await runCli(["init", root], captureIo().io)).toBe(1);
  });
  it("validates a vault and supports machine-readable output", async () => {
    const vaultRoot = await copyFixtureVault();
    const output = captureIo();

    const exitCode = await runCli(["validate", vaultRoot, "--json"], output.io);

    expect(exitCode).toBe(0);
    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0] ?? "")).toMatchObject({
      command: "validate",
      entityFiles: 6,
      errors: 0,
      warnings: 0,
    });
  });

  it("returns a failing exit code when validation has errors", async () => {
    const vaultRoot = await copyFixtureVault();
    const taskPath = join(
      vaultRoot,
      "tasks",
      "tsk_01997c2a-7b1c-7a01-8a10-000000000004.md",
    );
    await writeFile(taskPath, "---\ntype: task\n---\n", "utf8");
    const output = captureIo();

    const exitCode = await runCli(["validate", vaultRoot], output.io);

    expect(exitCode).toBe(1);
    expect(output.stdout.join("\n")).toContain("[error]");
  });

  it("rejects a missing vault.yaml", async () => {
    const vaultRoot = await copyFixtureVault();
    await unlink(join(vaultRoot, "vault.yaml"));
    const output = captureIo();

    expect(await runCli(["validate", vaultRoot, "--json"], output.io)).toBe(1);
    expect(JSON.parse(output.stdout[0] ?? "")).toMatchObject({
      errors: 1,
      issues: [{ code: "MissingVaultConfig" }],
    });
  });

  it("rejects malformed vault.yaml", async () => {
    const vaultRoot = await copyFixtureVault();
    await writeFile(
      join(vaultRoot, "vault.yaml"),
      "schema_version: [\n",
      "utf8",
    );
    const output = captureIo();

    expect(await runCli(["validate", vaultRoot, "--json"], output.io)).toBe(1);
    expect(JSON.parse(output.stdout[0] ?? "")).toMatchObject({
      errors: 1,
      issues: [{ code: "InvalidVaultConfig" }],
    });
  });

  it("rejects a newer vault schema version", async () => {
    const vaultRoot = await copyFixtureVault();
    await writeFile(
      join(vaultRoot, "vault.yaml"),
      "vault_id: 01997c2a-7b1c-7a01-8a10-000000000000\nschema_version: 2\n",
      "utf8",
    );
    const output = captureIo();

    expect(await runCli(["validate", vaultRoot, "--json"], output.io)).toBe(1);
    expect(JSON.parse(output.stdout[0] ?? "")).toMatchObject({
      schemaVersion: 2,
      accessMode: "read-only",
      errors: 1,
      issues: [{ code: "UnsupportedSchemaVersion" }],
    });
  });

  it("rebuilds and then incrementally synchronizes the index", async () => {
    const vaultRoot = await copyFixtureVault();
    const rebuildOutput = captureIo();
    expect(
      await runCli(["rebuild-index", vaultRoot, "--json"], rebuildOutput.io),
    ).toBe(0);
    expect(JSON.parse(rebuildOutput.stdout[0] ?? "")).toMatchObject({
      command: "rebuild-index",
      indexedEntities: 6,
    });

    const taskPath = join(
      vaultRoot,
      "tasks",
      "tsk_01997c2a-7b1c-7a01-8a10-000000000004.md",
    );
    const task = await readFile(taskPath, "utf8");
    await writeFile(taskPath, `${task}\nUpdated through CLI.\n`, "utf8");
    const syncOutput = captureIo();

    expect(
      await runCli(["sync-index", vaultRoot, "--json"], syncOutput.io),
    ).toBe(0);
    expect(JSON.parse(syncOutput.stdout[0] ?? "")).toMatchObject({
      command: "sync-index",
      mode: "incremental",
      changedFiles: 1,
      indexedEntities: 6,
    });
  });

  it("checks the Syncthing boundary in human and JSON modes", async () => {
    const vaultRoot = await copyFixtureVault();
    const missingOutput = captureIo();

    expect(await runCli(["check-sync", vaultRoot], missingOutput.io)).toBe(1);
    expect(missingOutput.stdout.join("\n")).toContain("MISSING_IGNORE_FILE");
    expect(missingOutput.stdout.join("\n")).toContain("/.pkm");

    await writeFile(
      join(vaultRoot, ".stignore"),
      SYNCTHING_IGNORE_TEMPLATE,
      "utf8",
    );
    const validOutput = captureIo();
    expect(
      await runCli(["check-sync", vaultRoot, "--json"], validOutput.io),
    ).toBe(0);
    expect(JSON.parse(validOutput.stdout[0] ?? "")).toMatchObject({
      command: "check-sync",
      ok: true,
      configuredRules: ["/.pkm", "/.git"],
    });
  });

  it("reads Syncthing and folder status without exposing the API key", async () => {
    const vaultRoot = await copyFixtureVault();
    await writeFile(
      join(vaultRoot, ".stignore"),
      SYNCTHING_IGNORE_TEMPLATE,
      "utf8",
    );
    mockGlobalFetch([
      jsonResponse({ status: "OK" }),
      jsonResponse({ myID: "LOCAL-DEVICE", uptime: 60 }),
      jsonResponse({
        id: "pkm-01997c2a-7b1c-7a01-8a10-000000000000",
        label: "PKM fixture",
        path: vaultRoot,
        type: "sendreceive",
        devices: [{ deviceID: "REMOTE-DEVICE" }],
      }),
      jsonResponse({
        state: "idle",
        stateChanged: "2026-09-22T12:00:00Z",
        needBytes: 0,
        needTotalItems: 0,
        pullErrors: 0,
      }),
    ]);
    const output = captureIo();

    expect(
      await runCli(["sync-status", vaultRoot, "--json"], output.io, {
        PKM_SYNCTHING_API_KEY: "must-not-be-printed",
      }),
    ).toBe(0);
    const result = JSON.parse(output.stdout[0] ?? "") as unknown;
    expect(result).toMatchObject({
      command: "sync-status",
      health: "OK",
      deviceId: "LOCAL-DEVICE",
      folder: { configured: true, state: "idle" },
    });
    expect(output.stdout.join("\n")).not.toContain("must-not-be-printed");
  });

  it("bootstraps the Vault folder and rejects missing credentials", async () => {
    const vaultRoot = await copyFixtureVault();
    await writeFile(
      join(vaultRoot, ".stignore"),
      SYNCTHING_IGNORE_TEMPLATE,
      "utf8",
    );
    const missingKey = captureIo();
    expect(await runCli(["sync-status", vaultRoot], missingKey.io, {})).toBe(1);
    expect(missingKey.stderr).toEqual(["PKM_SYNCTHING_API_KEY is required"]);

    mockGlobalFetch([
      jsonResponse({ myID: "LOCAL-DEVICE", uptime: 60 }),
      jsonResponse({ error: "not found" }, 404),
      jsonResponse({
        id: "default",
        label: "Default Folder",
        path: "~/Sync",
        type: "sendreceive",
        devices: [],
      }),
      new Response(null, { status: 200 }),
    ]);
    const output = captureIo();
    expect(
      await runCli(["bootstrap-sync", vaultRoot, "--json"], output.io, {
        PKM_SYNCTHING_API_KEY: "secret-key",
        PKM_SYNCTHING_DEVICE_IDS: "REMOTE-A,REMOTE-B",
      }),
    ).toBe(0);
    expect(JSON.parse(output.stdout[0] ?? "")).toMatchObject({
      command: "bootstrap-sync",
      created: true,
      localDeviceId: "LOCAL-DEVICE",
      devices: ["REMOTE-A", "REMOTE-B"],
    });

    mockGlobalFetch([jsonResponse({ myID: "LOCAL-DEVICE", uptime: 60 })]);
    const localDevice = captureIo();
    expect(
      await runCli(["bootstrap-sync", vaultRoot], localDevice.io, {
        PKM_SYNCTHING_API_KEY: "secret-key",
        PKM_SYNCTHING_DEVICE_IDS: "LOCAL-DEVICE",
      }),
    ).toBe(1);
    expect(localDevice.stderr).toEqual([
      "PKM_SYNCTHING_DEVICE_IDS must contain remote devices only",
    ]);
  });

  it("prints usage and returns exit code 2 for invalid arguments", async () => {
    const output = captureIo();

    expect(await runCli(["unknown"], output.io)).toBe(2);
    expect(output.stdout).toEqual([]);
    expect(output.stderr[0]).toContain("Usage: pkm");
  });
});
