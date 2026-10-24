import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { watch } from "chokidar";
import { afterEach, describe, expect, it } from "vitest";
import writeFileAtomic from "write-file-atomic";

const temporaryDirectories: string[] = [];

const waitForChange = (expectedPath: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const watcher = watch(expectedPath, {
      atomic: true,
      ignoreInitial: true,
      interval: 10,
      usePolling: true,
    });
    const timeout = setTimeout(() => {
      void watcher.close().then(() => {
        reject(new Error("Timed out waiting for an external file update"));
      });
    }, 3_000);

    watcher.on("ready", () => {
      void writeFileAtomic(expectedPath, "external version\n", "utf8");
    });
    watcher.on("change", (path) => {
      if (path === expectedPath) {
        clearTimeout(timeout);
        void watcher.close().then(() => resolve());
      }
    });
    watcher.on("error", (error) => {
      clearTimeout(timeout);
      void watcher.close().then(() => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  });

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("external update PoC", () => {
  it("observes an atomic replacement and retains the resulting content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pkms-watch-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "entry.md");
    await writeFile(path, "base version\n", "utf8");

    await waitForChange(path);

    await expect(readFile(path, "utf8")).resolves.toBe("external version\n");
  });
});
