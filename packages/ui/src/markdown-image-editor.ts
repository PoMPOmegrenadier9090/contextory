import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  StateEffect,
  StateField,
  Prec,
  type EditorState,
  type Range,
} from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import { defaultUrlTransform } from "react-markdown";
import { assetUrl } from "./asset-links.js";
import { copyImage } from "./image-clipboard.js";
import { imageDimensions, IMAGE_WIDTHS } from "./image-settings.js";

interface ImageRange {
  readonly from: number;
  readonly to: number;
  readonly labelFrom: number;
  readonly labelTo: number;
  readonly label: string;
  readonly url: string;
}

const imageAction = StateEffect.define<{
  from: number;
  mode: "menu" | "source";
} | null>();
const imageListeners = new WeakMap<HTMLElement, AbortController>();

const images = (state: EditorState): ImageRange[] => {
  const result: ImageRange[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Image") return;
      const url = node.node.getChild("URL");
      const marks = node.node.getChildren("LinkMark");
      const labelTo = marks[1]?.from;
      if (!url || labelTo === undefined) return;
      result.push({
        from: node.from,
        to: node.to,
        labelFrom: node.from + 2,
        labelTo,
        label: state.doc.sliceString(node.from + 2, labelTo),
        url: state.doc
          .sliceString(url.from, url.to)
          .replace(/^<|>$/g, "")
          .replace(/\\([\\()])/g, "$1"),
      });
    },
  });
  return result;
};

export const imageWidthChange = (image: ImageRange, width: number) => ({
  from: image.labelFrom,
  to: image.labelTo,
  insert:
    imageDimensions(image.label).alt +
    (width > 0 ? `|${Math.round(width)}` : ""),
});

class ImageWidget extends WidgetType {
  constructor(
    readonly image: ImageRange,
    readonly url: string,
    readonly selected: boolean,
    readonly readOnly: boolean,
    readonly copy: (image: HTMLImageElement) => Promise<void>,
  ) {
    super();
  }

  override eq(other: ImageWidget): boolean {
    return (
      this.image.from === other.image.from &&
      this.image.to === other.image.to &&
      this.image.label === other.image.label &&
      this.url === other.url &&
      this.selected === other.selected &&
      this.readOnly === other.readOnly
    );
  }

  override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "pkm-image-widget";
    root.dataset.from = String(this.image.from);
    root.dataset.selected = String(this.selected);
    const listeners = new AbortController();
    imageListeners.set(root, listeners);
    const frame = document.createElement("span");
    frame.className = "pkm-image-frame";
    const dimensions = imageDimensions(this.image.label);
    frame.style.width = dimensions.width
      ? `${dimensions.width}px`
      : "fit-content";
    const image = document.createElement("img");
    image.src = this.url;
    image.alt = dimensions.alt.replace(/\\([\\[\]|])/g, "$1");
    image.draggable = !this.readOnly;
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `${image.alt || "画像"}の操作`);
    image.setAttribute("aria-expanded", String(this.selected));
    image.addEventListener("load", () => view.requestMeasure());
    const status = document.createElement("span");
    status.className = "pkm-image-status";
    status.setAttribute("role", "status");
    image.addEventListener("error", () => {
      status.textContent =
        "画像を読み込めませんでした。Markdownから参照先を確認できます。";
      view.requestMeasure();
    });
    const menu = document.createElement("div");
    menu.className = "pkm-image-toolbar";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "画像の操作");
    const select = (focus = false) => {
      const current = images(view.state).find(
        (image) => image.from === this.image.from,
      );
      if (!current) return;
      view.dispatch({
        selection: { anchor: current.from, head: current.to },
        effects: imageAction.of({ from: current.from, mode: "menu" }),
      });
      if (focus) view.focus();
    };
    const setWidth = (width: number) => {
      if (view.state.readOnly) return;
      const current = images(view.state).find(
        (image) => image.from === this.image.from,
      );
      if (!current) return;
      view.dispatch({
        changes: imageWidthChange(current, width),
        effects: imageAction.of({ from: this.image.from, mode: "menu" }),
        annotations: [isolateHistory.of("full")],
        userEvent: "input.image.resize",
      });
    };
    const button = (
      parent: HTMLElement,
      label: string,
      action: () => void,
      disabled = false,
    ) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = label;
      element.setAttribute("aria-label", label);
      element.disabled = disabled;
      element.addEventListener("click", action);
      parent.append(element);
      return element;
    };
    const iconButton = (label: string, path: string, action: () => void) => {
      const element = button(menu, label, action);
      element.title = label;
      element.textContent = "";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.7");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      const shape = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      shape.setAttribute("d", path);
      svg.append(shape);
      element.append(svg);
      return element;
    };
    const popup = (label: string, path: string) => {
      const panel = document.createElement("div");
      panel.className = "pkm-image-popup";
      panel.popover = "auto";
      panel.id = `pkm-image-${crypto.randomUUID()}`;
      panel.setAttribute("role", "group");
      panel.setAttribute("aria-label", label);
      const dismiss = () => {
        if (panel.matches(":popover-open")) panel.hidePopover();
      };
      const trigger = iconButton(label, path, () => {
        select();
        if (panel.matches(":popover-open")) {
          dismiss();
          return;
        }
        panel.showPopover({ source: trigger });
        const anchor = trigger.getBoundingClientRect();
        const bounds = panel.getBoundingClientRect();
        panel.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
        panel.style.top = `${Math.max(8, anchor.bottom + bounds.height + 6 <= window.innerHeight - 8 ? anchor.bottom + 6 : anchor.top - bounds.height - 6)}px`;
        trigger.setAttribute("aria-expanded", "true");
        window.addEventListener("scroll", dismiss, {
          capture: true,
          signal: listeners.signal,
        });
        window.addEventListener("resize", dismiss, {
          signal: listeners.signal,
        });
      });
      trigger.setAttribute("aria-controls", panel.id);
      trigger.setAttribute("aria-expanded", "false");
      panel.addEventListener("beforetoggle", (event) => {
        if (event.newState !== "closed") return;
        trigger.setAttribute("aria-expanded", "false");
        window.removeEventListener("scroll", dismiss, true);
        window.removeEventListener("resize", dismiss);
      });
      frame.append(panel);
      return { panel, trigger, dismiss };
    };
    const copy = iconButton("コピー", "M8 8h12v12H8z M16 8V4H4v12h4", () => {
      copy.disabled = true;
      status.textContent = "";
      void this.copy(image)
        .catch((error: unknown) => {
          status.textContent = `コピーできませんでした。${error instanceof Error ? error.message : ""}`;
        })
        .finally(() => {
          copy.disabled = false;
          view.requestMeasure();
        });
    });
    const sizes = popup(
      "サイズ変更",
      "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5 M4 4l6 6 M20 20l-6-6",
    );
    sizes.trigger.disabled = this.readOnly;
    for (const { label, width } of IMAGE_WIDTHS) {
      const element = button(
        sizes.panel,
        `表示サイズ: ${label}`,
        () => {
          setWidth(width);
          sizes.dismiss();
          sizes.trigger.focus();
        },
        this.readOnly,
      );
      element.textContent = label;
      const hint = document.createElement("span");
      hint.textContent = width ? `${width}px` : "元の幅";
      element.append(hint);
      element.setAttribute(
        "aria-pressed",
        String((dimensions.width ?? 0) === width),
      );
    }
    const more = popup("その他の画像操作", "M5 12h.01 M12 12h.01 M19 12h.01");
    more.trigger.querySelector("svg")!.setAttribute("stroke-width", "3");
    button(more.panel, "Markdown表示", () => {
      more.dismiss();
      view.dispatch({
        effects: imageAction.of({ from: this.image.from, mode: "source" }),
        selection: { anchor: this.image.labelFrom },
        scrollIntoView: true,
      });
      view.focus();
    });
    for (const side of ["left", "right"]) {
      const resize = document.createElement("button");
      resize.type = "button";
      resize.className = "pkm-image-resize";
      resize.dataset.side = side;
      resize.setAttribute(
        "aria-label",
        `${side === "left" ? "左端" : "右端"}をドラッグして画像の表示幅を変更（左右キーでも調整可能）`,
      );
      resize.hidden = this.readOnly;
      resize.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        setWidth(
          Math.max(
            32,
            Math.min(
              8192,
              frame.getBoundingClientRect().width +
                (event.key === "ArrowRight" ? 16 : -16),
            ),
          ),
        );
      });
      resize.addEventListener("pointerdown", (event) => {
        if (view.state.readOnly || event.button !== 0) return;
        event.preventDefault();
        resize.setPointerCapture(event.pointerId);
        const start = event.clientX;
        const initial = frame.getBoundingClientRect().width;
        const initialStyle = frame.style.width;
        let width = initial;
        const move = (next: PointerEvent) => {
          width = Math.round(
            Math.max(
              32,
              Math.min(
                8192,
                initial + (next.clientX - start) * (side === "left" ? -1 : 1),
                root.clientWidth,
              ),
            ),
          );
          frame.style.width = `${width}px`;
          view.requestMeasure();
        };
        const finish = (next: PointerEvent) => {
          resize.removeEventListener("pointermove", move);
          resize.removeEventListener("pointerup", finish);
          resize.removeEventListener("pointercancel", cancel);
          if (resize.hasPointerCapture(event.pointerId))
            resize.releasePointerCapture(event.pointerId);
          if (next.type === "pointerup") setWidth(width);
        };
        const cancel = (next: PointerEvent) => {
          frame.style.width = initialStyle;
          finish(next);
        };
        resize.addEventListener("pointermove", move);
        resize.addEventListener("pointerup", finish);
        resize.addEventListener("pointercancel", cancel);
      });
      const bar = document.createElement("span");
      bar.className = "pkm-image-resize-bar";
      bar.setAttribute("aria-hidden", "true");
      resize.append(bar);
      frame.append(resize);
    }
    image.addEventListener("click", () => select(true));
    image.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(true);
      }
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        const open = sizes.panel.matches(":popover-open")
          ? sizes
          : more.panel.matches(":popover-open")
            ? more
            : null;
        if (open) {
          open.dismiss();
          open.trigger.focus();
          return;
        }
        view.dispatch({ effects: imageAction.of(null) });
        view.focus();
      }
    });
    frame.prepend(image);
    frame.append(menu, status);
    root.append(frame);
    return root;
  }

  override updateDOM(root: HTMLElement, view: EditorView): boolean {
    const image = root.querySelector("img");
    if (
      !image ||
      image.getAttribute("src") !== this.url ||
      Number(root.dataset.from) !== this.image.from
    )
      return false;
    const dimensions = imageDimensions(this.image.label);
    root.dataset.selected = String(this.selected);
    root.querySelector<HTMLElement>(".pkm-image-frame")!.style.width =
      dimensions.width ? `${dimensions.width}px` : "fit-content";
    image.alt = dimensions.alt.replace(/\\([\\[\]|])/g, "$1");
    image.setAttribute("aria-label", `${image.alt || "画像"}の操作`);
    image.setAttribute("aria-expanded", String(this.selected));
    if (!this.selected)
      for (const panel of root.querySelectorAll<HTMLElement>("[popover]")) {
        if (panel.matches(":popover-open")) panel.hidePopover();
      }
    root.querySelector<HTMLButtonElement>(
      'button[aria-label="サイズ変更"]',
    )!.disabled = this.readOnly;
    image.draggable = !this.readOnly;
    for (const resize of root.querySelectorAll<HTMLElement>(
      ".pkm-image-resize",
    ))
      resize.hidden = this.readOnly;
    IMAGE_WIDTHS.forEach(({ width }, index) => {
      const button = root.querySelectorAll<HTMLButtonElement>(
        ".pkm-image-popup button[aria-pressed]",
      )[index]!;
      button.disabled = this.readOnly;
      button.setAttribute(
        "aria-pressed",
        String((dimensions.width ?? 0) === width),
      );
    });
    view.requestMeasure();
    return true;
  }

  override ignoreEvent(event: Event): boolean {
    return !["dragstart", "dragend", "dragover", "drop"].includes(event.type);
  }

  override destroy(root: HTMLElement): void {
    imageListeners.get(root)?.abort();
    imageListeners.delete(root);
    for (const panel of root.querySelectorAll<HTMLElement>("[popover]")) {
      if (panel.matches(":popover-open")) panel.hidePopover();
    }
  }
}

export const markdownImageField = (baseUrl = "/api/", copy = copyImage) =>
  StateField.define<{
    readonly active: { from: number; mode: "menu" | "source" } | null;
    readonly decorations: ReturnType<typeof Decoration.set>;
  }>({
    create: (state) => build(state, null, baseUrl, copy),
    update(value, transaction) {
      let active = value.active && {
        ...value.active,
        from: transaction.changes.mapPos(value.active.from),
      };
      for (const effect of transaction.effects)
        if (effect.is(imageAction)) active = effect.value;
      if (transaction.selection && active?.mode !== "source") {
        const selection = transaction.state.selection.main;
        const image = images(transaction.state).find(
          (image) => image.from === selection.from && image.to === selection.to,
        );
        active = image ? { from: image.from, mode: "menu" } : null;
      } else if (active && (transaction.selection || transaction.docChanged)) {
        const image = images(transaction.state).find(
          (image) => image.from === active?.from,
        );
        const head = transaction.state.selection.main.head;
        if (!image || head < image.from || head > image.to) active = null;
      }
      if (
        !transaction.docChanged &&
        !transaction.selection &&
        !transaction.reconfigured &&
        active === value.active
      )
        return value;
      return build(transaction.state, active, baseUrl, copy);
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
      Prec.high(
        keymap.of([
          ...(
            [
              ["ArrowLeft", false, false],
              ["ArrowRight", true, false],
              ["ArrowUp", false, true],
              ["ArrowDown", true, true],
            ] as const
          ).map(([key, forward, vertical]) => ({
            key,
            run: (view: EditorView) => {
              const value = view.state.field(field);
              if (
                value.active?.mode === "source" ||
                view.state.selection.ranges.length !== 1
              )
                return false;
              const visible: ImageRange[] = [];
              value.decorations.between(
                0,
                view.state.doc.length,
                (_from, _to, decoration) => {
                  const { widget } = decoration.spec as { widget?: unknown };
                  if (widget instanceof ImageWidget) visible.push(widget.image);
                },
              );
              const selection = view.state.selection.main;
              const selected = visible.find(
                (image) =>
                  image.from === selection.from && image.to === selection.to,
              );
              let image: ImageRange | undefined;
              let target: number | undefined;
              let goal = vertical ? selection.goalColumn : undefined;
              if (selected) {
                target = forward ? selected.to : selected.from;
                const line = view.state.doc.lineAt(target);
                if (target === (forward ? line.to : line.from))
                  target = Math.max(
                    0,
                    Math.min(
                      view.state.doc.length,
                      target + (forward ? 1 : -1),
                    ),
                  );
                image = visible.find((image) =>
                  forward ? image.from === target : image.to === target,
                );
                if (vertical && !image && goal !== undefined) {
                  const coords = view.coordsAtPos(target, forward ? 1 : -1);
                  const position =
                    coords &&
                    view.posAtCoords(
                      {
                        x: view.contentDOM.getBoundingClientRect().left + goal,
                        y: (coords.top + coords.bottom) / 2,
                      },
                      false,
                    );
                  if (position != null) {
                    const line = view.state.doc.lineAt(target);
                    target = Math.max(line.from, Math.min(line.to, position));
                  }
                }
              } else {
                if (!selection.empty) return false;
                const next = vertical
                  ? view.moveVertically(selection, forward)
                  : view.moveByChar(selection, forward);
                goal = next.goalColumn;
                image = (forward ? visible : visible.toReversed()).find(
                  (image) =>
                    forward
                      ? selection.head <= image.from && next.head >= image.from
                      : selection.head >= image.to && next.head <= image.to,
                );
                if (!image) return false;
              }
              view.dispatch({
                selection: EditorSelection.create([
                  image
                    ? EditorSelection.range(
                        forward ? image.from : image.to,
                        forward ? image.to : image.from,
                        goal,
                      )
                    : EditorSelection.cursor(
                        target!,
                        forward ? 1 : -1,
                        undefined,
                        goal,
                      ),
                ]),
                effects: imageAction.of(
                  image ? { from: image.from, mode: "menu" } : null,
                ),
                scrollIntoView: true,
                userEvent: "select",
              });
              return true;
            },
          })),
          {
            key: "Escape",
            run: (view) => {
              if (!view.state.field(field).active) return false;
              view.dispatch({ effects: imageAction.of(null) });
              return true;
            },
          },
        ]),
      ),
    ],
  });

const build = (
  state: EditorState,
  active: { from: number; mode: "menu" | "source" } | null,
  baseUrl: string,
  copy: (image: HTMLImageElement) => Promise<void>,
) => {
  const decorations: Range<Decoration>[] = [];
  for (const image of images(state)) {
    if (active?.from === image.from && active.mode === "source") continue;
    const resolved = assetUrl(image.url, baseUrl);
    const url =
      resolved !== image.url ? resolved : defaultUrlTransform(image.url);
    if (!url) continue;
    decorations.push(
      Decoration.replace({
        widget: new ImageWidget(
          image,
          url,
          active?.from === image.from,
          state.readOnly,
          copy,
        ),
        block: true,
        // Preserve text-side carets without adding empty rows around image-only lines.
        inclusiveStart:
          image.from > 0 && image.from === state.doc.lineAt(image.from).from,
        inclusiveEnd:
          image.to < state.doc.length &&
          image.to === state.doc.lineAt(image.to).to,
      }).range(image.from, image.to),
    );
  }
  return { active, decorations: Decoration.set(decorations, true) };
};
