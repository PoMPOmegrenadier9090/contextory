import { describe, expect, it } from "vitest";

import { SyncthingApiError, SyncthingClient } from "./syncthing-client.js";

interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const mockFetch = (
  responses: readonly Response[],
): {
  readonly fetcher: typeof fetch;
  readonly requests: RecordedRequest[];
} => {
  const queue = [...responses];
  const requests: RecordedRequest[] = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    requests.push({ url, init });
    const response = queue.shift();
    if (response === undefined) throw new Error(`Unexpected request: ${url}`);
    return Promise.resolve(response);
  }) as typeof fetch;
  return { fetcher, requests };
};

const folder = {
  id: "pkm-vault-1",
  label: "PKM vault-1",
  path: "/vault",
  type: "sendreceive",
  devices: [{ deviceID: "REMOTE-DEVICE" }],
};

describe("SyncthingClient", () => {
  it("reports system and configured folder health without sending the API key to noauth", async () => {
    const mocked = mockFetch([
      jsonResponse({ status: "OK" }),
      jsonResponse({ myID: "LOCAL-DEVICE", uptime: 42 }),
      jsonResponse(folder),
      jsonResponse({
        state: "idle",
        stateChanged: "2026-09-22T12:00:00Z",
        needBytes: 0,
        needTotalItems: 0,
        pullErrors: 0,
      }),
    ]);
    const client = new SyncthingClient({
      apiKey: "secret-key",
      fetcher: mocked.fetcher,
    });

    await expect(client.getStatus("pkm-vault-1")).resolves.toEqual({
      health: "OK",
      deviceId: "LOCAL-DEVICE",
      uptimeSeconds: 42,
      folder: {
        configured: true,
        id: "pkm-vault-1",
        path: "/vault",
        type: "sendreceive",
        state: "idle",
        stateChanged: "2026-09-22T12:00:00Z",
        needBytes: 0,
        needTotalItems: 0,
        pullErrors: 0,
        devices: ["REMOTE-DEVICE"],
      },
    });
    expect(mocked.requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:8384/rest/noauth/health",
      "http://127.0.0.1:8384/rest/system/status",
      "http://127.0.0.1:8384/rest/config/folders/pkm-vault-1",
      "http://127.0.0.1:8384/rest/db/status?folder=pkm-vault-1",
    ]);
    expect(
      new Headers(mocked.requests[0]?.init?.headers).has("X-API-Key"),
    ).toBe(false);
    expect(
      new Headers(mocked.requests[1]?.init?.headers).get("X-API-Key"),
    ).toBe("secret-key");
  });

  it("reports an unconfigured folder without making an expensive db status call", async () => {
    const mocked = mockFetch([
      jsonResponse({ status: "OK" }),
      jsonResponse({ myID: "LOCAL-DEVICE", uptime: 42 }),
      jsonResponse({ error: "not found" }, 404),
    ]);
    const client = new SyncthingClient({
      apiKey: "secret-key",
      fetcher: mocked.fetcher,
    });

    const status = await client.getStatus("pkm-vault-1");

    expect(status.folder).toMatchObject({
      configured: false,
      state: null,
      devices: [],
    });
    expect(mocked.requests).toHaveLength(3);
  });

  it("bootstraps a send-receive folder from Syncthing defaults", async () => {
    const mocked = mockFetch([
      jsonResponse({ error: "not found" }, 404),
      jsonResponse({
        id: "default",
        label: "Default Folder",
        path: "~/Sync",
        type: "sendreceive",
        devices: [],
        rescanIntervalS: 3600,
      }),
      new Response(null, { status: 200 }),
    ]);
    const client = new SyncthingClient({
      apiKey: "secret-key",
      fetcher: mocked.fetcher,
    });

    await expect(
      client.bootstrapFolder({
        folderId: "pkm-vault-1",
        label: "PKM vault-1",
        path: "/vault",
        deviceIds: ["REMOTE-A", "REMOTE-A", "REMOTE-B"],
      }),
    ).resolves.toEqual({
      created: true,
      folderId: "pkm-vault-1",
      path: "/vault",
      devices: ["REMOTE-A", "REMOTE-B"],
    });
    const createRequest = mocked.requests[2];
    expect(createRequest?.init?.method).toBe("POST");
    const requestBody = createRequest?.init?.body;
    if (typeof requestBody !== "string") {
      throw new Error("Expected a JSON request body");
    }
    expect(JSON.parse(requestBody)).toMatchObject({
      id: "pkm-vault-1",
      label: "PKM vault-1",
      path: "/vault",
      type: "sendreceive",
      rescanIntervalS: 3600,
      devices: [{ deviceID: "REMOTE-A" }, { deviceID: "REMOTE-B" }],
    });
  });

  it("is idempotent for the same folder and refuses a path mismatch", async () => {
    const existing = new SyncthingClient({
      apiKey: "secret-key",
      fetcher: mockFetch([jsonResponse(folder)]).fetcher,
    });
    await expect(
      existing.bootstrapFolder({
        folderId: folder.id,
        label: folder.label,
        path: folder.path,
      }),
    ).resolves.toMatchObject({ created: false, path: "/vault" });

    const mismatched = new SyncthingClient({
      apiKey: "secret-key",
      fetcher: mockFetch([jsonResponse(folder)]).fetcher,
    });
    await expect(
      mismatched.bootstrapFolder({
        folderId: folder.id,
        label: folder.label,
        path: "/different-vault",
      }),
    ).rejects.toThrow("already points to /vault");
  });

  it("requires secure transport and surfaces API errors", async () => {
    expect(
      () =>
        new SyncthingClient({
          apiKey: "secret-key",
          baseUrl: "http://syncthing.example.com:8384",
        }),
    ).toThrow("must use HTTPS unless it is loopback");

    const client = new SyncthingClient({
      apiKey: "secret-key",
      fetcher: mockFetch([jsonResponse({ error: "forbidden" }, 403)]).fetcher,
    });
    await expect(client.getSystemStatus()).rejects.toEqual(
      new SyncthingApiError(403, "forbidden"),
    );

    const unreachable = new SyncthingClient({
      apiKey: "secret-key",
      fetcher: () => Promise.reject(new Error("connection refused")),
    });
    await expect(unreachable.getHealth()).rejects.toEqual(
      new SyncthingApiError(
        0,
        "Cannot reach Syncthing at http://127.0.0.1:8384: connection refused",
      ),
    );
  });
});
