/** ProseMirror JSONの最小形。TiptapのJSONContentと互換。 */
export interface DocNode {
  readonly type?: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly DocNode[];
  readonly text?: string;
  readonly marks?: readonly unknown[];
}

export interface StoredObject {
  /** type、doneなどObject自身の属性 */
  readonly attrs: Readonly<Record<string, unknown>>;
  readonly title: readonly DocNode[];
  readonly body: readonly DocNode[];
}

export interface SplitResult {
  readonly host: DocNode;
  readonly objects: Readonly<Record<string, StoredObject>>;
}

/** 配置側（埋め込みBlock）に残す属性。それ以外はObject側へ保存する。 */
const PLACEMENT_ATTRS = ["id", "objectId", "collapsed"];

/**
 * 編集中は一つの文書木として扱い、保存時にObject単位へ分ける。
 * objectBlockを埋め込み参照へ置き換え、本文はObjectごとに切り出す。
 */
export const splitDocument = (doc: DocNode): SplitResult => {
  const objects: Record<string, StoredObject> = {};
  const visit = (node: DocNode): DocNode => {
    const content = node.content?.map(visit);
    if (node.type !== "objectBlock")
      return content ? { ...node, content } : node;
    const attrs = node.attrs ?? {};
    const [title, ...body] = content ?? [];
    objects[String(attrs.objectId)] = {
      attrs: Object.fromEntries(
        Object.entries(attrs).filter(([key]) => !PLACEMENT_ATTRS.includes(key)),
      ),
      title: title?.content ?? [],
      body,
    };
    return {
      type: "objectEmbed",
      attrs: Object.fromEntries(
        Object.entries(attrs).filter(([key]) => PLACEMENT_ATTRS.includes(key)),
      ),
    };
  };
  return { host: visit(doc), objects };
};

/** 保存形式から編集用の文書木へ戻す。循環する埋め込みは展開しない。 */
export const joinDocument = (
  { host, objects }: SplitResult,
  ancestors: ReadonlySet<string> = new Set(),
): DocNode => {
  const visit = (node: DocNode, seen: ReadonlySet<string>): DocNode => {
    if (node.type !== "objectEmbed")
      return node.content
        ? { ...node, content: node.content.map((child) => visit(child, seen)) }
        : node;
    const id = String(node.attrs?.objectId);
    const object = objects[id];
    if (!object || seen.has(id)) return node;
    const inner = new Set([...seen, id]);
    return {
      type: "objectBlock",
      attrs: { ...node.attrs, ...object.attrs },
      content: [
        object.title.length
          ? { type: "objectTitle", content: object.title }
          : { type: "objectTitle" },
        ...object.body.map((child) => visit(child, inner)),
      ],
    };
  };
  return visit(host, ancestors);
};

export interface Mention {
  readonly targetId: string;
  /** @を含む最小の構造。これが参照先のTimelineへ届く単位になる。 */
  readonly unit: {
    readonly kind: "object" | "listItem" | "section" | "block";
    readonly id: string;
  };
}

const UNIT_KIND: Record<string, Mention["unit"]["kind"]> = {
  objectBlock: "object",
  listItem: "listItem",
  heading: "section",
};

export const collectMentions = (doc: DocNode): readonly Mention[] => {
  const mentions: Mention[] = [];
  const visit = (node: DocNode, unit: Mention["unit"] | null): void => {
    if (node.type === "objectRef" && unit) {
      mentions.push({ targetId: String(node.attrs?.objectId), unit });
      return;
    }
    // Object・リスト項目・見出しはそれ自体が単位。段落は外側に単位がない時だけ単位になる。
    const kind = UNIT_KIND[node.type ?? ""];
    const id = String(
      node.type === "objectBlock" ? node.attrs?.objectId : node.attrs?.id,
    );
    const next: Mention["unit"] | null = kind
      ? { kind, id }
      : (unit ?? (node.type === "paragraph" ? { kind: "block", id } : null));
    for (const child of node.content ?? []) visit(child, next);
  };
  visit(doc, null);
  return mentions;
};
