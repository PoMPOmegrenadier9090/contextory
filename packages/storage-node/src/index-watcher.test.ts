import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { openVaultIndex } from "./index-database.js";
import { getIndexedEntity } from "./index-query.js";
import { startVaultIndexWatcher } from "./index-watcher.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../../fixtures/vault-v1/", import.meta.url),
);
const temporaryDirectories: string[] = [];

const createFixtureVault = async (): Promise<string> => {
  const parent = await mkdtemp(join(tmpdir(), "pkms-watcher-"));
  temporaryDirectories.push(parent);
  const vaultRoot = join(parent, "vault");
  await cp(FIXTURE_ROOT, vaultRoot, { recursive: true });
  await rm(join(vaultRoot, ".pkm"), { recursive: true, force: true });
  return vaultRoot;
};

const waitFor = async (condition: () => boolean): Promise<void> => {
  const timeoutAt = Date.now() + 3_000;
  while (!condition()) {
    if (Date.now() >= timeoutAt) {
      throw new Error("Timed out waiting for the index to converge");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("VaultIndexWatcher", () => {
  it("converges the index after an external atomic-style replacement", async () => {
    const vaultRoot = await createFixtureVault();
    const index = openVaultIndex(vaultRoot);
    const watcher = await startVaultIndexWatcher(vaultRoot, index, {
      debounceMs: 10,
      pollIntervalMs: 10,
      usePolling: true,
    });
    const taskId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    const taskPath = join(vaultRoot, "tasks", `${taskId}.md`);
    const task = await readFile(taskPath, "utf8");

    await writeFile(
      taskPath,
      task.replace(
        "title: Markdown parserを実装する",
        "title: Index watcherを実装する",
      ),
      "utf8",
    );
    await waitFor(
      () =>
        getIndexedEntity(index, taskId)?.displayName ===
        "Index watcherを実装する",
    );

    expect(getIndexedEntity(index, taskId)?.displayName).toBe(
      "Index watcherを実装する",
    );
    await watcher.close();
    index.close();
  });

  it("manual rescan recovers changes even when no event is relied upon", async () => {
    const vaultRoot = await createFixtureVault();
    const index = openVaultIndex(vaultRoot);
    const watcher = await startVaultIndexWatcher(vaultRoot, index, {
      debounceMs: 1_000,
      usePolling: true,
    });
    const topicId = "topic_01997c2a-7b1c-7a01-8a10-000000000002";
    const topicPath = join(vaultRoot, "topics", `${topicId}.md`);
    const topic = await readFile(topicPath, "utf8");
    await writeFile(
      topicPath,
      topic.replace("name: Personal Knowledge Management", "name: PKM"),
      "utf8",
    );

    await watcher.rescan();

    expect(getIndexedEntity(index, topicId)?.displayName).toBe("PKM");
    await watcher.close();
    index.close();
  });
});
