import { parseEntityPageQuery, parseBacklinkPageQuery } from "@pkm/core";
import { ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { parseTodoQuery, parseToggleTodoRequest } from "@pkm/core";

import { DESKTOP_IPC_CHANNELS } from "./ipc-contract.js";
import {
  parseCreateAssetRequest,
  parseCreateEntityRequest,
  parseOrphanAssetDeletion,
  parseResolveEntityConflictRequest,
  parseResolveSyncthingConflictRequest,
  parseSaveSyncthingConflictDraftRequest,
  parseSaveDraftRequest,
  parseSaveEntityRequest,
  parsePermanentlyDeleteEntityRequest,
  requireRequestString,
} from "@pkm/core";
import type { DesktopVaultController } from "./vault-controller.js";
import {
  parseDesktopSyncConnection,
  parseDesktopSyncSetup,
} from "./desktop-sync.js";

export type DesktopEventSender = (channel: string, payload: unknown) => void;

export const registerDesktopIpc = (
  controller: DesktopVaultController,
  sendEvent: DesktopEventSender = () => undefined,
): (() => void) => {
  const channels = Object.values(DESKTOP_IPC_CHANNELS);
  ipcMain.handle(DESKTOP_IPC_CHANNELS.linkPreview, (_event, url: unknown) =>
    controller.api.linkPreview(requireRequestString(url, "url")),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.refreshVault, () =>
    controller.api.refreshVault(),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.restoreVault, () =>
    controller.api.restoreVault(),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.syncStatus, (_event, request: unknown) =>
    controller.api.syncStatus(parseDesktopSyncConnection(request)),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.setupSync, (_event, request: unknown) =>
    controller.api.setupSync(parseDesktopSyncSetup(request)),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.chooseVault, () =>
    controller.api.chooseVault(),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.closeVault, () =>
    controller.api.closeVault(),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.queryEntities, (_event, query: unknown) =>
    controller.api.queryEntities(parseEntityPageQuery(query ?? {})),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.queryBacklinks,
    (_event, id: unknown, query: unknown) =>
      controller.api.queryBacklinks(
        requireRequestString(id, "entityId"),
        parseBacklinkPageQuery(query ?? {}),
      ),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.entityCounts, () =>
    controller.api.entityCounts(),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.calendarCounts,
    (_event, from: unknown, to: unknown) =>
      controller.api.calendarCounts(
        requireRequestString(from, "from"),
        requireRequestString(to, "to"),
      ),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.listEntities, () =>
    controller.api.listEntities(),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.listTodos,
    (_event: IpcMainInvokeEvent, query: unknown) =>
      controller.api.listTodos(parseTodoQuery(query ?? {})),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.toggleTodo,
    (_event: IpcMainInvokeEvent, request: unknown) =>
      controller.api.toggleTodo(parseToggleTodoRequest(request)),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.listJournalEntries,
    (_event: IpcMainInvokeEvent, date: unknown) =>
      controller.api.listJournalEntries(requireRequestString(date, "date")),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.listDeletedEntities, () =>
    controller.api.listDeletedEntities(),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.quickOpen,
    (_event: IpcMainInvokeEvent, query: unknown) =>
      controller.api.quickOpen(
        typeof query === "string"
          ? query
          : requireRequestString(query, "query"),
      ),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.searchEntities,
    (_event: IpcMainInvokeEvent, query: unknown) =>
      controller.api.searchEntities(requireRequestString(query, "query")),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.createEntity,
    (_event: IpcMainInvokeEvent, request: unknown) =>
      controller.api.createEntity(parseCreateEntityRequest(request)),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.createAsset,
    (_event: IpcMainInvokeEvent, request: unknown) =>
      controller.api.createAsset(parseCreateAssetRequest(request)),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.openAsset,
    async (_event: IpcMainInvokeEvent, path: unknown) => {
      const absolutePath = await controller.api.assetAbsolutePath(
        requireRequestString(path, "path"),
      );
      const error = await shell.openPath(absolutePath);
      if (error.length > 0) throw new Error(error);
    },
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.readImage,
    async (_event, path: unknown) => {
      const asset = await controller.api.readAsset(
        requireRequestString(path, "path"),
      );
      if (!asset.mimeType.startsWith("image/"))
        throw new Error("画像を選択してください。");
      return {
        mimeType: asset.mimeType,
        dataBase64: asset.data.toString("base64"),
      };
    },
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.permanentlyDeleteEntity,
    (_event, request: unknown) =>
      controller.api.permanentlyDeleteEntity(
        parsePermanentlyDeleteEntityRequest(request),
      ),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.listUnresolvedReferences, () =>
    controller.api.listUnresolvedReferences(),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.listOrphanAssets, () =>
    controller.api.listOrphanAssets(),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.deleteOrphanAssets,
    (_event: IpcMainInvokeEvent, assets: unknown) =>
      controller.api.deleteOrphanAssets(parseOrphanAssetDeletion(assets)),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.loadEntity,
    (_event: IpcMainInvokeEvent, entityId: unknown) =>
      controller.api.loadEntity(requireRequestString(entityId, "entityId")),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.getBacklinks,
    (_event: IpcMainInvokeEvent, entityId: unknown) =>
      controller.api.getBacklinks(requireRequestString(entityId, "entityId")),
  );
  ipcMain.handle(DESKTOP_IPC_CHANNELS.listSyncthingConflicts, () =>
    controller.api.listSyncthingConflicts(),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.loadSyncthingConflict,
    (_event: IpcMainInvokeEvent, path: unknown) =>
      controller.api.loadSyncthingConflict(requireRequestString(path, "path")),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.saveSyncthingConflictDraft,
    (_event: IpcMainInvokeEvent, request: unknown) =>
      controller.api.saveSyncthingConflictDraft(
        parseSaveSyncthingConflictDraftRequest(request),
      ),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.discardSyncthingConflictDraft,
    (_event: IpcMainInvokeEvent, conflictPath: unknown) =>
      controller.api.discardSyncthingConflictDraft(
        requireRequestString(conflictPath, "conflictPath"),
      ),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.saveDraft,
    (_event: IpcMainInvokeEvent, request: unknown) =>
      controller.api.saveDraft(parseSaveDraftRequest(request)),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.discardDraft,
    (_event: IpcMainInvokeEvent, entityId: unknown) =>
      controller.api.discardDraft(requireRequestString(entityId, "entityId")),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.saveEntity,
    (_event: IpcMainInvokeEvent, request: unknown) =>
      controller.api.saveEntity(parseSaveEntityRequest(request)),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.resolveEntityConflict,
    (_event: IpcMainInvokeEvent, request: unknown) =>
      controller.api.resolveEntityConflict(
        parseResolveEntityConflictRequest(request),
      ),
  );
  ipcMain.handle(
    DESKTOP_IPC_CHANNELS.resolveSyncthingConflict,
    (_event: IpcMainInvokeEvent, request: unknown) =>
      controller.api.resolveSyncthingConflict(
        parseResolveSyncthingConflictRequest(request),
      ),
  );
  const unsubscribe = controller.onVaultChanged((result) => {
    sendEvent(DESKTOP_IPC_CHANNELS.vaultChanged, result);
  });

  return () => {
    unsubscribe();
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
};
