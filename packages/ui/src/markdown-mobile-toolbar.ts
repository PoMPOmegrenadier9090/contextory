import { indentLess, indentMore } from "@codemirror/commands";
import {
  EditorView,
  showPanel,
  type Command,
  type ViewUpdate,
} from "@codemirror/view";
import {
  isInlineFormatActive,
  toggleInlineFormat,
  type InlineFormat,
} from "./markdown-formatting.js";
import {
  indentMarkdownList,
  outdentMarkdownList,
} from "./markdown-list-commands.js";
import { openMarkdownActionMenu } from "./markdown-action-menu.js";

export const markdownMobileToolbar = [
  showPanel.of((view) => {
    const panel = document.createElement("div");
    const dom = document.createElement("div");
    dom.className = "pkm-markdown-toolbar";
    dom.popover = "manual";
    dom.setAttribute("role", "group");
    dom.setAttribute("aria-label", "本文の書式");
    panel.append(dom);
    const viewport = window.visualViewport;
    let frame: number | null = null;
    let resizePending = true;
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    let avoidCaret = false;
    const position = () => {
      frame = null;
      const visible =
        (view.hasFocus ||
          view.dom.contains(document.activeElement) ||
          dom.contains(document.activeElement)) &&
        view.dom.getClientRects().length > 0;
      if (!visible) {
        if (dom.matches(":popover-open")) dom.hidePopover();
        view.dom.style.removeProperty("--pkm-keyboard-inset");
        resizePending = true;
        return;
      }
      if (scrollTimer !== null) return;
      // The top layer keeps the bar above transformed/clipped Quick Capture dialogs.
      if (!dom.matches(":popover-open")) dom.showPopover();
      const width = viewport?.width ?? window.innerWidth;
      const maxWidth = `${Math.max(0, width - 24)}px`;
      if (dom.style.maxWidth !== maxWidth) dom.style.maxWidth = maxWidth;
      const bottom =
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      const left = (viewport?.offsetLeft ?? 0) + (width - dom.offsetWidth) / 2;
      const transform = `translate3d(${Math.round(left)}px, ${Math.round(bottom - dom.offsetHeight - 8)}px, 0px)`;
      if (dom.style.transform !== transform) dom.style.transform = transform;
      // Panning must never resize the document or pull it back to the caret.
      if (resizePending) {
        const inset = Math.max(
          0,
          window.innerHeight - (viewport?.height ?? window.innerHeight),
        );
        view.dom.style.setProperty("--pkm-keyboard-inset", `${inset}px`);
        resizePending = false;
      }
      delete dom.dataset.scrolling;
      dom.inert = false;
      const caret = view.coordsAtPos(view.state.selection.main.head);
      // Move the bar, rather than the composing text, while the IME owns the caret.
      if (
        view.compositionStarted &&
        caret &&
        caret.bottom > bottom - dom.offsetHeight - 40 &&
        caret.top < bottom
      ) {
        const top = caret.top - dom.offsetHeight - 40;
        if (top >= (viewport?.offsetTop ?? 0) + 8)
          dom.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0px)`;
      }
      if (avoidCaret && view.hasFocus && !view.compositionStarted) {
        avoidCaret = false;
        if (
          caret &&
          caret.bottom > bottom - dom.offsetHeight - 40 &&
          caret.top < bottom
        )
          view.dispatch({
            effects: EditorView.scrollIntoView(view.state.selection.main.head, {
              y: "nearest",
              yMargin: 0,
            }),
          });
      }
    };
    const schedulePosition = () => {
      if (frame === null) frame = requestAnimationFrame(position);
    };
    const resize = () => {
      resizePending = true;
      avoidCaret = true;
      schedulePosition();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && dom.contains(event.target)) return;
      if (dom.matches(":popover-open")) {
        dom.dataset.scrolling = "true";
        dom.inert = true;
        if (scrollTimer !== null) clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
          scrollTimer = null;
          schedulePosition();
        }, 180);
      }
      schedulePosition();
    };
    const click = () => {
      avoidCaret = true;
      schedulePosition();
    };
    const commands: readonly [string, string, Command, InlineFormat?][] = [
      ["太字", "B", toggleInlineFormat("bold"), "bold"],
      ["斜体", "I", toggleInlineFormat("italic"), "italic"],
      ["取り消し線", "S", toggleInlineFormat("strike"), "strike"],
      [
        "インデントを減らす",
        "←",
        (target) => outdentMarkdownList(target) || indentLess(target),
      ],
      [
        "インデントを増やす",
        "→",
        (target) => indentMarkdownList(target) || indentMore(target),
      ],
      [
        "その他の操作",
        "＋",
        () => {
          const bounds = dom.getBoundingClientRect();
          openMarkdownActionMenu(
            view,
            bounds.left,
            bounds.top - 8,
            document.activeElement,
            dom,
          );
          return true;
        },
      ],
      [
        "キーボードを閉じる",
        "",
        () => {
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
          return true;
        },
      ],
    ];
    for (const [label, text, command] of commands) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.title = label;
      button.setAttribute("aria-label", label);
      if (label === "キーボードを閉じる") {
        const icon = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        icon.setAttribute("viewBox", "0 0 24 24");
        icon.setAttribute("width", "24");
        icon.setAttribute("height", "24");
        icon.setAttribute("fill", "none");
        icon.setAttribute("stroke", "currentColor");
        icon.setAttribute("stroke-width", "1.6");
        icon.setAttribute("aria-hidden", "true");
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute(
          "d",
          "M3 4h18v11H3z M6 7h2m2 0h2m2 0h2m2 0h1 M6 10h2m2 0h2m2 0h2m2 0h1 M7 13h10 M8 18l4 3 4-3",
        );
        icon.append(path);
        button.append(icon);
      }
      // Keep the native selection and software keyboard when tapping a command.
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        if (
          view.state.readOnly ||
          (view.composing && label !== "キーボードを閉じる")
        )
          return;
        command(view);
        if (label !== "キーボードを閉じる") view.focus();
      });
      dom.append(button);
    }
    const update = (update?: ViewUpdate) => {
      if (update?.docChanged || update?.selectionSet || update?.focusChanged)
        avoidCaret = true;
      for (const [index, [, , , format]] of commands.entries()) {
        if (!format) continue;
        const button = dom.children[index]!;
        const pressed = String(isInlineFormatActive(view.state, format));
        if (button.getAttribute("aria-pressed") !== pressed)
          button.setAttribute("aria-pressed", pressed);
      }
      schedulePosition();
    };
    return {
      dom: panel,
      top: true,
      update,
      mount() {
        update();
        viewport?.addEventListener("resize", resize);
        viewport?.addEventListener("scroll", scroll);
        window.addEventListener("resize", resize);
        window.addEventListener("scroll", scroll, {
          capture: true,
          passive: true,
        });
        view.contentDOM.addEventListener("click", click);
        view.contentDOM.addEventListener("compositionend", click);
        dom.addEventListener("focusin", schedulePosition);
        dom.addEventListener("focusout", schedulePosition);
      },
      destroy() {
        viewport?.removeEventListener("resize", resize);
        viewport?.removeEventListener("scroll", scroll);
        window.removeEventListener("resize", resize);
        window.removeEventListener("scroll", scroll, true);
        view.contentDOM.removeEventListener("click", click);
        view.contentDOM.removeEventListener("compositionend", click);
        view.dom.style.removeProperty("--pkm-keyboard-inset");
        if (frame !== null) cancelAnimationFrame(frame);
        if (scrollTimer !== null) clearTimeout(scrollTimer);
      },
    };
  }),
  EditorView.scrollMargins.of((view) => {
    const toolbar = view.dom.querySelector<HTMLElement>(
      ".pkm-markdown-toolbar:popover-open",
    );
    if (!toolbar) return null;
    const viewport = window.visualViewport;
    const bottom =
      (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
    const margin = toolbar.offsetHeight + 40;
    // Reserve only the part covering this scroller, retaining context in short inputs.
    return {
      bottom: Math.max(
        0,
        Math.min(
          margin,
          view.scrollDOM.getBoundingClientRect().bottom - (bottom - margin),
          view.scrollDOM.clientHeight / 2,
        ),
      ),
    };
  }),
  EditorView.baseTheme({
    ".cm-panels-top:has(.pkm-markdown-toolbar)": { height: "0", border: "0" },
    ".pkm-markdown-toolbar": {
      display: "none",
      position: "fixed",
      inset: "auto",
      top: "0",
      left: "0",
      width: "max-content",
      overflowX: "auto",
      margin: "0",
      boxSizing: "border-box",
      border: "1px solid var(--mantine-color-default-border, #c9cdd3)",
      borderRadius: "999px",
      background:
        "color-mix(in srgb, var(--mantine-color-body, white) 78%, transparent)",
      boxShadow: "0 2px 12px #0002",
      color: "var(--mantine-color-text, #18212f)",
      gap: "2px",
      padding: "2px 4px",
      willChange: "transform, opacity",
      transition: "opacity 120ms ease-out",
    },
    ".pkm-markdown-toolbar:popover-open": {
      display: "flex",
    },
    '.pkm-markdown-toolbar[data-scrolling="true"]': {
      opacity: "0",
      pointerEvents: "none",
      transition: "none",
    },
    ".pkm-markdown-toolbar button": {
      width: "44px",
      height: "44px",
      padding: "0",
      border: "none",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 44px",
      borderRadius: "50%",
      background: "transparent",
      color: "inherit",
      font: "inherit",
      fontSize: "18px",
      cursor: "pointer",
      touchAction: "manipulation",
    },
    '.pkm-markdown-toolbar button[aria-label="太字"]': {
      fontWeight: "bold",
    },
    '.pkm-markdown-toolbar button[aria-label="斜体"]': {
      fontStyle: "italic",
    },
    '.pkm-markdown-toolbar button[aria-label="取り消し線"]': {
      textDecoration: "line-through",
    },
    '.pkm-markdown-toolbar button:active, .pkm-markdown-toolbar button[aria-pressed="true"]':
      {
        background: "var(--mantine-color-default-hover, #ddd)",
      },
    ".pkm-markdown-toolbar button:focus-visible": {
      outline: "2px solid var(--mantine-color-blue-6, #228be6)",
      outlineOffset: "-2px",
    },
  }),
];
