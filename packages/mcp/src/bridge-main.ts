import { readFile } from "node:fs/promises";
import { openStdioBridge } from "./stdio-bridge.js";
let url = process.env.PKM_MCP_URL;
let token = process.env.PKM_MCP_TOKEN;
if (process.env.PKM_MCP_CONNECTION_FILE) {
  const descriptor: unknown = JSON.parse(
    await readFile(process.env.PKM_MCP_CONNECTION_FILE, "utf8"),
  );
  if (
    typeof descriptor !== "object" ||
    descriptor === null ||
    !("url" in descriptor) ||
    !("token" in descriptor) ||
    typeof descriptor.url !== "string" ||
    typeof descriptor.token !== "string"
  )
    throw new Error("Invalid MCP connection file");
  url = descriptor.url;
  token = descriptor.token;
}
if (!url || !token)
  throw new Error(
    "Set PKM_MCP_CONNECTION_FILE or PKM_MCP_URL and PKM_MCP_TOKEN",
  );
const bridge = await openStdioBridge(url, token);
await bridge.connect();
const close = () => {
  void bridge.close().finally(() => process.exit());
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
process.stdin.once("end", close);
