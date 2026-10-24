import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, expect, it, vi } from "vitest";
import { openLocalVault } from "@pkm/storage-node";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { openMcpHost } from "./http-host.js";
const dispose: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of dispose.splice(0).reverse()) await close();
  vi.unstubAllGlobals();
});
it("publishes OAuth resource metadata and verifies issuer, audience, expiry, identity and write scopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pkm-oauth-"));
  await cp(
    fileURLToPath(new URL("../../../fixtures/vault-v1/", import.meta.url)),
    root,
    { recursive: true },
  );
  const vault = await openLocalVault(root, { watch: false });
  dispose.push(async () => {
    await vault.close();
    await rm(root, { recursive: true, force: true });
  });
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-key",
    alg: "ES256",
  };
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (
        (typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url) === "https://issuer.example/jwks"
      )
        return Promise.resolve(
          new Response(JSON.stringify({ keys: [jwk] }), {
            headers: { "content-type": "application/json" },
          }),
        );
      return realFetch(input, init);
    },
  );
  const host = await openMcpHost(vault, {
    auth: {
      type: "oauth",
      issuer: "https://issuer.example/",
      audience: "https://mcp.example/mcp",
      resourceUrl: "https://mcp.example/mcp",
      jwksUrl: "https://issuer.example/jwks",
    },
    port: 0,
    writes: true,
    operationStorePath: join(root, ".pkm/agent-state.sqlite"),
  });
  dispose.push(() => host.close());
  const token = (
    scope: string,
    audience = "https://mcp.example/mcp",
    exp = Math.floor(Date.now() / 1000) + 60,
  ) =>
    new SignJWT({ scope })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer("https://issuer.example/")
      .setSubject("user-1")
      .setAudience(audience)
      .setExpirationTime(exp)
      .sign(privateKey);
  const metadata = await host.app.inject({
    url: "/.well-known/oauth-protected-resource/mcp",
  });
  expect(metadata.json()).toMatchObject({
    resource: "https://mcp.example/mcp",
    scopes_supported: ["pkm:read", "pkm:write"],
  });
  const challenge = await host.app.inject({
    method: "POST",
    url: "/mcp",
    payload: {},
  });
  expect(challenge.statusCode).toBe(401);
  expect(challenge.headers["www-authenticate"]).toContain("resource_metadata");
  for (const invalid of [
    await token("pkm:read", "https://wrong.example"),
    await token("pkm:read", undefined, 1),
  ]) {
    expect(
      (
        await host.app.inject({
          method: "POST",
          url: "/mcp",
          headers: { authorization: `Bearer ${invalid}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
  }
  expect(
    (
      await host.app.inject({
        method: "POST",
        url: "/mcp",
        headers: { authorization: `Bearer ${await token("pkm:write")}` },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  const connect = async (scope: string) => {
    const client = new Client({ name: "oauth-test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(host.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${await token(scope)}` },
        },
      }),
    );
    dispose.push(() => client.close());
    return client;
  };
  const reader = await connect("pkm:read");
  const blocked = await reader.callTool({
    name: "create_entry",
    arguments: { operationId: "scope-block" },
  });
  expect(blocked.structuredContent).toEqual({
    error: { code: "INSUFFICIENT_SCOPE" },
  });
  const blockedUpload = await reader.callTool({
    name: "upload_asset",
    arguments: {
      operationId: "scope-asset-block",
      fileName: "notes.txt",
      dataBase64: Buffer.from("blocked").toString("base64"),
    },
  });
  expect(blockedUpload.structuredContent).toEqual({
    error: { code: "INSUFFICIENT_SCOPE" },
  });
  for (const type of ["project", "resource", "topic", "area"]) {
    expect(
      (
        await reader.callTool({
          name: `create_${type}`,
          arguments: {
            operationId: `scope-block-${type}`,
            displayName: "Blocked",
          },
        })
      ).structuredContent,
    ).toEqual({ error: { code: "INSUFFICIENT_SCOPE" } });
  }
  const writer = await connect("pkm:read pkm:write");
  const written = await writer.callTool({
    name: "create_entry",
    arguments: { operationId: "scope-write", body: "OAuth note" },
  });
  expect(written.isError).not.toBe(true);
  expect(written.structuredContent).toHaveProperty("entityId");
});
