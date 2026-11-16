import { readFile, rm, writeFile } from "node:fs/promises";

import { requireRequestRecord, requireRequestString } from "@pkm/core";

/** Cloudflare Accessのservice tokenでつなぐサーバー。 */
export interface ServerConnection {
  readonly url: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/** rendererへ渡す接続情報。secretは渡さない。 */
export interface ServerConnectionSummary {
  readonly url: string;
  readonly clientId: string;
}

export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** 入力を検証する。secretが空なら、保存済みのsecretを使い続ける。 */
export const parseServerConnection = (
  value: unknown,
  current: ServerConnection | null,
): ServerConnection => {
  const input = requireRequestRecord(value);
  let url: URL;
  try {
    url = new URL(requireRequestString(input.url, "url").trim());
  } catch {
    throw new TypeError("サーバーのURLが正しくありません");
  }
  // tokenを平文で送らないよう、localhost以外はhttpsに限る。
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))
  )
    throw new TypeError("サーバーのURLはhttpsで指定してください");
  const clientId = requireRequestString(
    typeof input.clientId === "string" ? input.clientId.trim() : input.clientId,
    "Client ID",
  );
  const secret =
    typeof input.clientSecret === "string" ? input.clientSecret.trim() : "";
  const clientSecret =
    secret || (current?.clientId === clientId ? current.clientSecret : "");
  if (!clientSecret) throw new TypeError("Client Secretを入力してください");
  return { url: url.origin, clientId, clientSecret };
};

export const accessHeaders = (
  connection: ServerConnection,
): Record<string, string> => ({
  "CF-Access-Client-Id": connection.clientId,
  "CF-Access-Client-Secret": connection.clientSecret,
});

/** userDataに置く接続設定。secretはOSの鍵で暗号化する。 */
export const connectionFile = (path: string, cipher: SecretCipher) => ({
  async load(): Promise<ServerConnection | null> {
    const text = await readFile(path, "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (text === null) return null;
    const stored = JSON.parse(text) as {
      url: string;
      clientId: string;
      clientSecret: string;
    };
    return {
      url: stored.url,
      clientId: stored.clientId,
      clientSecret: cipher.decryptString(
        Buffer.from(stored.clientSecret, "base64"),
      ),
    };
  },
  async save(connection: ServerConnection): Promise<void> {
    if (!cipher.isEncryptionAvailable())
      throw new Error("この端末ではsecretを暗号化して保存できません");
    await writeFile(
      path,
      JSON.stringify({
        url: connection.url,
        clientId: connection.clientId,
        clientSecret: cipher
          .encryptString(connection.clientSecret)
          .toString("base64"),
      }),
      { mode: 0o600 },
    );
  },
  clear: () => rm(path, { force: true }),
});
