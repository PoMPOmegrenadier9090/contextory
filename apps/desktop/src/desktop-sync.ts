import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  checkSyncthingIgnore,
  SyncthingClient,
  SYNCTHING_IGNORE_TEMPLATE,
} from "@pkm/storage-node";

export interface DesktopSyncConnection {
  readonly baseUrl: string;
  readonly apiKey: string;
}
export interface DesktopSyncSetup extends DesktopSyncConnection {
  readonly deviceIds: readonly string[];
}

export const parseDesktopSyncConnection = (
  value: unknown,
): DesktopSyncConnection => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("baseUrl" in value) ||
    !("apiKey" in value) ||
    typeof value.baseUrl !== "string" ||
    typeof value.apiKey !== "string" ||
    !value.apiKey.trim()
  ) {
    throw new TypeError("ローカルSyncthingのURLとAPI Keyを入力してください。");
  }
  const url = new URL(value.baseUrl);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new TypeError(
      "この端末のSyncthing URL（localhost / 127.0.0.1 / [::1]）を指定してください。",
    );
  }
  return { baseUrl: url.origin, apiKey: value.apiKey.trim() };
};

export const parseDesktopSyncSetup = (value: unknown): DesktopSyncSetup => {
  const connection = parseDesktopSyncConnection(value);
  if (
    typeof value !== "object" ||
    value === null ||
    !("deviceIds" in value) ||
    !Array.isArray(value.deviceIds) ||
    !value.deviceIds.every(
      (id: unknown) =>
        typeof id === "string" && /^[A-Z2-7]{7}(?:-[A-Z2-7]{7}){7}$/.test(id),
    )
  ) {
    throw new TypeError("共有先のSyncthing Device IDを入力してください。");
  }
  if (value.deviceIds.length === 0)
    throw new TypeError("共有先のDevice IDが必要です。");
  return { ...connection, deviceIds: value.deviceIds as string[] };
};

export const setupDesktopSync = async (
  vaultRoot: string,
  vaultId: string,
  request: DesktopSyncSetup,
) => {
  const connection = parseDesktopSyncSetup(request);
  const client = new SyncthingClient(connection);
  const system = await client.getSystemStatus();
  if (connection.deviceIds.includes(system.myID))
    throw new Error("共有先には別の端末のDevice IDを指定してください。");
  try {
    await writeFile(join(vaultRoot, ".stignore"), SYNCTHING_IGNORE_TEMPLATE, {
      flag: "wx",
    });
  } catch (error) {
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    ))
      throw error;
  }
  const boundary = await checkSyncthingIgnore(vaultRoot);
  if (!boundary.ok)
    throw new Error(
      `.stignoreを確認してください: ${boundary.issues.map((issue) => issue.message).join("; ")}`,
    );
  return client.bootstrapFolder({
    folderId: `pkm-${vaultId}`,
    label: `PKM ${vaultId}`,
    path: vaultRoot,
    deviceIds: connection.deviceIds,
  });
};
