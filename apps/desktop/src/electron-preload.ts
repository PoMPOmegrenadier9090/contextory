import type {
  ObjectOverview,
  ObjectPage,
  ObjectSummary,
  TypeDefinition,
  ViewResult,
} from "@pkm/core";
import { contextBridge, ipcRenderer } from "electron";

import type { DesktopApi, DesktopConnectionApi } from "./desktop-api.js";
import { DESKTOP_IPC_CHANNELS } from "./ipc-contract.js";

const invoke = <T>(channel: string, ...args: readonly unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: DesktopApi = {
  loadPage: (hostId) =>
    invoke<ObjectPage>(DESKTOP_IPC_CHANNELS.objectLoadPage, hostId),
  savePage: (hostId, doc, baseRevision, keepalive = false) => {
    if (!keepalive)
      return invoke<ObjectPage>(DESKTOP_IPC_CHANNELS.objectSavePage, hostId, {
        doc,
        baseRevision,
      });
    // 閉じる途中の窓では非同期の返事を待てないため、同期で書き切る。
    const result = ipcRenderer.sendSync(
      DESKTOP_IPC_CHANNELS.objectSavePageSync,
      hostId,
      { doc, baseRevision },
    ) as { page: ObjectPage } | { error: string };
    return "page" in result
      ? Promise.resolve(result.page)
      : Promise.reject(new Error(result.error));
  },
  searchObjects: (query, exclude = null, limit) =>
    invoke<readonly ObjectSummary[]>(
      DESKTOP_IPC_CHANNELS.objectSearch,
      query,
      exclude,
      limit,
    ),
  createObject: (input) =>
    invoke<ObjectSummary>(DESKTOP_IPC_CHANNELS.objectCreate, input),
  patchObject: (id, patch) =>
    invoke<ObjectSummary>(DESKTOP_IPC_CHANNELS.objectPatch, id, patch),
  queryView: (viewId, anchorId, today) =>
    invoke<ViewResult>(DESKTOP_IPC_CHANNELS.objectQueryView, viewId, {
      ...(anchorId ? { anchor: anchorId } : {}),
      today,
    }),
  trashObject: (id) =>
    invoke<ObjectSummary>(DESKTOP_IPC_CHANNELS.objectTrash, id),
  restoreObject: (id) =>
    invoke<ObjectSummary>(DESKTOP_IPC_CHANNELS.objectRestore, id),
  purgeObject: (id) => invoke<void>(DESKTOP_IPC_CHANNELS.objectPurge, id),
  trash: () =>
    invoke<readonly ObjectSummary[]>(DESKTOP_IPC_CHANNELS.objectTrashList),
  emptyTrash: () => invoke<void>(DESKTOP_IPC_CHANNELS.objectEmptyTrash),
  types: () =>
    invoke<readonly TypeDefinition[]>(DESKTOP_IPC_CHANNELS.objectTypes),
  updateType: (name, patch) =>
    invoke<TypeDefinition>(DESKTOP_IPC_CHANNELS.objectUpdateType, name, patch),
  deleteType: (name) =>
    invoke<void>(DESKTOP_IPC_CHANNELS.objectDeleteType, name),
  overview: (from, to) =>
    invoke<ObjectOverview>(DESKTOP_IPC_CHANNELS.objectOverview, { from, to }),
  uiState: () =>
    invoke<Readonly<Record<string, unknown>>>(DESKTOP_IPC_CHANNELS.uiState),
  setUiState: (key, value) =>
    invoke<void>(DESKTOP_IPC_CHANNELS.setUiState, key, value),
};

const connection: DesktopConnectionApi = {
  get: () => invoke(DESKTOP_IPC_CHANNELS.connectionGet),
  save: (input) => invoke(DESKTOP_IPC_CHANNELS.connectionSave, input),
  clear: () => invoke(DESKTOP_IPC_CHANNELS.connectionClear),
};

contextBridge.exposeInMainWorld("pkm", api);
contextBridge.exposeInMainWorld("pkmConnection", connection);
