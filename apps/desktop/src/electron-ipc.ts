import {
  parseObjectCreate,
  parseObjectOverviewRange,
  parseObjectPageSave,
  parseObjectPatch,
  parseObjectTypePatch,
  requireRequestString,
} from "@pkm/core";
import type { ObjectStore } from "@pkm/storage-node";
import { ipcMain } from "electron";

import { DESKTOP_IPC_CHANNELS } from "./ipc-contract.js";

export const registerDesktopIpc = (objects: ObjectStore): (() => void) => {
  const savePage = (hostId: unknown, request: unknown) =>
    objects.savePage(
      requireRequestString(hostId, "hostId"),
      parseObjectPageSave(request),
      Date.now(),
    );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectLoadPage, (_event, hostId) =>
    objects.loadPage(requireRequestString(hostId, "hostId")),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.objectSavePage,
    (_event, hostId, request) => savePage(hostId, request),
  );
  // 窓を閉じる直前の保存。rendererを待たせ、終了処理より先に書き終える。
  ipcMain.on(
    DESKTOP_IPC_CHANNELS.objectSavePageSync,
    (event, hostId, request) => {
      try {
        savePage(hostId, request);
        event.returnValue = null;
      } catch (error) {
        console.error("Object page could not be saved on close", error);
        event.returnValue =
          error instanceof Error ? error.message : String(error);
      }
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
      return objects.search(query, excluded);
    },
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectListType, (_event, type) =>
    objects.objectsOfType(requireRequestString(type, "type")),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectCreate, (_event, request) =>
    objects.createObject(parseObjectCreate(request), Date.now()),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectPatch, (_event, id, request) =>
    objects.patchObject(
      requireRequestString(id, "id"),
      parseObjectPatch(request),
      Date.now(),
    ),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectTimeline, (_event, id) =>
    objects.timeline(requireRequestString(id, "id")),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectTypes, () => objects.types());
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.objectUpdateType,
    (_event, name, request) =>
      objects.updateType(
        requireRequestString(name, "name"),
        parseObjectTypePatch(request),
      ),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.objectOverview, (_event, request) => {
    const { from, to } = parseObjectOverviewRange(request);
    return objects.overview(from, to);
  });

  return () => {
    for (const channel of Object.values(DESKTOP_IPC_CHANNELS)) {
      ipcMain.removeHandler(channel);
      ipcMain.removeAllListeners(channel);
    }
  };
};
