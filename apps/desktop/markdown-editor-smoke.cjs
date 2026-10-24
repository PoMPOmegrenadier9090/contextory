const { app, BrowserWindow, nativeTheme } = require("electron");
const path = require("node:path");
const { readFileSync } = require("node:fs");
const process = require("node:process");

void app
  .whenReady()
  .then(async () => {
    const imageCheck = app.commandLine.hasSwitch("images");
    const tableCheck = app.commandLine.hasSwitch("tables");
    const quickOpenCheck = app.commandLine.hasSwitch("quick-open");
    const appearanceCheck = app.commandLine.hasSwitch("appearance");
    const commandsCheck = app.commandLine.hasSwitch("commands");
    const timelineCheck = app.commandLine.hasSwitch("entry-timeline");
    const captureCheck = app.commandLine.hasSwitch("capture");
    const scrollCheck = app.commandLine.hasSwitch("scroll");
    const relationsCheck = app.commandLine.hasSwitch("web-relations");
    const notificationsCheck = app.commandLine.hasSwitch("notifications");
    const label = notificationsCheck
      ? "Notifications"
      : relationsCheck
        ? "Web entity relations"
        : imageCheck
          ? "Images"
          : appearanceCheck
            ? "Appearance"
            : commandsCheck
              ? "App commands"
              : timelineCheck
                ? "Entity Entry Timeline"
                : scrollCheck
                  ? "Page scroll"
                  : quickOpenCheck
                    ? "Quick Open"
                    : "Markdown editor";
    const modulePath = imageCheck
      ? "/apps/desktop/src/image.browser-test.tsx"
      : appearanceCheck
        ? "/apps/desktop/src/appearance.browser-test.tsx"
        : commandsCheck
          ? "/apps/desktop/src/app-commands.browser-test.tsx"
          : timelineCheck
            ? "/apps/desktop/src/entity-entry-timeline.browser-test.tsx"
            : scrollCheck
              ? "/apps/desktop/src/page-scroll.browser-test.tsx"
              : quickOpenCheck
                ? "/apps/desktop/src/quick-open.browser-test.tsx"
                : "/packages/ui/src/markdown-editor.browser-test.ts";
    const run = imageCheck
      ? "runImageBrowserChecks"
      : appearanceCheck
        ? "runAppearanceBrowserChecks"
        : commandsCheck
          ? "runAppCommandsBrowserChecks"
          : timelineCheck
            ? "runEntityEntryTimelineBrowserChecks"
            : scrollCheck
              ? "runPageScrollBrowserChecks"
              : quickOpenCheck
                ? "runQuickOpenBrowserChecks"
                : "runMarkdownEditorBrowserChecks";
    const browserModule = notificationsCheck
      ? "/apps/desktop/src/notifications.browser-test.tsx"
      : relationsCheck
        ? "/apps/web/src/web-app.browser-test.tsx"
        : modulePath;
    const browserRun = notificationsCheck
      ? "runNotificationBrowserChecks"
      : relationsCheck
        ? "runWebEntityRelationsBrowserChecks"
        : run;
    const imagePolicy =
      imageCheck || timelineCheck
        ? readFileSync(path.join(app.getAppPath(), "index.html"), "utf8").match(
            /img-src [^;"]+/,
          )?.[0]
        : undefined;
    if ((imageCheck || timelineCheck) && !imagePolicy)
      throw new Error("Desktop image CSP was not found");
    const { createServer } = await import("vite");
    const server = await createServer({
      configFile: false,
      root: path.resolve(app.getAppPath(), "../.."),
      resolve: {
        alias: {
          react: path.dirname(require.resolve("react/package.json")),
          "react-dom": path.dirname(require.resolve("react-dom/package.json")),
          "react-markdown": require.resolve("react-markdown", {
            paths: [path.resolve(app.getAppPath(), "../../packages/ui")],
          }),
          "rehype-katex": require.resolve("rehype-katex", {
            paths: [path.resolve(app.getAppPath(), "../../packages/ui")],
          }),
        },
      },
      optimizeDeps: {
        include: [
          "react",
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "react-markdown",
          "rehype-katex",
        ],
        entries: [
          "apps/desktop/src/appearance.browser-test.tsx",
          "apps/desktop/src/app-commands.browser-test.tsx",
          "apps/desktop/src/entity-entry-timeline.browser-test.tsx",
          "apps/desktop/src/page-scroll.browser-test.tsx",
          "apps/desktop/src/quick-open.browser-test.tsx",
          "packages/ui/src/markdown-editor.browser-test.ts",
          "apps/desktop/src/image.browser-test.tsx",
          "apps/web/src/web-app.browser-test.tsx",
          "apps/desktop/src/notifications.browser-test.tsx",
        ],
      },
      server: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "markdown-editor-smoke",
          configureServer(vite) {
            if (appearanceCheck)
              vite.middlewares.use(
                "/__appearance_scheme",
                (request, response) => {
                  const source = request.url?.slice(1);
                  if (
                    source !== "light" &&
                    source !== "dark" &&
                    source !== "system"
                  ) {
                    response.statusCode = 400;
                    response.end();
                    return;
                  }
                  nativeTheme.themeSource = source;
                  response.end("ok");
                },
              );
            vite.middlewares.use("/__editor_smoke", (_request, response) => {
              response.setHeader("Content-Type", "text/html");
              if (imagePolicy)
                response.setHeader("Content-Security-Policy", imagePolicy);
              response.end(
                `<!doctype html><html><body><main id="editor"></main><script type="module">${tableCheck ? 'import "/apps/desktop/node_modules/@mantine/core/styles.css"; import "/apps/desktop/src/renderer.css"; import "/packages/ui/src/compact.css";' : ""}import { ${browserRun} } from "${browserModule}"; globalThis.editorChecks = ${browserRun}(document.getElementById("editor"), ${tableCheck || captureCheck || imageCheck || quickOpenCheck});</script></body></html>`,
              );
            });
          },
        },
      ],
    });
    try {
      await server.listen();
      const window = new BrowserWindow({
        show: commandsCheck || appearanceCheck || imageCheck,
        webPreferences: { backgroundThrottling: false },
        width: app.commandLine.hasSwitch("mobile") ? 390 : 900,
        height: 600,
      });
      await window.loadURL(server.resolvedUrls.local[0] + "__editor_smoke");
      window.webContents.focus();
      /** @type {unknown} */
      const result = await Promise.race([
        window.webContents.executeJavaScript(
          "Promise.resolve(globalThis.editorChecks).catch(error => { throw new Error(error.stack ?? error.message); })",
        ),
        require("node:timers/promises")
          .setTimeout(60000, null, { ref: false })
          .then(() => {
            throw new Error(`${label} browser checks timed out`);
          }),
      ]);
      if (
        !result ||
        typeof result !== "object" ||
        !("checks" in result) ||
        typeof result.checks !== "number"
      )
        throw new Error("Editor browser checks did not load");
      console.log(`${label} browser smoke passed: ${result.checks} checks`);
      if (
        !imageCheck &&
        !appearanceCheck &&
        !commandsCheck &&
        !timelineCheck &&
        !scrollCheck &&
        !quickOpenCheck &&
        !relationsCheck &&
        !notificationsCheck &&
        !tableCheck
      ) {
        window.show();
        window.focus();
        window.webContents.debugger.attach("1.3");
        try {
          for (const prefix of ["", "- ", "折り返す日本語の本文".repeat(12)]) {
            for (const bold of [false, true]) {
              await window.webContents.executeJavaScript(`(async () => {
                const { createMarkdownBodyEditor } = await import('/packages/ui/src/markdown-live-editor.tsx');
                globalThis.imeMount = document.body.appendChild(document.createElement('div'));
                const editor = globalThis.imeEditor = createMarkdownBodyEditor({ parent: globalThis.imeMount, document: ${JSON.stringify(prefix)} });
                editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length }, scrollIntoView: true });
                editor.view.focus();
                if (${bold}) editor.view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'b', keyCode: 66, metaKey: /Mac/.test(navigator.platform), ctrlKey: !/Mac/.test(navigator.platform), bubbles: true, cancelable: true
                }));
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              })()`);
              await window.webContents.debugger.sendCommand(
                "Input.imeSetComposition",
                { text: "にほんご", selectionStart: 4, selectionEnd: 4 },
              );
              await require("node:timers/promises").setTimeout(90);
              /** @type {unknown} */
              const intermediate = await window.webContents.executeJavaScript(
                "globalThis.imeEditor.view.state.doc.toString()",
              );
              if (intermediate !== prefix + "にほんご")
                throw new Error(
                  `IME changed before commit: ${String(intermediate)}`,
                );
              await window.webContents.debugger.sendCommand(
                "Input.imeSetComposition",
                { text: "日本語", selectionStart: 3, selectionEnd: 3 },
              );
              await window.webContents.debugger.sendCommand(
                "Input.insertText",
                { text: "日本語" },
              );
              await require("node:timers/promises").setTimeout(150);
              await window.webContents.debugger.sendCommand(
                "Input.insertText",
                { text: "続き" },
              );
              await require("node:timers/promises").setTimeout(60);
              /** @type {unknown} */
              const actual = await window.webContents.executeJavaScript(
                "JSON.stringify({ doc: globalThis.imeEditor.view.state.doc.toString(), empty: globalThis.imeEditor.view.state.selection.main.empty, collapsed: window.getSelection().isCollapsed })",
              );
              const expected =
                prefix + (bold ? "**日本語続き**" : "日本語続き");
              if (
                actual !==
                JSON.stringify({ doc: expected, empty: true, collapsed: true })
              )
                throw new Error(
                  `Native IME failed: ${JSON.stringify({ expected, actual })}`,
                );
              await window.webContents.executeJavaScript(
                "globalThis.imeEditor.destroy(); globalThis.imeMount.remove(); delete globalThis.imeEditor; delete globalThis.imeMount",
              );
            }
          }
          console.log(
            "Native Japanese IME checks passed (plain, bold, lists, wrapped lines)",
          );
        } finally {
          window.webContents.debugger.detach();
        }
      }
      if (tableCheck) {
        window.webContents.debugger.attach("1.3");
        await window.webContents.debugger.sendCommand(
          "Emulation.setFocusEmulationEnabled",
          { enabled: true },
        );
        await window.webContents.debugger.sendCommand(
          "Input.imeSetComposition",
          { text: "", selectionStart: 0, selectionEnd: 0 },
        );
        /** @param {string} key @param {number} [modifiers] */
        const nativeKey = async (key, modifiers = 0) => {
          const windowsVirtualKeyCode =
            key === "Backspace" ? 8 : key === "Enter" ? 13 : 90;
          for (const type of ["rawKeyDown", "keyUp"])
            await window.webContents.debugger.sendCommand(
              "Input.dispatchKeyEvent",
              {
                type,
                key: key === "Z" ? "z" : key,
                code: key === "Z" ? "KeyZ" : key,
                windowsVirtualKeyCode,
                modifiers,
              },
            );
        };
        await window.webContents.executeJavaScript(
          "globalThis.tableCheckCancelComposition()",
        );
        const table = "| A | B |\n| --- | --- |\n| a | b |";
        const fixture = table + "\n\n\n後文";
        const settle = () =>
          window.webContents.executeJavaScript(
            "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          );
        await window.webContents.executeJavaScript(
          `globalThis.tableCheckSetDocument(${JSON.stringify(fixture)}, ${fixture.indexOf("後文")})`,
        );
        await settle();
        for (const expected of [
          "\n" + table + "\n\n後文",
          "\n" + table + "\n\n後文",
        ]) {
          await nativeKey("Backspace");
          await settle();
          if (
            !(await window.webContents.executeJavaScript(
              `globalThis.tableCheckDocument() === ${JSON.stringify(expected)} && document.querySelector('.cm-content').textContent.includes('後文') && document.querySelector('.pkm-table-preview table') && !document.querySelector('.pkm-table-preview').textContent.includes('後文')`,
            ))
          )
            throw new Error(
              "Native table paragraph boundary deletion failed: " +
                (await window.webContents.executeJavaScript(
                  "JSON.stringify({ doc: globalThis.tableCheckDocument(), composing: globalThis.tableCheckComposition(), active: document.activeElement.className })",
                )),
            );
        }
        await window.webContents.executeJavaScript(
          `globalThis.tableCheckSetDocument(${JSON.stringify(table)})`,
        );
        await settle();
        await nativeKey("Enter");
        await settle();
        await window.webContents.insertText("続く本文");
        await settle();
        if (
          !(await window.webContents.executeJavaScript(
            `globalThis.tableCheckDocument() === ${JSON.stringify("\n" + table + "\n\n続く本文")} && !document.querySelector('.pkm-table-preview').textContent.includes('続く本文')`,
          ))
        )
          throw new Error("Native writing after a terminal table failed");
        await require("electron").clipboard.writeText("名前\t値\n左\t右");
        await window.webContents.executeJavaScript(
          "globalThis.tableCheckSetDocument('')",
        );
        await settle();
        window.webContents.paste();
        await settle();
        if (
          !(await window.webContents.executeJavaScript(
            "globalThis.tableCheckDocument() === '\\n| 名前 | 値 |\\n| --- | --- |\\n| 左 | 右 |\\n\\n' && document.querySelector('.pkm-table-preview td').textContent === '左'",
          ))
        )
          throw new Error("Native TSV to rendered table paste failed");
        const source = "前文\n\n" + table + "\n\n後文";
        try {
          // Native IME at both blank separators must preserve a writable paragraph.
          for (const side of ["before", "after"]) {
            const position =
              side === "before"
                ? source.indexOf(table) - 1
                : source.indexOf("後文") - 1;
            await window.webContents.executeJavaScript(
              `globalThis.tableCheckSetDocument(${JSON.stringify(source)}, ${position})`,
            );
            await settle();
            await window.webContents.debugger.sendCommand(
              "Input.imeSetComposition",
              { text: "にほんご", selectionStart: 4, selectionEnd: 4 },
            );
            await require("node:timers/promises").setTimeout(90);
            await window.webContents.debugger.sendCommand(
              "Input.imeSetComposition",
              { text: "日本語", selectionStart: 3, selectionEnd: 3 },
            );
            await window.webContents.debugger.sendCommand("Input.insertText", {
              text: "日本語",
            });
            await require("node:timers/promises").setTimeout(120);
            await window.webContents.debugger.sendCommand("Input.insertText", {
              text: "続き",
            });
            await settle();
            const expected =
              side === "before"
                ? "前文\n日本語続き\n\n" + table + "\n\n後文"
                : "前文\n\n" + table + "\n\n日本語続き\n後文";
            /** @type {unknown} */
            const actual = await window.webContents.executeJavaScript(
              "globalThis.tableCheckDocument()",
            );
            if (actual !== expected)
              throw new Error(
                `Native table boundary IME (${side}): ${JSON.stringify(actual)}`,
              );
            await nativeKey("Z", 4);
            await settle();
            if (
              !(await window.webContents.executeJavaScript(
                `globalThis.tableCheckDocument() === ${JSON.stringify(source)}`,
              ))
            )
              throw new Error(
                `Native table boundary IME undo (${side}) did not restore the original separators`,
              );
          }
          await window.webContents.executeJavaScript(
            `globalThis.tableCheckSetDocument(${JSON.stringify(source)}); document.querySelector('.pkm-table-preview td').click(); document.querySelector('.pkm-table-cell-input').select()`,
          );
          await settle();
          await window.webContents.debugger.sendCommand(
            "Input.imeSetComposition",
            { text: "にほんご", selectionStart: 4, selectionEnd: 4 },
          );
          await settle();
          if (
            !(await window.webContents.executeJavaScript(
              `globalThis.tableCheckDocument() === ${JSON.stringify(source)} && document.activeElement.matches('.pkm-table-cell-input')`,
            ))
          )
            throw new Error(
              "Cell composition changed the document before commit or lost focus",
            );
          await window.webContents.debugger.sendCommand(
            "Input.imeSetComposition",
            { text: "日本語", selectionStart: 3, selectionEnd: 3 },
          );
          await window.webContents.debugger.sendCommand("Input.insertText", {
            text: "日本語",
          });
          const compositionDeadline = Date.now() + 2000;
          while (
            await window.webContents.executeJavaScript(
              "document.querySelector('.pkm-table-cell-input')?.dataset.composing === 'true'",
            )
          ) {
            if (Date.now() > compositionDeadline)
              throw new Error("Native cell composition did not finish");
            await settle();
          }
          await settle();
          await nativeKey("Enter", 8);
          await window.webContents.insertText("二行目");
          await settle();
          if (
            !(await window.webContents.executeJavaScript(
              "globalThis.tableCheckDocument().includes('日本語<br>二行目') && document.activeElement.matches('.pkm-table-cell-input')",
            ))
          )
            throw new Error(
              "Native cell IME/Shift-Enter lost text or focus: " +
                (await window.webContents.executeJavaScript(
                  "JSON.stringify({ doc: globalThis.tableCheckDocument(), active: document.activeElement.outerHTML.slice(0, 300), value: document.activeElement.value })",
                )),
            );
          await nativeKey("Enter");
          await settle();
          if (
            !(await window.webContents.executeJavaScript(
              "document.querySelectorAll('.pkm-table-preview tr').length === 3 && document.activeElement.matches('.pkm-table-cell-input') && document.activeElement.value === ''",
            ))
          )
            throw new Error(
              "Native cell Enter did not create and focus a new row",
            );
        } finally {
          window.webContents.debugger.detach();
        }
        console.log(
          "Native table editing, boundary IME, row insertion, cell breaks and TSV paste passed",
        );
      }
      if (quickOpenCheck) {
        window.webContents.debugger.attach("1.3");
        /** @type {unknown} */
        const target = await window.webContents.executeJavaScript(`(() => {
          const viewport = document.querySelector('.quick-open-results');
          const rect = viewport.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: Math.min(rect.bottom, innerHeight) - 30 };
        })()`);
        if (
          !target ||
          typeof target !== "object" ||
          !("x" in target) ||
          typeof target.x !== "number" ||
          !("y" in target) ||
          typeof target.y !== "number"
        )
          throw new Error("Quick Open touch target was not found");
        await window.webContents.debugger.sendCommand(
          "Input.dispatchTouchEvent",
          {
            type: "touchStart",
            touchPoints: [{ x: target.x, y: target.y }],
          },
        );
        for (let offset = 20; offset <= 140; offset += 20) {
          await window.webContents.debugger.sendCommand(
            "Input.dispatchTouchEvent",
            {
              type: "touchMove",
              touchPoints: [{ x: target.x, y: target.y - offset }],
            },
          );
          await require("node:timers/promises").setTimeout(30);
        }
        await window.webContents.debugger.sendCommand(
          "Input.dispatchTouchEvent",
          {
            type: "touchEnd",
            touchPoints: [],
          },
        );
        await require("node:timers/promises").setTimeout(250);
        if (
          !(await window.webContents.executeJavaScript(
            "document.querySelector('.quick-open-results').scrollTop > 0",
          ))
        )
          throw new Error(
            "Quick Open native touch swipe did not scroll results",
          );
        window.webContents.debugger.detach();
        console.log("Quick Open native touch scrolling passed");
      }
      if (imageCheck) {
        // Exercise real pointer capture as well as the renderer's synthetic
        // checks, which cannot acquire a native pointer.
        window.focus();
        /** @type {unknown} */
        const hover = await window.webContents.executeJavaScript(`(async () => {
          const root = document.querySelector('.pkm-image-widget');
          root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          document.activeElement?.blur();
          window.scrollTo(0, 0);
          document.querySelector('.cm-scroller').scrollTop = 0;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const rect = root.querySelector('img').getBoundingClientRect();
          return { x: Math.round(rect.x + 16), y: Math.round(rect.y + 16) };
        })()`);
        if (
          !hover ||
          typeof hover !== "object" ||
          !("x" in hover) ||
          typeof hover.x !== "number" ||
          !("y" in hover) ||
          typeof hover.y !== "number"
        )
          throw new Error("Image hover target was not found");
        window.webContents.sendInputEvent({
          type: "mouseMove",
          x: hover.x,
          y: hover.y,
        });
        /** @type {unknown} */
        const hovered = await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => resolve(getComputedStyle(document.querySelector('.pkm-image-toolbar')).visibility === 'visible')))",
        );
        if (hovered !== true)
          throw new Error("Image toolbar did not appear on hover");
        await window.webContents.executeJavaScript(
          "document.querySelector('.pkm-image-widget img').click()",
        );
        /** @type {unknown} */
        const drag = await window.webContents.executeJavaScript(`(async () => {
            const handle = document.querySelector('.pkm-image-resize[data-side="right"]');
            handle.scrollIntoView({ block: 'center' });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const rect = handle.getBoundingClientRect();
            const frame = document.querySelector('.pkm-image-frame');
            return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), width: frame.getBoundingClientRect().width };
          })()`);
        if (
          !drag ||
          typeof drag !== "object" ||
          !("x" in drag) ||
          typeof drag.x !== "number" ||
          !("y" in drag) ||
          typeof drag.y !== "number" ||
          !("width" in drag) ||
          typeof drag.width !== "number"
        )
          throw new Error("Image drag target was not found");
        window.webContents.sendInputEvent({
          type: "mouseMove",
          x: drag.x,
          y: drag.y,
        });
        window.webContents.sendInputEvent({
          type: "mouseDown",
          button: "left",
          clickCount: 1,
          x: drag.x,
          y: drag.y,
        });
        await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(resolve))",
        );
        window.webContents.sendInputEvent({
          type: "mouseMove",
          modifiers: ["leftButtonDown"],
          x: drag.x - 40,
          y: drag.y,
        });
        await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(resolve))",
        );
        window.webContents.sendInputEvent({
          type: "mouseUp",
          button: "left",
          clickCount: 1,
          x: drag.x - 40,
          y: drag.y,
        });
        /** @type {unknown} */
        const width = await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(parseFloat(document.querySelector('.pkm-image-frame').style.width)))))",
        );
        if (width !== Math.round(drag.width - 40))
          throw new Error(
            `Real image drag failed: ${String(width)}; ${JSON.stringify(drag)}`,
          );
        /** @type {unknown} */
        const saved = await window.webContents
          .executeJavaScript(`new Promise(resolve => {
          const deadline = Date.now() + 2000;
          const check = () => {
            if (globalThis.imageCheckDocument().includes('|${String(width)}]')) return resolve(true);
            if (Date.now() >= deadline) return resolve(false);
            requestAnimationFrame(check);
          };
          check();
        })`);
        if (saved !== true)
          throw new Error(
            "Native image drag did not save its width to Markdown",
          );
        /** @type {unknown} */
        const beforeKeys = await window.webContents.executeJavaScript(
          "globalThis.imageCheckDocument()",
        );
        await window.webContents.executeJavaScript(
          "document.querySelector('.pkm-image-widget img').click()",
        );
        await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        for (const type of ["keyDown", "keyUp"])
          window.webContents.sendInputEvent({ type, keyCode: "Backspace" });
        await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        /** @type {unknown} */
        const deleted = await window.webContents.executeJavaScript(
          "!document.querySelector('.pkm-image-widget') && !globalThis.imageCheckDocument().includes('![')",
        );
        if (deleted !== true)
          throw new Error(
            `Native image deletion failed: ${await window.webContents.executeJavaScript("JSON.stringify({doc:globalThis.imageCheckDocument(), focused:document.activeElement?.className, hasFocus:document.hasFocus()})")}`,
          );
        await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        for (const type of ["keyDown", "keyUp"])
          window.webContents.sendInputEvent({
            type,
            keyCode: "Z",
            modifiers: [process.platform === "darwin" ? "meta" : "control"],
          });
        await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        if (
          (await window.webContents.executeJavaScript(
            "globalThis.imageCheckDocument()",
          )) !== beforeKeys
        )
          throw new Error("Native image deletion undo failed");
        await window.webContents.executeJavaScript(
          "document.querySelector('.pkm-image-widget img').click()",
        );
        await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        for (const type of ["keyDown", "keyUp"])
          window.webContents.sendInputEvent({
            type,
            keyCode: "Down",
            modifiers: ["alt"],
          });
        await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        if (
          (await window.webContents.executeJavaScript(
            "globalThis.imageCheckDocument()",
          )) === beforeKeys
        )
          throw new Error("Native Option+Down image movement failed");
        await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        for (const type of ["keyDown", "keyUp"])
          window.webContents.sendInputEvent({
            type,
            keyCode: "Up",
            modifiers: ["alt"],
          });
        await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        if (
          (await window.webContents.executeJavaScript(
            "globalThis.imageCheckDocument()",
          )) !== beforeKeys
        )
          throw new Error("Native Option+Up image movement failed");
        console.log(
          "Native image pointer drag, deletion, undo and Option+arrow movement passed",
        );
        for (const navigationSource of [
          "直前のテキスト\n![cursor|120](/apps/web/public/icon-512.png)\n直後のテキスト",
          "直前のテキスト![cursor|120](/apps/web/public/icon-512.png)直後のテキスト",
          "直前のテキスト\n![cursor|800](/apps/web/public/icon-512.png)\n直後のテキスト",
          "直前のテキスト\n\n![cursor|120](/apps/web/public/icon-512.png)\n\n直後のテキスト",
        ]) {
          await window.webContents.executeJavaScript(`(async () => {
          globalThis.imageCheckSetDocument(${JSON.stringify(navigationSource)});
          await document.querySelector('.pkm-image-widget img').decode();
          window.scrollTo(0, 0);
          document.querySelector('.cm-scroller').scrollTop = 0;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`);
          for (const text of ["直前のテキスト", "直後のテキスト"]) {
            for (const edge of ["top", "middle", "bottom"]) {
              await window.webContents.executeJavaScript(`(async () => {
                [...document.querySelectorAll('.cm-line')].find(line => line.textContent === ${JSON.stringify(text)}).scrollIntoView({ block: 'center' });
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              })()`);
              /** @type {unknown} */
              const target = await window.webContents
                .executeJavaScript(`(() => {
              const line = [...document.querySelectorAll('.cm-line')].find(line => line.textContent === ${JSON.stringify(text)});
              const range = document.createRange(); range.selectNodeContents(line);
              const glyph = range.getBoundingClientRect();
              const rect = line.getBoundingClientRect();
              return { x: Math.round(glyph.left + 4), y: Math.round(${edge === "top" ? "rect.top + 1" : edge === "bottom" ? "rect.bottom - 1" : "(rect.top + rect.bottom) / 2"}), top: rect.top, bottom: rect.bottom };
            })()`);
              if (
                !target ||
                typeof target !== "object" ||
                !("x" in target) ||
                typeof target.x !== "number" ||
                !("y" in target) ||
                typeof target.y !== "number" ||
                !("top" in target) ||
                typeof target.top !== "number" ||
                !("bottom" in target) ||
                typeof target.bottom !== "number"
              )
                throw new Error("Image-adjacent text target was not found");
              for (const type of ["mouseDown", "mouseUp"])
                window.webContents.sendInputEvent({
                  type,
                  button: "left",
                  clickCount: 1,
                  x: target.x,
                  y: target.y,
                });
              await window.webContents.executeJavaScript(
                "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
              );
              /** @type {unknown} */
              const selection = await window.webContents.executeJavaScript(
                "globalThis.imageCheckSelection()",
              );
              const start = navigationSource.indexOf(text);
              if (
                !selection ||
                typeof selection !== "object" ||
                !("from" in selection) ||
                typeof selection.from !== "number" ||
                !("to" in selection) ||
                typeof selection.to !== "number" ||
                selection.from !== selection.to ||
                selection.from < start ||
                selection.from > start + text.length
              )
                throw new Error(
                  `Image-adjacent click failed: ${text} ${edge}; ${JSON.stringify(selection)}; ${JSON.stringify(target)}`,
                );
              if (
                !("coords" in selection) ||
                !selection.coords ||
                typeof selection.coords !== "object" ||
                !("top" in selection.coords) ||
                typeof selection.coords.top !== "number" ||
                !("bottom" in selection.coords) ||
                typeof selection.coords.bottom !== "number" ||
                (selection.coords.top + selection.coords.bottom) / 2 <
                  target.top ||
                (selection.coords.top + selection.coords.bottom) / 2 >
                  target.bottom
              )
                throw new Error(
                  `Image-adjacent caret is not on text: ${text} ${edge}; ${JSON.stringify(selection)}; ${JSON.stringify(target)}`,
                );
            }
          }
          if (navigationSource.includes("\n\n")) {
            const emptyPositions = [];
            let offset = 0;
            for (const line of navigationSource.split("\n")) {
              if (!line) emptyPositions.push(offset);
              offset += line.length + 1;
            }
            for (let index = 0; index < emptyPositions.length; index++) {
              /** @type {unknown} */
              const target = await window.webContents
                .executeJavaScript(`(() => {
                const line = [...document.querySelectorAll('.cm-line')].filter(line => !line.textContent && line.getBoundingClientRect().height > 0)[${index}];
                const rect = line.getBoundingClientRect();
                return { x: Math.round(rect.left + parseFloat(getComputedStyle(line).paddingLeft) + 4), y: Math.round((rect.top + rect.bottom) / 2) };
              })()`);
              if (
                !target ||
                typeof target !== "object" ||
                !("x" in target) ||
                typeof target.x !== "number" ||
                !("y" in target) ||
                typeof target.y !== "number"
              )
                throw new Error("Blank line target was not found");
              for (const type of ["mouseDown", "mouseUp"])
                window.webContents.sendInputEvent({
                  type,
                  button: "left",
                  clickCount: 1,
                  x: target.x,
                  y: target.y,
                });
              await window.webContents.executeJavaScript(
                "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
              );
              if (
                (await window.webContents.executeJavaScript(
                  "globalThis.imageCheckSelection().head",
                )) !== emptyPositions[index]
              )
                throw new Error(
                  `Image-adjacent blank line click failed: ${index}`,
                );
            }
          }
        }
        console.log("Native image-adjacent text clicks passed");
        await window.webContents.executeJavaScript(`(async () => {
          globalThis.imageCheckSetDocument(${JSON.stringify("直前のテキスト\n![cursor|120](/apps/web/public/icon-512.png)\n直後のテキスト")});
          window.scrollTo(0, 0); document.querySelector('.cm-scroller').scrollTop = 0;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`);
        for (const type of ["keyDown", "keyUp"])
          window.webContents.sendInputEvent({ type, keyCode: "Down" });
        await window.webContents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
        if (
          (await window.webContents.executeJavaScript(
            "document.querySelector('.pkm-image-widget').dataset.selected",
          )) !== "true"
        )
          throw new Error(
            `ArrowDown skipped image selection: ${JSON.stringify(await window.webContents.executeJavaScript("globalThis.imageCheckSelection()"))}`,
          );
        for (const [keyCode, expected] of [
          ["Down", "after"],
          ["Up", "image"],
          ["Up", "before"],
          ["End", "before"],
          ["Right", "image"],
          ["Right", "after"],
          ["Left", "image"],
          ["Left", "before"],
        ]) {
          for (const type of ["keyDown", "keyUp"])
            window.webContents.sendInputEvent({ type, keyCode });
          await window.webContents.executeJavaScript(
            "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
          );
          /** @type {unknown} */
          const matched = await window.webContents.executeJavaScript(`(() => {
            const selection = globalThis.imageCheckSelection();
            const source = globalThis.imageCheckDocument();
            if (${JSON.stringify(expected)} === "image") return document.querySelector('.pkm-image-widget').dataset.selected === 'true' && selection.from < selection.to;
            const start = ${JSON.stringify(expected)} === "after" ? source.indexOf('直後のテキスト') : 0;
            const line = [...document.querySelectorAll('.cm-line')].find(line => line.textContent === (${JSON.stringify(expected)} === "after" ? '直後のテキスト' : '直前のテキスト'));
            const rect = line.getBoundingClientRect();
            const center = selection.coords && (selection.coords.top + selection.coords.bottom) / 2;
            return selection.from === selection.to && selection.from >= start && selection.from <= start + '直前のテキスト'.length && center >= rect.top && center <= rect.bottom;
          })()`);
          if (matched !== true)
            throw new Error(
              `Image arrow navigation failed: ${keyCode} ${expected}; ${JSON.stringify(await window.webContents.executeJavaScript("globalThis.imageCheckSelection()"))}`,
            );
        }
        console.log("Native image arrow navigation passed");
        await window.webContents.executeJavaScript(
          `(async () => {
            globalThis.imageCheckSetDocument(${JSON.stringify(beforeKeys)});
            await document.querySelector('.pkm-image-widget img').decode();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            document.querySelector('.pkm-image-widget img').click();
          })()`,
        );
      }
      if (captureCheck) {
        if (imageCheck)
          await window.webContents.executeJavaScript(`(async () => {
          window.scrollTo(0, 0);
          document.querySelector('.cm-scroller').scrollTop = 0;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          document.querySelector('.pkm-image-toolbar button[aria-label="サイズ変更"]').click();
        })()`);
        const output = path.join(
          app.getPath("temp"),
          `pkms-${imageCheck ? "images" : appearanceCheck ? "appearance" : commandsCheck ? "commands" : "entry-timeline"}${app.commandLine.hasSwitch("mobile") ? "-mobile" : ""}.png`,
        );
        require("node:fs").writeFileSync(
          output,
          (await window.webContents.capturePage()).toPNG(),
        );
        console.log(`Browser screenshot: ${output}`);
      }
      window.destroy();
    } finally {
      await server.close();
    }
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
