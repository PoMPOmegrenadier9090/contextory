import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSyncthingIgnore } from "@pkm/storage-node";
import {
  parseDesktopSyncConnection,
  parseDesktopSyncSetup,
  setupDesktopSync,
} from "./desktop-sync.js";

const DEVICE_ID =
  "AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA-AAAAAAA";
const connection = {
  baseUrl: "http://127.0.0.1:8384",
  apiKey: "secret-key",
  deviceIds: [DEVICE_ID],
};
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const createRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "pkms-desktop-sync-"));
  roots.push(root);
  return root;
};
const mockSyncthing = (responses: unknown[]) => {
  const fetcher = vi.fn(() => {
    if (responses.length === 0) throw new Error("Unexpected Syncthing request");
    const body = responses.shift();
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: body === null ? 404 : 200 }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
describe("Desktop Syncthing setup", () => {
  it("accepts only local endpoints and valid remote Device IDs", () => {
    expect(parseDesktopSyncConnection(connection)).toEqual({
      baseUrl: connection.baseUrl,
      apiKey: connection.apiKey,
    });
    expect(
      parseDesktopSyncConnection({
        ...connection,
        baseUrl: "http://[::1]:8384",
      }).baseUrl,
    ).toBe("http://[::1]:8384");
    for (const baseUrl of [
      "https://server.example.com",
      "file:///vault",
      "http://user:pass@localhost:8384",
      "http://localhost:8384/prefix",
    ]) {
      expect(() =>
        parseDesktopSyncConnection({ ...connection, baseUrl }),
      ).toThrow();
    }
    expect(() =>
      parseDesktopSyncSetup({ ...connection, deviceIds: [] }),
    ).toThrow();
    expect(() =>
      parseDesktopSyncSetup({ ...connection, deviceIds: ["not-a-device"] }),
    ).toThrow();
    expect(() =>
      parseDesktopSyncSetup({ ...connection, apiKey: " " }),
    ).toThrow();
  });
  it("creates the ignore boundary before registering the selected Vault with its exact path", async () => {
    const root = await createRoot();
    const fetcher = mockSyncthing([
      { myID: "LOCAL-DEVICE", uptime: 1 },
      null,
      { devices: [] },
      {},
    ]);
    const result = await setupDesktopSync(root, "vault-id", connection);
    expect(result).toMatchObject({
      created: true,
      path: root,
      folderId: "pkm-vault-id",
      devices: [DEVICE_ID],
    });
    expect((await checkSyncthingIgnore(root)).ok).toBe(true);
    const request = fetcher.mock.calls[3] as unknown as [URL, RequestInit];
    expect(JSON.parse(request[1].body as string)).toMatchObject({
      id: "pkm-vault-id",
      path: root,
      type: "sendreceive",
      devices: [{ deviceID: DEVICE_ID }],
    });
    expect(await readFile(join(root, ".stignore"), "utf8")).not.toContain(
      "secret-key",
    );
  });
  it("preserves custom ignore rules and does not register the folder if the boundary is invalid", async () => {
    const root = await createRoot();
    await writeFile(join(root, ".stignore"), "/entries\n");
    const fetcher = mockSyncthing([{ myID: "LOCAL-DEVICE", uptime: 1 }]);
    await expect(
      setupDesktopSync(root, "vault-id", connection),
    ).rejects.toThrow(".stignore");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readFile(join(root, ".stignore"), "utf8")).toBe("/entries\n");
  });
  it("rejects the local Device ID without creating the boundary or folder", async () => {
    const root = await createRoot();
    const fetcher = mockSyncthing([{ myID: DEVICE_ID, uptime: 1 }]);
    await expect(
      setupDesktopSync(root, "vault-id", connection),
    ).rejects.toThrow("別の端末");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      readFile(join(root, ".stignore"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
