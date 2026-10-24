import { openDesktopMcpHost } from "@pkm/mcp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  powerMonitor,
  protocol,
  shell,
} from "electron";

import { registerDesktopIpc } from "./electron-ipc.js";
import { registerDesktopLifecycle } from "./electron-lifecycle.js";
import { DesktopVaultController } from "./vault-controller.js";
import { externalWebUrl } from "./external-link.js";
import { openLocalVault } from "@pkm/storage-node";
import { FileVaultPreferences } from "./vault-preferences.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const controller = new DesktopVaultController(
  async () => {
    const result = await dialog.showOpenDialog({
      title: "既存Vaultまたは新規Vault用の空フォルダを選択",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  openLocalVault,
  {},
  process.env.PKM_ELECTRON_SMOKE === "1"
    ? undefined
    : new FileVaultPreferences(() =>
        join(app.getPath("userData"), "vault-preferences.json"),
      ),
  process.env.PKM_DESKTOP_MCP_ENABLED === "1"
    ? (service, root) =>
        openDesktopMcpHost(
          service,
          root,
          join(app.getPath("userData"), "mcp-connection.json"),
        )
    : undefined,
);
const unregisterIpc = registerDesktopIpc(controller, (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send(channel, payload);
  }
});

const refreshVault = (): void => {
  void controller.api.refreshVault().catch((error: unknown) => {
    console.error("Vault refresh failed", error);
  });
};

const createWindow = async (): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Contextory",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 12, y: 14 },
        }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDirectory, "preload.cjs"),
    },
  });
  window.on("focus", refreshVault);
  window.webContents.setWindowOpenHandler(({ url }) => {
    const external = externalWebUrl(url);
    if (external !== null)
      void shell
        .openExternal(external)
        .catch((error: unknown) =>
          console.error("External link could not be opened", error),
        );
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const developmentUrl = process.env.PKM_RENDERER_URL;
  if (developmentUrl === undefined) {
    await window.loadFile(
      join(currentDirectory, "../dist-renderer/index.html"),
    );
  } else {
    await window.loadURL(developmentUrl);
  }
  return window;
};

await app.whenReady();
powerMonitor.on("resume", refreshVault);
protocol.handle("pkm-asset", async (request) => {
  const url = new URL(request.url);
  if (url.hostname !== "vault") return new Response(null, { status: 404 });
  try {
    const asset = await controller.api.readAsset(
      decodeURIComponent(url.pathname.slice(1)),
    );
    return new Response(new Uint8Array(asset.data), {
      headers: {
        "content-type": asset.mimeType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
});
registerDesktopLifecycle(createWindow, () => controller.close(), unregisterIpc);
const mainWindow = await createWindow();
if (process.env.PKM_ELECTRON_SMOKE === "1") {
  const result = (await mainWindow.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const inspect = () => ({
        api: typeof window.pkm,
        root: document.querySelector('#root') !== null,
        rendered: document.querySelector('#root')?.childElementCount > 0,
        title: document.title,
        chooseVaultButton: [...document.querySelectorAll('button')]
          .some((button) => button.textContent?.includes('Vaultを選択')),
        methods: [
          'chooseVault', 'restoreVault', 'syncStatus', 'setupSync', 'listEntities', 'listTodos', 'toggleTodo', 'quickOpen', 'searchEntities', 'createEntity',
          'createAsset', 'openAsset', 'readImage', 'listUnresolvedReferences',
          'loadEntity', 'saveDraft', 'saveEntity', 'permanentlyDeleteEntity', 'resolveEntityConflict',
          'listSyncthingConflicts', 'loadSyncthingConflict',
          'resolveSyncthingConflict',
          'onVaultChanged'
        ].every((name) => typeof window.pkm?.[name] === 'function')
      });
      const initial = inspect();
      if (initial.rendered) return resolve(initial);
      const observer = new MutationObserver(() => {
        const result = inspect();
        if (result.rendered) {
          observer.disconnect();
          resolve(result);
        }
      });
      observer.observe(document.querySelector('#root'), {
        childList: true,
        subtree: true
      });
      setTimeout(() => {
        observer.disconnect();
        resolve(inspect());
      }, 3000);
    })`,
  )) as {
    readonly api: string;
    readonly root: boolean;
    readonly rendered: boolean;
    readonly title: string;
    readonly chooseVaultButton: boolean;
    readonly methods: boolean;
  };
  if (
    app.getName() !== "Contextory" ||
    result.api !== "object" ||
    !result.root ||
    !result.rendered ||
    result.title !== "Contextory" ||
    !result.chooseVaultButton ||
    !result.methods
  ) {
    throw new Error(
      `Electron renderer smoke failed: ${JSON.stringify(result)}`,
    );
  }
  console.log(
    `Electron renderer smoke passed: ${JSON.stringify({ ...result, name: app.getName(), packaged: app.isPackaged, userData: app.getPath("userData") })}`,
  );
  app.quit();
}
