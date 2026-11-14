import { CONTEXT_FIELD, fieldNode, newId, type DocNode } from "@pkm/core";

/** Quick Captureで書いている内容。本文はMemoの本文だけを持つ文書。 */
export interface CaptureInput {
  readonly title: string;
  /** Contextに付けるObject。外せばnull */
  readonly context: string | null;
  readonly body: DocNode;
}

export const emptyBody = (): DocNode => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

/** 文字か言及があるか。 */
const written = (node: DocNode): boolean =>
  Boolean(node.text?.trim()) ||
  node.type === "objectRef" ||
  (node.content ?? []).some(written);

/** Dailyへ足すMemo。TitleにもBodyにも書いていなければnull。 */
export const captureMemo = (input: CaptureInput): DocNode | null => {
  const title = input.title.trim();
  // 空の段落は落とす。
  const body = (input.body.content ?? []).filter(
    (node) => node.type !== "paragraph" || written(node),
  );
  if (!title && !body.length) return null;
  return {
    type: "objectBlock",
    // 本文が無ければ畳んで置く。
    attrs: {
      id: newId(),
      objectId: newId(),
      type: "memo",
      done: false,
      collapsed: !body.length,
    },
    content: [
      title
        ? { type: "objectTitle", content: [{ type: "text", text: title }] }
        : { type: "objectTitle" },
      ...(input.context
        ? [
            fieldNode({
              ...CONTEXT_FIELD,
              value: [
                { type: "objectRef", attrs: { objectId: input.context } },
              ],
            }),
          ]
        : []),
      ...body,
    ],
  };
};
