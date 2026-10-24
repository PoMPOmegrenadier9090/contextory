import { homedir } from "node:os";
import { mcpOptionsFromEnvironment } from "@pkm/mcp";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openServerApp } from "./http-api.js";

const vaultRoot = process.env.PKM_VAULT_ROOT;
if (vaultRoot === undefined || vaultRoot.length === 0) {
  throw new Error("PKM_VAULT_ROOT must point to the server Vault directory");
}

const host = process.env.PKM_SERVER_HOST ?? "127.0.0.1";
const portValue = Number(process.env.PKM_SERVER_PORT ?? "3210");
if (!Number.isSafeInteger(portValue) || portValue < 1 || portValue > 65_535) {
  throw new Error("PKM_SERVER_PORT must be an integer between 1 and 65535");
}

const webRoot = fileURLToPath(new URL("../../web/dist-web/", import.meta.url));
const mcp = mcpOptionsFromEnvironment(
  process.env,
  process.env.PKM_SERVER_DATA_DIR ?? resolve(homedir(), ".local/share/pkm"),
);
const app = await openServerApp(resolve(vaultRoot), {
  logger: true,
  webRoot,
  ...(mcp ? { mcp } : {}),
});
await app.listen({ host, port: portValue });

const close = (): void => {
  void app.close().finally(() => process.exit());
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
