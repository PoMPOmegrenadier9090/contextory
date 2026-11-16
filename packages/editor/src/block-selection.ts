import type { Node, ResolvedPos } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  Selection,
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
  if (
    selection instanceof NodeSelection &&
    selection.node.type.name === "objectBlock"
  ) {
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
  view.dispatch(view.state.tr.setSelection(new NodeSelection($pos)));
};

export const extendBlockDrag = (
  view: EditorView,
  left: number,
  top: number,
): void => {
  const range = endpoints(view.state.selection);
  if (!range) return;
  const [$start] = range;
  const rect = view.dom.getBoundingClientRect();
  const found = view.posAtCoords({
    left: Math.max(rect.left + 1, Math.min(left, rect.right - 1)),
    top,
  });
  if (!found) return;
  for (const pos of [found.inside, found.pos]) {
    if (pos < $start.start() || pos >= $start.end()) continue;
    const $hit = view.state.doc.resolve(pos);
    const $end = view.state.doc.resolve(
      $hit.posAtIndex($hit.index($start.depth), $start.depth),
    );
    if (extendTo(view, $start, $end)) return;
  }
};

export const BlockSelection = Extension.create({
  name: "blockSelection",
  priority: 110,
  addProseMirrorPlugins: () => [
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          const { selection, doc } = view.state;
          const range = endpoints(selection);
          if (
            !range ||
            event.isComposing ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey
          )
            return false;
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
          if (!(selection instanceof BlockRangeSelection)) return null;
          const marks: Decoration[] = [];
          selection.$from.parent.forEach((node, offset) => {
            const pos = selection.$from.start() + offset;
            if (pos >= selection.from && pos < selection.to)
              marks.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: "pe-block-selected",
                }),
              );
          });
          return DecorationSet.create(doc, marks);
        },
      },
    }),
  ],
});
