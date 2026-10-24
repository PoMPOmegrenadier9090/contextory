import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStateDatabase } from "./local-state.js";
import { readVaultFile } from "./vault-file.js";
import { saveVaultFileWithDraft } from "./vault-store.js";

const temporaryDirectories: string[] = [];

const entryMarkdown = (heading: string, updatedAt: string): string => `---
id: ent_01997c2a-7b1c-7a01-8a10-000000000006
type: entry
origin: human
exclude_from_ai: false
created_at: 2026-09-21T10:00:00+09:00
updated_at: ${updatedAt}
---
# ${heading}
`;

const createTemporaryVault = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "pkms-local-state-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "entries"), { recursive: true });
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("LocalStateDatabase", () => {
  it("retains a draft across reopen and removes it after a successful save", async () => {
    const root = await createTemporaryVault();
    const entityId = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
    const relativePath = `entries/${entityId}.md`;
    const absolutePath = join(root, relativePath);
    const statePath = join(root, ".pkm", "local-state.sqlite");
    await writeFile(
      absolutePath,
      entryMarkdown("base", "2026-09-21T10:00:00+09:00"),
      "utf8",
    );
    const base = await readVaultFile(root, relativePath);
    await writeFile(
      absolutePath,
      entryMarkdown("external", "2026-09-21T17:00:00+09:00"),
      "utf8",
    );

    let state = new LocalStateDatabase(statePath);
    const conflict = await saveVaultFileWithDraft(
      root,
      {
        entityId,
        path: relativePath,
        content: entryMarkdown("draft", "2026-09-21T10:00:00+09:00"),
        expectedFileHash: base.hash,
        updatedAt: "2026-09-21T18:00:00+09:00",
      },
      state,
    );
    expect(conflict.ok).toBe(false);
    state.close();

    state = new LocalStateDatabase(statePath);
    expect(state.getDraft(entityId)).toMatchObject({
      baseHash: base.hash,
    });
    expect(state.getDraft(entityId)?.content).toContain(
      "updated_at: 2026-09-21T18:00:00+09:00",
    );
    if (conflict.ok) throw new Error("Expected a hash conflict");
    const saved = await saveVaultFileWithDraft(
      root,
      {
        entityId,
        path: relativePath,
        content: entryMarkdown("draft", "2026-09-21T10:00:00+09:00"),
        expectedFileHash: conflict.actual?.hash ?? null,
        updatedAt: "2026-09-21T18:01:00+09:00",
      },
      state,
    );
    expect(saved.ok).toBe(true);
    expect(state.getDraft(entityId)).toBeNull();
    state.close();
  });

  it("refuses to open a newer local-state schema", async () => {
    const root = await createTemporaryVault();
    const statePath = join(root, ".pkm", "local-state.sqlite");
    const state = new LocalStateDatabase(statePath);
    state.database.pragma("user_version = 3");
    state.close();

    expect(() => new LocalStateDatabase(statePath)).toThrow(
      "schema v3 is newer than supported v2",
    );
  });

  it("retains a Syncthing conflict merge draft across reopen", async () => {
    const root = await createTemporaryVault();
    const statePath = join(root, ".pkm", "local-state.sqlite");
    const conflictPath =
      "entries/entity.sync-conflict-20260923-120000-DEVICE.md";
    const canonicalHash = `sha256:${"a".repeat(64)}` as const;
    const conflictHash = `sha256:${"b".repeat(64)}` as const;

    let state = new LocalStateDatabase(statePath);
    state.saveSyncthingConflictDraft({
      conflictPath,
      canonicalHash,
      conflictHash,
      content: "手動マージ途中",
      updatedAt: "2026-09-23T12:00:00.000Z",
    });
    state.close();

    state = new LocalStateDatabase(statePath);
    expect(state.getSyncthingConflictDraft(conflictPath)).toEqual({
      conflictPath,
      canonicalHash,
      conflictHash,
      content: "手動マージ途中",
      updatedAt: "2026-09-23T12:00:00.000Z",
    });
    state.deleteSyncthingConflictDraft(conflictPath);
    expect(state.getSyncthingConflictDraft(conflictPath)).toBeNull();
    state.close();
  });

  it("migrates a v1 database without losing Entity drafts", async () => {
    const root = await createTemporaryVault();
    const statePath = join(root, ".pkm", "local-state.sqlite");
    const entityId = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
    let state = new LocalStateDatabase(statePath);
    state.saveDraft({
      entityId,
      filePath: `entries/${entityId}.md`,
      baseHash: null,
      content: "existing draft",
      updatedAt: "2026-09-23T12:00:00.000Z",
    });
    state.database.exec("DROP TABLE conflict_drafts");
    state.database.pragma("user_version = 1");
    state.close();

    state = new LocalStateDatabase(statePath);
    expect(state.getDraft(entityId)?.content).toBe("existing draft");
    expect(state.database.pragma("user_version", { simple: true })).toBe(2);
    expect(
      state.getSyncthingConflictDraft("entries/not-created.md"),
    ).toBeNull();
    state.close();
  });
});
