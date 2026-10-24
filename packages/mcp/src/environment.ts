import { join } from "node:path";
import type { McpHostOptions, McpAuthentication } from "./http-host.js";
export const mcpOptionsFromEnvironment = (
  env: NodeJS.ProcessEnv,
  stateDirectory: string,
): McpHostOptions | undefined => {
  if (env.PKM_MCP_ENABLED !== "1") return undefined;
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  let auth: McpAuthentication;
  switch (env.PKM_MCP_AUTH ?? "token") {
    case "token":
      auth = {
        type: "token",
        token:
          env.PKM_MCP_TOKEN ||
          env.MCP_BEARER_TOKEN ||
          required("PKM_MCP_TOKEN"),
      };
      break;
    case "private-tunnel":
      auth = { type: "private-tunnel" };
      break;
    case "oauth":
      auth = {
        type: "oauth",
        issuer: required("PKM_MCP_OAUTH_ISSUER"),
        audience: required("PKM_MCP_OAUTH_AUDIENCE"),
        jwksUrl: required("PKM_MCP_OAUTH_JWKS_URL"),
        resourceUrl: required("PKM_MCP_RESOURCE_URL"),
      };
      break;
    default:
      throw new Error("PKM_MCP_AUTH must be token, private-tunnel or oauth");
  }
  const port = Number(env.PKM_MCP_PORT ?? "3211");
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PKM_MCP_PORT must be 0–65535");
  return {
    auth,
    host: env.PKM_MCP_HOST ?? "127.0.0.1",
    port,
    writes: env.PKM_MCP_WRITES === "1",
    operationStorePath: join(stateDirectory, "agent-state.sqlite"),
    ...(env.PKM_MCP_PUBLIC_WEB_URL
      ? { publicWebUrl: env.PKM_MCP_PUBLIC_WEB_URL }
      : {}),
    ...(env.PKM_MCP_ALLOWED_HOSTS
      ? {
          allowedHosts: env.PKM_MCP_ALLOWED_HOSTS.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
    ...(env.PKM_MCP_ALLOWED_ORIGINS
      ? {
          allowedOrigins: env.PKM_MCP_ALLOWED_ORIGINS.split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }
      : {}),
  };
};
