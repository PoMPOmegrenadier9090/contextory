import type { Fragment, Node as PMNode, ResolvedPos } from "@tiptap/pm/model";

/** Objectにする範囲。from〜toをObjectで置き換える。 */
export interface Conversion {
  readonly from: number;
  readonly to: number;
  readonly title: Fragment;
  readonly body: readonly PMNode[];
}

/** 末尾の空白を除いたインライン内容。「会議 #task」のTitleを「会議」にする。 */
const trimEnd = (content: Fragment): Fragment => {
  const text = content.lastChild?.isText ? (content.lastChild.text ?? "") : "";
  const trailing = text.length - text.trimEnd().length;
  return trailing ? content.cut(0, content.size - trailing) : content;
};

/**
 * カーソルのある行からObjectにする範囲を決める。行の内容がTitleになる。
 *
 * - リスト項目の先頭の行: 項目の残り（入れ子のリストなど）を本文にする。Objectは項目の中に置き、リストの位置を保つ。
 * - 見出し: 次の同じか上の階層の見出しまでを本文にする。
 * - bodyEnd: 複数の行を選んで#を打った時の、選択の終わり。行の後ろの兄弟をそこまで本文にする。
 */
export const conversionAt = (
  $pos: ResolvedPos,
  bodyEnd: number | null = null,
): Conversion | null => {
  const block = $pos.parent;
  const depth = $pos.depth;
  if (depth < 1 || !block.isTextblock || block.type.name === "objectTitle")
    return null;
  const parent = $pos.node(depth - 1);
  const index = $pos.index(depth - 1);
  const title = trimEnd(block.content);
  const from = $pos.before(depth);
  let to = $pos.after(depth);
  const body: PMNode[] = [];
  const take = (until: (child: PMNode) => boolean): void => {
    for (let i = index + 1; i < parent.childCount; i++) {
      const child = parent.child(i);
      if (until(child)) break;
      body.push(child);
      to += child.nodeSize;
    }
  };
  if (parent.type.name === "listItem" && index === 0) take(() => false);
  else if (bodyEnd !== null) take(() => to >= bodyEnd);
  else if (block.type.name === "heading") {
    const level = Number(block.attrs.level);
    take(
      (child) =>
        child.type.name === "heading" && Number(child.attrs.level) <= level,
    );
  }
  return { from, to, title, body };
};
