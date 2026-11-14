// Run after building and rebuilding better-sqlite3 for Electron.
// Uses a temporary userData directory and never opens the user's ObjectStore.
/* global __dirname, __filename */
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const http = require("node:http");
const { tmpdir } = require("node:os");
const path = require("node:path");
const process = require("node:process");
const { clearTimeout, setTimeout } = require("node:timers");
const { pathToFileURL } = require("node:url");
const electron = require("electron");

if (typeof electron === "string") {
  const electronPath = electron;
  const root = mkdtempSync(path.join(tmpdir(), "contextory-object-smoke-"));
  // Cloudflare Accessの代わり。service tokenが無いリクエストは403で断る。
  /** @type {Map<string, unknown>} */
  const pages = new Map();
  /** @type {{ method: string, url: string, authorized: boolean }[]} */
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const url = request.url ?? "";
      const authorized =
        request.headers["cf-access-client-id"] === "smoke-id" &&
        request.headers["cf-access-client-secret"] === "smoke-secret";
      requests.push({ method: request.method ?? "", url, authorized });
      const send = (
        /** @type {number} */ status,
        /** @type {unknown} */ value,
      ) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (!authorized) return send(403, { message: "forbidden" });
      const page = /^\/api\/next\/pages\/([^/?]+)$/.exec(url);
      if (page && request.method === "PUT") {
        /** @type {unknown} */
        const parsed = JSON.parse(body);
        const saved = {
          doc: /** @type {{ doc: unknown }} */ (parsed).doc,
          objects: {},
        };
        pages.set(decodeURIComponent(page[1] ?? ""), saved);
        return send(200, saved);
      }
      if (page)
        return send(
          200,
          pages.get(decodeURIComponent(page[1] ?? "")) ?? {
            doc: { type: "doc", content: [{ type: "paragraph" }] },
            objects: {},
          },
        );
      if (url.startsWith("/api/next/overview"))
        return send(200, { navigation: [], recent: [], memos: [] });
      return send(200, []);
    });
  });
  const run = (/** @type {string[]} */ args) =>
    new Promise((resolve, reject) => {
      const child = spawn(electronPath, [__filename, root, ...args], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "",
          PKM_ELECTRON_SMOKE: "0",
          PKM_RENDERER_URL: undefined,
        },
        stdio: "inherit",
      });
      const timer = setTimeout(() => child.kill(), 20_000);
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(undefined);
        else reject(new Error(`Electron ${args[0]} exited with ${code}`));
      });
    });
  void (async () => {
    try {
      await new Promise((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve(undefined)),
      );
      const address = /** @type {import("node:net").AddressInfo} */ (
        server.address()
      );
      await run(["save"]);
      await run(["restart"]);
      assert.equal(existsSync(path.join(root, "objects.sqlite")), true);
      await run(["remote", `http://127.0.0.1:${address.port}`]);
      const stored = readFileSync(
        path.join(root, "server-connection.json"),
        "utf8",
      );
      assert.equal(stored.includes("smoke-secret"), false);
      assert.ok(requests.some((request) => !request.authorized));
      const daily = [...pages.entries()].find(([id]) =>
        id.startsWith("daily:"),
      );
      assert.ok(daily, "Daily was not saved to the server");
      assert.ok(
        JSON.stringify(daily[1]).includes("サーバーへの終了直前の入力"),
      );
      console.log(
        "Electron lifecycle smoke passed: Object IPC, restart and server connection",
      );
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      server.close();
      rmSync(root, { recursive: true, force: true });
    }
  })();
} else {
  const { app, BrowserWindow } = electron;
  const root = process.argv[2];
  const phase = process.argv[3];
  app.setPath("userData", root);
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

      if (phase === "remote") {
        const url = process.argv[4];
        /** @type {unknown} */
        const rejected = await window.webContents.executeJavaScript(
          `window.pkmConnection.save(${JSON.stringify({ url, clientId: "smoke-id", clientSecret: "wrong" })})
            .then(() => "saved", (error) => error.message)`,
        );
        assert.match(String(rejected), /認証に失敗/);
        // 保存が通ると画面を読み直すので、結果は待たない。
        await window.webContents.executeJavaScript(
          `void window.pkmConnection.save(${JSON.stringify({ url, clientId: "smoke-id", clientSecret: "smoke-secret" })}); true`,
        );
        const host = new URL(String(url)).host;
        const deadline = Date.now() + 10_000;
        while (
          !(await window.webContents.executeJavaScript(
            `document.body.innerText.includes(${JSON.stringify(`${host}へ保存`)})`,
          ))
        ) {
          if (Date.now() > deadline)
            throw new Error("Server connection was not applied");
          await pause();
        }
        await waitForObjectApp(window);
        await window.webContents.executeJavaScript(
          `document.querySelector(".tiptap").focus()`,
        );
        await window.webContents.insertText("サーバーへの終了直前の入力");
      } else if (phase === "save") {
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
        // 保存の待ち時間より前に終了しても、窓を閉じる時に書き切る。
        await window.webContents.executeJavaScript(
          `document.querySelector(".tiptap").focus()`,
        );
        await window.webContents.insertText("終了直前の入力");
      } else {
        /** @type {unknown} */
        const result = await window.webContents
          .executeJavaScript(`(async () => {
          const object = await window.pkm.loadPage("desktop-smoke");
          const daily = await window.pkm.loadPage("daily:2026-11-11");
          const pad = (value) => String(value).padStart(2, "0");
          const now = new Date();
          const today = await window.pkm.loadPage(
            "daily:" + now.getFullYear() + "-" + pad(now.getMonth() + 1)
              + "-" + pad(now.getDate())
          );
          return {
            title: object.objects["desktop-smoke"].title,
            text: daily.doc.content[0].content[0].text,
            closing: JSON.stringify(today.doc).includes("終了直前の入力")
          };
        })()`);
        assert.deepEqual(result, {
          title: "Desktop smoke",
          text: "Desktop persisted",
          closing: true,
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
