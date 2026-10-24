import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readVaultFile, resolveVaultPath } from "./vault-file.js";
import { scanVault } from "./vault-scan.js";
import {
  saveVaultFileWithDraft,
  writeVaultFile,
  type DraftStore,
} from "./vault-store.js";

const temporaryDirectories: string[] = [];

const createTemporaryVault = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "pkms-vault-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("scanVault", () => {
  it("classifies canonical entities and Syncthing conflict copies separately", async () => {
    const root = await createTemporaryVault();
    await mkdir(join(root, "entries"), { recursive: true });
    await mkdir(join(root, ".pkm"), { recursive: true });
    await writeFile(join(root, "vault.yaml"), "schema_version: 1\n", "utf8");
    await writeFile(
      join(root, "entries", "ent_example.md"),
      "canonical\n",
      "utf8",
    );
    await writeFile(
      join(
        root,
        "entries",
        "ent_example.sync-conflict-20260921-120000-ABCDEFG.md",
      ),
      "conflict\n",
      "utf8",
    );
    await writeFile(join(root, ".pkm", "index.sqlite"), "ignored", "utf8");
    await writeFile(join(root, ".stignore"), "/.pkm\n", "utf8");
    await writeFile(join(root, ".DS_Store"), "ignored", "utf8");

    const result = await scanVault(root);

    expect(result.files.map(({ path, kind }) => ({ path, kind }))).toEqual([
      { path: "entries/ent_example.md", kind: "entity" },
      {
        path: "entries/ent_example.sync-conflict-20260921-120000-ABCDEFG.md",
        kind: "conflict",
      },
      { path: "vault.yaml", kind: "vault-config" },
    ]);
    expect(result.files[1]).toMatchObject({
      canonicalEntityPath: "entries/ent_example.md",
    });
  });
});

describe("writeVaultFile", () => {
  it("writes atomically when the expected hash still matches", async () => {
    const root = await createTemporaryVault();
    await mkdir(join(root, "entries"), { recursive: true });
    await writeFile(join(root, "entries", "entry.md"), "base\n", "utf8");
    const base = await readVaultFile(root, "entries/entry.md");

    const result = await writeVaultFile(root, {
      path: "entries/entry.md",
      content: "saved\n",
      expectedFileHash: base.hash,
    });

    expect(result.ok).toBe(true);
    await expect(
      readFile(join(root, "entries", "entry.md"), "utf8"),
    ).resolves.toBe("saved\n");
  });

  it("creates a new file when the expected hash is null", async () => {
    const root = await createTemporaryVault();

    const result = await writeVaultFile(root, {
      path: "entries/new-entry.md",
      content: "new\n",
      expectedFileHash: null,
    });

    expect(result).toMatchObject({ ok: true, snapshot: { content: "new\n" } });
  });

  it("retains both the external version and draft on a hash conflict", async () => {
    const root = await createTemporaryVault();
    await mkdir(join(root, "entries"), { recursive: true });
    const absolutePath = join(root, "entries", "entry.md");
    await writeFile(absolutePath, "base\n", "utf8");
    const base = await readVaultFile(root, "entries/entry.md");
    await writeFile(absolutePath, "external\n", "utf8");

    const result = await writeVaultFile(root, {
      path: "entries/entry.md",
      content: "draft\n",
      expectedFileHash: base.hash,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "hash-conflict",
      draftContent: "draft\n",
      actual: { content: "external\n" },
    });
    await expect(readFile(absolutePath, "utf8")).resolves.toBe("external\n");
  });

  it("rejects paths outside the vault", async () => {
    const root = await createTemporaryVault();

    expect(() => resolveVaultPath(root, "../outside.md")).toThrow(
      "Path escapes the vault root",
    );
  });

  it("rejects writes through a symbolic link inside the vault", async () => {
    const root = await createTemporaryVault();
    const outside = await createTemporaryVault();
    await symlink(outside, join(root, "entries"), "dir");

    await expect(
      writeVaultFile(root, {
        path: "entries/escaped.md",
        content: "must not escape\n",
        expectedFileHash: null,
      }),
    ).rejects.toThrow("contains a symbolic link");
    await expect(
      readFile(join(outside, "escaped.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("saveVaultFileWithDraft", () => {
  it("updates updated_at in both the draft and saved Markdown", async () => {
    const root = await createTemporaryVault();
    const path = "entries/ent_01997c2a-7b1c-7a01-8a10-000000000006.md";
    await mkdir(join(root, "entries"), { recursive: true });
    const original = `---
id: ent_01997c2a-7b1c-7a01-8a10-000000000006
type: entry
origin: human
exclude_from_ai: false
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
---
# 保存テスト
`;
    await writeFile(join(root, path), original, "utf8");
    const base = await readVaultFile(root, path);
    let draftContent = "";
    let deletedDraft = false;
    const drafts: DraftStore = {
      saveDraft: (draft) => {
        draftContent = draft.content;
      },
      deleteDraft: () => {
        deletedDraft = true;
      },
    };

    const result = await saveVaultFileWithDraft(
      root,
      {
        path,
        entityId: "ent_01997c2a-7b1c-7a01-8a10-000000000006",
        content: original.replace("# 保存テスト", "# 更新後"),
        expectedFileHash: base.hash,
        updatedAt: "2026-09-21T20:30:00+09:00",
      },
      drafts,
    );

    expect(result.ok).toBe(true);
    expect(draftContent).toContain("updated_at: 2026-09-21T20:30:00+09:00");
    await expect(readFile(join(root, path), "utf8")).resolves.toContain(
      "updated_at: 2026-09-21T20:30:00+09:00",
    );
    expect(deletedDraft).toBe(true);
  });

  it("rejects Markdown whose Entity ID differs from the save request", async () => {
    const root = await createTemporaryVault();
    const path = "entries/ent_01997c2a-7b1c-7a01-8a10-000000000006.md";
    await mkdir(join(root, "entries"), { recursive: true });
    const original = `---
id: ent_01997c2a-7b1c-7a01-8a10-000000000006
type: entry
origin: human
exclude_from_ai: false
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
---
# Identity test
`;
    await writeFile(join(root, path), original, "utf8");
    const base = await readVaultFile(root, path);
    let savedDraft = false;
    const drafts: DraftStore = {
      saveDraft: () => {
        savedDraft = true;
      },
      deleteDraft: () => undefined,
    };

    await expect(
      saveVaultFileWithDraft(
        root,
        {
          path,
          entityId: "ent_01997c2a-7b1c-7a01-8a10-000000000099",
          content: original,
          expectedFileHash: base.hash,
          updatedAt: "2026-09-21T21:00:00+09:00",
        },
        drafts,
      ),
    ).rejects.toThrow("as requested Entity");
    expect(savedDraft).toBe(false);
    await expect(readFile(join(root, path), "utf8")).resolves.toBe(original);
  });
});
