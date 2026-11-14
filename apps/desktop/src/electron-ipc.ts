import {
  parseObjectCreate,
  parseObjectOverviewRange,
  parseObjectPageSave,
  parseObjectPatch,
  parseObjectTypePatch,
  requireRequestString,
  type ObjectClient,
} from "@pkm/core";
import { ipcMain } from "electron";

import { DESKTOP_IPC_CHANNELS } from "./ipc-contract.js";
import type { ServerConnectionSummary } from "./server-connection.js";

export interface DesktopServices {
  /** いまの保存先。接続設定を変えると差し替わる。 */
  readonly client: () => ObjectClient;
  readonly connection: {
    get(): ServerConnectionSummary | null;
    save(input: unknown): Promise<ServerConnectionSummary>;
    clear(): Promise<void>;
  };
}

export const registerDesktopIpc = ({
  client,
  connection,
}: DesktopServices): (() => void) => {
  const savePage = (hostId: unknown, request: unknown) => {
    const { doc, baseRevision } = parseObjectPageSave(request);
    return client().savePage(
      requireRequestString(hostId, "hostId"),
      doc,
      baseRevision,
    );
  };
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectLoadPage, (_event, hostId) =>
    client().loadPage(requireRequestString(hostId, "hostId")),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.objectSavePage,
    (_event, hostId, request) => savePage(hostId, request),
  );
  // 窓を閉じる直前の保存。rendererを待たせ、終了処理より先に書き終える。
  ipcMain.on(
    DESKTOP_IPC_CHANNELS.objectSavePageSync,
    (event, hostId, request) => {
      void Promise.resolve()
        .then(() => savePage(hostId, request))
        .then(
          (page) => {
            event.returnValue = { page };
          },
          (error: unknown) => {
            console.error("Object page could not be saved on close", error);
            event.returnValue = {
              error: error instanceof Error ? error.message : String(error),
            };
          },
        );
    },
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.objectSearch,
    (_event, query: unknown, exclude: unknown) => {
      if (typeof query !== "string")
        throw new TypeError("query must be a string");
      const excluded =
        exclude === null || exclude === undefined
          ? null
          : requireRequestString(exclude, "exclude");
      return client().searchObjects(query, excluded);
    },
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectListType, (_event, type) =>
    client().objectsOfType(requireRequestString(type, "type")),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectCreate, (_event, request) =>
    client().createObject(parseObjectCreate(request)),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectPatch, (_event, id, request) =>
    client().patchObject(
      requireRequestString(id, "id"),
      parseObjectPatch(request),
    ),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectTimeline, (_event, id) =>
    client().timeline(requireRequestString(id, "id")),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectTypes, () => client().types());
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.objectUpdateType,
    (_event, name, request) =>
      client().updateType(
        requireRequestString(name, "name"),
        parseObjectTypePatch(request),
      ),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectOverview, (_event, request) => {
    const { from, to } = parseObjectOverviewRange(request);
    return client().overview(from, to);
  });
  ipcMain.handle(DESKTOP_IPC_CHANNELS.connectionGet, () => connection.get());
  ipcMain.handle(DESKTOP_IPC_CHANNELS.connectionSave, (_event, input) =>
    connection.save(input),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.connectionClear, () =>
    connection.clear(),
  );

  return () => {
    for (const channel of Object.values(DESKTOP_IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
      ipcMain.removeAllListeners(channel);
    }
  };
};
