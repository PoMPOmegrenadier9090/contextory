import { cp, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, expect, it } from "vitest";
import { openLocalVault } from "@pkm/storage-node";
import { openMcpHost } from "./http-host.js";
import { openStdioBridge } from "./stdio-bridge.js";
import { openDesktopMcpHost } from "./desktop-host.js";
const ENTRY = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
const TOKEN = "a".repeat(64);
const cleanup: (() => Promise<void>)[] = [];
const fixture = async (citations = true, writes = true) => {
  const root = await mkdtemp(join(tmpdir(), "pkm-mcp-"));
  await cp(
    fileURLToPath(new URL("../../../fixtures/vault-v1/", import.meta.url)),
    root,
    { recursive: true },
  );
  const vault = await openLocalVault(root, { watch: false });
  const host = await openMcpHost(vault, {
    auth: { type: "token", token: TOKEN },
    port: 0,
    writes,
    operationStorePath: join(root, ".pkm/agent-state.sqlite"),
    ...(citations ? { publicWebUrl: "https://pkm.example.com/" } : {}),
  });
  cleanup.push(async () => {
    await host.close();
    await vault.close();
    await rm(root, { recursive: true, force: true });
  });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(host.url), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
  cleanup.push(() => client.close());
  return { root, vault, host, client };
};
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
it("connects with the official SDK and returns citation-compatible search/fetch payloads", async () => {
  const { client } = await fixture();
  const tools = await client.listTools();
  expect(tools.tools.map((t) => t.name)).toContain("fetch");
  expect(tools.tools.map((t) => t.name)).not.toContain("propose_update");
  const found = await client.callTool({
    name: "search",
    arguments: { query: "実装開始" },
  });
  expect(found.structuredContent).toEqual({
    results: [
      {
        id: ENTRY,
        title: "実装開始",
        url: `https://pkm.example.com/?entity=${ENTRY}`,
      },
    ],
  });
  expect(found.content).toEqual([
    { type: "text", text: JSON.stringify(found.structuredContent) },
  ]);
  const fetched = await client.callTool({
    name: "fetch",
    arguments: { id: ENTRY },
  });
  expect(JSON.stringify(fetched.structuredContent)).toContain("# 実装開始");
  expect(JSON.stringify(fetched.structuredContent)).not.toMatch(
    /exclude_from_ai|entries\/|draft/,
  );
  expect(fetched.content).toEqual([
    { type: "text", text: JSON.stringify(fetched.structuredContent) },
  ]);
});
it("calls direct tools with hash checking and idempotency through HTTP", async () => {
  const { client, vault } = await fixture();
  const snapshot = await vault.loadEntity(ENTRY);
  const input = {
    name: "update_entry",
    arguments: {
      operationId: "http-update",
      entityId: ENTRY,
      expectedFileHash: snapshot.fileHash,
      patch: { body: "HTTP changed" },
    },
  };
  const first = await client.callTool(input);
  expect(first.isError).not.toBe(true);
  const second = await client.callTool(input);
  expect(second.structuredContent).toMatchObject({ replayed: true });
  expect((await vault.loadEntity(ENTRY)).content).toContain("HTTP changed");
  const stale = await client.callTool({
    ...input,
    arguments: { ...input.arguments, operationId: "http-stale" },
  });
  expect(stale.structuredContent).toEqual({ error: { code: "HASH_CONFLICT" } });
});
it.each(["project", "resource", "topic", "area"] as const)(
  "discovers, creates and updates %s through the official MCP client",
  async (type) => {
    const { client, vault } = await fixture();
    const tools = (await client.listTools()).tools;
    for (const name of [`create_${type}`, `update_${type}`]) {
      expect(tools.find((tool) => tool.name === name)).toMatchObject({
        annotations: { readOnlyHint: false, idempotentHint: true },
      });
    }
    const capabilities = await client.callTool({
      name: "get_capabilities",
      arguments: {},
    });
    expect(capabilities.structuredContent).toMatchObject({
      directWrites: true,
    });
    expect(capabilities.structuredContent).toHaveProperty(
      "writes",
      expect.arrayContaining([`create_${type}`, `update_${type}`]),
    );
    const created = await client.callTool({
      name: `create_${type}`,
      arguments: {
        operationId: `http-create-${type}`,
        displayName: `New ${type}`,
        description: "Initial",
        ...(type === "resource"
          ? { authors: ["Author"], sourceUri: "https://example.com/" }
          : {}),
      },
    });
    expect(created.isError).not.toBe(true);
    const { entityId } = created.structuredContent as { entityId: string };
    const snapshot = await client.callTool({
      name: "get_entity",
      arguments: { id: entityId },
    });
    expect(snapshot.structuredContent).toMatchObject({
      type,
      title: `New ${type}`,
      body: "",
      metadata: { description: "Initial" },
    });
    const input = {
      name: `update_${type}`,
      arguments: {
        operationId: `http-update-${type}`,
        entityId,
        expectedFileHash: (snapshot.structuredContent as { fileHash: string })
          .fileHash,
        patch: { displayName: `Updated ${type}`, description: null },
      },
    };
    expect((await client.callTool(input)).isError).not.toBe(true);
    expect((await client.callTool(input)).structuredContent).toMatchObject({
      replayed: true,
    });
    expect(
      (
        await client.callTool({
          name: "get_entity",
          arguments: { id: entityId },
        })
      ).structuredContent,
    ).toMatchObject({
      title: `Updated ${type}`,
      metadata: { description: null },
    });
    expect(
      (
        await client.callTool({
          ...input,
          arguments: { ...input.arguments, operationId: `http-stale-${type}` },
        })
      ).structuredContent,
    ).toEqual({ error: { code: "HASH_CONFLICT" } });
    expect(vault.listEntities()).toHaveLength(7);
  },
);
it("requires auth, rejects hostile Host/Origin, and exposes only MCP routes", async () => {
  const { host } = await fixture();
  expect(
    (await host.app.inject({ method: "POST", url: "/mcp", payload: {} }))
      .statusCode,
  ).toBe(401);
  expect(
    (
      await host.app.inject({
        method: "POST",
        url: "/mcp",
        headers: { host: "evil.example", authorization: `Bearer ${TOKEN}` },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await host.app.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          origin: "https://evil.example",
          authorization: `Bearer ${TOKEN}`,
        },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await host.app.inject({
        url: "/api/entities",
        headers: { authorization: `Bearer ${TOKEN}` },
      })
    ).statusCode,
  ).toBe(404);
});
it("omits citation tools until a public Web URL exists and omits writes when disabled", async () => {
  const { client } = await fixture(false, false);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  expect(tools).toContain("get_entity");
  expect(tools).not.toContain("search");
  expect(tools).not.toContain("fetch");
  expect(tools).not.toContain("create_entry");
  expect(tools).not.toContain("upload_asset");
  for (const type of ["project", "resource", "topic", "area"]) {
    expect(tools).not.toContain(`create_${type}`);
    expect(tools).not.toContain(`update_${type}`);
  }
});
it("requires a matching fileHash for later body pages and fails full fetch rather than silently truncating", async () => {
  const { client, root, vault } = await fixture();
  const original = await vault.loadEntity(ENTRY);
  await writeFile(
    join(root, original.entity.path),
    original.content + "大".repeat(90_000),
  );
  const fetched = await client.callTool({
    name: "fetch",
    arguments: { id: ENTRY },
  });
  expect(fetched.structuredContent).toEqual({
    error: { code: "DOCUMENT_TOO_LARGE" },
  });
  const paged = await client.callTool({
    name: "get_entity",
    arguments: { id: ENTRY },
  });
  expect(paged.structuredContent).toMatchObject({ nextBodyOffset: 8000 });
  const invalid = await client.callTool({
    name: "get_entity",
    arguments: { id: ENTRY, bodyOffset: 8000 },
  });
  expect(invalid.structuredContent).toEqual({
    error: { code: "HASH_CONFLICT" },
  });
});
it("bridges the owner's tool schemas without opening a second Vault", async () => {
  const { host } = await fixture();
  const bridge = await openStdioBridge(host.url, TOKEN);
  try {
    const { InMemoryTransport, Client: MemoryClient } =
      await import("@modelcontextprotocol/client");
    const [remote, local] = InMemoryTransport.createLinkedPair();
    await bridge.server.connect(local);
    const client = new MemoryClient({ name: "stdio-test", version: "1" });
    await client.connect(remote);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain(
      "update_entry",
    );
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "create_project",
        "update_resource",
        "create_topic",
        "update_area",
      ]),
    );
    const output = await client.callTool({
      name: "get_entity",
      arguments: { id: ENTRY },
    });
    expect(output.structuredContent).toMatchObject({ id: ENTRY });
    await client.close();
  } finally {
    await bridge.close();
  }
});
it("rejects unprotected network binds and unsafe remote-write configurations", async () => {
  const { vault } = await fixture();
  await expect(
    openMcpHost(vault, {
      auth: { type: "token", token: TOKEN },
      host: "0.0.0.0",
    }),
  ).rejects.toThrow("allowedHosts");
  await expect(
    openMcpHost(vault, {
      auth: { type: "private-tunnel" },
      host: "0.0.0.0",
      allowedHosts: ["127.0.0.1"],
    }),
  ).rejects.toThrow("loopback");
  await expect(
    openMcpHost(vault, { auth: { type: "private-tunnel" }, writes: true }),
  ).rejects.toThrow("read operations only");
  await expect(
    openMcpHost(vault, { auth: { type: "token", token: TOKEN }, writes: true }),
  ).rejects.toThrow("durable");
});
it("rotates Desktop credentials and lets an older host close without deleting the new descriptor", async () => {
  const { root, vault } = await fixture();
  const path = join(root, "descriptor.json");
  const first = await openDesktopMcpHost(vault, root, path);
  const old = await readFile(path, "utf8");
  const second = await openDesktopMcpHost(vault, root, path);
  try {
    expect(await readFile(path, "utf8")).not.toBe(old);
    await first();
    expect(await readFile(path, "utf8")).not.toBe(old);
  } finally {
    await second();
  }
  await expect(readFile(path, "utf8")).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("serves a real stdio child process while keeping writes in the HTTP owner", async () => {
  const { host, vault } = await fixture();
  const { StdioClientTransport } =
    await import("@modelcontextprotocol/client/stdio");
  const client = new Client({ name: "stdio-process-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/bridge-main.js", import.meta.url))],
    env: { PKM_MCP_URL: host.url, PKM_MCP_TOKEN: TOKEN },
    stderr: "pipe",
  });
  await client.connect(transport);
  cleanup.push(() => client.close());
  const output = await client.callTool({
    name: "create_entry",
    arguments: { operationId: "stdio-real-write", body: "from stdio" },
  });
  expect(output.isError).not.toBe(true);
  expect(
    vault.listEntities().some((entity) => entity.body === "from stdio"),
  ).toBe(true);
});
it("preserves the local owner identity and operation replay when credentials rotate", async () => {
  const { host, client, root, vault } = await fixture();
  const command = {
    name: "create_entry",
    arguments: { operationId: "rotated-retry", body: "created once" },
  };
  const first = await client.callTool(command);
  await client.close();
  await host.close();
  const token = "b".repeat(64);
  const next = await openMcpHost(vault, {
    auth: { type: "token", token },
    port: 0,
    writes: true,
    operationStorePath: join(root, ".pkm/agent-state.sqlite"),
  });
  cleanup.push(() => next.close());
  const reconnected = new Client({ name: "reconnect", version: "1" });
  await reconnected.connect(
    new StreamableHTTPClientTransport(new URL(next.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  cleanup.push(() => reconnected.close());
  const replay = await reconnected.callTool(command);
  expect(replay.structuredContent).toMatchObject({
    ...(first.structuredContent as Record<string, unknown>),
    replayed: true,
  });
  expect(vault.listEntities()).toHaveLength(7);
});
it("accepts an authenticated tunnel over a wildcard container listener with explicit Host checks", async () => {
  const { vault, root } = await fixture();
  const host = await openMcpHost(vault, {
    auth: { type: "token", token: TOKEN },
    host: "0.0.0.0",
    port: 0,
    allowedHosts: ["127.0.0.1", "localhost"],
    writes: true,
    operationStorePath: join(root, ".pkm/agent-state.sqlite"),
  });
  cleanup.push(() => host.close());
  const endpoint = new URL(host.url);
  endpoint.hostname = "127.0.0.1";
  const client = new Client({ name: "tunnel-forwarder", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    }),
  );
  cleanup.push(() => client.close());
  expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
    "create_entry",
  );
  const created = await client.callTool({
    name: "create_entry",
    arguments: { operationId: "tunnel-direct-write", body: "via host tunnel" },
  });
  expect(created.isError).not.toBe(true);
  expect(
    vault.listEntities().some((entity) => entity.body === "via host tunnel"),
  ).toBe(true);
  for (const authorization of [undefined, "Bearer incorrect-token"]) {
    const response = await host.app.inject({
      method: "POST",
      url: "/mcp",
      payload: {},
      ...(authorization ? { headers: { authorization } } : {}),
    });
    expect(response.statusCode).toBe(401);
  }
  for (const headers of [
    { host: "evil.example" },
    { origin: "https://evil.example" },
  ]) {
    expect(
      (
        await host.app.inject({
          method: "POST",
          url: "/mcp",
          payload: {},
          headers: { ...headers, authorization: `Bearer ${TOKEN}` },
        })
      ).statusCode,
    ).toBe(403);
  }
  expect(
    (
      await host.app.inject({
        url: "/api/entities",
        headers: { authorization: `Bearer ${TOKEN}` },
      })
    ).statusCode,
  ).toBe(404);
});

it("uploads a 10 MiB asset over MCP, replays it and attaches the returned Markdown", async () => {
  const { client, vault } = await fixture();
  const tools = (await client.listTools()).tools;
  expect(tools.find((tool) => tool.name === "upload_asset")).toMatchObject({
    annotations: { readOnlyHint: false, idempotentHint: true },
  });
  const bytes = Buffer.alloc(10 * 1024 * 1024, 42);
  const input = {
    name: "upload_asset",
    arguments: {
      operationId: "http-asset-upload",
      fileName: "資料[1].pdf",
      dataBase64: bytes.toString("base64"),
    },
  };
  const uploaded = await client.callTool(input);
  expect(uploaded.isError).not.toBe(true);
  const asset = uploaded.structuredContent as {
    path: string;
    markdown: string;
  };
  expect(asset.markdown).toBe(`[資料\\[1\\].pdf](../${asset.path})`);
  expect((await vault.readAsset(asset.path)).data.equals(bytes)).toBe(true);
  const replay = await client.callTool(input);
  expect(replay.structuredContent).toMatchObject({
    path: asset.path,
    replayed: true,
  });
  const entry = await client.callTool({
    name: "create_entry",
    arguments: {
      operationId: "http-entry-with-asset",
      body: asset.markdown,
    },
  });
  const { entityId } = entry.structuredContent as { entityId: string };
  expect((await vault.loadEntity(entityId)).entity.body).toBe(asset.markdown);
  const caps = await client.callTool({
    name: "get_capabilities",
    arguments: {},
  });
  expect(caps.structuredContent).toMatchObject({
    limits: { assetBytes: bytes.length },
  });
  expect((caps.structuredContent as { writes: string[] }).writes).toContain(
    "upload_asset",
  );
});

it.each([
  { fileName: "empty.txt", dataBase64: "" },
  { fileName: "bad.txt", dataBase64: "invalid!" },
  {
    fileName: "huge.txt",
    dataBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
  },
])("rejects invalid MCP uploads: $fileName", async (file) => {
  const { client } = await fixture();
  const response = await client.callTool({
    name: "upload_asset",
    arguments: {
      operationId: "http-invalid-upload",
      ...file,
    },
  });
  expect(response.isError).toBe(true);
});
