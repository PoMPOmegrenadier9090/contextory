import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { openLocalVault } from "@pkm/storage-node";
import { updateEntityMetadata } from "@pkm/core";
import { afterEach, describe, expect, it } from "vitest";

import { DesktopVaultController } from "./vault-controller.js";
import type { DesktopVaultControllerError } from "./vault-controller.js";
import { FileVaultPreferences } from "./vault-preferences.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../../fixtures/vault-v1/", import.meta.url),
);
const ENTRY_ID = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
const ENTRY_PATH = `entries/${ENTRY_ID}.md`;
const CONFLICT_PATH = `entries/${ENTRY_ID}.sync-conflict-20260922-120000-ABCDEFG.md`;
const temporaryDirectories: string[] = [];
const controllers: DesktopVaultController[] = [];

const createFixtureVault = async (): Promise<string> => {
  const parent = await mkdtemp(join(tmpdir(), "pkms-desktop-controller-"));
  temporaryDirectories.push(parent);
  const vaultRoot = join(parent, "vault");
  await cp(FIXTURE_ROOT, vaultRoot, { recursive: true });
  await rm(join(vaultRoot, ".pkm"), { recursive: true, force: true });
  return vaultRoot;
};

afterEach(async () => {
  await Promise.all(
    controllers.splice(0).map((controller) => controller.close()),
  );
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("DesktopVaultController", () => {
  it("does not notify for unchanged rescans and publishes the IDs of saved Entities", async () => {
    const root = await createFixtureVault();
    const controller = new DesktopVaultController(
      () => Promise.resolve(root),
      openLocalVault,
      { watch: false },
    );
    controllers.push(controller);
    await controller.api.chooseVault();
    const ids: string[][] = [];
    controller.onVaultChanged(({ changes }) =>
      ids.push(changes.entities.map(({ id }) => id)),
    );
    await controller.api.refreshVault();
    expect(ids).toEqual([]);
    const document = await controller.api.loadEntity(ENTRY_ID);
    await controller.api.saveEntity({
      entityId: ENTRY_ID,
      expectedFileHash: document.fileHash,
      content: document.content.replace("# 実装開始", "# Updated"),
    });
    expect(ids).toHaveLength(1);
    expect(ids[0]).toContain(ENTRY_ID);
    expect(
      (await controller.api.listEntities()).every(({ body }) => body === ""),
    ).toBe(true);
    expect((await controller.api.loadEntity(ENTRY_ID)).entity.body).toContain(
      "# Updated",
    );
    await controller.api.refreshVault();
    expect(ids).toHaveLength(1);
  });
  it("initializes a chosen empty folder and restores the last successfully opened Vault", async () => {
    const root = await mkdtemp(join(tmpdir(), "pkms-desktop-new-"));
    temporaryDirectories.push(root);
    const preferences = new FileVaultPreferences(() =>
      join(root, ".pkm", "preferences.json"),
    );
    let selected: string | null = root;
    const controller = new DesktopVaultController(
      () => Promise.resolve(selected),
      openLocalVault,
      { watch: false },
      preferences,
    );
    controllers.push(controller);
    expect(await controller.api.restoreVault()).toBeNull();
    const opened = await controller.api.chooseVault();
    expect(opened).toMatchObject({ vaultRoot: root, accessMode: "read-write" });
    const entry = await controller.api.createEntity({
      type: "entry",
      body: "remembered",
      displayName: null,
    });
    selected = null;
    expect(await controller.api.chooseVault()).toBeNull();
    await controller.close();
    const restarted = new DesktopVaultController(
      () => Promise.resolve(null),
      openLocalVault,
      { watch: false },
      preferences,
    );
    controllers.push(restarted);
    expect(await restarted.api.restoreVault()).toEqual(opened);
    expect((await restarted.api.loadEntity(entry.entity.id)).entity.body).toBe(
      "remembered",
    );
  });
  it("rescans missed changes on wake and reopening a window without opening the Vault twice", async () => {
    const root = await createFixtureVault();
    let opens = 0;
    const controller = new DesktopVaultController(
      () => Promise.resolve(root),
      (path, options) => {
        opens += 1;
        return openLocalVault(path, options);
      },
      { watch: false },
    );
    controllers.push(controller);
    await controller.api.refreshVault();
    const opened = await controller.api.chooseVault();
    const source = await readFile(join(root, ENTRY_PATH), "utf8");
    await writeFile(
      join(root, ENTRY_PATH),
      source.replace("# 実装開始", "# スリープ中の更新"),
    );
    let changes = 0;
    controller.onVaultChanged(() => {
      changes += 1;
    });
    await controller.api.refreshVault();
    expect((await controller.api.loadEntity(ENTRY_ID)).entity.body).toContain(
      "スリープ中の更新",
    );
    await writeFile(
      join(root, ENTRY_PATH),
      source.replace("# 実装開始", "# ウィンドウを閉じた間の更新"),
    );
    expect(await controller.api.restoreVault()).toEqual(opened);
    expect((await controller.api.loadEntity(ENTRY_ID)).entity.body).toContain(
      "ウィンドウを閉じた間の更新",
    );
    expect(opens).toBe(1);
    expect(changes).toBeGreaterThan(0);
  });

  it("does not initialize the remembered folder or replace the saved path on failed selection", async () => {
    const existing = await createFixtureVault();
    const empty = await mkdtemp(join(tmpdir(), "pkms-desktop-restore-empty-"));
    temporaryDirectories.push(empty);
    let remembered: string | null = existing;
    let selected = existing;
    const controller = new DesktopVaultController(
      () => Promise.resolve(selected),
      openLocalVault,
      { watch: false },
      {
        readLastVaultRoot: () => Promise.resolve(remembered),
        saveLastVaultRoot: (root) => {
          remembered = root;
          return Promise.resolve();
        },
      },
    );
    controllers.push(controller);
    await controller.api.restoreVault();
    selected = join(empty, "missing");
    await expect(controller.api.chooseVault()).rejects.toThrow();
    expect(remembered).toBe(existing);
    expect(await controller.api.listEntities()).toHaveLength(6);
    await controller.close();
    remembered = empty;
    await expect(controller.api.restoreVault()).rejects.toThrow(
      "前回のVaultを開けませんでした",
    );
    expect(await readdir(empty)).toEqual([]);
  });
  it("routes Todo listing and safe checks through the shared Vault service", async () => {
    const root = await createFixtureVault();
    const controller = new DesktopVaultController(
      () => Promise.resolve(root),
      (vaultRoot) => openLocalVault(vaultRoot, { watch: false }),
    );
    controllers.push(controller);
    await expect(controller.api.listTodos()).rejects.toMatchObject({
      code: "VAULT_NOT_OPEN",
    });
    await controller.api.chooseVault();
    const created = await controller.api.createEntity({
      type: "entry",
      displayName: null,
      body: "- [ ] desktop todo",
    });
    const todo = (await controller.api.listTodos()).items.find(
      (item) => item.entryId === created.entity.id,
    )!;
    await controller.api.toggleTodo({
      entryId: todo.entryId,
      markerFrom: todo.markerFrom,
      checked: true,
      expectedFileHash: todo.fileHash,
    });
    expect(
      (await controller.api.loadEntity(created.entity.id)).entity.body,
    ).toBe("- [x] desktop todo");
    expect(
      (await controller.api.listTodos({ state: "checked" })).items.some(
        (item) => item.entryId === created.entity.id,
      ),
    ).toBe(true);
  });
  it("exposes Entity operations only after main chooses a Vault directory", async () => {
    const vaultRoot = await createFixtureVault();
    const controller = new DesktopVaultController(
      () => Promise.resolve(vaultRoot),
      (root) => openLocalVault(root, { watch: false }),
    );
    controllers.push(controller);

    await expect(controller.api.listEntities()).rejects.toMatchObject<
      Partial<DesktopVaultControllerError>
    >({ code: "VAULT_NOT_OPEN" });
    expect("openVault" in controller.api).toBe(false);

    await expect(controller.api.chooseVault()).resolves.toEqual({
      vaultRoot,
      vaultId: "01997c2a-7b1c-7a01-8a10-000000000000",
      accessMode: "read-write",
    });
    await expect(controller.api.listEntities()).resolves.toHaveLength(6);
    await expect(
      controller.api.listJournalEntries("2026-09-21"),
    ).resolves.toEqual([
      expect.objectContaining({ id: ENTRY_ID, journalDate: "2026-09-21" }),
    ]);
    await expect(controller.api.listDeletedEntities()).resolves.toEqual([]);
    await expect(
      controller.api.searchEntities("実装開始"),
    ).resolves.toHaveLength(1);
    const created = await controller.api.createEntity({
      type: "topic",
      displayName: "Desktop Topic",
    });
    expect(created.entity).toMatchObject({
      type: "topic",
      displayName: "Desktop Topic",
    });
    const asset = await controller.api.createAsset({
      fileName: "notes.txt",
      dataBase64: Buffer.from("desktop attachment").toString("base64"),
    });
    expect(asset.path).toMatch(/^assets\/files\/[0-9a-f-]+\.txt$/);
    expect((await controller.api.readAsset(asset.path)).data).toEqual(
      Buffer.from("desktop attachment"),
    );
    expect(await controller.api.assetAbsolutePath(asset.path)).toBe(
      join(vaultRoot, asset.path),
    );
  });

  it("exposes logically deleted Entities for the renderer trash view", async () => {
    const vaultRoot = await createFixtureVault();
    const controller = new DesktopVaultController(
      () => Promise.resolve(vaultRoot),
      (root) => openLocalVault(root, { watch: false }),
    );
    controllers.push(controller);
    await controller.api.chooseVault();
    const loaded = await controller.api.loadEntity(ENTRY_ID);
    const deleted = updateEntityMetadata(loaded.content, {
      deletedAt: "2026-09-22T01:23:45.000Z",
    });

    await expect(
      controller.api.saveEntity({
        entityId: ENTRY_ID,
        content: deleted.content,
        expectedFileHash: loaded.fileHash,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(controller.api.listEntities()).resolves.toHaveLength(5);
    await expect(controller.api.listDeletedEntities()).resolves.toEqual([
      expect.objectContaining({
        id: ENTRY_ID,
        deletedAt: "2026-09-22T01:23:45.000Z",
      }),
    ]);

    const tombstone = await controller.api.loadEntity(ENTRY_ID);
    const restored = updateEntityMetadata(tombstone.content, {
      deletedAt: null,
    });
    await expect(
      controller.api.saveEntity({
        entityId: ENTRY_ID,
        content: restored.content,
        expectedFileHash: tombstone.fileHash,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(controller.api.listEntities()).resolves.toHaveLength(6);
    await expect(controller.api.listDeletedEntities()).resolves.toEqual([]);
  });

  it("does not close the current Vault when directory selection is cancelled", async () => {
    const vaultRoot = await createFixtureVault();
    let selected: string | null = vaultRoot;
    const controller = new DesktopVaultController(
      () => Promise.resolve(selected),
      (root) => openLocalVault(root, { watch: false }),
    );
    controllers.push(controller);
    await controller.api.chooseVault();
    selected = null;

    await expect(controller.api.chooseVault()).resolves.toBeNull();
    await expect(controller.api.listEntities()).resolves.toHaveLength(6);
  });

  it("exposes Syncthing conflict inspection and resolution to the renderer", async () => {
    const vaultRoot = await createFixtureVault();
    const canonical = await readFile(join(vaultRoot, ENTRY_PATH), "utf8");
    await writeFile(
      join(vaultRoot, CONFLICT_PATH),
      canonical.replace("# 実装開始", "# Desktop競合版"),
      "utf8",
    );
    const controller = new DesktopVaultController(
      () => Promise.resolve(vaultRoot),
      (root) => openLocalVault(root, { watch: false }),
    );
    controllers.push(controller);
    await controller.api.chooseVault();

    await expect(controller.api.listSyncthingConflicts()).resolves.toHaveLength(
      1,
    );
    const conflict = await controller.api.loadSyncthingConflict(CONFLICT_PATH);
    expect(conflict.conflicting.content).toContain("# Desktop競合版");
    await controller.api.saveSyncthingConflictDraft({
      conflictPath: CONFLICT_PATH,
      canonicalHash: conflict.canonical?.hash ?? null,
      conflictHash: conflict.conflicting.hash,
      content: "Desktop手動マージ途中",
    });
    await expect(
      controller.api.loadSyncthingConflict(CONFLICT_PATH),
    ).resolves.toMatchObject({
      draft: { content: "Desktop手動マージ途中" },
    });
    const resolved = await controller.api.resolveSyncthingConflict({
      conflictPath: CONFLICT_PATH,
      resolution: "keep-conflict",
      expectedCanonicalHash: conflict.canonical?.hash ?? null,
      expectedConflictHash: conflict.conflicting.hash,
    });

    expect(resolved).toMatchObject({ ok: true, resolution: "keep-conflict" });
    await expect(
      readFile(join(vaultRoot, ENTRY_PATH), "utf8"),
    ).resolves.toContain("# Desktop競合版");
  });

  it("publishes watcher rebuilds after the Vault has opened", async () => {
    const vaultRoot = await createFixtureVault();
    const controller = new DesktopVaultController(
      () => Promise.resolve(vaultRoot),
      openLocalVault,
      {
        watcherOptions: {
          debounceMs: 10,
          pollIntervalMs: 10,
          usePolling: true,
        },
      },
    );
    controllers.push(controller);
    const changes: number[] = [];
    controller.onVaultChanged((result) => changes.push(result.changedFiles));
    await controller.api.chooseVault();

    const taskId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    const taskPath = join(vaultRoot, "tasks", `${taskId}.md`);
    const task = await readFile(taskPath, "utf8");
    await writeFile(
      taskPath,
      task.replace("status: not_started", "status: in_progress"),
    );

    await expect
      .poll(() => changes.some((count) => count > 0), { timeout: 3_000 })
      .toBe(true);
  });
});
it("closes the MCP host before closing or switching its owning Vault service", async () => {
  const firstRoot = await createFixtureVault();
  const secondRoot = await createFixtureVault();
  let selected = firstRoot;
  const closed: string[] = [];
  const controller = new DesktopVaultController(
    () => Promise.resolve(selected),
    openLocalVault,
    { watch: false },
    undefined,
    (service, root) =>
      Promise.resolve(() => {
        // The service must still be open when the listener drains its requests.
        expect(service.listEntities()).toHaveLength(6);
        closed.push(root);
        return Promise.resolve();
      }),
  );
  controllers.push(controller);
  await controller.api.chooseVault();
  selected = secondRoot;
  await controller.api.chooseVault();
  expect(closed).toEqual([firstRoot]);
  await controller.api.closeVault();
  expect(closed).toEqual([firstRoot, secondRoot]);
});
