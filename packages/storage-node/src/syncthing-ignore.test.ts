import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkSyncthingIgnore,
  SYNCTHING_IGNORE_TEMPLATE,
} from "./syncthing-ignore.js";

const temporaryDirectories: string[] = [];

const createVaultRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "pkms-sync-ignore-"));
  temporaryDirectories.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Syncthing ignore check", () => {
  it("accepts the managed rules and documents both sides of the boundary", async () => {
    const root = await createVaultRoot();
    await writeFile(join(root, ".stignore"), SYNCTHING_IGNORE_TEMPLATE, "utf8");

    const result = await checkSyncthingIgnore(root);

    expect(result).toMatchObject({
      ok: true,
      configuredRules: ["/.pkm", "/.git"],
      issues: [],
    });
    expect(result.syncedExamples).toContain("vault.yaml");
    expect(result.syncedExamples).toContain(
      "tasks/tsk_<uuid>.sync-conflict-<timestamp>-<device>.md",
    );
    expect(result.excludedExamples).toContain(".pkm/local-state.sqlite");
  });

  it("reports a missing per-peer ignore file", async () => {
    const root = await createVaultRoot();

    await expect(checkSyncthingIgnore(root)).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "MISSING_IGNORE_FILE" }],
    });
  });

  it("rejects missing and unmanaged rules", async () => {
    const root = await createVaultRoot();
    await writeFile(join(root, ".stignore"), "/.pkm\n*.md\n", "utf8");

    const result = await checkSyncthingIgnore(root);

    expect(result.ok).toBe(false);
    expect(result.issues).toMatchObject([
      { code: "MISSING_REQUIRED_RULE", rule: "/.git" },
      { code: "UNMANAGED_IGNORE_RULE", rule: "*.md" },
    ]);
  });

  it("treats only Syncthing double-slash lines as comments", async () => {
    const root = await createVaultRoot();
    await writeFile(
      join(root, ".stignore"),
      `${SYNCTHING_IGNORE_TEMPLATE}# this is a pattern, not a comment\n`,
      "utf8",
    );

    await expect(checkSyncthingIgnore(root)).resolves.toMatchObject({
      ok: false,
      issues: [
        {
          code: "UNMANAGED_IGNORE_RULE",
          rule: "# this is a pattern, not a comment",
        },
      ],
    });
  });

  it("rejects a non-UTF-8 ignore file", async () => {
    const root = await createVaultRoot();
    await writeFile(join(root, ".stignore"), Uint8Array.of(0xff));

    await expect(checkSyncthingIgnore(root)).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "INVALID_IGNORE_ENCODING" }],
    });
  });

  it("rejects a symlinked ignore file", async () => {
    const root = await createVaultRoot();
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "rules"), SYNCTHING_IGNORE_TEMPLATE, "utf8");
    await symlink(join(outside, "rules"), join(root, ".stignore"));

    await expect(checkSyncthingIgnore(root)).resolves.toMatchObject({
      ok: false,
      issues: [{ code: "IGNORE_FILE_NOT_REGULAR" }],
    });
  });
});
