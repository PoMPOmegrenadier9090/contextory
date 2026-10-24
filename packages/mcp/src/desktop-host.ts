import { randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import writeFileAtomic from "write-file-atomic";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { LocalVaultService } from "@pkm/storage-node";
import { openMcpHost } from "./http-host.js";
export const openDesktopMcpHost = async (
  service: LocalVaultService,
  vaultRoot: string,
  connectionFile: string,
) => {
  const token = randomBytes(32).toString("hex");
  const host = await openMcpHost(service, {
    auth: { type: "token", token },
    port: 0,
    writes: true,
    operationStorePath: join(vaultRoot, ".pkm/agent-state.sqlite"),
  });
  try {
    await mkdir(dirname(connectionFile), { recursive: true });
    await writeFileAtomic(
      connectionFile,
      JSON.stringify({ url: host.url, token, vaultId: service.vaultId }),
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (error) {
    await host.close();
    throw error;
  }
  return async () => {
    await host.close();
    try {
      const current: unknown = JSON.parse(
        await readFile(connectionFile, "utf8"),
      );
      if (
        typeof current === "object" &&
        current !== null &&
        "token" in current &&
        current.token === token
      )
        await rm(connectionFile, { force: true });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  };
};
