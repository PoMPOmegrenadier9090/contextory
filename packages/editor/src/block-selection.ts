import { Fragment, type Node, type ResolvedPos } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  Selection,
  TextSelection,
  type SelectionBookmark,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";

const isBlock = (node: Node | null): node is Node =>
  Boolean(
    node && (node.type.isInGroup("block") || node.type.name === "listItem"),
  );

// The leading Object represents its list item when extending across list rows.
const blockAt = ($pos: ResolvedPos): ResolvedPos =>
  $pos.parent.type.name === "listItem" && $pos.parentOffset === 0
    ? $pos.doc.resolve($pos.before())
    : $pos;

export class BlockRangeSelection extends Selection {
  constructor(
    readonly startBlock: ResolvedPos,
    readonly endBlock: ResolvedPos,
  ) {
    const after = ($pos: ResolvedPos): ResolvedPos =>
      $pos.doc.resolve($pos.pos + $pos.nodeAfter!.nodeSize);
    super(
      startBlock.pos <= endBlock.pos ? startBlock : after(startBlock),
      startBlock.pos <= endBlock.pos ? after(endBlock) : endBlock,
    );
    this.visible = false;
  }

  static create(doc: Node, start: number, end: number): Selection {
    const $start = doc.resolve(start);
    const $end = doc.resolve(end);
    if (
      !$start.sameParent($end) ||
      !isBlock($start.nodeAfter) ||
      !isBlock($end.nodeAfter)
    )
      return Selection.near($start);
    if (start === end) {
      const leading = $start.nodeAfter.firstChild;
      return NodeSelection.create(
        doc,
        $start.nodeAfter.type.name === "listItem" &&
          leading?.type.name === "objectBlock"
          ? start + 1
          : start,
      );
    }
    return new BlockRangeSelection($start, $end);
  }

  eq(other: Selection): boolean {
    return (
      other instanceof BlockRangeSelection &&
      this.startBlock.pos === other.startBlock.pos &&
      this.endBlock.pos === other.endBlock.pos
    );
  }

  map(doc: Node, mapping: Parameters<Selection["map"]>[1]): Selection {
    return this.getBookmark().map(mapping).resolve(doc);
  }

  override getBookmark(): SelectionBookmark {
    return blockBookmark(this.startBlock.pos, this.endBlock.pos);
  }

  toJSON(): { type: string; start: number; end: number } {
    return {
      type: "contextoryBlocks",
      start: this.startBlock.pos,
      end: this.endBlock.pos,
    };
  }

  static override fromJSON(
    doc: Node,
    json: { start: number; end: number },
  ): Selection {
    return this.create(doc, json.start, json.end);
  }
}

const blockBookmark = (start: number, end: number): SelectionBookmark => ({
  map(mapping) {
    return blockBookmark(mapping.map(start), mapping.map(end));
  },
  resolve(doc) {
    return BlockRangeSelection.create(doc, start, end);
  },
});

Selection.jsonID("contextoryBlocks", BlockRangeSelection);

const endpoints = (selection: Selection): [ResolvedPos, ResolvedPos] | null => {
  if (selection instanceof BlockRangeSelection)
    return [selection.startBlock, selection.endBlock];
  if (selection instanceof NodeSelection && isBlock(selection.node)) {
    const $block = blockAt(selection.$from);
    return [$block, $block];
  }
  return null;
};

const extendTo = (
  view: EditorView,
  $start: ResolvedPos,
  $end: ResolvedPos,
): boolean => {
  if (!$start.sameParent($end) || !isBlock($end.nodeAfter)) return false;
  const selection = BlockRangeSelection.create(
    view.state.doc,
    $start.pos,
    $end.pos,
  );
  if (!selection.eq(view.state.selection))
    view.dispatch(view.state.tr.setSelection(selection));
  return true;
};

export const selectBlock = (
  view: EditorView,
  pos: number,
  extend: boolean,
): void => {
  const range = extend && endpoints(view.state.selection);
  const $pos = view.state.doc.resolve(pos);
  if (range && extendTo(view, range[0], blockAt($pos))) return;
  const $block = blockAt($pos);
  view.dispatch(
    view.state.tr.setSelection(
      BlockRangeSelection.create(view.state.doc, $block.pos, $block.pos),
    ),
  );
};

const blockAtCursor = ($pos: ResolvedPos): ResolvedPos | null => {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (isBlock($pos.node(depth)))
      return blockAt($pos.doc.resolve($pos.before(depth)));
  }
  return isBlock($pos.nodeAfter) ? $pos : null;
};

const siblingsFrom = (view: EditorView, $pos: ResolvedPos) => {
  const rows: { pos: number; node: Node; rect: DOMRect }[] = [];
  $pos.parent.forEach((node, offset) => {
    const pos = $pos.start() + offset;
    const element = view.nodeDOM(pos);
    if (
      !isBlock(node) ||
      !(element instanceof Element) ||
      !element.getClientRects().length
    )
      return;
    rows.push({ pos, node, rect: element.getBoundingClientRect() });
  });
  return rows;
};

const trackPointer = (
  handle: HTMLElement,
  pointer: number,
  update: (event: PointerEvent) => void,
  finish: (event: PointerEvent | null) => void,
): void => {
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const end = (event: PointerEvent | null): void => {
    listeners.abort();
    if (handle.hasPointerCapture(pointer))
      handle.releasePointerCapture(pointer);
    finish(event);
  };
  handle.setPointerCapture(pointer);
  handle.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerId === pointer) update(event);
    },
    options,
  );
  for (const type of [
    "pointerup",
    "lostpointercapture",
    "pointercancel",
  ] as const)
    (type === "lostpointercapture"
      ? handle
      : handle.ownerDocument
    ).addEventListener(
      type,
      (event) => {
        if (event instanceof PointerEvent && event.pointerId === pointer)
          end(type === "pointerup" ? event : null);
      },
      options,
    );
  handle.ownerDocument.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      end(null);
    },
    { ...options, capture: true },
  );
};

const moveBlock = (
  view: EditorView,
  $block: ResolvedPos,
  to: number,
): number => {
  const node = $block.nodeAfter!;
  const from = $block.pos;
  if (to === from || to === from + node.nodeSize) return from;
  const tr = view.state.tr.delete(from, from + node.nodeSize);
  const next = tr.mapping.map(to);
  const $next = tr.doc.resolve(next);
  if (
    !$next.parent.canReplace($next.index(), $next.index(), Fragment.from(node))
  )
    return from;
  tr.insert(next, node);
  tr.setSelection(BlockRangeSelection.create(tr.doc, next, next));
  view.dispatch(tr);
  const status = view.dom
    .closest(".pe-edit-area")
    ?.querySelector(".pe-move-status");
  if (status) {
    const title = node.firstChild?.isTextblock
      ? node.firstChild.textContent
      : node.textContent;
    status.textContent = `${title.trim().slice(0, 60)}を${$next.index() + 1}番目に移動しました`;
  }
  return next;
};

export const moveBlockWithKey = (
  view: EditorView,
  event: KeyboardEvent,
  pos: number,
): void => {
  if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown"))
    return;
  event.preventDefault();
  const $block = blockAt(view.state.doc.resolve(pos));
  const $after = view.state.doc.resolve(
    $block.pos + $block.nodeAfter!.nodeSize,
  );
  const up = event.key === "ArrowUp";
  const neighbor = up ? $block.nodeBefore : $after.nodeAfter;
  if (!isBlock(neighbor)) return;
  const next = moveBlock(
    view,
    $block,
    up ? $block.pos - neighbor.nodeSize : $after.pos + neighbor.nodeSize,
  );
  const element = view.nodeDOM(next);
  if (element instanceof Element) {
    element
      .querySelector<HTMLElement>(".pe-grip")
      ?.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest" });
  }
};

export const grabBlock = (
  view: EditorView,
  handle: HTMLElement,
  event: PointerEvent,
  pos: number,
): void => {
  if (event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  selectBlock(view, pos, event.shiftKey || event.pointerType === "touch");
  if (event.pointerType !== "touch") view.focus();
  if (event.shiftKey) return;

  const doc = view.state.doc;
  const $block = blockAt(doc.resolve(pos));
  const frame = view.dom.parentElement!;
  const place = (pointer: PointerEvent): number | null => {
    delete frame.dataset.drop;
    if (view.state.doc !== doc || Math.abs(pointer.clientY - event.clientY) < 4)
      return null;
    const rows = siblingsFrom(view, $block);
    const first = rows[0];
    const last = rows.at(-1);
    if (
      !first ||
      !last ||
      pointer.clientY < first.rect.top - 12 ||
      pointer.clientY > last.rect.bottom + 12
    )
      return null;
    const row = rows.find(
      ({ rect }) => pointer.clientY < (rect.top + rect.bottom) / 2,
    );
    const to = row?.pos ?? last.pos + last.node.nodeSize;
    if (to === $block.pos || to === $block.pos + $block.nodeAfter!.nodeSize)
      return null;
    const rect = (row ?? last).rect;
    frame.style.setProperty("--pe-drop-x", `${rect.left}px`);
    frame.style.setProperty("--pe-drop-y", `${row ? rect.top : rect.bottom}px`);
    frame.style.setProperty("--pe-drop-width", `${rect.width}px`);
    frame.dataset.drop = "";
    return to;
  };
  trackPointer(handle, event.pointerId, place, (pointer) => {
    const to = pointer === null ? null : place(pointer);
    delete frame.dataset.drop;
    if (to !== null) moveBlock(view, $block, to);
  });
};

export const selectFromMargin = (
  view: EditorView,
  handle: HTMLElement,
  event: PointerEvent,
): void => {
  if (event.button !== 0 || !event.isPrimary) return;
  const row = Array.from(
    view.dom.querySelectorAll(
      "p, h1, h2, h3, h4, h5, h6, pre, [data-object-title]",
    ),
  ).find((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.height > 0 &&
      rect.top <= event.clientY &&
      rect.bottom >= event.clientY
    );
  });
  if (!row) return;
  const doc = view.state.doc;
  const start = blockAtCursor(doc.resolve(view.posAtDOM(row, 0)));
  if (!start) return;
  event.preventDefault();
  selectBlock(view, start.pos, event.shiftKey || event.pointerType === "touch");
  if (event.pointerType !== "touch") view.focus();
  const box = view.dom.ownerDocument.createElement("div");
  box.className = "pe-selection-box";
  box.setAttribute("aria-hidden", "true");
  trackPointer(
    handle,
    event.pointerId,
    (pointer) => {
      if (
        view.isDestroyed ||
        view.state.doc !== doc ||
        Math.hypot(
          pointer.clientX - event.clientX,
          pointer.clientY - event.clientY,
        ) < 4
      )
        return;
      if (!box.isConnected) handle.append(box);
      const top = Math.min(event.clientY, pointer.clientY);
      const bottom = Math.max(event.clientY, pointer.clientY);
      Object.assign(box.style, {
        top: `${top}px`,
        left: `${Math.min(event.clientX, pointer.clientX)}px`,
        width: `${Math.abs(pointer.clientX - event.clientX)}px`,
        height: `${bottom - top}px`,
      });
      const down = pointer.clientY >= event.clientY;
      const rows = siblingsFrom(view, start).filter(
        ({ rect }) => rect.bottom > top && rect.top <= bottom,
      );
      const target = down ? rows.at(-1) : rows[0];
      if (target) extendTo(view, start, doc.resolve(target.pos));
    },
    () => box.remove(),
  );
};

const plainHandle = (
  view: EditorView,
  getPos: () => number | undefined,
): HTMLElement => {
  const handle = view.dom.ownerDocument.createElement("button");
  handle.type = "button";
  handle.className = "pe-grip pe-plain-grip";
  handle.textContent = "⠿";
  handle.title = "ドラッグまたは Alt＋↑↓で並べ替え";
  handle.setAttribute("aria-label", "ブロックを並べ替え");
  handle.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
  const position = (): number | undefined => {
    const pos = getPos();
    if (pos !== undefined) return view.state.doc.resolve(pos).before();
    return undefined;
  };
  handle.onpointerdown = (event) => {
    const pos = position();
    if (pos !== undefined) grabBlock(view, handle, event, pos);
  };
  handle.onkeydown = (event) => {
    const pos = position();
    if (pos !== undefined) moveBlockWithKey(view, event, pos);
  };
  handle.onclick = (event) => {
    const pos = position();
    if (event.detail !== 0 || pos === undefined) return;
    selectBlock(view, pos, event.shiftKey);
    view.focus();
  };
  return handle;
};

const plainHandles = (doc: Node): DecorationSet => {
  const marks: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!["paragraph", "heading", "codeBlock"].includes(node.type.name)) return;
    marks.push(
      Decoration.node(pos, pos + node.nodeSize, { class: "pe-plain-block" }),
    );
    marks.push(
      Decoration.widget(pos + 1, plainHandle, {
        key: "block-grip",
        side: -1,
        stopEvent: () => true,
        ignoreSelection: true,
      }),
    );
  });
  return DecorationSet.create(doc, marks);
};

export const BlockSelection = Extension.create({
  name: "blockSelection",
  priority: 110,
  addProseMirrorPlugins: () => [
    new Plugin<DecorationSet>({
      state: {
        init: (_config, state) => plainHandles(state.doc),
        apply: (tr, handles) =>
          tr.docChanged ? plainHandles(tr.doc) : handles,
      },
      props: {
        handleKeyDown(view, event) {
          const { selection, doc } = view.state;
          const range = endpoints(selection);
          if (
            event.isComposing ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey
          )
            return false;
          if (event.key === "Escape" && selection instanceof TextSelection) {
            const block = blockAtCursor(selection.$from);
            if (!block) return false;
            selectBlock(view, block.pos, false);
            return true;
          }
          if (!range) return false;
          const [$start, $end] = range;
          if (
            event.key === "Escape" &&
            selection instanceof BlockRangeSelection
          ) {
            view.dispatch(
              view.state.tr.setSelection(
                Selection.near(doc.resolve($start.pos + 1)),
              ),
            );
            return true;
          }
          if (
            !event.shiftKey ||
            (event.key !== "ArrowUp" && event.key !== "ArrowDown")
          )
            return false;
          const down = event.key === "ArrowDown";
          const next = down
            ? $end.pos + $end.nodeAfter!.nodeSize
            : $end.pos - ($end.nodeBefore?.nodeSize ?? 0);
          if (extendTo(view, $start, doc.resolve(next))) {
            const target = view.nodeDOM(next);
            if (target instanceof Element)
              target.scrollIntoView({ block: "nearest" });
          }
          return true;
        },
        decorations(state) {
          const { selection, doc } = state;
          const marks: Decoration[] = [];
          if (selection instanceof BlockRangeSelection) {
            selection.$from.parent.forEach((node, offset) => {
              const pos = selection.$from.start() + offset;
              if (pos >= selection.from && pos < selection.to)
                marks.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: "pe-block-selected",
                  }),
                );
            });
          } else if (
            selection instanceof NodeSelection &&
            isBlock(selection.node) &&
            selection.node.type.name !== "objectBlock"
          ) {
            marks.push(
              Decoration.node(selection.from, selection.to, {
                class: "pe-block-selected",
              }),
            );
          }
          return this.getState(state)?.add(doc, marks);
        },
      },
    }),
  ],
});
