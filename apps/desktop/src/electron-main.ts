import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createHttpObjectClient, type ObjectClient } from "@pkm/core";
import { ObjectStore } from "@pkm/storage-node";
import { app, BrowserWindow, dialog, Menu, safeStorage, shell } from "electron";

import { registerDesktopIpc } from "./electron-ipc.js";
import { registerDesktopLifecycle } from "./electron-lifecycle.js";
import { externalWebUrl } from "./external-link.js";
import { localObjectClient } from "./local-object-client.js";
import {
  accessHeaders,
  connectionFile,
  parseServerConnection,
  type ServerConnection,
} from "./server-connection.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));

const loadPage = async (window: BrowserWindow, page: string) => {
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
  if (developmentUrl === undefined)
    await window.loadFile(join(currentDirectory, "../dist-renderer", page));
  else await window.loadURL(new URL(page, developmentUrl).href);
};

const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: join(currentDirectory, "preload.cjs"),
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
    webPreferences,
  });
  await loadPage(window, "index.html");
  return window;
};

let connectionWindow: BrowserWindow | null = null;
const openConnectionWindow = (): void => {
  if (connectionWindow !== null) return connectionWindow.focus();
  connectionWindow = new BrowserWindow({
    width: 520,
    height: 540,
    resizable: false,
    title: "サーバー接続",
    webPreferences,
  });
  connectionWindow.on("closed", () => {
    connectionWindow = null;
  });
  void loadPage(connectionWindow, "connection.html");
};

await app.whenReady();
const smoke = process.env.PKM_ELECTRON_SMOKE === "1";
const objects = new ObjectStore(
  smoke ? ":memory:" : join(app.getPath("userData"), "objects.sqlite"),
);
const local = localObjectClient(objects);
const settings = connectionFile(
  join(app.getPath("userData"), "server-connection.json"),
  safeStorage,
);
// smokeは利用中の接続設定を読まない。
let connection = smoke
  ? null
  : await settings.load().catch((error: unknown) => {
      console.error("Server connection could not be read", error);
      return null;
    });
const clientFor = (next: ServerConnection | null): ObjectClient =>
  next === null
    ? local
    : createHttpObjectClient({
        baseUrl: next.url,
        headers: accessHeaders(next),
      });
let client = clientFor(connection);
const summary = () =>
  connection && { url: connection.url, clientId: connection.clientId };
// 保存先が変わったら、Object画面を新しい保存先で読み直す。
const switchTo = (next: ServerConnection | null): void => {
  connection = next;
  client = clientFor(next);
  for (const window of BrowserWindow.getAllWindows())
    if (window !== connectionWindow) window.webContents.reload();
};

const today = (): string => new Date().toISOString().slice(0, 10);
/** つないでいるサーバーから、バックアップや書き出しを受け取る。 */
const download = async (
  server: ServerConnection,
  path: string,
): Promise<Buffer> => {
  const response = await fetch(`${server.url}/api/next${path}`, {
    headers: accessHeaders(server),
    redirect: "manual",
  });
  if (!response.ok)
    throw new Error(
      response.status >= 300 && response.status < 400
        ? "サーバーの認証に失敗しました（Cloudflare Access）"
        : `HTTP ${response.status}`,
    );
  return Buffer.from(await response.arrayBuffer());
};
const exportBackup = async (): Promise<void> => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: `contextory-${today()}.sqlite`,
  });
  if (canceled || !filePath) return;
  if (connection)
    await writeFile(filePath, await download(connection, "/backup"));
  else await objects.backup(filePath);
};
const exportMarkdown = async (): Promise<void> => {
  if (connection) {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `contextory-${today()}.zip`,
    });
    if (canceled || !filePath) return;
    await writeFile(filePath, await download(connection, "/export/markdown"));
    return;
  }
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  if (canceled || !filePaths[0]) return;
  const root = join(filePaths[0], `contextory-${today()}`);
  for (const file of objects.exportMarkdown()) {
    const path = join(root, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.text);
  }
};
const reportFailure = (task: () => Promise<void>) => (): void => {
  void task().catch((error: unknown) =>
    dialog.showErrorBox(
      "書き出せませんでした",
      error instanceof Error ? error.message : String(error),
    ),
  );
};

registerDesktopLifecycle(
  createWindow,
  () => {
    objects.close();
    return Promise.resolve();
  },
  registerDesktopIpc({
    client: () => client,
    connection: {
      get: summary,
      async save(input) {
        const next = parseServerConnection(input, connection);
        // 届くことと認証が通ることを確かめてから切り替える。
        await clientFor(next).types();
        await settings.save(next);
        switchTo(next);
        return { url: next.url, clientId: next.clientId };
      },
      async clear() {
        await settings.clear();
        switchTo(null);
      },
    },
  }),
);
Menu.setApplicationMenu(
  Menu.buildFromTemplate([
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "サーバー接続…", click: openConnectionWindow },
        { type: "separator" },
        {
          label: "バックアップを書き出す…",
          click: reportFailure(exportBackup),
        },
        {
          label: "Markdownで書き出す…",
          click: reportFailure(exportMarkdown),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]),
);
const mainWindow = await createWindow();
if (smoke) {
  const result = (await mainWindow.webContents.executeJavaScript(
    `new Promise((resolve) => {
      const inspect = () => ({
        api: typeof window.pkm,
        root: document.querySelector('#root') !== null,
        rendered: document.querySelector('#root')?.childElementCount > 0,
        title: document.title,
        dailyButton: [...document.querySelectorAll('button')]
          .some((button) => button.textContent === 'Daily'),
        methods: [
          'loadPage', 'savePage', 'searchObjects',
          'createObject', 'patchObject', 'queryView',
          'types', 'updateType', 'overview', 'trashObject',
          'restoreObject', 'purgeObject', 'trash', 'emptyTrash', 'deleteType',
          'uiState', 'setUiState'
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
    readonly dailyButton: boolean;
    readonly methods: boolean;
  };
  if (
    app.getName() !== "Contextory" ||
    result.api !== "object" ||
    !result.root ||
    !result.rendered ||
    result.title !== "Contextory" ||
    !result.dailyButton ||
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
