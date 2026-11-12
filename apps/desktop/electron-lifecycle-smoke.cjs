// Run after building and rebuilding better-sqlite3 for Electron.
// Uses a temporary userData directory and never opens the user's ObjectStore.
/* global __dirname, __filename */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { existsSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const process = require("node:process");
const { setTimeout } = require("node:timers");
const { pathToFileURL } = require("node:url");
const electron = require("electron");

if (typeof electron === "string") {
  const root = mkdtempSync(path.join(tmpdir(), "contextory-object-smoke-"));
  try {
    for (const phase of ["save", "restart"])
      execFileSync(electron, [__filename, root, phase], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "",
          PKM_ELECTRON_SMOKE: "0",
          PKM_DESKTOP_MCP_ENABLED: "0",
          PKM_RENDERER_URL: undefined,
        },
        stdio: "inherit",
        timeout: 20_000,
      });
    assert.equal(existsSync(path.join(root, "objects.sqlite")), true);
    console.log("Electron lifecycle smoke passed: Object IPC and restart");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow, protocol } = electron;
  const root = process.argv[2];
  const phase = process.argv[3];
  app.setPath("userData", root);
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "pkm-asset",
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  /** @param {import("electron").BrowserWindow} window */
  const waitForObjectApp = async (window) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (
        await window.webContents.executeJavaScript(
          `typeof window.pkm?.loadPage === "function"
            && [...document.querySelectorAll("button")]
              .some((button) => button.textContent === "Daily")`,
        )
      )
        return;
      await pause();
    }
    throw new Error("Object app was not ready in the renderer");
  };

  app
    .whenReady()
    .then(async () => {
      await import(
        pathToFileURL(path.join(__dirname, "dist/electron-main.js")).href
      );
      const window = BrowserWindow.getAllWindows()[0];
      assert.ok(window);
      await waitForObjectApp(window);

      if (phase === "save") {
        await window.webContents.executeJavaScript(`(async () => {
          await window.pkm.createObject({
            id: "desktop-smoke",
            type: "project",
            title: "Desktop smoke",
            parentId: null
          });
          await window.pkm.savePage("daily:2026-11-11", {
            type: "doc",
            content: [{
              type: "paragraph",
              attrs: { id: "smoke-block" },
              content: [{ type: "text", text: "Desktop persisted" }]
            }]
          });
        })()`);
      } else {
        /** @type {unknown} */
        const result = await window.webContents
          .executeJavaScript(`(async () => {
          const object = await window.pkm.loadPage("desktop-smoke");
          const daily = await window.pkm.loadPage("daily:2026-11-11");
          return {
            title: object.objects["desktop-smoke"].title,
            text: daily.doc.content[0].content[0].text
          };
        })()`);
        assert.deepEqual(result, {
          title: "Desktop smoke",
          text: "Desktop persisted",
        });
      }

      console.log(`Electron lifecycle ${phase}: ObjectStore is available`);
      app.quit();
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
