import { readClipboardMarkdown } from "./clipboard-markdown.js";
import { createMarkdownBodyEditor } from "./markdown-live-editor.js";
import { acceptCompletion, startCompletion } from "@codemirror/autocomplete";
import { undo, redo, isolateHistory } from "@codemirror/commands";

// Run in Chromium/Electron so clipboard parsing, keymap precedence, and the
// live decorations are exercised together with the actual DOM implementation.
export const runMarkdownEditorBrowserChecks = async (
  parent: HTMLElement,
  nativeTable = false,
) => {
  // This smoke window runs hidden. Model window focus while retaining the real
  // activeElement, so active-line decorations are also checked in Chromium.
  document.hasFocus = () => true;
  let checks = 0;
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected)
      throw new Error(
        `Check ${checks}: expected ${JSON.stringify(expected)}, received ${actual instanceof Element ? actual.outerHTML.slice(0, 500) : JSON.stringify(actual)}`,
      );
    checks++;
  };
  const htmlCases: [string, string | null][] = [
    ["<strong>太字</strong>", "**太字**"],
    ['<span style="font-weight:700">太字</span>', "**太字**"],
    [
      '<b style="font-weight:normal"><span style="font-weight:700">太字</span> 通常</b>',
      "**太字** 通常",
    ],
    ['<strong><span style="font-weight:bold">太字</span></strong>', "**太字**"],
    ["前<strong> 太字 </strong>後", "前 **太字** 後"],
    [
      '<span style="font-style:italic;text-decoration:line-through">text</span>',
      "*~~text~~*",
    ],
    ["<p>one</p>\n<p><b>two</b></p>", "one\n\n**two**"],
    ["<strong>one</strong>\n<span>two</span>", "**one** two"],
    ["<ul>\n<li>one</li>\n<li><b>two</b></li>\n</ul>", "- one\n- **two**"],
    ['<ol start="9"><li>one</li><li>two</li></ol>', "9. one\n10. two"],
    [
      "<ul><li>[ ] 未完了</li><li><p>[x] <b>完了</b></p></li><li>[X] 完了</li></ul>",
      "- [ ] 未完了\n- [x] **完了**\n- [X] 完了",
    ],
    [
      "<ul><li>[ ] 親<ul><li>[x] 子</li></ul></li></ul>",
      "- [ ] 親\n  \n  - [x] 子",
    ],
    [
      '<ul><li><input type="checkbox">未完了</li><li><input type="checkbox" checked>完了</li></ul>',
      "- [ ] 未完了\n- [x] 完了",
    ],
    [
      "<ul><li><code>[ ]</code> コード</li><li>本文 [ ] 途中</li><li>[x](リンク)</li></ul>",
      "- `[ ]` コード\n- 本文 \\[ \\] 途中\n- \\[x\\](リンク)",
    ],
    [
      '<ul><li>parent<ul><li><input type="checkbox" checked>child</li></ul></li></ul>',
      "- parent\n  \n  - [x] child",
    ],
    [
      '<pre><code class="language-js">const x = `a`;</code></pre>',
      "```js\nconst x = `a`;\n```",
    ],
    ['<a href="javascript:alert(1)"><b>safe</b></a>', "**safe**"],
    [
      '<script>throw new Error("unsafe")</script><strong>safe</strong>',
      "**safe**",
    ],
    ['<table><tr><td colspan="2">merged</td></tr></table>', null],
  ];
  for (const [html, expected] of htmlCases)
    equal(readClipboardMarkdown(html)?.text ?? null, expected);
  equal(readClipboardMarkdown("<p><b>太字</b></p>")?.block, false);

  const cursorMount = parent.appendChild(document.createElement("div"));
  const cursorEditor = createMarkdownBodyEditor({
    parent: cursorMount,
    document:
      "本文 [[task:tsk_01997c2a-7b1c-7a01-8a10-000000000004|作業]]\n\n末尾",
  });
  try {
    const doc = cursorEditor.view.state.doc;
    const stringify = doc.toString.bind(doc);
    let wholeDocumentReads = 0;
    doc.toString = () => {
      wholeDocumentReads++;
      return stringify();
    };
    cursorEditor.view.dispatch({ selection: { anchor: 10 } });
    cursorEditor.view.dispatch({ selection: { anchor: doc.length } });
    equal(wholeDocumentReads, 0);
    equal(
      cursorMount.querySelector(".pkm-direct-reference")?.textContent,
      "作業",
    );
  } finally {
    cursorEditor.destroy();
    cursorMount.remove();
  }

  const referenceMount = parent.appendChild(document.createElement("div"));
  const referenceQueries: string[] = [];
  const referenceEditor = createMarkdownBodyEditor({
    parent: referenceMount,
    document: "[[area:",
    getReferenceOptions: (query, type) => {
      referenceQueries.push(`${type}:${query}`);
      return Promise.resolve([
        {
          id: "area_01997c2a-7b1c-7a01-8a10-000000000001",
          type: "area",
          displayName: "研究",
        },
      ]);
    },
  });
  try {
    referenceEditor.view.dispatch({ selection: { anchor: 7 } });
    referenceEditor.view.focus();
    startCompletion(referenceEditor.view);
    const deadline = Date.now() + 5000;
    while (!referenceMount.querySelector(".cm-completionLabel")) {
      if (Date.now() > deadline)
        throw Error("Reference completion did not open");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    equal(
      referenceMount.querySelector(".cm-completionLabel")!.textContent,
      "研究",
    );
    equal(referenceQueries.at(-1), "area:");
    // CodeMirror ignores acceptance during its initial interaction delay.
    await new Promise((resolve) => setTimeout(resolve, 100));
    equal(acceptCompletion(referenceEditor.view), true);
    equal(
      referenceEditor.view.state.doc.toString(),
      "[[area:area_01997c2a-7b1c-7a01-8a10-000000000001|研究]]",
    );
  } finally {
    referenceEditor.destroy();
    referenceMount.remove();
  }

  let lastChangedDocument = "";
  const handle = createMarkdownBodyEditor({
    parent,
    document: "",
    showImagePreview: false,
    onChange: (doc) => {
      lastChangedDocument = doc;
    },
  });
  const view = handle.view;
  const reset = (doc: string, anchor = doc.length, head = anchor) => {
    handle.updateDocument(doc);
    view.dispatch({ selection: { anchor, head } });
    view.focus();
  };
  const press = (key: string, shiftKey = false) => {
    const event = new KeyboardEvent("keydown", {
      key,
      code: key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    equal(event.defaultPrevented, true);
  };
  const paste = (html: string, plain = "太字") => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", plain);
    const event = new ClipboardEvent("paste", {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    equal(event.defaultPrevented, true);
  };

  equal(
    parent.querySelector(".pkm-markdown-toolbar") !== null,
    window.matchMedia("(max-width: 47.99em)").matches,
  );
  if (window.matchMedia("(max-width: 47.99em)").matches) {
    const settleToolbar = async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    };
    const stopScrolling = async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await settleToolbar();
    };
    const tap = async (label: string) => {
      await settleToolbar();
      const button = parent.querySelector<HTMLButtonElement>(
        `.pkm-markdown-toolbar button[aria-label="${label}"]`,
      );
      if (!button) throw new Error(`Missing mobile command: ${label}`);
      const selection = view.state.selection;
      for (const event of [
        new PointerEvent("pointerdown", {
          pointerType: "touch",
          bubbles: true,
          cancelable: true,
        }),
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      ]) {
        button.dispatchEvent(event);
        equal(event.defaultPrevented, true);
        equal(view.state.selection.eq(selection), true);
        equal(document.activeElement, view.contentDOM);
      }
      equal(
        button.closest(".pkm-markdown-toolbar")!.matches(":popover-open"),
        true,
      );
      button.click();
      equal(document.activeElement, view.contentDOM);
      const rect = button.getBoundingClientRect();
      equal(rect.width >= 44 && rect.height >= 44, true);
    };
    for (const [label, formatted] of [
      ["太字", "**本文**"],
      ["斜体", "*本文*"],
      ["取り消し線", "~~本文~~"],
    ] as const) {
      reset("本文", 0, 2);
      await tap(label);
      equal(view.state.doc.toString(), formatted);
      equal(lastChangedDocument, formatted);
      equal(
        parent
          .querySelector(`[aria-label="${label}"]`)
          ?.getAttribute("aria-pressed"),
        "true",
      );
      await tap(label);
      equal(view.state.doc.toString(), "本文");
      equal(
        parent
          .querySelector(`[aria-label="${label}"]`)
          ?.getAttribute("aria-pressed"),
        "false",
      );
    }
    reset("");
    await tap("太字");
    equal(
      parent.querySelector('[aria-label="太字"]')?.getAttribute("aria-pressed"),
      "true",
    );
    view.dispatch(view.state.replaceSelection("入力"), {
      userEvent: "input.type",
    });
    equal(view.state.doc.toString(), "**入力**");
    await tap("太字");
    view.dispatch(view.state.replaceSelection("続き"), {
      userEvent: "input.type",
    });
    equal(view.state.doc.toString(), "**入力**続き");

    for (const [source, nested] of [
      ["- 親\n- 子", "- 親\n  - 子"],
      ["1. 親\n2. 子", "1. 親\n   1. 子"],
      ["- [ ] 親\n- [ ] 子", "- [ ] 親\n  - [ ] 子"],
      ["本文", "  本文"],
    ] as const) {
      reset(source);
      await tap("インデントを増やす");
      equal(view.state.doc.toString(), nested);
      equal(undo(view), true);
      equal(view.state.doc.toString(), source);
      equal(redo(view), true);
      equal(view.state.doc.toString(), nested);
      await tap("インデントを減らす");
      equal(view.state.doc.toString(), source);
    }
    const selection = view.state.selection;
    handle.setReadOnly(true);
    equal(parent.querySelector(".pkm-markdown-toolbar"), null);
    handle.setReadOnly(false);
    equal(parent.querySelectorAll(".pkm-markdown-toolbar").length, 1);
    equal(view.state.selection.eq(selection), true);

    const toolbar = parent.querySelector<HTMLElement>(".pkm-markdown-toolbar")!;
    const originalDocument = view.state.doc.toString();
    const contentTop = view.contentDOM.getBoundingClientRect().top;
    view.focus();
    await settleToolbar();
    equal(toolbar.matches(":popover-open"), true);
    equal(getComputedStyle(toolbar).backgroundColor.includes("0.78"), true);
    equal(toolbar.getBoundingClientRect().bottom, window.innerHeight - 8);
    const viewport = window.visualViewport!;
    const properties = ["height", "width", "offsetTop", "offsetLeft"] as const;
    const descriptors = properties.map((key) =>
      Object.getOwnPropertyDescriptor(viewport, key),
    );
    try {
      // Model a keyboard shrinking and panning the visible part of the page.
      for (const [key, value] of [
        ["height", 300],
        ["width", 320],
        ["offsetTop", 80],
        ["offsetLeft", 10],
      ] as const)
        Object.defineProperty(viewport, key, { configurable: true, value });
      viewport.dispatchEvent(new Event("resize"));
      await settleToolbar();
      equal(toolbar.getBoundingClientRect().bottom, 372);
      equal(toolbar.getBoundingClientRect().left, 22);
      equal(toolbar.getBoundingClientRect().width, 296);
      Object.defineProperty(viewport, "offsetTop", {
        configurable: true,
        value: 120,
      });
      viewport.dispatchEvent(new Event("scroll"));
      await settleToolbar();
      equal(getComputedStyle(toolbar).opacity, "0");
      equal(getComputedStyle(toolbar).pointerEvents, "none");
      equal(toolbar.inert, true);
      await stopScrolling();
      equal(toolbar.getBoundingClientRect().bottom, 412);
      equal(getComputedStyle(toolbar).opacity, "1");
      equal(toolbar.inert, false);
      equal(view.state.selection.eq(selection), true);
      reset(Array.from({ length: 80 }, (_, i) => `入力 ${i}`).join("\n"));
      view.dispatch({ scrollIntoView: true });
      await settleToolbar();
      const caret = view.coordsAtPos(view.state.selection.main.head)!;
      const toolbarTop = toolbar.getBoundingClientRect().top;
      if (caret.bottom > toolbarTop)
        throw new Error(
          `Caret hidden by toolbar: ${JSON.stringify({ caret, toolbarTop, scrollY: window.scrollY, padding: getComputedStyle(view.contentDOM).paddingBottom, inset: view.dom.style.getPropertyValue("--pkm-keyboard-inset"), pageHeight: document.body.scrollHeight })}`,
        );
      equal(caret.bottom <= toolbarTop, true);

      // A user can leave the caret offscreen and freely scroll in either direction.
      view.dispatch({ selection: { anchor: 0 } });
      await settleToolbar();
      window.scrollTo(0, 500);
      await settleToolbar();
      const manualScroll = window.scrollY;
      equal(manualScroll > 0, true);
      const padding = getComputedStyle(view.contentDOM).paddingBottom;
      const pageHeight = document.body.scrollHeight;
      const state = view.state;
      for (const [scrollY, offsetTop] of [
        [700, 40],
        [350, 120],
        [800, 60],
        [450, 100],
      ] as const) {
        window.scrollTo(0, scrollY);
        Object.defineProperty(viewport, "offsetTop", {
          configurable: true,
          value: offsetTop,
        });
        viewport.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("scroll"));
        await settleToolbar();
        equal(window.scrollY, scrollY);
        equal(getComputedStyle(view.contentDOM).paddingBottom, padding);
        equal(document.body.scrollHeight, pageHeight);
        equal(view.state, state);
        equal(getComputedStyle(toolbar).opacity, "0");
      }
      let styleUpdates = 0;
      const observer = new MutationObserver((records) => {
        styleUpdates += records.length;
      });
      observer.observe(toolbar, {
        attributes: true,
        subtree: true,
        attributeFilter: ["style", "aria-pressed"],
      });
      viewport.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));
      await settleToolbar();
      observer.disconnect();
      equal(styleUpdates, 0);
      await stopScrolling();
      equal(getComputedStyle(toolbar).opacity, "1");
      equal(window.scrollY, 450);

      // A tap may place the native caret underneath the temporarily hidden bar.
      const overlap = view.posAtCoords({
        x: view.contentDOM.getBoundingClientRect().left + 16,
        y: toolbar.getBoundingClientRect().top + 12,
      });
      if (overlap === null) throw Error("Missing text underneath toolbar");
      equal(
        view.coordsAtPos(overlap)!.bottom > toolbar.getBoundingClientRect().top,
        true,
      );
      const beforeTap = window.scrollY;
      Object.defineProperty(view, "compositionStarted", {
        configurable: true,
        value: true,
      });
      view.dispatch({
        selection: { anchor: overlap },
        userEvent: "select.pointer",
      });
      await stopScrolling();
      equal(window.scrollY, beforeTap);
      equal(
        toolbar.getBoundingClientRect().bottom <=
          view.coordsAtPos(overlap)!.top - 24,
        true,
      );
      Reflect.deleteProperty(view, "compositionStarted");
      view.contentDOM.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      view.contentDOM.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await stopScrolling();
      equal(view.state.selection.main.head, overlap);
      equal(window.scrollY > beforeTap, true);
      equal(
        view.coordsAtPos(overlap)!.bottom <=
          toolbar.getBoundingClientRect().top - 12,
        true,
      );
      // Typing can move a mapped caret across wrapped lines without selectionSet.
      view.dispatch({
        changes: { from: overlap, insert: "折り返し入力".repeat(30) },
        userEvent: "input.type",
      });
      await stopScrolling();
      equal(
        view.coordsAtPos(view.state.selection.main.head)!.bottom <=
          toolbar.getBoundingClientRect().top - 24,
        true,
      );
      equal(view.state.selection.main.empty, true);
    } finally {
      for (const [index, key] of properties.entries()) {
        const descriptor = descriptors[index];
        if (descriptor) Object.defineProperty(viewport, key, descriptor);
        else Reflect.deleteProperty(viewport, key);
      }
      viewport.dispatchEvent(new Event("resize"));
      reset(originalDocument, selection.main.anchor, selection.main.head);
      await stopScrolling();
    }
    equal(toolbar.getBoundingClientRect().bottom, window.innerHeight - 8);
    // Model an active native IME composition without an OS software keyboard.
    Object.defineProperty(view, "composing", {
      configurable: true,
      value: true,
    });
    equal(view.composing, true);
    toolbar
      .querySelector<HTMLButtonElement>('[aria-label="キーボードを閉じる"]')!
      .click();
    await settleToolbar();
    equal(document.activeElement === view.contentDOM, false);
    equal(toolbar.matches(":popover-open"), false);
    Reflect.deleteProperty(view, "composing");
    equal(view.contentDOM.getBoundingClientRect().top, contentTop);

    // Quick Capture can clip its contents and use a transformed modal ancestor.
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.style.cssText =
      "width:280px;height:160px;overflow:auto;transform:translateY(-40px)";
    dialog.showModal();
    const modalEditor = createMarkdownBodyEditor({
      parent: dialog,
      document: "メモ",
    });
    try {
      modalEditor.view.focus();
      await settleToolbar();
      const modalToolbar = dialog.querySelector<HTMLElement>(
        ".pkm-markdown-toolbar",
      )!;
      equal(modalToolbar.matches(":popover-open"), true);
      equal(
        document.querySelectorAll(".pkm-markdown-toolbar:popover-open").length,
        1,
      );
      const rect = modalToolbar.getBoundingClientRect();
      equal(rect.bottom, window.innerHeight - 8);
      equal(rect.left, Math.round((window.innerWidth - rect.width) / 2));
      equal(
        document
          .elementFromPoint(rect.left + 20, rect.top + 20)
          ?.closest(".pkm-markdown-toolbar"),
        modalToolbar,
      );
      dialog.dispatchEvent(new Event("scroll"));
      await settleToolbar();
      equal(getComputedStyle(modalToolbar).opacity, "0");
      await stopScrolling();
      equal(getComputedStyle(modalToolbar).opacity, "1");
      dialog.appendChild(document.createElement("input")).focus();
      await settleToolbar();
      equal(modalToolbar.matches(":popover-open"), false);
    } finally {
      modalEditor.destroy();
      dialog.close();
      dialog.remove();
    }
    view.focus();
    await settleToolbar();
  }

  for (const source of [
    "before\n\n$$\nx^2\n$$\n\nafter",
    "before\n\n$$\n\n$$\n\nafter",
  ]) {
    const from = source.indexOf("$$");
    const to = source.lastIndexOf("$$") + 2;
    reset(source, from - 1);
    press("ArrowDown");
    equal(view.state.selection.main.head, from);
    equal(parent.querySelector(".pkm-math-source") !== null, true);
    reset(source, to + 1);
    press("ArrowUp");
    equal(view.state.selection.main.head, to);
    equal(parent.querySelector(".pkm-math-source") !== null, true);
    equal(view.state.doc.toString(), source);
    reset(source, from - 1);
    press("ArrowRight");
    equal(view.state.selection.main.head, from);
    press("ArrowRight");
    equal(view.state.selection.main.head, from + 1);
    reset(source, to + 1);
    press("ArrowLeft");
    equal(view.state.selection.main.head, to);
    press("ArrowLeft");
    equal(view.state.selection.main.head, to - 1);
    reset(source, from - 1);
    press("ArrowDown", true);
    equal(view.state.selection.main.anchor, from - 1);
    equal(view.state.selection.main.head, from);
  }

  for (const [prefix, indent] of [
    ["", ""],
    ["- ", "  "],
    ["1. ", "   "],
    ["- parent\n  - ", "    "],
  ] as const) {
    reset(prefix + "$$$$", prefix.length + 2);
    press("Enter");
    equal(
      view.state.doc.toString(),
      prefix + "$$\n" + indent + "\n" + indent + "$$",
    );
    equal(view.state.selection.main.head, prefix.length + 3 + indent.length);
    press("Enter");
    equal(
      view.state.doc.toString(),
      prefix + "$$\n" + indent + "\n" + indent + "\n" + indent + "$$",
    );
  }
  reset("- $$");
  press("Enter");
  equal(view.state.doc.toString(), "- $$\n  ");
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  press("Enter");
  equal(view.state.doc.toString(), "- $$\n  \n  ");
  reset("- $$\n  x^2\n  $$");
  press("Enter");
  equal(view.state.doc.toString(), "- $$\n  x^2\n  $$\n- ");

  for (const source of [
    "- first\n-   ",
    "1. first\n2. ",
    "- [x] done\n- [ ]  ",
  ]) {
    reset(source);
    press("Enter");
    equal(
      view.state.doc.toString(),
      source.slice(0, source.lastIndexOf("\n") + 1),
    );
  }
  reset("1.\tfirst");
  press("Enter");
  equal(view.state.doc.toString(), "1.\tfirst\n2. ");
  reset("-   [x] done");
  press("Enter");
  equal(view.state.doc.toString(), "-   [x] done\n- [ ] ");
  reset("1. parent\n2. child");
  press("Tab");
  equal(view.state.doc.toString(), "1. parent\n   1. child");
  press("Tab", true);
  equal(view.state.doc.toString(), "1. parent\n2. child");
  reset("-   text", 4);
  press("Backspace");
  equal(view.state.doc.toString(), "text");
  reset("- text");
  press("Enter", true);
  equal(view.state.doc.toString(), "- text\n  ");

  for (const html of [
    "<strong>太字</strong>",
    '<span style="font-weight:700">太字</span>',
    "<p><b>太字</b></p>",
  ]) {
    reset("- 前後", 3);
    paste(html);
    equal(view.state.doc.toString(), "- 前**太字**後");
  }
  reset("- ");
  paste("<ul><li>one</li><li><b>two</b></li></ul>", "one\ntwo");
  equal(view.state.doc.toString(), "- one\n- **two**");
  for (const prefix of ["", "- ", "- [ ] ", "- 親\n  - "]) {
    reset(prefix);
    paste(
      "<ul><li>[ ] 未完了</li><li>[x] 完了</li></ul>",
      "[ ] 未完了\n[x] 完了",
    );
    const expected = prefix.startsWith("- 親")
      ? "- 親\n  - [ ] 未完了\n  - [x] 完了"
      : "- [ ] 未完了\n- [x] 完了";
    equal(view.state.doc.toString(), expected);
    equal(undo(view), true);
    equal(view.state.doc.toString(), prefix);
    equal(redo(view), true);
    equal(view.state.doc.toString(), expected);
    const boxes =
      parent.querySelectorAll<HTMLInputElement>(".pkm-task-checkbox");
    equal(boxes.length, 2);
    equal(boxes[0]!.checked, false);
    equal(boxes[1]!.checked, true);
    boxes[0]!.click();
    equal(view.state.doc.toString(), expected.replace("[ ]", "[x]"));
  }
  reset("- item ");
  paste("<p>one</p><p>two</p>", "one\ntwo");
  equal(view.state.doc.toString(), "- item one\n  \n  two");
  reset("- 前後", 3);
  paste("<b> 太字 </b>", " 太字 ");
  equal(view.state.doc.toString(), "- 前 **太字** 後");
  reset("```md\n\n```", 6);
  paste("<b>太字</b>");
  equal(view.state.doc.toString(), "```md\n太字\n```");
  const tsvTable = "名前\t値\r\n左|右\t**日本語**\r\n";
  const tsvMarkdown = "| 名前 | 値 |\n| --- | --- |\n| 左\\|右 | **日本語** |";
  reset("");
  paste("", tsvTable);
  equal(view.state.doc.toString(), "\n" + tsvMarkdown + "\n\n");
  equal(parent.querySelector(".pkm-table-preview table") !== null, true);
  equal(undo(view), true);
  equal(view.state.doc.toString(), "");
  paste("<p>名前\t値<br>左|右\t**日本語**</p>", tsvTable);
  equal(view.state.doc.toString(), "\n" + tsvMarkdown + "\n\n");
  reset("前後", 1);
  paste("", tsvTable);
  equal(view.state.doc.toString(), "前\n\n" + tsvMarkdown + "\n\n後");
  reset("- ");
  paste("", tsvTable);
  equal(parent.querySelector(".pkm-table-preview table") !== null, true);
  equal(readClipboardMarkdown("", "a\tb\nc") === null, true);
  reset("```text\n\n```", 8);
  paste("", tsvTable);
  equal(view.state.doc.toString().startsWith("```text\n名前\t値"), true);
  equal(parent.querySelector(".pkm-table-editor"), null);
  reset("label", 0, 5);
  paste("", "https://example.com");
  equal(view.state.doc.toString(), "[label](https://example.com)");
  reset("- text");
  handle.setReadOnly(true);
  paste("<b>太字</b>");
  equal(view.state.doc.toString(), "- text");
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  equal(view.state.doc.toString(), "- text");
  handle.setReadOnly(false);

  for (const prefix of ["- ", "1. ", "- [ ] "]) {
    reset(prefix);
    document.execCommand("insertText", false, "      ");
    await new Promise((resolve) => setTimeout(resolve, 30));
    equal(view.state.doc.toString(), prefix);
    document.execCommand("insertText", false, "本文");
    await new Promise((resolve) => setTimeout(resolve, 30));
    equal(view.state.doc.toString(), prefix + "本文");
    press("Enter");
    equal(
      view.state.doc.toString(),
      prefix + "本文\n" + (prefix === "1. " ? "2. " : prefix),
    );
  }

  reset("-   text\n1. first\n2. second");
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  equal(parent.querySelector(".pkm-editor-bullet")?.textContent, "•");
  equal(parent.querySelectorAll(".pkm-editor-ordered-number").length, 2);
  // The marker remains rendered when the caret is in this item's content.
  reset("-   text", 4);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  equal(parent.querySelector(".pkm-editor-bullet")?.textContent, "•");
  equal(parent.querySelector(".cm-line")?.textContent?.includes("-"), false);

  const formatKey = (key: string, shiftKey = false) => {
    const event = new KeyboardEvent("keydown", {
      key,
      keyCode:
        key === "ArrowDown"
          ? 40
          : key === "ArrowUp"
            ? 38
            : key.toUpperCase().charCodeAt(0),
      ...(/Mac/.test(navigator.platform)
        ? { metaKey: true }
        : { ctrlKey: true }),
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    equal(event.defaultPrevented, true);
  };
  const type = async (text: string) => {
    document.execCommand("insertText", false, text);
    await new Promise((resolve) => setTimeout(resolve, 30));
  };

  for (const prefix of ["", "- ", "1. ", "折り返す日本語の本文".repeat(8)]) {
    for (const formatted of [false, true]) {
      reset(prefix);
      if (formatted) formatKey("b");
      const compositionTarget =
        (Reflect.get(view.contentDOM, "editContext") as EventTarget | null) ??
        view.contentDOM;
      compositionTarget.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      view.dispatch({
        changes: { from: prefix.length, insert: "に" },
        selection: { anchor: prefix.length, head: prefix.length + 1 },
        userEvent: "input.type.compose",
      });
      equal(view.state.doc.toString(), prefix + "に");
      await new Promise((resolve) => setTimeout(resolve, 90));
      equal(view.state.doc.toString(), prefix + "に");
      view.dispatch({
        changes: {
          from: prefix.length,
          to: prefix.length + 1,
          insert: "日本語",
        },
        selection: { anchor: prefix.length, head: prefix.length + 3 },
        userEvent: "input.type.compose",
      });
      compositionTarget.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          data: "日本語",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 130));
      equal(
        view.state.doc.toString(),
        prefix + (formatted ? "**日本語**" : "日本語"),
      );
      equal(view.state.selection.main.empty, true);
      equal(window.getSelection()!.isCollapsed, true);
      await type("続き");
      equal(
        view.state.doc.toString(),
        prefix + (formatted ? "**日本語続き**" : "日本語続き"),
      );
      equal(view.state.selection.main.empty, true);
    }
  }

  if (/Mac/.test(navigator.platform)) {
    const optionBackspace = () => {
      const event = new KeyboardEvent("keydown", {
        key: "Backspace",
        keyCode: 8,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      equal(event.defaultPrevented, true);
    };
    for (const prefix of ["", "- ", "1. ", "- [ ] ", "- 親\n  - [x] "]) {
      reset(prefix + "日本語の入力");
      for (const remaining of ["日本語の", "日本語", "", ""]) {
        optionBackspace();
        equal(view.state.doc.toString(), prefix + remaining);
      }
      equal(undo(view), true);
      equal(view.state.doc.toString(), prefix + "日本語の入力");
    }
    reset("前 選択範囲 後", 2, 6);
    optionBackspace();
    equal(view.state.doc.toString(), "前  後");
    reset("日本語の入力");
    handle.setReadOnly(true);
    optionBackspace();
    equal(view.state.doc.toString(), "日本語の入力");
    handle.setReadOnly(false);

    for (const source of [
      "- [ ] 本文",
      "- [x] 本文",
      "- [ ] ",
      "- [ ]",
      "- [x]",
      "1. [ ] 本文",
    ]) {
      reset(source);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const event = new KeyboardEvent("keydown", {
        key: "Backspace",
        keyCode: 8,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      equal(event.defaultPrevented, true);
      equal(view.state.doc.toString(), "");
      equal(undo(view), true);
      equal(view.state.doc.toString(), source);
    }
  }

  for (const prefix of ["", "before\n\n", "- item\n\n"]) {
    reset(prefix);
    for (let count = 1; count <= 3; count++) {
      await type("-");
      equal(view.state.doc.toString(), prefix + "-".repeat(count));
      equal(
        parent.querySelectorAll(".pkm-editor-bullet").length,
        prefix.startsWith("- ") ? 1 : 0,
      );
      equal(view.state.selection.main.head, prefix.length + count);
    }
    press("Enter");
    equal(view.state.doc.toString(), prefix + "---\n");
    equal(parent.querySelector(".pkm-editor-rule") !== null, true);
  }
  reset("");
  await type("-");
  await type(" ");
  equal(view.state.doc.toString(), "- ");
  equal(parent.querySelector(".pkm-editor-bullet")?.textContent, "•");
  await type("item");
  press("Enter");
  equal(view.state.doc.toString(), "- item\n- ");

  for (const prefix of [
    "- ",
    "1. ",
    "- [ ] ",
    "- parent\n  - ",
    "- first\n- ",
  ]) {
    for (const marker of ["-", "[]", "- []", "1."]) {
      reset(prefix);
      for (const character of marker + " ") await type(character);
      const expected =
        (prefix.startsWith("- parent")
          ? marker === "1."
            ? "- parent\n\n  "
            : "- parent\n  "
          : prefix.startsWith("- first")
            ? marker === "1."
              ? "- first\n\n"
              : "- first\n"
            : "") +
        (marker.includes("[]") ? "- [ ]" : marker) +
        " ";
      equal(view.state.doc.toString(), expected);
      equal(
        parent.querySelector(
          marker.includes("[]")
            ? ".pkm-task-checkbox"
            : marker === "1."
              ? ".pkm-editor-ordered-number"
              : ".pkm-editor-bullet",
        ) !== null,
        true,
      );
      await type("item");
      equal(view.state.doc.toString(), expected + "item");
    }
  }

  const blockSource =
    "- first\n- second\n  continuation\n  - child\n- third\n\nafter";
  reset(blockSource);
  const selectBullet = (index: number, shiftKey = false) => {
    const bullet =
      parent.querySelectorAll<HTMLElement>(".pkm-editor-bullet")[index]!;
    bullet.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 0,
        bubbles: true,
        cancelable: true,
        shiftKey,
      }),
    );
  };
  selectBullet(1);
  equal(view.state.selection.main.empty, true);
  equal(view.state.selection.main.head, blockSource.indexOf("second"));
  equal(parent.querySelectorAll(".pkm-editor-bullet").length, 4);
  press("Tab");
  equal(
    view.state.doc.toString(),
    "- first\n  - second\n    continuation\n    - child\n- third\n\nafter",
  );
  press("Tab", true);
  equal(view.state.doc.toString(), blockSource);
  selectBullet(3, true);
  equal(view.state.selection.main.anchor, blockSource.indexOf("second"));
  equal(view.state.selection.main.head, blockSource.indexOf("third"));
  // Moving the caret onto a marker never selects the nested item.
  selectBullet(2);
  equal(view.state.selection.main.empty, true);
  equal(view.state.selection.main.head, blockSource.indexOf("child"));

  // Selection never exposes prefixes or changes line geometry.
  reset("- first\n- second\n- third", 2, 8);
  equal(parent.querySelectorAll(".pkm-editor-bullet").length, 3);
  const listHeight = view.contentDOM.getBoundingClientRect().height;
  view.dispatch({ selection: { anchor: 0, head: 16 } });
  equal(parent.querySelectorAll(".pkm-editor-bullet").length, 3);
  equal(view.contentDOM.getBoundingClientRect().height, listHeight);
  press("Tab");
  equal(view.state.doc.toString(), "- first\n- second\n- third");

  reset("1. first\n2. second\n3. third");
  const numberHandle = parent.querySelectorAll<HTMLElement>(
    ".pkm-editor-ordered-number",
  )[1]!;
  numberHandle.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  equal(view.state.selection.main.empty, true);
  equal(view.state.selection.main.head, "1. first\n2. ".length);
  press("Tab");
  equal(view.state.doc.toString(), "1. first\n   1. second\n2. third");

  // Editing ordinary text must retain the formula DOM, even when document
  // offsets move. Replacing a preview here changes layout during input.
  const stableMathSource =
    "before\n\n$$\n\\frac{x}{y}\n$$\n\nbetween $z^2$ text\n\nafter";
  reset(stableMathSource, 0);
  const mathPreviews = () =>
    Array.from(
      parent.querySelectorAll<HTMLElement>(".pkm-math-block, .pkm-math-inline"),
    );
  const originalMath = mathPreviews();
  const originalKatex = originalMath.map((element) => element.firstChild);
  equal(originalMath.length, 2);
  const assertStableMath = () => {
    const current = mathPreviews();
    equal(current.length, originalMath.length);
    current.forEach((element, index) => {
      equal(element === originalMath[index], true);
      equal(element.firstChild === originalKatex[index], true);
    });
  };
  await type("追加");
  assertStableMath();
  press("Enter");
  assertStableMath();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  await type("末尾");
  assertStableMath();
  const between = view.state.doc.toString().indexOf("between");
  view.dispatch({ selection: { anchor: between } });
  await type("中間");
  assertStableMath();
  formatKey("z");
  assertStableMath();
  formatKey("z", true);
  assertStableMath();

  // A click on ordinary text must not expand every formula for one frame.
  const beforeMouseHeight = view.contentDOM.getBoundingClientRect().height;
  const textLine = parent.querySelector<HTMLElement>(".cm-line")!;
  textLine.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      buttons: 1,
    }),
  );
  assertStableMath();
  equal(view.contentDOM.getBoundingClientRect().height, beforeMouseHeight);
  window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  assertStableMath();

  // Reused widgets must resolve their current offset when clicked, including
  // after text has been inserted before them.
  const shiftedSource = view.state.doc.toString();
  originalMath[0]!.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  equal(view.state.selection.main.head, shiftedSource.indexOf("$$") + 1);
  equal(parent.querySelectorAll(".pkm-math-source").length > 0, true);
  equal(parent.querySelector(".pkm-math-inline") === originalMath[1], true);
  window.dispatchEvent(new MouseEvent("mouseup"));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  view.dispatch({ selection: { anchor: 0 } });
  const refreshedBlock = parent.querySelector(".pkm-math-block");
  equal(refreshedBlock !== null, true);

  // Preserve previews throughout a drag; expose only the selected formula
  // once the pointer is released, when the browser has fixed the selection.
  const firstLine = parent.querySelector<HTMLElement>(".cm-line")!;
  firstLine.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      buttons: 1,
    }),
  );
  view.dispatch({
    selection: {
      anchor: shiftedSource.indexOf("$$") - 1,
      head: shiftedSource.indexOf("between") - 1,
    },
  });
  equal(parent.querySelector(".pkm-math-block") === refreshedBlock, true);
  equal(parent.querySelector(".pkm-math-inline") === originalMath[1], true);
  window.dispatchEvent(new MouseEvent("mouseup"));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  equal(parent.querySelector(".pkm-math-block"), null);
  equal(parent.querySelector(".pkm-math-inline") === originalMath[1], true);
  equal(view.state.doc.toString(), shiftedSource);
  for (const [key, shift, delimiter, className] of [
    ["b", false, "**", ".cm-strong"],
    ["i", false, "*", ".cm-emphasis"],
    ["x", true, "~~", ".cm-strikethrough"],
  ] as const) {
    reset("word", 0, 4);
    formatKey(key, shift);
    equal(view.state.doc.toString(), delimiter + "word" + delimiter);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    equal(parent.querySelector(".cm-line")?.textContent, "word");
    equal(parent.querySelector(className)?.textContent, "word");
    formatKey(key, shift);
    equal(view.state.doc.toString(), "word");

    reset("", 0);
    formatKey(key, shift);
    equal(view.state.doc.toString(), "");
    await type("本文");
    equal(view.state.doc.toString(), delimiter + "本文" + delimiter);
    await type("続き");
    equal(view.state.doc.toString(), delimiter + "本文続き" + delimiter);
    formatKey(key, shift);
    await type("通常");
    equal(
      view.state.doc.toString(),
      delimiter + "本文続き" + delimiter + "通常",
    );
  }
  reset("word", 0, 4);
  formatKey("b");
  formatKey("i");
  equal(view.state.doc.toString(), "***word***");
  formatKey("b");
  equal(view.state.doc.toString(), "*word*");
  reset("- ");
  formatKey("b");
  await type("項目");
  equal(view.state.doc.toString(), "- **項目**");
  reset("-   ");
  formatKey("b");
  await type("項目");
  equal(view.state.doc.toString(), "- **項目**");
  reset("`code`", 1, 5);
  formatKey("b");
  equal(view.state.doc.toString(), "`code`");
  reset("word", 0, 4);
  handle.setReadOnly(true);
  formatKey("i");
  equal(view.state.doc.toString(), "word");
  handle.setReadOnly(false);

  reset("**word**", 2);
  press("Backspace");
  equal(view.state.doc.toString(), "word");
  reset("~~word~~", 6);
  press("Delete");
  equal(view.state.doc.toString(), "word");
  reset("**字**", 3);
  press("Backspace");
  equal(view.state.doc.toString(), "");
  await type("次");
  equal(view.state.doc.toString(), "**次**");

  const searchSource = "検索対象\n別の本文\n検索対象";
  const searchKey = (key: string, shiftKey = false) => {
    const event = new KeyboardEvent("keydown", {
      key,
      keyCode: key === "Enter" ? 13 : key === "Escape" ? 27 : 70,
      ...(/Mac/.test(navigator.platform)
        ? { metaKey: key === "f" }
        : { ctrlKey: key === "f" }),
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement?.dispatchEvent(event);
    equal(event.defaultPrevented, true);
  };
  const searchInput = () => {
    const input = parent.querySelector<HTMLInputElement>(
      '.cm-search input[name="search"]',
    );
    if (input === null) throw new Error("Search panel did not open");
    return input;
  };
  const searchFor = (query: string) => {
    const input = searchInput();
    input.value = query;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  reset(searchSource, 0);
  searchKey("f");
  equal(document.activeElement, searchInput());
  equal(parent.querySelector(".cm-panels-top") !== null, true);
  searchFor("検索対象");
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  equal(parent.querySelectorAll(".cm-searchMatch").length, 2);
  equal(parent.querySelector(".pkm-search-count")?.textContent, "– / 2");
  searchKey("Enter");
  equal(view.state.selection.main.from, 0);
  equal(view.state.selection.main.to, "検索対象".length);
  equal(parent.querySelector(".pkm-search-count")?.textContent, "1 / 2");
  searchKey("Enter");
  equal(view.state.selection.main.from, searchSource.lastIndexOf("検索対象"));
  searchKey("Enter");
  equal(view.state.selection.main.from, 0);
  searchKey("Enter", true);
  equal(view.state.selection.main.from, searchSource.lastIndexOf("検索対象"));
  searchFor("存在しない語句");
  equal(parent.querySelector(".pkm-search-count")?.textContent, "一致なし");
  searchKey("Enter");
  equal(view.state.selection.main.from, searchSource.lastIndexOf("検索対象"));
  equal(view.state.doc.toString(), searchSource);
  searchKey("Escape");
  equal(parent.querySelector(".cm-search"), null);
  equal(view.hasFocus, true);

  // Opening search initializes its query from the selected text, and Escape
  // from the document must close search before the editor's blur binding runs.
  reset(searchSource, 0, "検索対象".length);
  searchKey("f");
  equal(searchInput().value, "検索対象");
  view.focus();
  searchKey("Escape");
  equal(parent.querySelector(".cm-search"), null);
  equal(view.hasFocus, true);

  handle.setReadOnly(true);
  reset(searchSource, 0);
  searchKey("f");
  equal(parent.querySelector('.cm-search input[name="replace"]'), null);
  searchFor("別の本文");
  searchKey("Enter");
  equal(view.state.selection.main.from, searchSource.indexOf("別の本文"));
  equal(view.state.doc.toString(), searchSource);
  searchKey("Escape");
  handle.setReadOnly(false);

  // The search overlay stays visible without changing the document layout or
  // scrolling to the first line, even when the caret is still at that line.
  const settleSearch = async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  };
  const longSearchSource = Array.from(
    { length: 180 },
    (_, i) => `本文 ${i} 検索対象`,
  ).join("\n");
  reset(longSearchSource, 0);
  await settleSearch();
  window.scrollTo(0, 900);
  await settleSearch();
  const pageScroll = window.scrollY;
  equal(pageScroll > 0, true);
  const contentTop = view.contentDOM.getBoundingClientRect().top;
  if (window.matchMedia("(max-width: 47.99em)").matches) {
    const toolbar = parent.querySelector<HTMLElement>(".pkm-markdown-toolbar")!;
    equal(toolbar.getBoundingClientRect().top >= 0, true);
    equal(toolbar.getBoundingClientRect().right <= window.innerWidth, true);
  }
  searchKey("f");
  await settleSearch();
  equal(window.scrollY, pageScroll);
  equal(view.contentDOM.getBoundingClientRect().top, contentTop);
  const panel = parent.querySelector<HTMLElement>(".pkm-editor-search")!;
  equal(getComputedStyle(panel).position, "fixed");
  equal(
    getComputedStyle(panel.querySelector('[name="close"]')!).position,
    "static",
  );
  equal(panel.getBoundingClientRect().top >= 0, true);
  equal(panel.getBoundingClientRect().right <= window.innerWidth, true);
  const panelTop = panel.getBoundingClientRect().top;
  window.scrollTo(0, pageScroll + 300);
  await settleSearch();
  equal(panel.getBoundingClientRect().top, panelTop);
  view.focus();
  const reopenScroll = window.scrollY;
  searchKey("f");
  await settleSearch();
  equal(window.scrollY, reopenScroll);
  equal(document.activeElement, searchInput());
  searchFor("本文");
  searchInput().setSelectionRange(1, 1);
  searchKey("f");
  equal(searchInput().selectionStart, 0);
  equal(searchInput().selectionEnd, 2);
  searchKey("Escape");
  await settleSearch();
  equal(window.scrollY, reopenScroll);
  equal(parent.querySelector(".pkm-editor-search"), null);

  window.scrollTo(0, 0);
  const parentStyle = parent.style.cssText;
  const editorStyle = view.dom.style.cssText;
  parent.style.height = "300px";
  parent.style.overflow = "auto";
  view.dom.style.height = "auto";
  view.focus();
  await settleSearch();
  parent.scrollTop = 800;
  await settleSearch();
  const innerScroll = parent.scrollTop;
  equal(innerScroll > 0, true);
  searchKey("f");
  await settleSearch();
  equal(parent.scrollTop, innerScroll);
  const innerPanelTop = parent
    .querySelector(".pkm-editor-search")!
    .getBoundingClientRect().top;
  parent.scrollTop += 200;
  await settleSearch();
  equal(
    parent.querySelector(".pkm-editor-search")!.getBoundingClientRect().top,
    innerPanelTop,
  );
  searchFor("検索対象");
  equal(parent.querySelector(".pkm-search-count")?.textContent, "– / 180");
  searchKey("Escape");
  parent.style.cssText = parentStyle;
  view.dom.style.cssText = editorStyle;
  parent.scrollTop = 0;

  reset("Word word", 0);
  searchKey("f");
  searchFor("word");
  equal(parent.querySelector(".pkm-search-count")?.textContent, "– / 2");
  parent.querySelector<HTMLButtonElement>('[name="caseSensitive"]')!.click();
  equal(parent.querySelector(".pkm-search-count")?.textContent, "– / 1");
  parent.querySelector<HTMLButtonElement>('[name="regexp"]')!.click();
  searchFor("[");
  equal(searchInput().getAttribute("aria-invalid"), "true");
  equal(parent.querySelector(".pkm-search-count")?.textContent, "無効な式");
  parent.querySelector<HTMLButtonElement>('[name="regexp"]')!.click();
  searchFor("word");
  const replacement =
    parent.querySelector<HTMLInputElement>('[name="replace"]')!;
  replacement.value = "replaced";
  replacement.dispatchEvent(new Event("input", { bubbles: true }));
  parent.querySelector<HTMLButtonElement>('[name="replaceAll"]')!.click();
  equal(view.state.doc.toString(), "Word replaced");
  parent.querySelector<HTMLButtonElement>('[name="close"]')!.click();
  equal(parent.querySelector(".pkm-editor-search"), null);

  // Code preview has a language menu, and keyboard movement enters its body.
  const codeSourceForKeys =
    "before\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nafter";
  const codeStart = codeSourceForKeys.indexOf("const a");
  const codeEnd = codeSourceForKeys.indexOf(";\n```") + 1;
  const fenceStart = codeSourceForKeys.indexOf("```");
  const fenceEnd = codeSourceForKeys.lastIndexOf("```") + 3;
  for (const [key, from, expected] of [
    ["ArrowDown", fenceStart - 1, codeStart],
    ["ArrowRight", fenceStart - 1, codeStart],
    ["ArrowUp", fenceEnd + 1, codeEnd],
    ["ArrowLeft", fenceEnd + 1, codeEnd],
  ] as const) {
    reset(codeSourceForKeys, from);
    press(key);
    equal(view.state.selection.main.head, expected);
    equal(parent.querySelector(".cm-codeblock-widget"), null);
    equal(parent.querySelector(".pkm-code-header") !== null, true);
  }
  reset(codeSourceForKeys, codeStart);
  press("ArrowRight");
  equal(view.state.selection.main.head, codeStart + 1);
  formatKey("ArrowDown");
  equal(view.state.selection.main.head, codeEnd);
  formatKey("ArrowUp", true);
  equal(view.state.selection.main.anchor, codeEnd);
  equal(view.state.selection.main.head, codeStart);
  formatKey("ArrowDown");
  equal(view.state.selection.main.head, codeEnd);
  formatKey("ArrowUp");
  equal(view.state.selection.main.head, codeStart);
  reset(codeSourceForKeys, 0);
  equal(parent.querySelector(".cm-codeblock-fence"), null);
  const languageMenu = () =>
    parent.querySelector<HTMLSelectElement>(".pkm-code-language")!;
  equal(languageMenu().value, "js");
  equal(
    Array.from(languageMenu().options).some(
      (option) => option.value === "python",
    ),
    true,
  );
  languageMenu().value = "python";
  languageMenu().dispatchEvent(new Event("change", { bubbles: true }));
  equal(
    view.state.doc.toString(),
    codeSourceForKeys.replace("```js", "```python"),
  );
  formatKey("z");
  equal(view.state.doc.toString(), codeSourceForKeys);
  handle.setReadOnly(true);
  equal(languageMenu().disabled, true);
  equal(parent.querySelector(".cm-codeblock-fence"), null);
  handle.setReadOnly(false);

  reset("");
  await type("`");
  await type("`");
  await type("`");
  equal(view.state.doc.toString(), "```\n\n```");
  equal(view.state.selection.main.head, 3);
  await type("js");
  press("Enter");
  equal(view.state.doc.toString(), "```js\n\n```");
  equal(view.state.selection.main.head, 6);
  await type("const x = 1;");
  equal(view.state.doc.toString(), "```js\nconst x = 1;\n```");
  reset("```\nconst x = ``\n```", 16);
  await type("`");
  equal(view.state.doc.toString(), "```\nconst x = ```\n```");

  reset(
    "before\n\n```js\n/* comment\ncontinued */\nconst text = '<script>unsafe</script>';\n```\n\nafter",
    0,
  );
  equal(parent.querySelectorAll(".cm-codeblock-line .hljs-comment").length, 2);
  equal(parent.querySelector(".cm-codeblock-widget script"), null);
  reset("before\n\n```\n\n```\n\nafter", 7);
  press("ArrowDown");
  equal(view.state.selection.main.head, 12);
  for (const [prefix, continuation] of [
    ["- ", "  "],
    ["> ", "> "],
    ["  ", "  "],
  ] as const) {
    reset(prefix + "``");
    await type("`");
    equal(
      view.state.doc.toString(),
      prefix + "```\n" + continuation + "\n" + continuation + "```",
    );
    press("Enter");
    equal(
      view.state.selection.main.head,
      prefix.length + 4 + continuation.length,
    );
  }
  // A fence ends a lazy list continuation. Only indentation actually present
  // on its opening line belongs on the automatically inserted closing fence.
  for (const prefix of [
    "- first\n- second\n",
    "123. item\n",
    "- outer\n  - inner\n",
    "- item\n\n",
    "- item\n  ",
    "> - item\n> ",
  ]) {
    reset(prefix + "``");
    await type("`");
    const indentation = prefix.slice(prefix.lastIndexOf("\n") + 1);
    equal(
      view.state.doc.toString(),
      prefix + "```\n" + indentation + "\n" + indentation + "```",
    );
    press("Enter");
    equal(
      view.state.selection.main.head,
      prefix.length + 4 + indentation.length,
    );
    await type("code");
    equal(
      view.state.doc.toString(),
      prefix + "```\n" + indentation + "code\n" + indentation + "```",
    );
  }
  reset("``\nexisting\n```", 2);
  await type("`");
  equal(view.state.doc.toString(), "```\nexisting\n```");
  reset("before\n\n```custom title\ncode\n```", 0);
  equal(languageMenu().value, "custom");
  languageMenu().value = "python";
  languageMenu().dispatchEvent(new Event("change", { bubbles: true }));
  equal(view.state.doc.toString(), "before\n\n```python title\ncode\n```");

  for (const source of [
    "> ```js\n> const first = 1;\n> const second = 2;\n> ```\n\nafter",
    "- ```js\n  const first = 1;\n  const second = 2;\n  ```\n\nafter",
  ]) {
    reset(source, source.length);
    equal(
      parent.querySelector(".cm-codeblock-widget pre")?.textContent,
      "const first = 1;const second = 2;",
    );
    const clipboard = navigator.clipboard;
    const originalWrite = clipboard.writeText.bind(clipboard);
    let copied = "";
    clipboard.writeText = (text) => {
      copied = text;
      return Promise.resolve();
    };
    try {
      parent.querySelector<HTMLButtonElement>(".pkm-code-copy")!.click();
      await settleSearch();
      equal(copied, "const first = 1;\nconst second = 2;");
    } finally {
      clipboard.writeText = originalWrite;
    }
    equal(view.state.doc.toString(), source);
  }

  // Long code lines wrap in preview and while editing, without adding newlines
  // or making each source line its own horizontal scroll container.
  const codeParentStyle = parent.style.cssText;
  const longCode =
    '  const message = "Designed and developed an automated system to collect and analyze advertising performance data and generate reports in standardized, reproducible formats. ' +
    'Designed and developed an automated system to collect and analyze advertising performance data.";';
  const longToken = "  " + "long_identifier_".repeat(30);
  for (const width of [Math.min(640, window.innerWidth - 16), 280]) {
    parent.style.width = `${width}px`;
    for (const language of ["", "js"]) {
      const codeSource = `before\n\n\`\`\`${language}\n${longCode}\n\n\tindented\n${longToken}\n\`\`\`\n\nafter`;
      reset(codeSource, 0);
      await settleSearch();
      const preview = parent.querySelector<HTMLElement>(
        ".cm-codeblock-widget pre",
      )!;
      const codeLines = preview.querySelectorAll<HTMLElement>(
        ".cm-codeblock-line:not(.cm-codeblock-fence)",
      );
      equal(codeLines.length, 4);
      equal(codeLines[0]!.textContent, longCode);
      equal(codeLines[0]!.offsetHeight > codeLines[2]!.offsetHeight, true);
      equal(codeLines[3]!.offsetHeight > codeLines[2]!.offsetHeight, true);
      equal(preview.scrollWidth <= preview.clientWidth + 1, true);
      equal(view.scrollDOM.scrollWidth <= view.scrollDOM.clientWidth + 1, true);

      // Click a character on a continuation row, including highlighted spans.
      const clickOffset = 150;
      const walker = document.createTreeWalker(
        codeLines[0]!,
        NodeFilter.SHOW_TEXT,
      );
      let remaining = clickOffset;
      let textNode = walker.nextNode();
      while (textNode && remaining >= textNode.textContent!.length) {
        remaining -= textNode.textContent!.length;
        textNode = walker.nextNode();
      }
      if (!textNode) throw new Error("Code preview text did not render");
      const clickRange = document.createRange();
      clickRange.setStart(textNode, remaining);
      clickRange.setEnd(textNode, remaining + 1);
      codeLines[0]!.scrollIntoView();
      const rect = clickRange.getBoundingClientRect();
      equal(rect.top > codeLines[0]!.getBoundingClientRect().top + 20, true);
      textNode.parentElement!.dispatchEvent(
        new MouseEvent("mousedown", {
          clientX: rect.left + 0.1,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
      equal(
        view.state.selection.main.head,
        codeSource.indexOf(longCode) + clickOffset,
      );
      await settleSearch();
      equal(parent.querySelector(".cm-codeblock-widget"), null);
      const sourceLines = parent.querySelectorAll<HTMLElement>(
        ".cm-codeblock-source",
      );
      equal(sourceLines.length, 6);
      for (const line of sourceLines)
        equal(line.scrollWidth <= line.clientWidth + 1, true);
      equal(sourceLines[1]!.offsetHeight > sourceLines[3]!.offsetHeight, true);
      equal(view.scrollDOM.scrollWidth <= view.scrollDOM.clientWidth + 1, true);
      equal(view.state.doc.toString(), codeSource);
      await type("編集");
      equal(
        view.state.doc.toString(),
        codeSource.replace(
          longCode,
          longCode.slice(0, clickOffset) + "編集" + longCode.slice(clickOffset),
        ),
      );
    }
  }
  parent.style.cssText = codeParentStyle;
  window.scrollTo(0, 0);

  // Tables retain their source while editing one cell at a time.
  const tableSource =
    "前文\n\n| 名前 | 値 |\n| :--- | ---: |\n| 元 | $x^2$ |\n\n後文";
  reset(tableSource, tableSource.indexOf("後文"));
  equal(parent.querySelectorAll(".pkm-table-preview table").length, 1);
  equal(parent.querySelector(".pkm-table-preview th")?.textContent, "名前");
  equal(parent.querySelector(".pkm-table-editor"), null);
  equal(parent.querySelectorAll(".pkm-table-controls button").length, 2);
  equal(parent.querySelector(".pkm-table-preview .katex") !== null, true);
  await settleSearch();
  const tablePreview = parent.querySelector<HTMLElement>(".pkm-table-preview")!;
  const paragraphBefore = [...view.contentDOM.children]
    .find(
      (el) => el.classList.contains("cm-line") && el.textContent === "前文",
    )!
    .getBoundingClientRect();
  const paragraphAfter = [...view.contentDOM.children]
    .find(
      (el) => el.classList.contains("cm-line") && el.textContent === "後文",
    )!
    .getBoundingClientRect();
  const tableBounds = tablePreview.getBoundingClientRect();
  equal(
    Math.abs(
      tableBounds.top - paragraphBefore.bottom - paragraphBefore.height,
    ) < 2,
    true,
  );
  equal(
    Math.abs(paragraphAfter.top - tableBounds.bottom - paragraphAfter.height) <
      2,
    true,
  );
  equal(tablePreview.getBoundingClientRect().height < 180, true);
  equal(view.scrollDOM.scrollWidth <= view.scrollDOM.clientWidth + 1, true);
  equal(
    parent.querySelector(".pkm-table-preview")?.textContent?.includes("後文"),
    false,
  );
  press("Backspace");
  press("Backspace");
  equal(view.state.doc.toString(), tableSource);
  equal(view.contentDOM.textContent?.includes("後文"), true);
  const extraBlank = tableSource.replace("\n\n後文", "\n\n\n後文");
  reset(extraBlank, extraBlank.indexOf("後文"));
  press("Backspace");
  equal(view.state.doc.toString(), tableSource);
  press("Backspace");
  equal(view.state.doc.toString(), tableSource);
  equal(undo(view), true);
  equal(view.state.doc.toString(), extraBlank);
  // Existing source without a separator also keeps the following prose visible.
  const noBlank = tableSource.replace("\n\n後文", "\n後文");
  reset(noBlank, noBlank.indexOf("後文"));
  equal(
    parent.querySelector(".pkm-table-preview")?.textContent?.includes("後文"),
    false,
  );
  equal(
    [...parent.querySelectorAll(".cm-line")].some(
      (line) => line.textContent === "後文",
    ),
    true,
  );
  press("Backspace");
  equal(view.state.doc.toString(), noBlank);
  const terminalTable = "| A | B |\n| --- | --- |\n| a | b |";
  reset(terminalTable);
  press("Enter");
  await type("続く本文");
  equal(view.state.doc.toString(), "\n" + terminalTable + "\n\n続く本文");
  equal(
    parent
      .querySelector(".pkm-table-preview")
      ?.textContent?.includes("続く本文"),
    false,
  );
  reset("");
  paste("", tableSource);
  equal(view.state.doc.toString(), tableSource);
  equal(parent.querySelectorAll(".pkm-table-preview table").length, 1);
  handle.setReadOnly(true);
  equal(view.state.readOnly, true);
  equal(parent.querySelectorAll(".pkm-table-preview table").length, 1);
  equal(view.state.doc.toString(), tableSource);
  handle.setReadOnly(false);
  for (const source of [
    "> | A | B |\n> | --- | --- |\n> | a | b |",
    "- item\n\n  | A | B |\n  | --- | --- |\n  | a | b |",
    "| A | B |\n| --- | --- |\n| | b |",
  ]) {
    reset(source);
    equal(parent.querySelector(".pkm-table-preview th")?.textContent, "A");
    equal(parent.querySelectorAll(".pkm-table-preview td").length, 2);
    equal(
      parent.querySelectorAll(".pkm-table-preview td")[1]?.textContent,
      "b",
    );
  }
  // Focusing any cell preserves the complete table geometry, including wide headers.
  const layoutSource =
    "前文\n\n| count(DISTINCT user_id) | count(DISTINCT artist_id) | count(DISTINCT track_id) |\n| --- | --- | --- |\n| 992 | 107397 | 961416 |\n\n後文";
  reset(layoutSource);
  lastChangedDocument = "";
  const tableGeometry = () =>
    [
      ...parent.querySelectorAll(
        ".pkm-table-preview th, .pkm-table-preview td",
      ),
    ].map((cell) => {
      const rect = cell.getBoundingClientRect();
      return [rect.width, rect.height];
    });
  const dimensions = tableGeometry();
  for (const cell of parent.querySelectorAll<HTMLElement>(
    ".pkm-table-preview th, .pkm-table-preview td",
  )) {
    cell.click();
    const input = cell.querySelector("textarea")!;
    equal(document.activeElement, input);
    const actual = tableGeometry();
    equal(
      actual.every((size, index) =>
        size.every(
          (value, axis) => Math.abs(value - dimensions[index]![axis]!) < 1,
        ),
      ),
      true,
    );
    equal(getComputedStyle(input).outlineStyle, "none");
    equal(getComputedStyle(input).resize, "none");
    equal(
      getComputedStyle(input).fontWeight,
      getComputedStyle(cell).fontWeight,
    );
    equal(view.state.doc.toString(), layoutSource);
    equal(lastChangedDocument, "");
  }
  await settleSearch();
  const tableRect = parent
    .querySelector(".pkm-table-preview table")!
    .getBoundingClientRect();
  const scrollRect = parent
    .querySelector(".pkm-table-scroll")!
    .getBoundingClientRect();
  const rightButton = parent.querySelector<HTMLElement>(
    '[aria-label="列を追加"]',
  )!;
  const bottomButton = parent.querySelector<HTMLElement>(
    '[aria-label="行を追加"]',
  )!;
  const rightHandle = rightButton.getBoundingClientRect();
  const bottomHandle = bottomButton.getBoundingClientRect();
  equal(getComputedStyle(rightButton).visibility, "visible");
  equal(getComputedStyle(bottomButton).visibility, "visible");
  equal(
    rightHandle.left >= scrollRect.right &&
      rightHandle.left < scrollRect.right + 26,
    true,
  );
  equal(Math.abs(rightHandle.top - scrollRect.top) < 1, true);
  equal(Math.abs(rightHandle.height - scrollRect.height) < 1, true);
  equal(Math.abs(bottomHandle.left - scrollRect.left) < 1, true);
  equal(Math.abs(bottomHandle.width - scrollRect.width) < 1, true);
  equal(
    bottomHandle.top >= tableRect.bottom &&
      bottomHandle.top < tableRect.bottom + 5,
    true,
  );
  const followingParagraph = [...view.contentDOM.children].find(
    (el) => el.classList.contains("cm-line") && el.textContent === "後文",
  )!;
  const followingBounds = followingParagraph.getBoundingClientRect();
  equal(bottomHandle.bottom < followingBounds.top, true);
  equal(
    Math.abs(followingBounds.top - tableRect.bottom - followingBounds.height) <
      2,
    true,
  );
  // Both whole edges stay fixed when focus moves to another cell, without
  // pushing the following paragraph down or intercepting its input area.
  (parent.querySelector(".pkm-table-preview th") as HTMLElement).click();
  await settleSearch();
  equal(rightButton.getBoundingClientRect().top, rightHandle.top);
  equal(rightButton.getBoundingClientRect().height, rightHandle.height);
  equal(bottomButton.getBoundingClientRect().left, bottomHandle.left);
  equal(bottomButton.getBoundingClientRect().width, bottomHandle.width);
  equal(followingParagraph.getBoundingClientRect().top, followingBounds.top);
  for (const [button, rect, vertical] of [
    [rightButton, rightHandle, true],
    [bottomButton, bottomHandle, false],
  ] as const) {
    for (const fraction of [0.1, 0.9]) {
      const x = rect.left + rect.width * (vertical ? 0.5 : fraction);
      const y = rect.top + rect.height * (vertical ? fraction : 0.5);
      const hitButton = document.elementFromPoint(x, y)?.closest("button");
      if (hitButton !== button)
        throw new Error(
          `Table edge is not clickable at ${x}, ${y}: ${document.elementFromPoint(x, y)?.outerHTML.slice(0, 300)}; viewport ${innerWidth} × ${innerHeight}`,
        );
      equal(hitButton, button);
    }
  }
  equal(
    document
      .elementFromPoint(
        followingBounds.left + 2,
        followingBounds.top + followingBounds.height / 2,
      )
      ?.closest(".cm-line"),
    followingParagraph,
  );
  // The first pointer click places the caret at the clicked text, rather than the end.
  view.focus();
  parent.querySelector(".pkm-table-scroll")!.scrollLeft = 0;
  const pointerCell = parent.querySelector<HTMLElement>(
    ".pkm-table-preview td",
  )!;
  const text = pointerCell.querySelector(
    ".pkm-table-cell-display",
  )!.firstChild!;
  const hit = document.createRange();
  hit.setStart(text, 1);
  hit.collapse(true);
  const hitRect = hit.getBoundingClientRect();
  pointerCell.dispatchEvent(
    new MouseEvent("click", {
      detail: 1,
      clientX: hitRect.left + 0.1,
      clientY: hitRect.top + hitRect.height / 2,
      bubbles: true,
    }),
  );
  equal(pointerCell.querySelector("textarea")!.selectionStart, 1);
  // Enter moves down an existing row, adding one only at the end.
  const navigationSource =
    "前文\n\n| A | B |\n| --- | --- |\n| a | b |\n| c | d |\n\n後文";
  reset(navigationSource);
  (
    parent.querySelectorAll(".pkm-table-preview tr")[1]!
      .children[0] as HTMLElement
  ).click();
  parent.querySelector("textarea")!.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  equal(parent.querySelector("textarea")!.value, "c");
  equal(view.state.doc.toString(), navigationSource);

  // Editing, keyboard navigation, composition, history and structural changes.
  const editableTable =
    "前文\n\n| A | B |\n| :--- | ---: |\n| **元** | $x^2$ |\n\n後文";
  reset(editableTable);
  const clickCell = (row: number, column: number) => {
    const cell = parent.querySelectorAll(".pkm-table-preview tr")[row]!
      .children[column] as HTMLElement;
    cell.click();
    const input = cell.querySelector("textarea")!;
    equal(document.activeElement, input);
    return input;
  };
  const cellKey = (
    input: HTMLTextAreaElement,
    key: string,
    shiftKey = false,
  ) => {
    const event = new KeyboardEvent("keydown", {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    equal(event.defaultPrevented, true);
  };
  let cellInput = clickCell(1, 0);
  equal(cellInput.value, "**元**");
  cellInput.value = "**編集** ";
  cellInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
  equal(document.activeElement, cellInput);
  equal(cellInput.value, "**編集** ");
  cellInput.value += "日本語|値";
  cellInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
  equal(view.state.doc.toString().includes("**編集** 日本語\\|値"), true);
  cellKey(cellInput, "Enter", true);
  equal(cellInput.value.endsWith("\n"), true);
  equal(view.state.doc.toString().includes("値<br>"), true);
  cellInput.value += "二行目";
  cellInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
  const beforeComposition = view.state.doc.toString();
  cellInput.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true }),
  );
  cellInput.value += "変換";
  cellInput.dispatchEvent(
    new InputEvent("input", { isComposing: true, bubbles: true }),
  );
  cellInput.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
    }),
  );
  equal(view.state.doc.toString(), beforeComposition);
  equal(parent.querySelectorAll(".pkm-table-preview tr").length, 2);
  cellInput.dispatchEvent(
    new CompositionEvent("compositionend", { data: "変換", bubbles: true }),
  );
  equal(document.activeElement, cellInput);
  equal(view.state.doc.toString().includes("二行目変換"), true);
  cellKey(cellInput, "Tab");
  cellInput = parent.querySelector("textarea.pkm-table-cell-input")!;
  equal(cellInput.value, "$x^2$");
  cellKey(cellInput, "Tab", true);
  cellInput = parent.querySelector("textarea.pkm-table-cell-input")!;
  equal(cellInput.value.includes("二行目変換"), true);
  cellKey(cellInput, "Enter");
  equal(parent.querySelectorAll(".pkm-table-preview tr").length, 3);
  cellInput = parent.querySelector("textarea.pkm-table-cell-input")!;
  equal(document.activeElement, cellInput);
  equal(cellInput.value, "");
  equal(undo(view), true);
  equal(parent.querySelectorAll(".pkm-table-preview tr").length, 2);
  equal(redo(view), true);
  equal(parent.querySelectorAll(".pkm-table-preview tr").length, 3);
  (
    parent.querySelector('[aria-label="列を追加"]') as HTMLButtonElement
  ).click();
  equal(parent.querySelectorAll(".pkm-table-preview th").length, 3);
  equal(document.activeElement instanceof HTMLTextAreaElement, true);
  equal(view.state.doc.toString().includes("| :--- | ---: | --- |"), true);
  (
    parent.querySelector('[aria-label="行を追加"]') as HTMLButtonElement
  ).click();
  equal(parent.querySelectorAll(".pkm-table-preview tr").length, 4);
  cellInput = parent.querySelector("textarea.pkm-table-cell-input")!;
  cellKey(cellInput, "Escape");
  equal(document.activeElement, view.contentDOM);
  equal(view.state.doc.toString().endsWith("\n\n後文"), true);
  // Typing into either separator preserves a real blank beside the table.
  reset(tableSource, tableSource.indexOf("後文") - 1);
  await type("直後");
  equal(
    view.state.doc.toString(),
    tableSource.replace("\n\n後文", "\n\n直後\n後文"),
  );
  equal(
    view.state.doc.sliceString(
      view.state.selection.main.head - 2,
      view.state.selection.main.head,
    ),
    "直後",
  );
  equal(undo(view), true);
  equal(view.state.doc.toString(), tableSource);
  reset(tableSource, tableSource.indexOf("| 名前") - 1);
  await type("直前");
  equal(
    view.state.doc.toString(),
    tableSource.replace("前文\n\n", "前文\n直前\n\n"),
  );
  equal(
    view.state.doc.sliceString(
      view.state.selection.main.head - 2,
      view.state.selection.main.head,
    ),
    "直前",
  );
  // A table occupying the entire document gets actual writable boundary lines.
  reset(terminalTable);
  clickCell(1, 0);
  equal(view.state.doc.toString(), "\n" + terminalTable + "\n\n");
  cellInput = parent.querySelector("textarea.pkm-table-cell-input")!;
  cellInput.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true }),
  );
  cellInput.value = "未確定";
  const externalTable =
    "\n" + terminalTable.replace("| a |", "| 外部更新 |") + "\n\n";
  handle.updateDocument(externalTable);
  cellInput.dispatchEvent(
    new CompositionEvent("compositionend", { bubbles: true }),
  );
  equal(view.state.doc.toString(), externalTable);
  equal(parent.querySelector("textarea.pkm-table-cell-input"), null);
  handle.setReadOnly(true);
  equal(parent.querySelectorAll(".pkm-table-controls button").length, 0);
  equal(parent.querySelector("textarea.pkm-table-cell-input"), null);
  handle.setReadOnly(false);

  // Autolinks remain text even when the editor is blurred; clicking cannot
  // swap a leading URL widget underneath the browser's caret hit testing.
  const leadingUrl = "https://example.com/path\n次の行";
  reset(leadingUrl, leadingUrl.length);
  view.contentDOM.blur();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  equal(parent.querySelector("a.pkm-editor-link"), null);
  equal(
    parent.querySelector(".pkm-editor-link-source")?.textContent,
    "https://example.com/path",
  );
  view.dispatch({ selection: { anchor: 0 } });
  view.focus();
  await type("先頭 ");
  equal(view.state.doc.toString(), "先頭 " + leadingUrl);
  const action = (label: string) => {
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".pkm-markdown-action-menu button",
      ),
    ].find((candidate) => candidate.textContent === label);
    if (!button) throw Error(`Missing Markdown action: ${label}`);
    button.click();
  };
  reset("本文", 2);
  const insertionPoint = view.coordsAtPos(2)!;
  const context = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: insertionPoint.left,
    clientY: insertionPoint.top,
  });
  view.contentDOM.dispatchEvent(context);
  equal(context.defaultPrevented, true);
  action("区切り線");
  equal(view.state.doc.toString(), "本文\n\n---");
  reset("本文", 2);
  view.contentDOM.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: insertionPoint.left,
      clientY: insertionPoint.top,
    }),
  );
  action("脚注");
  equal(view.state.doc.toString(), "本文[^1]\n\n[^1]: 脚注");
  reset(tableSource);
  const tableCell = parent.querySelector(".pkm-table-preview td")!;
  tableCell.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 20,
    }),
  );
  action("右に列を追加");
  equal(parent.querySelectorAll(".pkm-table-preview th").length, 3);
  parent
    .querySelector(".pkm-table-preview td")!
    .dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  action("列を削除");
  equal(parent.querySelectorAll(".pkm-table-preview th").length, 2);
  parent
    .querySelector(".pkm-table-preview td")!
    .dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  action("下に行を追加");
  equal(parent.querySelectorAll(".pkm-table-preview tr").length, 3);
  parent
    .querySelectorAll(".pkm-table-preview tbody tr")[1]!
    .querySelector("td")!
    .dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  action("行を削除");
  equal(parent.querySelectorAll(".pkm-table-preview tr").length, 2);
  if (window.matchMedia("(max-width: 47.99em)").matches) {
    (parent.querySelector(".pkm-table-preview td") as HTMLElement).click();
    parent
      .querySelector<HTMLButtonElement>(
        '.pkm-markdown-toolbar button[aria-label="その他の操作"]',
      )!
      .click();
    action("表を削除");
    equal(parent.querySelector(".pkm-table-preview"), null);
  }
  if (nativeTable) {
    handle.destroy();
    const nativeEditor = createMarkdownBodyEditor({
      parent,
      document: tableSource,
      showImagePreview: false,
    });
    const nativeView = nativeEditor.view;
    window.scrollTo(0, 0);
    Reflect.set(globalThis, "tableCheckDocument", () =>
      nativeView.state.doc.toString(),
    );
    Reflect.set(
      globalThis,
      "tableCheckComposition",
      () => nativeView.compositionStarted,
    );
    Reflect.set(globalThis, "tableCheckCancelComposition", () => {
      const target =
        (Reflect.get(
          nativeView.contentDOM,
          "editContext",
        ) as EventTarget | null) ?? nativeView.contentDOM;
      target.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
    });
    Reflect.set(
      globalThis,
      "tableCheckSetDocument",
      (source: string, anchor = source.length) => {
        nativeEditor.updateDocument(source);
        nativeView.dispatch({
          selection: { anchor },
          annotations: isolateHistory.of("full"),
        });
        nativeView.focus();
      },
    );
  } else handle.destroy();
  return { checks };
};
