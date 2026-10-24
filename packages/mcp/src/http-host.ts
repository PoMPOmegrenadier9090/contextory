import { createHash, timingSafeEqual } from "node:crypto";
import { createMcpFastifyApp } from "@modelcontextprotocol/fastify";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { LocalVaultService } from "@pkm/storage-node";
import { AgentOperationStore, AgentVaultService } from "@pkm/storage-node";
import { buildMcpServer, entityUrl } from "./tools.js";
import type { AgentPrincipal } from "./tools.js";

export type McpAuthentication =
  | { type: "token"; token: string }
  | { type: "private-tunnel" }
  | {
      type: "oauth";
      issuer: string;
      audience: string;
      jwksUrl: string;
      resourceUrl: string;
    };
export interface McpHostOptions {
  auth: McpAuthentication;
  host?: string;
  port?: number;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  publicWebUrl?: string;
  writes?: boolean;
  operationStorePath?: string;
}
const loopback = (host: string) =>
  ["127.0.0.1", "localhost", "::1"].includes(host);
const hash = (value: string) => createHash("sha256").update(value).digest();
const httpsUrl = (value: string): string => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error("OAuth configuration requires clean HTTPS URLs");
  return url.href;
};
export const openMcpHost = async (
  vault: LocalVaultService,
  options: McpHostOptions,
) => {
  const host = options.host ?? "127.0.0.1";
  if (options.auth.type === "private-tunnel" && !loopback(host))
    throw new Error(
      "Unauthenticated private-tunnel MCP listeners must bind to loopback",
    );
  if (!loopback(host) && !options.allowedHosts?.length)
    throw new Error("Non-loopback MCP listeners require explicit allowedHosts");
  if (options.auth.type === "token" && options.auth.token.length < 32)
    throw new Error("MCP token must have at least 32 characters");
  if (options.auth.type === "private-tunnel" && options.writes)
    throw new Error(
      "Private unauthenticated tunnel ingress supports read operations only; use OAuth for remote writes",
    );
  if (options.writes && !options.operationStorePath)
    throw new Error("MCP writes require a durable operationStorePath");
  if (options.publicWebUrl) entityUrl(options.publicWebUrl, "test");
  const oauth = options.auth.type === "oauth" ? options.auth : undefined;
  const jwks = oauth
    ? createRemoteJWKSet(new URL(httpsUrl(oauth.jwksUrl)), {
        timeoutDuration: 5000,
      })
    : undefined;
  if (oauth) {
    httpsUrl(oauth.issuer);
    httpsUrl(oauth.resourceUrl);
  }
  const store = options.writes
    ? new AgentOperationStore(options.operationStorePath!)
    : undefined;
  const service = new AgentVaultService(vault, store);
  const bodyLimit = options.writes ? 15 * 1024 * 1024 : 1024 * 1024;
  const app = createMcpFastifyApp({
    host,
    allowedHosts: options.allowedHosts ?? ["localhost", "127.0.0.1", "[::1]"],
    allowedOrigins: options.allowedOrigins ?? [],
  });
  app.server.requestTimeout = 120_000;
  const resourceMetadata = oauth
    ? {
        resource: oauth.resourceUrl,
        authorization_servers: [oauth.issuer],
        scopes_supported: [
          "pkm:read",
          ...(options.writes ? ["pkm:write"] : []),
        ],
        bearer_methods_supported: ["header"],
      }
    : undefined;
  if (resourceMetadata)
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ])
      app.get(path, (_request, reply) => reply.send(resourceMetadata));
  const authenticate = async (
    authorization?: string,
  ): Promise<AgentPrincipal | null> => {
    if (options.auth.type === "private-tunnel")
      return { id: "private-tunnel", scopes: ["pkm:read"] };
    const token = authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return null;
    if (options.auth.type === "token")
      return timingSafeEqual(hash(token), hash(options.auth.token))
        ? {
            id: "local-owner",
            scopes: ["pkm:read", ...(options.writes ? ["pkm:write"] : [])],
          }
        : null;
    try {
      const verified = await jwtVerify(token, jwks!, {
        issuer: options.auth.issuer,
        audience: options.auth.audience,
        requiredClaims: ["exp", "sub"],
        algorithms: ["RS256", "ES256", "EdDSA"],
      });
      const scopes =
        typeof verified.payload.scope === "string"
          ? verified.payload.scope.split(" ")
          : [];
      return { id: `${options.auth.issuer}:${verified.payload.sub!}`, scopes };
    } catch {
      return null;
    }
  };
  const rates = new Map<string, { since: number; count: number }>();
  let active = 0;
  app.all("/mcp", { bodyLimit }, async (request, reply) => {
    const principal = await authenticate(request.headers.authorization);
    if (!principal) {
      reply.header(
        "www-authenticate",
        oauth
          ? `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", oauth.resourceUrl).href}"`
          : "Bearer",
      );
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    if (!principal.scopes.includes("pkm:read"))
      return reply.code(403).send({ error: "INSUFFICIENT_SCOPE" });
    const now = Date.now();
    for (const [id, rate] of rates)
      if (now - rate.since >= 60_000) rates.delete(id);
    const rate = rates.get(principal.id) ?? { since: now, count: 0 };
    rates.set(principal.id, rate);
    if (++rate.count > 120 || active >= 8)
      return reply
        .header("retry-after", "60")
        .code(429)
        .send({ error: "RATE_LIMITED" });
    active++;
    const handler = createMcpHandler(
      () =>
        buildMcpServer(service, {
          principal,
          writes: options.writes ?? false,
          oauth: oauth !== undefined,
          ...(options.publicWebUrl
            ? { publicWebUrl: options.publicWebUrl }
            : {}),
        }),
      { legacy: "stateless", maxRequestBodySize: bodyLimit },
    );
    try {
      reply.hijack();
      await toNodeHandler(handler)(
        Object.assign(request.raw, {
          method: request.method,
          url: request.url,
        }),
        reply.raw,
        request.body,
      );
    } finally {
      active--;
      await handler.close();
    }
  });
  app.addHook("onClose", async () => {
    await store?.close();
  });
  try {
    await app.listen({ host, port: options.port ?? 3211 });
  } catch (error) {
    await app.close();
    throw error;
  }
  return {
    app,
    service,
    url: `http://${host === "::1" ? "[::1]" : host}:${app.server.address() && typeof app.server.address() === "object" ? (app.server.address() as { port: number }).port : options.port}/mcp`,
    close: () => app.close(),
  };
};
