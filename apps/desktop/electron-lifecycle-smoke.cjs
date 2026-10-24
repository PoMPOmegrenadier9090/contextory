// Run with node electron-lifecycle-smoke.cjs after building and rebuilding
// better-sqlite3 for Electron. Uses a temporary Vault and userData directory.
/* global __dirname, __filename */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { setTimeout } = require("node:timers");
const process = require("node:process");
const { pathToFileURL } = require("node:url");
const electron = require("electron");

if (typeof electron === "string") {
  const root = mkdtempSync(path.join(tmpdir(), "pkm-lifecycle-smoke-"));
  try {
    const vaultRoot = path.join(root, "vault");
    cpSync(path.join(__dirname, "../../fixtures/vault-v1"), vaultRoot, {
      recursive: true,
    });
    writeFileSync(
      path.join(root, "vault-preferences.json"),
      JSON.stringify({ lastVaultRoot: vaultRoot }),
    );
    for (const phase of [
      "navigation",
      "resource-body",
      "cancel-and-reopen",
      "restart",
    ])
      execFileSync(electron, [__filename, root, phase], {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "",
          PKM_ELECTRON_SMOKE: "0",
          PKM_DESKTOP_MCP_ENABLED: "0",
          PKM_RENDERER_URL: undefined,
        },
        stdio: "inherit",
        timeout: phase === "resource-body" ? 30_000 : 20_000,
      });
    console.log(
      "Electron lifecycle smoke passed: navigation, cancelled quit, reopen, restart",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} else {
  const { app, BrowserWindow, Menu, protocol } = electron;
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
  const waitForVault = async (window) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (
        await window.webContents.executeJavaScript(
          "document.querySelector('[aria-label=\"設定\"]')?.closest('[inert]') === null",
        )
      ) {
        /** @type {unknown} */
        const count = await window.webContents.executeJavaScript(
          "window.pkm.listEntities().then(entities => entities.length)",
        );
        assert.equal(count, 6);
        return;
      }
      await pause();
    }
    throw new Error("Vault was not restored in the renderer");
  };
  /** @param {import("electron").BrowserWindow} window */
  const assertAppearance = async (window) => {
    const script = `document.documentElement.dataset.mantineColorScheme === "dark"
      && document.documentElement.style.getPropertyValue("--pkm-body-font-size") === "20px"
      && document.documentElement.dataset.pkmHeadingColors === "true"
      && document.documentElement.dataset.pkmCompactHeadings === "true"`;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await window.webContents.executeJavaScript(script)) break;
      await pause();
    }
    assert.equal(
      await window.webContents.executeJavaScript(script),
      true,
      "Appearance settings were not restored",
    );
  };
  app
    .whenReady()
    .then(async () => {
      await import(
        pathToFileURL(path.join(__dirname, "dist/electron-main.js")).href
      );
      let window = BrowserWindow.getAllWindows()[0];
      await waitForVault(window);
      if (phase === "resource-body") {
        const resourceId = "res_01997c2a-7b1c-7a01-8a10-000000000005";
        const resourcePath = path.join(
          root,
          "vault",
          "resources",
          resourceId + ".md",
        );
        const memo = "# 資料の全般メモ\nDesktopで追記した内容\n";
        /** @param {() => boolean | Promise<boolean>} check */
        const wait = async (check) => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            if (await check()) return;
            await pause();
          }
          throw Error("Resource body smoke timed out: " + check.toString());
        };
        /** @param {import("electron").BrowserWindow} target @param {string} group @param {string} label @returns {Promise<unknown>} */
        const select = (target, group, label) =>
          target.webContents.executeJavaScript(`{
          const control = document.querySelector('[aria-label="${group}"]');
          [...control.querySelectorAll('label')].find(label => label.textContent === ${JSON.stringify(label)}).click();
        }`);
        /** @param {import("electron").BrowserWindow} target @param {string} editor */
        const openBody = async (target, editor) => {
          await wait(() =>
            target.webContents.executeJavaScript(
              `document.querySelector('.entity-body-section') !== null`,
            ),
          );
          assert.equal(
            await target.webContents.executeJavaScript(`{
              const section = document.querySelector('.entity-body-section');
              !section.open && !${editor}.checkVisibility() && !!(section.compareDocumentPosition(document.querySelector('.backlinks-panel')) & Node.DOCUMENT_POSITION_FOLLOWING);
            }`),
            true,
          );
          await target.webContents.executeJavaScript(
            `document.querySelector('.entity-body-section > summary').click()`,
          );
          await wait(() =>
            target.webContents.executeJavaScript(
              `document.querySelector('.entity-body-section').open && ${editor}.checkVisibility()`,
            ),
          );
        };
        /** @param {import("electron").BrowserWindow} target @param {string} editor */
        const checkBodyDisclosure = async (target, editor) => {
          assert.equal(
            await target.webContents.executeJavaScript(`
            [...document.querySelectorAll('.mantine-Accordion-control')].filter(button => button.textContent.startsWith('プロパティ')).every(button => button.getAttribute('aria-expanded') === 'false')
          `),
            true,
          );
          assert.equal(
            await target.webContents.executeJavaScript(`
            [...document.querySelectorAll('p')].some(element => element.textContent === '全般メモ')
          `),
            false,
          );
          assert.equal(
            await target.webContents.executeJavaScript(
              `document.querySelector('.entity-body-section').open && ${editor}.checkVisibility()`,
            ),
            true,
          );
          assert.equal(
            await target.webContents.executeJavaScript(`{
              const section = document.querySelector('.entity-body-section').getBoundingClientRect();
              const content = document.querySelector('.entity-body-section-content').getBoundingClientRect();
              content.width >= section.width - 2;
            }`),
            true,
          );
          /** @type {unknown} */
          const before = await target.webContents.executeJavaScript(
            `${editor}.textContent`,
          );
          await target.webContents.executeJavaScript(
            `document.querySelector('.entity-body-section > summary').click()`,
          );
          await wait(() =>
            target.webContents.executeJavaScript(
              `!document.querySelector('.entity-body-section').open && !${editor}.checkVisibility()`,
            ),
          );
          assert.equal(
            await target.webContents.executeJavaScript(`${editor}.textContent`),
            before,
          );
          await target.webContents.executeJavaScript(
            `document.querySelector('.entity-body-section > summary').click()`,
          );
          await wait(() =>
            target.webContents.executeJavaScript(
              `document.querySelector('.entity-body-section').open && ${editor}.checkVisibility()`,
            ),
          );
          assert.equal(
            await target.webContents.executeJavaScript(`${editor}.textContent`),
            before,
          );
        };
        await window.webContents.executeJavaScript(`
          [...document.querySelectorAll('.sidebar-collection-button')].find(button => button.textContent.startsWith('Resources')).click();
        `);
        await wait(() =>
          window.webContents.executeJavaScript(
            `document.querySelector('[data-open-entity="${resourceId}"]') !== null`,
          ),
        );
        await window.webContents.executeJavaScript(
          `document.querySelector('[data-open-entity="${resourceId}"]').click()`,
        );
        const desktopEditor = `document.querySelector('[aria-label="Resource本文エディタ"] .cm-content')`;
        await openBody(window, desktopEditor);
        await wait(() =>
          window.webContents.executeJavaScript(`${desktopEditor} !== null`),
        );
        await window.webContents.executeJavaScript(`${desktopEditor}.focus()`);
        await window.webContents.insertText(memo);
        await checkBodyDisclosure(window, desktopEditor);
        await wait(() =>
          readFileSync(resourcePath, "utf8").includes("Desktopで追記した内容"),
        );
        await select(window, "Frontmatter編集モード", "Raw Markdown");
        await wait(() =>
          window.webContents.executeJavaScript(
            `document.querySelector('[aria-label="Resource Raw Markdownエディタ"]')?.value.includes('Desktopで追記した内容')`,
          ),
        );
        await select(window, "Frontmatter編集モード", "フォーム");
        await wait(() =>
          window.webContents.executeJavaScript(
            `${desktopEditor}?.textContent.includes('Desktopで追記した内容')`,
          ),
        );
        assert.equal(
          await window.webContents.executeJavaScript(
            `document.querySelector('.entity-editor-shell').textContent.includes('Entries')`,
          ),
          true,
        );

        const { openServerApp } = await import("../server/dist/http-api.js");
        const server = await openServerApp(path.join(root, "vault"), {
          webRoot: path.join(__dirname, "../web/dist-web"),
          vault: { watch: false },
        });
        const address = await server.listen({ host: "127.0.0.1", port: 0 });
        const webWindow = new BrowserWindow({
          show: true,
          webPreferences: { backgroundThrottling: false },
        });
        try {
          await webWindow.loadURL(address + "/?entity=" + resourceId);
          webWindow.focus();
          webWindow.webContents.focus();
          const webEditor = `document.querySelector('[aria-label="Resource Markdown Live Previewエディタ"] .cm-content')`;
          await openBody(webWindow, webEditor);
          await wait(() =>
            webWindow.webContents.executeJavaScript(
              `${webEditor}?.textContent.includes('Desktopで追記した内容')`,
            ),
          );
          await webWindow.webContents.executeJavaScript(`${webEditor}.focus()`);
          await webWindow.webContents.insertText("Webの未保存メモ\n");
          await checkBodyDisclosure(webWindow, webEditor);
          await webWindow.webContents.executeJavaScript(`
            const properties = [...document.querySelectorAll('.mantine-Accordion-control')].find(button => button.textContent === 'プロパティ');
            if (properties.getAttribute('aria-expanded') !== 'true') properties.click();
          `);
          await webWindow.webContents.executeJavaScript(`{
            const label = [...document.querySelectorAll('label')].find(label => label.textContent === '説明');
            document.getElementById(label.htmlFor).focus();
          }`);
          await webWindow.webContents.insertText("Webで編集した説明");
          await pause();
          await webWindow.webContents.executeJavaScript(
            `document.activeElement.blur()`,
          );
          await wait(() =>
            webWindow.webContents.executeJavaScript(
              `document.querySelector('.markdown-live-editor .cm-content')?.textContent.includes('Webの未保存メモ')`,
            ),
          );
          await pause();
          await select(webWindow, "Resource表示モード", "Raw");
          await wait(() =>
            webWindow.webContents.executeJavaScript(
              `document.querySelector('[aria-label="Resource Raw Markdownエディタ"]')?.value.includes('Webで編集した説明')`,
            ),
          );
          await webWindow.webContents.executeJavaScript(
            `window.dispatchEvent(new KeyboardEvent('keydown', {key:'s', metaKey:${process.platform === "darwin"}, ctrlKey:${process.platform !== "darwin"}, bubbles:true, cancelable:true}))`,
          );
          await wait(() => {
            const saved = readFileSync(resourcePath, "utf8");
            return (
              saved.includes("Webの未保存メモ") &&
              saved.includes("Webで編集した説明") &&
              saved.includes("Desktopで追記した内容")
            );
          });
          await select(webWindow, "Resource表示モード", "Live編集");
          await webWindow.loadURL(webWindow.webContents.getURL());
          await openBody(webWindow, webEditor);
          await wait(() =>
            webWindow.webContents.executeJavaScript(
              `${webEditor}?.textContent.includes('Webの未保存メモ')`,
            ),
          );
          assert.equal(
            readdirSync(path.join(root, "vault", "entries")).filter(
              (name) => name.endsWith(".md") && !name.includes("sync-conflict"),
            ).length,
            1,
          );
          console.log(
            "Resource body smoke passed: collapsed properties, body disclosure and draft preservation, Desktop autosave/raw, Web Save and reload",
          );
        } finally {
          webWindow.destroy();
          await server.close();
        }
        app.quit();
        return;
      }
      if (phase === "navigation") {
        assert.equal(
          await window.webContents.executeJavaScript(
            'window.pkm.linkPreview("http://127.0.0.1/private").then(preview => preview === null)',
          ),
          true,
        );
        const projectId = "prj_01997c2a-7b1c-7a01-8a10-000000000003";
        const taskId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
        const resourceId = "res_01997c2a-7b1c-7a01-8a10-000000000005";
        const visible = `(element) => element.getClientRects().length > 0`;
        const activeEditor = `[...document.querySelectorAll('.entity-editor-shell')].find(${visible})`;
        const activeTitle = `(${activeEditor})?.querySelector('.entity-detail-identity')?.textContent`;
        const tabCount = `document.querySelectorAll('.page-tab-strip [role="tab"]').length`;
        const back = `document.querySelector('[aria-label="前のEntityへ戻る"]')`;
        const forward = `document.querySelector('[aria-label="次のEntityへ進む"]')`;
        const resources = `[...document.querySelectorAll('.sidebar-collection-button')].find(button => button.textContent.startsWith("Resources"))`;
        /** @param {string} script */
        const wait = async (script) => {
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            if (await window.webContents.executeJavaScript(script)) return;
            await pause();
          }
          throw Error(`Navigation smoke timed out: ${script}`);
        };
        const clickEntity = async (id, newTab = false) => {
          await window.webContents.executeJavaScript(`{
            const button = [...document.querySelectorAll('[data-open-entity="${id}"]')].find(${visible});
            if (!button) throw Error("Missing Entity link: ${id}");
            button.dispatchEvent(new MouseEvent("click", {bubbles:true, cancelable:true, metaKey:${newTab && process.platform === "darwin"}, ctrlKey:${newTab && process.platform !== "darwin"}}));
          }`);
        };
        await clickEntity(projectId);
        await wait(`${activeTitle}?.includes("PKM開発")`);
        assert.equal(await window.webContents.executeJavaScript(tabCount), 1);
        assert.equal(
          await window.webContents.executeJavaScript(`(() => {
          const identity = (${activeEditor}).querySelector('.entity-detail-identity');
          const title = identity.querySelector('.mantine-Text-root').getBoundingClientRect();
          const status = identity.querySelector('.entity-status-label').getBoundingClientRect();
          return status.left - title.right < 24 && Math.abs((title.top + title.bottom) / 2 - (status.top + status.bottom) / 2) < 2;
        })()`),
          true,
          "Status belongs next to the title on the same center line",
        );
        await window.webContents.executeJavaScript(`(${resources}).click()`);
        await wait(
          `document.querySelector('.entity-collection-view')?.textContent.includes("Resources")`,
        );
        assert.equal(await window.webContents.executeJavaScript(tabCount), 2);
        await clickEntity(resourceId);
        await wait(`${activeTitle}?.includes("PKM設計資料")`);
        assert.equal(await window.webContents.executeJavaScript(tabCount), 2);
        await window.webContents.executeJavaScript(`(${back}).click()`);
        await wait(
          `document.querySelector('.entity-collection-view')?.textContent.includes("Resources")`,
        );
        await window.webContents.executeJavaScript(`(${resources}).click()`);
        await pause();
        assert.equal(await window.webContents.executeJavaScript(tabCount), 2);
        await window.webContents.executeJavaScript(
          `[...document.querySelectorAll('.page-tab-strip [role="tab"]')].find(tab => tab.textContent.includes("PKM開発")).click()`,
        );
        await wait(`${activeTitle}?.includes("PKM開発")`);
        await clickEntity(taskId);
        await wait(`${activeTitle}?.includes("Markdown parser")`);
        assert.equal(await window.webContents.executeJavaScript(tabCount), 2);
        await window.webContents.executeJavaScript(`(${back}).click()`);
        await wait(`${activeTitle}?.includes("PKM開発")`);
        await window.webContents.executeJavaScript(`(${back}).click()`);
        await wait(`document.querySelector('.hierarchy-view') !== null`);
        await window.webContents.executeJavaScript(`(${forward}).click()`);
        await wait(`${activeTitle}?.includes("PKM開発")`);
        await clickEntity(taskId, true);
        await wait(`${tabCount} === 3`);
        await window.webContents.executeJavaScript(
          `[...document.querySelectorAll('.page-tab-strip [role="tab"]')].find(tab => tab.textContent.includes("Markdown parser")).click()`,
        );
        await wait(`${activeTitle}?.includes("Markdown parser")`);
        await clickEntity(projectId);
        await wait(`${activeTitle}?.includes("PKM開発")`);
        assert.equal(await window.webContents.executeJavaScript(tabCount), 3);
        await window.webContents.executeJavaScript(`(${back}).click()`);
        await wait(`${activeTitle}?.includes("Markdown parser")`);
        await window.webContents.executeJavaScript(`(${forward}).click()`);
        await wait(`${activeTitle}?.includes("PKM開発")`);
        const openCapture = () =>
          window.webContents.executeJavaScript(
            `window.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", shiftKey:true, metaKey:${process.platform === "darwin"}, ctrlKey:${process.platform !== "darwin"}, bubbles:true, cancelable:true}))`,
          );
        await openCapture();
        const editor = `document.querySelector('.quick-capture-dialog .cm-content')`;
        await wait(
          `Boolean(${editor}) && document.activeElement === ${editor}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(
          await window.webContents.executeJavaScript(
            `document.activeElement === ${editor}`,
          ),
          true,
        );
        const context = `document.querySelector('.quick-capture-dialog [aria-label="Contextを切り替え"]')`;
        assert.equal(
          await window.webContents.executeJavaScript(
            `(${context}).textContent.includes("PKM開発") && (${context}).getAttribute('aria-pressed') === 'true'`,
          ),
          true,
        );
        await window.webContents.executeJavaScript(`(${context}).click()`);
        await wait(`(${context}).getAttribute('aria-pressed') === 'false'`);
        assert.equal(
          await window.webContents.executeJavaScript(
            `(${context}).textContent.includes("PKM開発")`,
          ),
          true,
        );
        window.focus();
        window.webContents.focus();
        window.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Escape",
        });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
        await wait(
          `[...document.querySelectorAll('[role="dialog"]')].every(element => element.getClientRects().length === 0)`,
        );
        await openCapture();
        await wait(
          `(${context}).getAttribute('aria-pressed') === 'true' && document.activeElement === ${editor}`,
        );
        console.log(
          "Desktop navigation and contextual capture smoke passed: sidebar tabs, same-tab history, existing tabs, Cmd-click, focus",
        );
        app.quit();
        return;
      }
      if (phase === "restart") await assertAppearance(window);
      if (phase === "cancel-and-reopen") {
        assert.equal(
          await window.webContents.executeJavaScript(`(async () => {
          const dataBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIl8AAAAASUVORK5CYII=";
          const asset = await window.pkm.createAsset({ fileName: "clipboard.png", dataBase64 });
          const image = await window.pkm.readImage(asset.path);
          if (image.mimeType !== "image/png" || image.dataBase64 !== dataBase64) return false;
          const file = await window.pkm.createAsset({ fileName: "clipboard.txt", dataBase64: btoa("text") });
          for (const path of [file.path, "../vault.yaml"]) {
            try { await window.pkm.readImage(path); return false; } catch { /* rejected */ }
          }
          return true;
        })()`),
          true,
          "Image IPC must return image bytes and reject files and unsafe paths",
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        // Exercise the actual Desktop command wiring against the temporary Vault.
        await window.webContents.executeJavaScript(
          `window.dispatchEvent(new KeyboardEvent("keydown", { key: ",", metaKey: ${process.platform === "darwin"}, ctrlKey: ${process.platform !== "darwin"}, bubbles: true, cancelable: true }))`,
        );
        await pause();
        /** @type {unknown} */
        const settings = await window.webContents.executeJavaScript(
          `({ rows: document.querySelectorAll(".shortcut-setting-row").length, vaultCategory: [...document.querySelectorAll('[role="dialog"]')].some(element => element.getClientRects().length > 0 && element.textContent?.includes("Vault・同期")) })`,
        );
        assert.ok(
          typeof settings === "object" &&
            settings !== null &&
            "rows" in settings &&
            typeof settings.rows === "number" &&
            settings.rows > 0,
          JSON.stringify(settings),
        );
        assert.ok("vaultCategory" in settings);
        assert.equal(settings.vaultCategory, true);
        assert.deepEqual(
          await window.webContents.executeJavaScript(
            "window.pkm.listUnresolvedReferences()",
          ),
          [],
        );
        await window.webContents.executeJavaScript(
          `[...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === "参照切れ").click()`,
        );
        const referenceDeadline = Date.now() + 3000;
        while (Date.now() < referenceDeadline) {
          if (
            await window.webContents.executeJavaScript(
              `document.body.textContent.includes("参照切れはありません。")`,
            )
          )
            break;
          await pause();
        }
        assert.equal(
          await window.webContents.executeJavaScript(
            `document.body.textContent.includes("参照切れはありません。")`,
          ),
          true,
        );
        assert.equal(
          await window.webContents.executeJavaScript(
            `document.querySelector('.sidebar-trash-button') === null`,
          ),
          true,
        );
        assert.equal(
          await window.webContents.executeJavaScript(`(async () => {
          const entry = await window.pkm.loadEntity("ent_01997c2a-7b1c-7a01-8a10-000000000006");
          const result = await window.pkm.saveEntity({entityId: entry.entity.id, content: entry.content.replace("deleted_at: null", "deleted_at: 2026-10-18T00:00:00Z"), expectedFileHash: entry.fileHash});
          return result.ok;
        })()`),
          true,
        );
        await window.webContents.executeJavaScript(
          `[...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === "ゴミ箱").click()`,
        );
        const restoreButton = `[...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "復元")`;
        const trashDeadline = Date.now() + 3000;
        while (Date.now() < trashDeadline) {
          if (
            await window.webContents.executeJavaScript(
              `Boolean(${restoreButton})`,
            )
          )
            break;
          await pause();
        }
        assert.equal(
          await window.webContents.executeJavaScript(
            `Boolean(${restoreButton})`,
          ),
          true,
        );
        await window.webContents.executeJavaScript(
          `(${restoreButton}).click()`,
        );
        const restoreDeadline = Date.now() + 3000;
        while (Date.now() < restoreDeadline) {
          if (
            await window.webContents.executeJavaScript(
              `document.body.textContent.includes("削除済みEntityはありません。")`,
            )
          )
            break;
          await pause();
        }
        assert.equal(
          await window.webContents.executeJavaScript(
            `document.body.textContent.includes("削除済みEntityはありません。") && [...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.getClientRects().length > 0 && dialog.textContent.includes("ゴミ箱"))`,
          ),
          true,
        );
        assert.equal(
          await window.webContents.executeJavaScript(
            `window.pkm.loadEntity("ent_01997c2a-7b1c-7a01-8a10-000000000006").then(document => document.entity.deletedAt)`,
          ),
          null,
        );
        /** @type {unknown} */
        const permanentFixture = await window.webContents
          .executeJavaScript(`(async () => {
          const asset = await window.pkm.createAsset({fileName:"retain.txt",dataBase64:btoa("retain asset")});
          const entry = await window.pkm.createEntity({type:"entry",displayName:"完全削除の確認",body:"[retain](" + asset.path + ")",metadata:{deletedAt:"2026-10-18T00:00:00Z"}});
          const trashed = await window.pkm.loadEntity(entry.entity.id);
          await window.pkm.saveDraft({entityId:entry.entity.id,content:trashed.content,baseHash:trashed.fileHash});
          return {entityPath:entry.entity.path,assetPath:asset.path};
        })()`);
        assert.ok(
          permanentFixture &&
            typeof permanentFixture === "object" &&
            "entityPath" in permanentFixture &&
            typeof permanentFixture.entityPath === "string" &&
            "assetPath" in permanentFixture &&
            typeof permanentFixture.assetPath === "string",
        );
        await window.webContents.executeJavaScript(
          `document.querySelector('[aria-label="一覧を更新"]').click()`,
        );
        const deleteButton = `[...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "完全に削除")`;
        const deleteDeadline = Date.now() + 3000;
        while (Date.now() < deleteDeadline) {
          if (
            await window.webContents.executeJavaScript(
              `Boolean(${deleteButton})`,
            )
          )
            break;
          await pause();
        }
        assert.equal(
          await window.webContents.executeJavaScript(
            `Boolean(${deleteButton})`,
          ),
          true,
        );
        await window.webContents.executeJavaScript(`(${deleteButton}).click()`);
        const confirmButton = `[...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "完全に削除する")`;
        const confirmDeadline = Date.now() + 3000;
        while (Date.now() < confirmDeadline) {
          if (
            await window.webContents.executeJavaScript(
              `Boolean(${confirmButton})`,
            )
          )
            break;
          await pause();
        }
        assert.equal(
          existsSync(path.join(root, "vault", permanentFixture.entityPath)),
          true,
        );
        assert.equal(
          await window.webContents.executeJavaScript(
            `Boolean(${confirmButton})`,
          ),
          true,
        );
        await window.webContents.executeJavaScript(
          `(${confirmButton}).click()`,
        );
        const removedDeadline = Date.now() + 3000;
        while (
          Date.now() < removedDeadline &&
          existsSync(path.join(root, "vault", permanentFixture.entityPath))
        )
          await pause();
        assert.equal(
          existsSync(path.join(root, "vault", permanentFixture.entityPath)),
          false,
        );
        assert.equal(
          readFileSync(
            path.join(root, "vault", permanentFixture.assetPath),
            "utf8",
          ),
          "retain asset",
        );
        const confirmationClosed = Date.now() + 3000;
        while (Date.now() < confirmationClosed) {
          if (await window.webContents.executeJavaScript(`!(${confirmButton})`))
            break;
          await pause();
        }
        assert.equal(
          await window.webContents.executeJavaScript(
            `!(${confirmButton}) && document.body.textContent.includes("削除済みEntityはありません。")`,
          ),
          true,
        );
        await window.webContents.executeJavaScript(`
          globalThis.settingsDialogBefore = [...document.querySelectorAll('[role="dialog"]')].find(element => element.getClientRects().length > 0);
          [...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === "Vault・同期").click();
        `);
        await pause();
        assert.equal(
          await window.webContents.executeJavaScript(`
          globalThis.settingsDialogBefore === [...document.querySelectorAll('[role="dialog"]')].find(element => element.getClientRects().length > 0)
          && [...document.querySelectorAll('[role="dialog"]')].filter(element => element.getClientRects().length > 0).length === 1
          && globalThis.settingsDialogBefore.textContent.includes("Vaultの場所")
          && globalThis.settingsDialogBefore.textContent.includes("この端末のSyncthing")
          && !globalThis.settingsDialogBefore.textContent.includes("Vault・同期設定を開く")
          && document.querySelector('input[type="password"]') !== null
        `),
          true,
        );
        await window.webContents.executeJavaScript(`
          const input = document.querySelector('input[type="password"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "fixture-key");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        `);
        await pause();
        await window.webContents.executeJavaScript(
          `[...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === "ショートカット").click()`,
        );
        await pause();
        assert.equal(
          await window.webContents.executeJavaScript(
            `document.querySelector('input[type="password"]') === null`,
          ),
          true,
        );
        await window.webContents.executeJavaScript(
          `[...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === "Vault・同期").click()`,
        );
        await pause();
        assert.equal(
          await window.webContents.executeJavaScript(
            `document.querySelector('input[type="password"]').value`,
          ),
          "",
        );
        if (process.env.PKM_SETTINGS_CAPTURE === "1") {
          const capture = path.join(tmpdir(), "pkms-vault-settings.png");
          writeFileSync(
            capture,
            (await window.webContents.capturePage()).toPNG(),
          );
          console.log(`Vault settings screenshot: ${capture}`);
        }
        await window.webContents.executeJavaScript(
          `[...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === "外観").click()`,
        );
        await pause();
        await window.webContents.executeJavaScript(`
          document.querySelector('input[value="dark"]').click();
          document.querySelector('#appearance-heading-colors').click();
          document.querySelector('#appearance-compact-headings').click();
          const appearanceInput = document.querySelector('#appearance-body-font-size');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(appearanceInput, "20");
          appearanceInput.dispatchEvent(new Event("input", { bubbles: true }));
        `);
        await assertAppearance(window);
        assert.notEqual(
          await window.webContents.executeJavaScript(
            `getComputedStyle(document.querySelector('.appearance-preview h1')).color`,
          ),
          await window.webContents.executeJavaScript(
            `getComputedStyle(document.querySelector('.appearance-preview h2')).color`,
          ),
          "Production heading colors must remain distinct after CSS minification",
        );
        if (process.env.PKM_APPEARANCE_CAPTURE === "1") {
          await new Promise((resolve) => setTimeout(resolve, 300));
          const capture = path.join(tmpdir(), "pkms-app-appearance.png");
          writeFileSync(
            capture,
            (await window.webContents.capturePage()).toPNG(),
          );
          console.log(`App appearance screenshot: ${capture}`);
        }
        window.focus();
        window.webContents.focus();
        window.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Escape",
        });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
        const closedDeadline = Date.now() + 5000;
        while (Date.now() < closedDeadline) {
          if (
            await window.webContents.executeJavaScript(
              `[...document.querySelectorAll('[role="dialog"]')].every(element => element.getClientRects().length === 0)`,
            )
          )
            break;
          await pause();
        }
        assert.equal(
          await window.webContents.executeJavaScript(
            `[...document.querySelectorAll('[role="dialog"]')].every(element => element.getClientRects().length === 0)`,
          ),
          true,
          "Settings Escape must close: " +
            (await window.webContents.executeJavaScript(
              `JSON.stringify([...document.querySelectorAll('[role="dialog"]')].map(element => ({visible:element.getClientRects().length > 0,text:element.textContent.slice(0,300)})))`,
            )),
        );
        for (const [key, expectedTabs] of [
          ["t", 2],
          ["w", 1],
        ]) {
          await window.webContents.executeJavaScript(
            `window.dispatchEvent(new KeyboardEvent("keydown", { key: "${key}", metaKey: ${process.platform === "darwin"}, ctrlKey: ${process.platform !== "darwin"}, bubbles: true, cancelable: true }))`,
          );
          await pause();
          assert.equal(
            await window.webContents.executeJavaScript(
              `document.querySelectorAll('.page-tab-strip [role="tab"]').length`,
            ),
            expectedTabs,
          );
        }

        window.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Enter",
          modifiers: [
            process.platform === "darwin" ? "meta" : "control",
            "shift",
          ],
        });
        window.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "Enter",
          modifiers: [
            process.platform === "darwin" ? "meta" : "control",
            "shift",
          ],
        });
        const pasteTarget = `[...document.querySelectorAll('[role="dialog"] .quick-capture-body-editor .cm-content')].find(element => element.getClientRects().length > 0)`;
        const pasteDeadline = Date.now() + 5000;
        while (Date.now() < pasteDeadline) {
          if (
            await window.webContents.executeJavaScript(
              `Boolean(${pasteTarget})`,
            )
          )
            break;
          await pause();
        }
        assert.equal(
          await window.webContents.executeJavaScript(`Boolean(${pasteTarget})`),
          true,
          "Quick Capture paste target must be visible: " +
            (await window.webContents.executeJavaScript(
              `JSON.stringify({dialogs: [...document.querySelectorAll('[role="dialog"]')].map(element => ({visible: element.getClientRects().length > 0, text: element.textContent.slice(0, 200)})), editors: document.querySelectorAll('.cm-content').length, body: document.body.innerText.slice(-1000)})`,
            )),
        );
        await window.webContents.executeJavaScript(`(async () => {
          localStorage.setItem("pkm:images:v1", JSON.stringify({webp:true,quality:85,maxDimension:320,defaultWidth:0,includeFiles:false}));
          const canvas = document.createElement("canvas");
          canvas.width = 1200; canvas.height = 800;
          const context = canvas.getContext("2d");
          context.fillStyle = "#e8f0ff"; context.fillRect(0, 0, 1200, 800);
          context.fillStyle = "#234"; context.font = "40px sans-serif";
          context.fillText("Clipboard WebP fixture 123", 40, 100);
          const blob = await new Promise(resolve => canvas.toBlob(resolve));
          const transfer = new DataTransfer();
          transfer.items.add(new File([blob], "paste-fixture.png", { type: "image/png" }));
          (${pasteTarget}).dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
        })()`);
        const imagesRoot = path.join(root, "vault", "assets", "images");
        const uploadedDeadline = Date.now() + 5000;
        /** @type {string | undefined} */
        let pastedImage;
        while (Date.now() < uploadedDeadline) {
          pastedImage = existsSync(imagesRoot)
            ? readdirSync(imagesRoot).find((name) => name.endsWith(".webp"))
            : undefined;
          if (pastedImage) break;
          await pause();
        }
        assert.ok(
          pastedImage,
          "Production paste must save WebP under the Desktop CSP",
        );
        const pastedBytes = readFileSync(path.join(imagesRoot, pastedImage));
        assert.equal(pastedBytes.toString("ascii", 0, 4), "RIFF");
        assert.equal(pastedBytes.toString("ascii", 8, 12), "WEBP");
        console.log(
          "Production clipboard paste saved WebP bytes to the temporary Vault",
        );
        window.once("close", (event) => event.preventDefault());
        Menu.sendActionToFirstResponder("terminate:");
        await pause();
        assert.equal(window.isDestroyed(), false);
        /** @type {unknown} */
        const restored = await window.webContents.executeJavaScript(
          "window.pkm.restoreVault()",
        );
        assert.ok(
          typeof restored === "object" &&
            restored !== null &&
            "vaultRoot" in restored,
        );
        assert.equal(restored.vaultRoot, path.join(root, "vault"));
        const closed = new Promise((resolve) => window.once("closed", resolve));
        window.close();
        await closed;
        app.emit("activate");
        window = BrowserWindow.getAllWindows()[0];
        assert.ok(window);
        await new Promise((resolve) =>
          window.webContents.once("did-finish-load", resolve),
        );
        await waitForVault(window);
        await assertAppearance(window);
      }
      console.log(`Electron lifecycle ${phase}: Vault and IPC are available`);
      Menu.sendActionToFirstResponder("terminate:");
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
