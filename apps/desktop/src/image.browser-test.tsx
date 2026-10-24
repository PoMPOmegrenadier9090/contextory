import "@mantine/core/styles.css";
import "../../../packages/ui/src/compact.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AppearanceProvider } from "../../../packages/ui/src/appearance-provider.js";
import { ImageSettingsPanel } from "../../../packages/ui/src/image-settings-panel.js";
import { MarkdownBodyPreview } from "../../../packages/ui/src/markdown-body-preview.js";
import {
  createMarkdownBodyEditor,
  MarkdownLiveEditor,
} from "../../../packages/ui/src/markdown-live-editor.js";
import {
  IMAGE_SETTINGS_KEY,
  DEFAULT_IMAGE_SETTINGS,
  readImageSettings,
} from "../../../packages/ui/src/image-settings.js";
import {
  fileToAssetUpload,
  markdownForAsset,
  MAX_UPLOAD_BYTES,
} from "../../../packages/ui/src/asset-links.js";
import { copyImage } from "../../../packages/ui/src/image-clipboard.js";

export const runImageBrowserChecks = async (
  parent: HTMLElement,
  capture = false,
) => {
  let checks = 0;
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected)
      throw new Error(
        `Image check ${checks + 1}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    checks++;
  };
  const settle = async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  };
  const waitFor = async (predicate: () => boolean) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > 5000)
        throw new Error("Image browser checks timed out");
      await settle();
    }
  };
  const previous = localStorage.getItem(IMAGE_SETTINGS_KEY);
  const editorParent = document.createElement("div");
  const reactParent = document.createElement("div");
  parent.append(editorParent, reactParent);
  const root = createRoot(reactParent);
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#e8f0ff";
  context.fillRect(0, 0, 1200, 800);
  context.fillStyle = "#234";
  context.font = "40px sans-serif";
  context.fillText("画像 / Screenshot 123", 40, 100);
  const blob = (await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve),
  ))!;
  const file = new File([blob], "図.png", { type: "image/png" });
  const url = "/apps/web/public/icon-512.png";
  const source = `![図\\[1\\].png|800](${url})\n\n本文`;
  let copied = 0;
  let changed = "";
  const handle = createMarkdownBodyEditor({
    parent: editorParent,
    document: source,
    onCopyImage: (image) => {
      equal(image.naturalWidth, 512);
      copied++;
      return Promise.resolve();
    },
    onChange: (value) => {
      changed = value;
    },
  });
  const widget = () =>
    editorParent.querySelector<HTMLElement>(".pkm-image-widget")!;
  const image = () => widget().querySelector<HTMLImageElement>("img")!;
  const click = (label: string) => {
    const button = [...widget().querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === label,
    )!;
    button.click();
  };
  const size = (label: string) => {
    click("サイズ変更");
    equal(
      widget()
        .querySelector('[aria-label="サイズ変更"][popover]')!
        .matches(":popover-open"),
      true,
    );
    click(`表示サイズ: ${label}`);
  };
  const textTop = () =>
    [...editorParent.querySelectorAll<HTMLElement>(".cm-line")]
      .find((line) => line.textContent === "本文")!
      .getBoundingClientRect().top;
  const undo = () => {
    const mac = navigator.platform.startsWith("Mac");
    const event = new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      metaKey: mac,
      ctrlKey: !mac,
      bubbles: true,
      cancelable: true,
    });
    handle.view.contentDOM.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    localStorage.setItem(
      IMAGE_SETTINGS_KEY,
      JSON.stringify(DEFAULT_IMAGE_SETTINGS),
    );
    await image().decode();
    await settle();
    equal(image().alt, "図[1].png");
    equal(
      image().getBoundingClientRect().width <= editorParent.clientWidth,
      true,
    );
    const textLine = [
      ...editorParent.querySelectorAll<HTMLElement>(".cm-line"),
    ].find((line) => line.textContent === "本文")!;

    equal(
      image().getBoundingClientRect().left,
      textLine.getBoundingClientRect().left +
        parseFloat(getComputedStyle(textLine).paddingLeft),
    );
    const beforeMenu = textTop();
    image().click();
    const frame = widget().querySelector<HTMLElement>(".pkm-image-frame")!;
    const outline = parseFloat(getComputedStyle(frame).outlineWidth);
    equal(
      frame.getBoundingClientRect().left - outline >=
        handle.view.contentDOM.getBoundingClientRect().left,
      true,
    );
    equal(
      frame.getBoundingClientRect().right + outline <=
        handle.view.contentDOM.getBoundingClientRect().right,
      true,
    );
    const bounds = image().getBoundingClientRect();
    for (const side of ["left", "right"]) {
      const resize = widget().querySelector<HTMLElement>(
        `.pkm-image-resize[data-side="${side}"]`,
      )!;
      const control = resize.getBoundingClientRect();
      const bar = resize
        .querySelector<HTMLElement>(".pkm-image-resize-bar")!
        .getBoundingClientRect();
      equal(
        Math.abs(
          bar.top + bar.height / 2 - (control.top + control.height / 2),
        ) < 1,
        true,
      );
      equal(
        Math.abs(
          bar.left + bar.width / 2 - (control.left + control.width / 2),
        ) < 1,
        true,
      );
      equal(
        document.elementFromPoint(
          bar.left + bar.width / 2,
          bar.top + bar.height / 2,
        ),
        resize,
      );
      equal(
        side === "left"
          ? control.right <= bounds.left
          : control.left >= bounds.right,
        true,
      );
      equal(
        control.left >= 0 &&
          control.right <= document.documentElement.clientWidth,
        true,
      );
      equal(getComputedStyle(resize).visibility, "visible");
    }
    equal(
      getComputedStyle(widget().querySelector(".pkm-image-toolbar")!)
        .visibility,
      "visible",
    );
    equal(
      widget().querySelector(".pkm-image-toolbar")!.parentElement!.className,
      "pkm-image-frame",
    );
    equal(widget().querySelectorAll(".pkm-image-toolbar > button").length, 3);
    equal(textTop(), beforeMenu);
    click("サイズ変更");
    const sizePanel = widget().querySelector<HTMLElement>(
      '[aria-label="サイズ変更"][popover]',
    )!;
    equal(sizePanel.matches(":popover-open"), true);
    equal(textTop(), beforeMenu);
    equal(
      sizePanel.getBoundingClientRect().left >= 0 &&
        sizePanel.getBoundingClientRect().right <= window.innerWidth,
      true,
    );
    sizePanel.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    equal(sizePanel.matches(":popover-open"), false);
    equal(textTop(), beforeMenu);
    equal(handle.view.state.doc.toString(), source);
    size("小");
    equal(changed, source.replace("|800", "|240"));
    equal(Math.round(image().getBoundingClientRect().width), 240);
    equal(undo(), true);
    equal(handle.view.state.doc.toString(), source);
    image().click();
    size("自動");
    equal(handle.view.state.doc.toString(), source.replace("|800", ""));
    size("中");
    equal(handle.view.state.doc.toString(), source.replace("|800", "|480"));
    const beforeCopy = textTop();
    click("コピー");
    await waitFor(() => copied === 1);
    await settle();
    equal(textTop(), beforeCopy);
    equal(widget().querySelector(".pkm-image-status")!.textContent, "");
    equal(widget().querySelectorAll(".pkm-image-resize").length, 2);
    const resize = widget().querySelector<HTMLButtonElement>(
      '.pkm-image-resize[data-side="right"]',
    )!;
    resize.focus();
    const initial = image().getBoundingClientRect().width;
    resize.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
        cancelable: true,
      }),
    );
    equal(
      handle.view.state.doc
        .toString()
        .includes(`|${Math.round(initial - 16)}]`),
      true,
    );
    const initialWidth = image().getBoundingClientRect().width;
    // Synthetic pointer events cannot acquire a real pointer; keep the DOM drag
    // handlers and use a capture stub only for this event source.
    resize.setPointerCapture = () => {};
    resize.hasPointerCapture = () => false;
    resize.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        button: 0,
        clientX: 100,
        bubbles: true,
        cancelable: true,
      }),
    );
    resize.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 1, clientX: 60 }),
    );
    resize.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, clientX: 60 }),
    );
    Reflect.deleteProperty(resize, "setPointerCapture");
    Reflect.deleteProperty(resize, "hasPointerCapture");
    equal(
      handle.view.state.doc
        .toString()
        .includes(`|${Math.round(initialWidth - 40)}]`),
      true,
    );
    equal(undo(), true);
    equal(
      handle.view.state.doc
        .toString()
        .includes(`|${Math.round(initial - 16)}]`),
      true,
    );
    const leftResize = widget().querySelector<HTMLButtonElement>(
      '.pkm-image-resize[data-side="left"]',
    )!;
    const beforeLeftResize = image().getBoundingClientRect().width;
    leftResize.setPointerCapture = () => {};
    leftResize.hasPointerCapture = () => false;
    for (const [type, clientX] of [
      ["pointerdown", 100],
      ["pointermove", 140],
      ["pointerup", 140],
    ] as const)
      leftResize.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          button: 0,
          clientX,
          bubbles: true,
          cancelable: true,
        }),
      );
    Reflect.deleteProperty(leftResize, "setPointerCapture");
    Reflect.deleteProperty(leftResize, "hasPointerCapture");
    equal(
      handle.view.state.doc
        .toString()
        .includes(`|${Math.round(beforeLeftResize - 40)}]`),
      true,
    );
    equal(undo(), true);

    const key = (key: string, altKey = false) => {
      handle.view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          altKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    handle.updateDocument(source);
    image().click();
    equal(document.activeElement, handle.view.contentDOM);
    equal(
      handle.view.state.sliceDoc(
        handle.view.state.selection.main.from,
        handle.view.state.selection.main.to,
      ),
      source.split("\n")[0],
    );
    for (const deleteKey of ["Backspace", "Delete"]) {
      key(deleteKey);
      equal(handle.view.state.doc.toString(), "\n\n本文");
      equal(editorParent.querySelector(".pkm-image-widget"), null);
      equal(undo(), true);
      equal(handle.view.state.doc.toString(), source);
      image().click();
    }
    key("ArrowDown", true);
    equal(handle.view.state.doc.toString(), `\n${source.split("\n")[0]}\n本文`);
    equal(widget().dataset.selected, "true");
    key("ArrowUp", true);
    equal(handle.view.state.doc.toString(), source);
    // Hidden image Markdown is one unit for caret navigation and deletion.
    handle.view.dispatch({ selection: { anchor: source.indexOf("\n") } });
    key("ArrowLeft");
    equal(handle.view.state.selection.main.head, 0);
    key("ArrowRight");
    equal(handle.view.state.selection.main.head, source.indexOf("\n") + 1);
    handle.view.dispatch({ selection: { anchor: source.indexOf("\n") } });
    key("Backspace");
    equal(handle.view.state.doc.toString(), "\n\n本文");
    equal(undo(), true);
    handle.view.dispatch({ selection: { anchor: 0 } });
    key("Delete");
    equal(handle.view.state.doc.toString(), "\n\n本文");
    equal(undo(), true);

    const beforeDrop = `${source}\n\n移動先\n\n`;
    handle.updateDocument(beforeDrop);
    handle.view.dispatch({
      selection: { anchor: beforeDrop.length },
      scrollIntoView: true,
    });
    await settle();
    const dropAt = handle.view.coordsAtPos(beforeDrop.length)!;
    const dataTransfer = new DataTransfer();
    equal(image().draggable, true);
    image().dispatchEvent(
      new DragEvent("dragstart", { dataTransfer, bubbles: true }),
    );
    equal(dataTransfer.getData("text/plain"), source.split("\n")[0]);
    handle.view.contentDOM.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer,
        clientX: dropAt.left,
        clientY: (dropAt.top + dropAt.bottom) / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    equal(
      handle.view.state.doc.toString(),
      `\n\n本文\n\n移動先\n\n${source.split("\n")[0]}`,
    );
    equal(editorParent.querySelectorAll(".pkm-image-widget").length, 1);
    equal(undo(), true);
    equal(handle.view.state.doc.toString(), beforeDrop);
    handle.updateDocument(source);
    image().click();
    const beforeMore = textTop();
    click("その他の画像操作");
    equal(
      widget()
        .querySelector('[aria-label="その他の画像操作"][popover]')!
        .matches(":popover-open"),
      true,
    );
    equal(textTop(), beforeMore);
    click("Markdown表示");
    equal(editorParent.querySelector(".pkm-image-widget"), null);
    equal(handle.view.state.selection.main.head, 2);
    handle.view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    equal(editorParent.querySelectorAll(".pkm-image-widget").length, 1);
    image().click();
    click("その他の画像操作");
    click("Markdown表示");
    handle.view.dispatch({
      selection: { anchor: handle.view.state.doc.length },
    });
    equal(editorParent.querySelectorAll(".pkm-image-widget").length, 1);
    handle.updateDocument(source.replace("|800", "|64"));
    image().click();
    const toolbar = widget().querySelector(".pkm-image-toolbar")!;
    equal(
      toolbar.getBoundingClientRect().left >= 0 &&
        toolbar.getBoundingClientRect().right <= window.innerWidth,
      true,
    );
    click("サイズ変更");
    const smallPopup = widget().querySelector(
      '[aria-label="サイズ変更"][popover]',
    )!;
    equal(
      smallPopup.getBoundingClientRect().left >= 0 &&
        smallPopup.getBoundingClientRect().right <= window.innerWidth,
      true,
    );
    window.dispatchEvent(new Event("resize"));
    equal(smallPopup.matches(":popover-open"), false);
    handle.setReadOnly(true);
    image().click();
    equal(
      widget().querySelector<HTMLButtonElement>(
        'button[aria-label="表示サイズ: 小"]',
      )!.disabled,
      true,
    );
    equal(
      widget().querySelector<HTMLButtonElement>(
        'button[aria-label="サイズ変更"]',
      )!.disabled,
      true,
    );
    equal(
      widget().querySelector<HTMLElement>(".pkm-image-resize")!.hidden,
      true,
    );
    equal(image().draggable, false);
    const readOnlyDoc = handle.view.state.doc.toString();
    key("Backspace");
    key("ArrowDown", true);
    equal(handle.view.state.doc.toString(), readOnlyDoc);
    equal(editorParent.scrollWidth <= editorParent.clientWidth, true);

    // Test real WebP encoding, fallback paths, animation preservation and the
    // compressed-byte limit before transport encoding.
    localStorage.setItem(
      IMAGE_SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_IMAGE_SETTINGS, maxDimension: 320 }),
    );
    const upload = await fileToAssetUpload(file, "paste");
    equal(upload.fileName, "図.webp");
    const bytes = Uint8Array.from(atob(upload.dataBase64), (character) =>
      character.charCodeAt(0),
    );
    equal(bytes.length < file.size, true);
    const decoded = await createImageBitmap(
      new Blob([bytes], { type: "image/webp" }),
    );
    equal(decoded.width, 320);
    equal(decoded.height, 213);
    decoded.close();
    equal((await fileToAssetUpload(file)).fileName, "図.png");
    localStorage.setItem(
      IMAGE_SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_IMAGE_SETTINGS, webp: false }),
    );
    equal((await fileToAssetUpload(file, "paste")).fileName, "図.png");
    localStorage.setItem(
      IMAGE_SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_IMAGE_SETTINGS, includeFiles: true }),
    );
    equal((await fileToAssetUpload(file)).fileName, "図.webp");
    const animatedBytes = new Uint8Array(20);
    animatedBytes.set([82, 73, 70, 70], 0);
    animatedBytes.set([87, 69, 66, 80, 65, 78, 73, 77], 8);
    equal(
      (
        await fileToAssetUpload(
          new File([animatedBytes], "animated.webp", { type: "image/webp" }),
          "paste",
        )
      ).fileName,
      "animated.webp",
    );
    equal(
      (
        await fileToAssetUpload(
          new File(["broken"], "broken.png", { type: "image/png" }),
          "paste",
        )
      ).dataBase64,
      btoa("broken"),
    );
    let rejected = false;
    try {
      await fileToAssetUpload(
        new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "large.pdf"),
      );
    } catch {
      rejected = true;
    }
    equal(rejected, true);
    localStorage.setItem(
      IMAGE_SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_IMAGE_SETTINGS, defaultWidth: 480 }),
    );
    const path = "assets/images/12345678-1234-1234-1234-123456789abc.webp";
    equal(
      markdownForAsset({
        path,
        fileName: "図.webp",
        mimeType: "image/webp",
        size: 10,
      }),
      `![図.webp|480](../${path})`,
    );

    root.render(
      <AppearanceProvider storageKey="pkm:test:image-appearance">
        <ImageSettingsPanel />
        <MarkdownBodyPreview body={source} onOpenEntity={() => {}} />
      </AppearanceProvider>,
    );
    await waitFor(() => reactParent.querySelector("input") !== null);
    const toggle = [...reactParent.querySelectorAll("label")].find(
      (label) => label.textContent === "貼り付け画像をWebPに変換",
    )!;
    toggle.click();
    await settle();
    equal(readImageSettings().webp, false);
    const preview = reactParent.querySelector<HTMLImageElement>(
      ".pkm-markdown-content img",
    )!;
    await preview.decode();
    equal(preview.alt, "図[1].png");
    equal(preview.width <= reactParent.clientWidth, true);

    // Validate clipboard PNG construction without replacing the user's clipboard.
    let pngBytes = 0;
    const originalWrite = Object.getOwnPropertyDescriptor(
      navigator.clipboard,
      "write",
    );
    navigator.clipboard.write = async (items) => {
      const png = await items[0]!.getType("image/png");
      pngBytes = png.size;
    };
    try {
      await copyImage(preview);
      equal(pngBytes > 0, true);
      pngBytes = 0;
      await copyImage(
        preview,
        Promise.resolve(new Blob([bytes], { type: "image/webp" })),
      );
      equal(pngBytes > 0, true);
    } finally {
      if (originalWrite)
        Object.defineProperty(navigator.clipboard, "write", originalWrite);
      else Reflect.deleteProperty(navigator.clipboard, "write");
    }
    let pastedName = "";
    const PasteCheck = () => {
      const [body, setBody] = useState("");
      return (
        <AppearanceProvider storageKey="pkm:test:image-appearance">
          <MarkdownLiveEditor
            value={body}
            onChange={setBody}
            onUploadAsset={async (file, source) => {
              const upload = await fileToAssetUpload(file, source);
              pastedName = upload.fileName;
              return {
                path,
                fileName: upload.fileName,
                mimeType: "image/webp",
                size: 10,
              };
            }}
          />
        </AppearanceProvider>
      );
    };
    localStorage.setItem(
      IMAGE_SETTINGS_KEY,
      JSON.stringify(DEFAULT_IMAGE_SETTINGS),
    );
    root.render(<PasteCheck />);
    await waitFor(() => reactParent.querySelector(".cm-content") !== null);
    const transfer = new DataTransfer();
    transfer.items.add(file);
    reactParent.querySelector(".cm-content")!.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitFor(() => pastedName !== "");
    equal(pastedName, "図.webp");
    await waitFor(
      () => reactParent.querySelector(".pkm-image-widget") !== null,
    );
    equal(
      reactParent.querySelector<HTMLImageElement>(".pkm-image-widget img")!.alt,
      "図.webp",
    );
    const consecutive = `前の文章\n![one|80](${url})\n![two|80](${url})\n後の文章`;
    handle.updateDocument(consecutive);
    await Promise.all(
      [...editorParent.querySelectorAll("img")].map((image) => image.decode()),
    );
    await settle();
    handle.view.dispatch({ selection: { anchor: 2 }, scrollIntoView: true });
    handle.view.focus();
    await settle();
    for (const [direction, label] of [
      ["ArrowDown", "one"],
      ["ArrowDown", "two"],
      ["ArrowDown", "後"],
      ["ArrowUp", "two"],
      ["ArrowUp", "one"],
      ["ArrowUp", "前"],
    ] as const) {
      key(direction);
      await settle();
      const from =
        label === "前"
          ? 2
          : label === "後"
            ? consecutive.lastIndexOf("後") + 2
            : consecutive.indexOf(`![${label}`);
      equal(handle.view.state.selection.main.from, from);
      equal(
        handle.view.state.selection.main.empty,
        label === "前" || label === "後",
      );
    }
    equal(handle.view.state.doc.toString(), consecutive);
    key("ArrowDown");
    key("ArrowRight");
    equal(handle.view.state.selection.main.goalColumn, undefined);
    const imageOnly = `![edge|80](${url})`;
    handle.updateDocument(imageOnly);
    await image().decode();
    await settle();
    image().click();
    key("ArrowDown");
    equal(handle.view.state.selection.main.head, imageOnly.length);
    equal(handle.view.state.selection.main.empty, true);
    let caret = handle.view.coordsAtPos(imageOnly.length)!;
    equal(caret.bottom - caret.top <= handle.view.defaultLineHeight, true);
    key("ArrowUp");
    equal(handle.view.state.selection.main.empty, false);
    key("ArrowUp");
    equal(handle.view.state.selection.main.head, 0);
    equal(handle.view.state.selection.main.empty, true);
    caret = handle.view.coordsAtPos(0)!;
    equal(caret.bottom - caret.top <= handle.view.defaultLineHeight, true);
    equal(handle.view.state.doc.toString(), imageOnly);
    handle.updateDocument(source);
    if (capture) {
      Reflect.set(globalThis, "imageCheckDocument", () =>
        handle.view.state.doc.toString(),
      );
      Reflect.set(globalThis, "imageCheckSetDocument", (document: string) => {
        handle.updateDocument(document);
        handle.view.dispatch({ selection: { anchor: 0 } });
        handle.view.focus();
      });
      Reflect.set(globalThis, "imageCheckSelection", () => {
        const selection = handle.view.state.selection.main;
        const coords = handle.view.coordsAtPos(
          selection.head,
          selection.assoc || 1,
        );
        return {
          from: selection.from,
          to: selection.to,
          head: selection.head,
          coords: coords && {
            top: coords.top,
            bottom: coords.bottom,
            left: coords.left,
            right: coords.right,
          },
        };
      });
      root.render(
        <AppearanceProvider storageKey="pkm:test:image-appearance">
          <ImageSettingsPanel />
        </AppearanceProvider>,
      );
      handle.setReadOnly(false);
      image().click();
      size("中");
      await settle();
      widget().scrollIntoView({ block: "start" });
    }
    return { checks };
  } finally {
    if (!capture) {
      handle.destroy();
      root.unmount();
      editorParent.remove();
      reactParent.remove();
    }
    if (previous === null) localStorage.removeItem(IMAGE_SETTINGS_KEY);
    else localStorage.setItem(IMAGE_SETTINGS_KEY, previous);
  }
};
