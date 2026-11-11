/** ProseMirror JSONの最小形。TiptapのJSONContentと互換。 */
export interface DocNode {
  readonly type?: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly DocNode[];
  readonly text?: string;
  readonly marks?: readonly unknown[];
}

/** 文書から切り出したObjectの中身。配置側の属性は含まない。 */
export interface ObjectContent {
  /** type、doneなどObject自身の属性 */
  readonly attrs: Readonly<Record<string, unknown>>;
  readonly title: readonly DocNode[];
  readonly body: readonly DocNode[];
}

export interface SplitResult {
  readonly host: DocNode;
  readonly objects: Readonly<Record<string, ObjectContent>>;
  /** 文書内で各Objectを直接包んでいるObject。最上位ならnull。 */
  readonly parents: Readonly<Record<string, string | null>>;
}

/** 配置側（埋め込みBlock）に残す属性。それ以外はObject側へ保存する。 */
const PLACEMENT_ATTRS = ["id", "objectId", "collapsed"];

/**
 * 時刻順に並ぶID。先頭12桁がミリ秒の作成時刻で、Blockの作成日時を別に持たずに済む。
 */
export const newId = (now = Date.now()): string =>
  `${now.toString(16).padStart(12, "0")}-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;

export const timeFromId = (id: unknown): number | null => {
  const match = typeof id === "string" ? /^([0-9a-f]{12})-/.exec(id) : null;
  return match ? Number.parseInt(match[1]!, 16) : null;
};

/**
 * 編集中は一つの文書木として扱い、保存時にObject単位へ分ける。
 * objectBlockを埋め込み参照へ置き換え、本文はObjectごとに切り出す。
 */
export const splitDocument = (doc: DocNode): SplitResult => {
  const objects: Record<string, ObjectContent> = {};
  const parents: Record<string, string | null> = {};
  const visit = (node: DocNode, parent: string | null): DocNode => {
    if (node.type !== "objectBlock") {
      const content = node.content?.map((child) => visit(child, parent));
      return content ? { ...node, content } : node;
    }
    const attrs = node.attrs ?? {};
    const id = String(attrs.objectId);
    const [title, ...body] = (node.content ?? []).map((child) =>
      visit(child, id),
    );
    parents[id] = parent;
    objects[id] = {
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
  return { host: visit(doc, null), objects, parents };
};

/** 保存形式から編集用の文書木へ戻す。循環する埋め込みは展開しない。 */
export const joinDocument = (
  host: DocNode,
  objects: Readonly<Record<string, ObjectContent>>,
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

/** 文書（分割済み）に置かれている埋め込みObjectのID。 */
export const embeddedIds = (nodes: readonly DocNode[]): readonly string[] =>
  nodes.flatMap((node) =>
    node.type === "objectEmbed"
      ? [String(node.attrs?.objectId)]
      : embeddedIds(node.content ?? []),
  );

/** インライン内容が参照しているObjectのID。 */
export const refIds = (nodes: readonly DocNode[]): readonly string[] =>
  nodes.flatMap((node) =>
    node.type === "objectRef"
      ? [String(node.attrs?.objectId)]
      : refIds(node.content ?? []),
  );

export interface MentionUnit {
  readonly targetId: string;
  /** listItem: 項目と子、section: 見出し以下、block: 段落 */
  readonly kind: "listItem" | "section" | "block";
  /** @を含む最小の構造。これが参照先のTimelineへ届く単位になる。 */
  readonly node: DocNode;
}

const UNIT_KIND: Record<string, MentionUnit["kind"]> = {
  listItem: "listItem",
  heading: "section",
};

/** 分割済みの文書から、@を含む最小の構造を取り出す。埋め込みObjectの中は見ない。 */
export const collectMentionUnits = (
  nodes: readonly DocNode[],
): readonly MentionUnit[] => {
  const units: MentionUnit[] = [];
  const visit = (
    node: DocNode,
    unit: Omit<MentionUnit, "targetId"> | null,
  ): void => {
    if (node.type === "objectRef" && unit) {
      units.push({ targetId: String(node.attrs?.objectId), ...unit });
      return;
    }
    // リスト項目・見出しはそれ自体が単位。段落は外側に単位がない時だけ単位になる。
    const kind = UNIT_KIND[node.type ?? ""];
    const next = kind
      ? { kind, node }
      : (unit ??
        (node.type === "paragraph" ? { kind: "block" as const, node } : null));
    for (const child of node.content ?? []) visit(child, next);
  };
  for (const node of nodes) visit(node, null);
  return units;
};
