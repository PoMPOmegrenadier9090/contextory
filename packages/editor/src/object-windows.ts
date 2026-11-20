import type { DocNode } from "@pkm/core";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/** 文書木の中のObjectのID。 */
export const objectIdsIn = (node: PMNode): Set<string> => {
  const ids = new Set<string>();
  node.descendants((child) => {
    if (child.type.name === "objectBlock")
      ids.add(String(child.attrs.objectId));
  });
  return ids;
};

/** posを包むObjectのID。外側から順に並ぶ。 */
export const objectsAround = ($pos: ResolvedPos): string[] => {
  const ids: string[] = [];
  for (let depth = 1; depth <= $pos.depth; depth++)
    if ($pos.node(depth).type.name === "objectBlock")
      ids.push(String($pos.node(depth).attrs.objectId));
  return ids;
};

export const containsObject = (
  node: DocNode,
  ids: ReadonlySet<unknown>,
): boolean =>
  (node.type === "objectBlock" && ids.has(node.attrs?.objectId)) ||
  (node.content ?? []).some((child) => containsObject(child, ids));

/** 窓（埋め込み）が消えたObject。入れ子の中のObjectは、外側の窓と一緒に消えたので含めない。 */
export interface RemovedWindow {
  readonly id: string;
  readonly node: PMNode;
  /** 窓があった本文の持ち主。最上位なら開いている文書 */
  readonly hostId: string | null;
  /** 取引の後の文書で、窓があった位置 */
  pos: number;
}

export const removedWindows = (
  tr: Transaction,
  hostId: string | null,
): RemovedWindow[] => {
  const found = new Map<string, RemovedWindow>();
  tr.steps.forEach((step, index) => {
    const before = tr.docs[index]!;
    step.getMap().forEach((from, to) =>
      before.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== "objectBlock") return true;
        if (pos < from || pos + node.nodeSize > to) return true;
        const id = String(node.attrs.objectId);
        found.set(id, {
          id,
          node,
          hostId: objectsAround(before.resolve(pos)).at(-1) ?? hostId,
          pos: tr.mapping.slice(index).map(pos, -1),
        });
        return false;
      }),
    );
  });
  // 同じ取引で別の位置へ移ったものは、消えていない。
  if (found.size) for (const id of objectIdsIn(tr.doc)) found.delete(id);
  return [...found.values()];
};
