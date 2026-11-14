import type {
  ObjectOverview,
  ObjectPage,
  ObjectSummary,
  ObjectTimelineEntry,
  TypeDefinition,
} from "@pkm/core";
import { contextBridge, ipcRenderer } from "electron";

import type { DesktopApi, DesktopConnectionApi } from "./desktop-api.js";
import { DESKTOP_IPC_CHANNELS } from "./ipc-contract.js";

const invoke = <T>(channel: string, ...args: readonly unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: DesktopApi = {
  loadPage: (hostId) =>
    invoke<ObjectPage>(DESKTOP_IPC_CHANNELS.objectLoadPage, hostId),
  savePage: (hostId, doc, keepalive = false) => {
    if (!keepalive)
      return invoke<ObjectPage>(DESKTOP_IPC_CHANNELS.objectSavePage, hostId, {
        doc,
      });
    // 閉じる途中の窓では非同期の返事を待てないため、同期で書き切る。
    const error = ipcRenderer.sendSync(
      DESKTOP_IPC_CHANNELS.objectSavePageSync,
      hostId,
      { doc },
    ) as string | null;
    return error === null
      ? Promise.resolve({ doc, objects: {} })
      : Promise.reject(new Error(error));
  },
  searchObjects: (query, exclude = null) =>
    invoke<readonly ObjectSummary[]>(
      DESKTOP_IPC_CHANNELS.objectSearch,
      query,
      exclude,
    ),
  objectsOfType: (type) =>
    invoke<readonly ObjectSummary[]>(DESKTOP_IPC_CHANNELS.objectListType, type),
  createObject: (input) =>
    invoke<ObjectSummary>(DESKTOP_IPC_CHANNELS.objectCreate, input),
  patchObject: (id, patch) =>
    invoke<ObjectSummary>(DESKTOP_IPC_CHANNELS.objectPatch, id, patch),
  timeline: (id) =>
    invoke<readonly ObjectTimelineEntry[]>(
      DESKTOP_IPC_CHANNELS.objectTimeline,
      id,
    ),
  types: () =>
    invoke<readonly TypeDefinition[]>(DESKTOP_IPC_CHANNELS.objectTypes),
  updateType: (name, patch) =>
    invoke<TypeDefinition>(DESKTOP_IPC_CHANNELS.objectUpdateType, name, patch),
  overview: (from, to) =>
    invoke<ObjectOverview>(DESKTOP_IPC_CHANNELS.objectOverview, { from, to }),
};

const connection: DesktopConnectionApi = {
  get: () => invoke(DESKTOP_IPC_CHANNELS.connectionGet),
  save: (input) => invoke(DESKTOP_IPC_CHANNELS.connectionSave, input),
  clear: () => invoke(DESKTOP_IPC_CHANNELS.connectionClear),
};

contextBridge.exposeInMainWorld("pkm", api);
contextBridge.exposeInMainWorld("pkmConnection", connection);
