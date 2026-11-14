import { CONTEXT_FIELD, fieldNode, newId, type DocNode } from "@pkm/core";

/** Quick Captureの書き始め。空のTitle、Contextの行、空の本文を持つMemo。 */
export const captureDoc = (context: string | null): DocNode => ({
  type: "doc",
  content: [
    {
      type: "objectBlock",
      attrs: {
        id: newId(),
        objectId: newId(),
        type: "memo",
        done: false,
        collapsed: false,
      },
      content: [
        { type: "objectTitle" },
        fieldNode({
          ...CONTEXT_FIELD,
          value: context
            ? [{ type: "objectRef", attrs: { objectId: context } }]
            : [],
        }),
        { type: "paragraph", attrs: { id: newId() } },
      ],
    },
  ],
});

const isField = (node: DocNode): boolean =>
  node.type === "objectField" || node.type === "objectFieldControl";

/** Field行の外に、文字か言及があるか。 */
const written = (node: DocNode): boolean =>
  !isField(node) &&
  (Boolean(node.text?.trim()) ||
    node.type === "objectRef" ||
    (node.content ?? []).some(written));

/**
 * Dailyへ足すMemo。書いたものが無ければnull。
 * Objectを解除して書いた場合は、書いた内容をまとめて一つのMemoの本文にする。
 */
export const captureMemo = (doc: DocNode): DocNode | null => {
  if (!written(doc)) return null;
  const nodes = (doc.content ?? []).filter(
    (node) => node.type !== "paragraph" || written(node),
  );
  const [only] = nodes;
  const memo: DocNode =
    nodes.length === 1 && only?.type === "objectBlock"
      ? only
      : {
          type: "objectBlock",
          attrs: { id: newId(), objectId: newId(), type: "memo", done: false },
          content: [{ type: "objectTitle" }, ...nodes],
        };
  const content = memo.content ?? [];
  // 空の段落は落とし、本文が無ければ畳んで置く。
  const body = content
    .slice(1)
    .filter(
      (node) => isField(node) || node.type !== "paragraph" || written(node),
    );
  return {
    ...memo,
    attrs: { ...memo.attrs, collapsed: !body.some((node) => !isField(node)) },
    content: [content[0] ?? { type: "objectTitle" }, ...body],
  };
};
