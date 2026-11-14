import { app, BrowserWindow } from "electron";

export const registerDesktopLifecycle = (
  createWindow: () => Promise<BrowserWindow>,
  closeStore: () => Promise<void>,
  unregisterIpc: () => void,
): void => {
  let shutdown: Promise<void> | undefined;
  let readyToQuit = false;

  app.on("activate", () => {
    if (shutdown === undefined && BrowserWindow.getAllWindows().length === 0)
      void createWindow().catch((error: unknown) =>
        console.error("Window could not be opened", error),
      );
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  // A window can cancel quitting. Keep its store and IPC usable until all
  // windows have closed and Electron reaches will-quit.
  app.on("will-quit", (event) => {
    if (readyToQuit) return;
    event.preventDefault();
    if (shutdown !== undefined) return;
    shutdown = Promise.resolve()
      .then(closeStore)
      .catch((error: unknown) => {
        console.error("Object store could not be closed", error);
      })
      .then(() => {
        readyToQuit = true;
        // Resume quitting after the current native quit event has returned.
        setImmediate(() => app.quit());
      });
  });

  app.once("quit", unregisterIpc);
};
