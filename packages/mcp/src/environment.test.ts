import { expect, it } from "vitest";
import { mcpOptionsFromEnvironment } from "./environment.js";
it("accepts the existing tunnel bearer name while preferring the PKM token", () => {
  const env = { PKM_MCP_ENABLED: "1", MCP_BEARER_TOKEN: "legacy-token" };
  expect(mcpOptionsFromEnvironment(env, "/state")?.auth).toEqual({
    type: "token",
    token: "legacy-token",
  });
  expect(
    mcpOptionsFromEnvironment(
      { ...env, PKM_MCP_TOKEN: "canonical-token" },
      "/state",
    )?.auth,
  ).toEqual({ type: "token", token: "canonical-token" });
});
it("normalizes host configuration for container ingress without allowing an empty host list", () => {
  const options = mcpOptionsFromEnvironment(
    {
      PKM_MCP_ENABLED: "1",
      PKM_MCP_TOKEN: "a".repeat(64),
      PKM_MCP_HOST: "0.0.0.0",
      PKM_MCP_ALLOWED_HOSTS: "127.0.0.1, localhost,",
      PKM_MCP_ALLOWED_ORIGINS: " , ",
    },
    "/state",
  );
  expect(options?.host).toBe("0.0.0.0");
  expect(options?.allowedHosts).toEqual(["127.0.0.1", "localhost"]);
  expect(options?.allowedOrigins).toEqual([]);
});
