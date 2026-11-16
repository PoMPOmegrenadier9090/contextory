import type { ObjectClient } from "@pkm/core";

import type { ServerConnectionSummary } from "./server-connection.js";

export type DesktopApi = ObjectClient;

/** サーバー接続の設定画面とObject画面が使う。 */
export interface DesktopConnectionApi {
  get(): Promise<ServerConnectionSummary | null>;
  save(input: {
    readonly url: string;
    readonly clientId: string;
    readonly clientSecret: string;
  }): Promise<ServerConnectionSummary>;
  clear(): Promise<void>;
}
