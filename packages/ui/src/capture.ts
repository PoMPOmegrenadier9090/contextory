import {
  CONTEXT_FIELD,
  fieldNode,
  newId,
  RELATED_FIELD,
  type DocNode,
  type FieldDefinition,
} from "@pkm/core";

/** Quick Captureで書いている内容。本文はMemoの本文だけを持つ文書。 */
export interface CaptureInput {
  readonly title: string;
  /** Contextに付けるObject。外せばnull */
  readonly context: string | null;
  /** 参照に付けるObject。具象のページで書いたときの、その具象。 */
  readonly related?: string | null;
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

const refRow = (
  field: FieldDefinition,
  objectId: string | null | undefined,
): DocNode[] =>
  objectId
    ? [
        fieldNode({
          ...field,
          value: [{ type: "objectRef", attrs: { objectId } }],
        }),
      ]
    : [];

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
      ...refRow(CONTEXT_FIELD, input.context),
      ...refRow(RELATED_FIELD, input.related),
      ...body,
    ],
  };
};
