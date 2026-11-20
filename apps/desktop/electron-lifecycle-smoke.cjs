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
        return send(200, { navigation: [], recent: [], memos: [], inbox: [] });
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
      await run(["blocks"]);
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
  const userData = phase === "blocks" ? path.join(root, "blocks") : root;
  app.setPath("userData", userData);
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
      if (phase === "blocks") {
        const { ObjectStore } = await import("@pkm/storage-node");
        const store = new ObjectStore(path.join(userData, "objects.sqlite"));
        const today = new Date();
        const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
        const key = `daily:${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        const text = (/** @type {string} */ text) => [{ type: "text", text }];
        const block = (/** @type {string} */ label) => ({
          type: "objectBlock",
          attrs: {
            id: "block-" + label,
            objectId: "object-" + label,
            type: "task",
          },
          content: [{ type: "objectTitle", content: text(label) }],
        });
        const task = store.types().find((type) => type.name === "task");
        const table = task?.views.find((view) => view.scope === "type");
        assert.ok(task && table);
        store.updateType("task", {
          views: [
            ...task.views,
            {
              ...table,
              id: "smoke-timeline",
              name: "View smoke timeline",
              layout: "timeline",
            },
          ],
        });
        store.createObject(
          {
            id: "view-smoke-row",
            type: "task",
            title: "Editable View row",
            parentId: null,
          },
          Date.now(),
        );
        store.savePage(
          "view-smoke-row",
          {
            type: "doc",
            content: [
              { type: "paragraph", content: text("本文だけの照合語。") },
            ],
          },
          Date.now(),
        );
        store.savePage(
          key,
          {
            type: "doc",
            content: [
              block("First"),
              { type: "paragraph", content: text("Between") },
              block("Last"),
              { type: "paragraph", content: text("Keep") },
              {
                type: "bulletList",
                content: ["One", "Two"].map((label) => ({
                  type: "listItem",
                  content: [{ type: "paragraph", content: text(label) }],
                })),
              },
              {
                type: "viewEmbed",
                attrs: { viewId: table.id, anchorId: null },
              },
            ],
          },
          Date.now(),
        );
        store.close();
      }
      await import(
        pathToFileURL(path.join(__dirname, "dist/electron-main.js")).href
      );
      const window = BrowserWindow.getAllWindows()[0];
      assert.ok(window);
      await waitForObjectApp(window);

      if (phase === "blocks") {
        const { webContents } = window;
        const script = (/** @type {string} */ code) =>
          webContents.executeJavaScript(code);
        if (process.platform === "darwin")
          assert.equal(
            await script(`document.documentElement.dataset.desktopPlatform === "mac"
              && document.querySelector(".od-menu-toggle").getBoundingClientRect().left >= 88
              && document.querySelector(".od-search-trigger").getBoundingClientRect().left >
                document.querySelector(".od-menu-toggle").getBoundingClientRect().right`),
            true,
          );
        const deadline = Date.now() + 5_000;
        while (
          !(await script(
            'document.querySelectorAll(".od-document .pe-grip").length >= 6',
          ))
        ) {
          if (Date.now() > deadline)
            throw new Error("Block fixture did not render");
          await pause();
        }
        const marked = () =>
          script(`[...document.querySelectorAll(".pe-block-selected")]
            .map((block) => block.querySelector("[data-object-title]")?.firstChild?.textContent ?? block.textContent.replaceAll("⠿", ""))`);
        const point = async (/** @type {number} */ index, list = false) => {
          /** @type {unknown} */
          const result = await script(`(() => {
            const grip = document.querySelectorAll(".od-document ${list ? "li " : ""}.pe-grip")[${index}];
            const rect = grip.getBoundingClientRect();
            return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
          })()`);
          return /** @type {{ x: number, y: number }} */ (result);
        };
        const [first, last] = await Promise.all([point(0), point(2)]);
        const mouse = (
          /** @type {"mouseDown" | "mouseUp" | "mouseMove"} */ type,
          /** @type {{ x: number, y: number }} */ position,
          /** @type {boolean} */ shift = false,
        ) =>
          webContents.sendInputEvent({
            type,
            ...position,
            button: "left",
            clickCount: 1,
            modifiers:
              type === "mouseMove"
                ? ["leftbuttondown"]
                : shift
                  ? ["shift"]
                  : [],
          });
        const key = (
          /** @type {string} */ keyCode,
          /** @type {boolean} */ shift = false,
        ) =>
          webContents.sendInputEvent({
            type: "keyDown",
            keyCode,
            modifiers: shift ? ["shift"] : [],
          });
        mouse("mouseDown", first);
        mouse("mouseUp", first);
        key("Down", true);
        key("Down", true);
        await pause();
        assert.deepEqual(await marked(), ["First", "Between", "Last"]);
        key("Up", true);
        await pause();
        assert.deepEqual(await marked(), ["First", "Between"]);
        mouse("mouseDown", last, true);
        mouse("mouseUp", last, true);
        await pause();
        assert.deepEqual(await marked(), ["First", "Between", "Last"]);

        mouse("mouseDown", last);
        mouse("mouseMove", { ...first, y: first.y - 5 });
        await pause();
        assert.equal(
          await script(
            'document.querySelector(".pe-editor").hasAttribute("data-drop")',
          ),
          true,
        );
        mouse("mouseUp", { ...first, y: first.y - 5 });
        await pause();
        assert.deepEqual(
          await script(
            '[...document.querySelectorAll("[data-object-title]")].map((row) => row.firstChild.textContent)',
          ),
          ["Last", "First"],
        );
        const moved = await point(0);
        const afterBetween = await point(2);
        mouse("mouseDown", moved);
        mouse("mouseMove", { ...afterBetween, y: afterBetween.y + 6 });
        mouse("mouseUp", { ...afterBetween, y: afterBetween.y + 6 });
        await pause();
        assert.deepEqual(
          await script(
            '[...document.querySelectorAll("[data-object-title]")].map((row) => row.firstChild.textContent)',
          ),
          ["First", "Last"],
        );
        const gutterX = Number(
          await script(
            'Math.round(document.querySelector(".od-document .pe-select-gutter").getBoundingClientRect().left + 6)',
          ),
        );
        const [rangeStart, rangeEnd] = await Promise.all([point(0), point(2)]);
        assert.equal(
          await script(
            `document.elementFromPoint(${gutterX}, ${rangeStart.y})?.classList.contains("pe-select-gutter")`,
          ),
          true,
        );
        mouse("mouseDown", { x: gutterX, y: rangeStart.y });
        mouse("mouseMove", { x: rangeEnd.x + 60, y: rangeEnd.y });
        await pause();
        assert.equal(
          await script('document.querySelector(".pe-selection-box") !== null'),
          true,
        );
        mouse("mouseUp", { x: rangeEnd.x + 60, y: rangeEnd.y });
        await pause();
        assert.deepEqual(await marked(), ["First", "Between", "Last"]);
        /** @type {unknown} */
        const copied = await script(`(() => {
          const clipboardData = new DataTransfer();
          document.querySelector(".tiptap").dispatchEvent(new ClipboardEvent("copy", {
            bubbles: true, cancelable: true, clipboardData,
          }));
          return clipboardData.getData("text/html");
        })()`);
        assert.match(String(copied), /First.*Between.*Last/s);
        assert.doesNotMatch(String(copied), /Keep/);
        key("Backspace");
        await pause();
        assert.deepEqual(await marked(), []);
        assert.equal(
          await script(
            `document.querySelector(".tiptap p").textContent.replaceAll("⠿", "")`,
          ),
          "Keep",
        );
        assert.equal(
          await script(`document.querySelectorAll(".pe-object").length`),
          0,
        );

        const listStart = await point(0, true);
        const listEnd = await point(1, true);
        const listTextX = Number(
          await script(
            'Math.round(document.querySelector(".od-document li p").getBoundingClientRect().left + 6)',
          ),
        );
        assert.equal(
          await script(`(() => {
          const row = document.querySelector(".od-document li p");
          const grip = row.querySelector(".pe-grip").getBoundingClientRect();
          return grip.right < row.getBoundingClientRect().left;
        })()`),
          true,
        );
        mouse("mouseDown", { x: listTextX, y: listStart.y });
        mouse("mouseUp", { x: listTextX, y: listStart.y });
        await pause();
        assert.equal(
          await script("getSelection().anchorNode?.textContent"),
          "One",
        );
        key("Escape");
        await pause();
        assert.deepEqual(await marked(), ["One"]);
        mouse("mouseDown", listEnd);
        mouse("mouseMove", { ...listStart, y: listStart.y - 5 });
        mouse("mouseUp", { ...listStart, y: listStart.y - 5 });
        await pause();
        assert.deepEqual(
          await script(
            '[...document.querySelectorAll(".od-document .tiptap li")].map((row) => row.textContent.replaceAll("⠿", ""))',
          ),
          ["Two", "One"],
        );
        webContents.debugger.attach("1.3");
        await webContents.debugger.sendCommand(
          "Emulation.setTouchEmulationEnabled",
          { enabled: true },
        );
        const one = await point(0, true);
        const two = await point(1, true);
        const touch = (
          /** @type {string} */ type,
          /** @type {{ x: number, y: number }[]} */ touchPoints,
        ) =>
          webContents.debugger.sendCommand("Input.dispatchTouchEvent", {
            type,
            touchPoints,
          });
        await touch("touchStart", [one]);
        await touch("touchEnd", []);
        await touch("touchStart", [two]);
        await touch("touchEnd", []);
        assert.deepEqual(await marked(), ["Two", "One"]);
        webContents.debugger.detach();

        const waitFor = async (/** @type {string} */ condition) => {
          const until = Date.now() + 4_000;
          while (!(await script(condition))) {
            if (Date.now() >= until)
              throw new Error(
                `The renderer did not meet this condition: ${condition}`,
              );
            await pause();
          }
        };
        await waitFor(
          '!!document.querySelector(".od-embedded-view input[aria-label=Title]")',
        );
        assert.equal(
          await script(`["並べ替え", "絞り込み"].every(label =>
          document.querySelector('.od-embedded-view button[aria-label="' + label + '"]')
        )`),
          true,
        );
        await script(`(() => {
          const field = document.querySelector(".od-embedded-view input[value='Editable View row']");
          field.focus();
          field.select();
        })()`);
        await webContents.insertText("Edited View row");
        await script("document.activeElement.blur()");
        await waitFor(
          'window.pkm.searchObjects("Edited View row").then((rows) => rows[0]?.id === "view-smoke-row")',
        );

        await script(`[...document.querySelectorAll(".od-embedded-view .od-view-tabs > button")]
          .find((button) => button.textContent === "View smoke timeline").click()`);
        await waitFor(
          'document.querySelector(".od-embedded-view .od-timeline")?.textContent.includes("Edited View row")',
        );
        await script(
          'document.querySelector(".od-topbar > div:first-child .od-search-trigger").click()',
        );
        assert.equal(
          await script(
            'document.activeElement.matches(".od-search-dialog input")',
          ),
          true,
        );
        await webContents.insertText("本文だけの照合語");
        await waitFor(
          'document.querySelector(".od-search-excerpt")?.textContent.includes("本文だけの照合語")',
        );
        key("Return");
        await waitFor(
          'document.querySelector(".od-page-title")?.value === "Edited View row"',
        );
        await waitFor(
          'document.querySelector(".od-document .tiptap p")?.textContent.includes("本文だけの照合語")',
        );
        await script(`(() => {
          const editor = document.querySelector(".od-document .tiptap");
          const paragraph = editor.querySelector("p");
          editor.focus();
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          range.collapse(false);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
        })()`);
        await webContents.insertText(" @");
        await waitFor('!!document.querySelector(".pe-menu[role=listbox]")');
        const caret = () =>
          script(`(() => {
          const selection = getSelection();
          const paragraph = document.querySelector(".od-document .tiptap p");
          if (!selection?.isCollapsed || !paragraph.contains(selection.anchorNode)) return null;
          const before = document.createRange();
          before.setStart(paragraph, 0);
          before.setEnd(selection.anchorNode, selection.anchorOffset);
          return before.toString();
        })()`);
        /** @type {unknown} */
        const beforeEscape = await caret();
        assert.match(String(beforeEscape), / @$/);
        key("Escape");
        await waitFor('!document.querySelector(".pe-menu[role=listbox]")');
        assert.equal(
          await script(
            'document.activeElement.matches(".od-document .tiptap")',
          ),
          true,
        );
        assert.equal(await caret(), beforeEscape);
        await script(
          "document.querySelector('button[aria-label=\"Memoを書く\"]').click()",
        );
        await waitFor('!!document.querySelector(".od-capture-body .tiptap p")');
        assert.equal(
          await script(`(() => {
            const title = document.querySelector(".od-capture-title");
            const body = document.querySelector(".od-capture-body .tiptap p");
            const titleStart = title.getBoundingClientRect().left +
              parseFloat(getComputedStyle(title).paddingInlineStart);
            return Math.abs(titleStart - body.getBoundingClientRect().left) < 1;
          })()`),
          true,
        );
        await script(`[...document.querySelectorAll(".od-capture .od-dialog-actions button")]
          .find((button) => button.textContent === "キャンセル").click()`);
        await script('document.querySelector(".od-search-trigger").click()');
        await waitFor(
          'document.activeElement.matches(".od-search-dialog input") && document.activeElement.value === ""',
        );
        await webContents.insertText("#Task");
        await waitFor(
          'document.querySelector(".od-search-results [aria-selected=true]")?.textContent.includes("種別")',
        );
        key("Return");
        await waitFor(
          'document.querySelector("h1")?.textContent.includes("#Task")',
        );
      } else if (phase === "remote") {
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
            // 保存先は設定の窓に出る。開いて確かめ、閉じておく。
            `(() => {
              document.querySelector(".od-nav-settings")?.click();
              const applied = document.body.innerText.includes(${JSON.stringify(`${host}へ保存`)});
              [...document.querySelectorAll(".od-dialog-actions button")]
                .find((button) => button.textContent === "閉じる")?.click();
              return applied;
            })()`,
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
