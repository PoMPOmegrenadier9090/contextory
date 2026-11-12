import type { DocNode } from "./object-document.js";

/** 組み込みの種別。チェックボックスやContextの継承など、固有の振る舞いを持つ。 */
export const OBJECT_TYPES = [
  "area",
  "project",
  "task",
  "decision",
  "memo",
] as const;
/** 組み込みの種別か、ユーザーが#で作った種別の名前。 */
export type ObjectType = string;

/** 種別として使える名前に整える。使えなければnull。 */
export const normalizeObjectType = (value: unknown): ObjectType | null => {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return (
    OBJECT_TYPES.find((type) => type === name.toLowerCase()) ??
    (/^[^\s#@]{1,40}$/u.test(name) ? name : null)
  );
};

export const FIELD_KINDS = ["context", "text", "reference"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface FieldDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: FieldKind;
}

/** すべての種別が持つField。値はContextそのもので、推移的に収集される。 */
export const CONTEXT_FIELD: FieldDefinition = {
  id: "context",
  name: "Context",
  kind: "context",
};

export const TYPE_COLORS = [
  "blue",
  "amber",
  "purple",
  "green",
  "rose",
  "gray",
] as const;

export interface TypeDefinition {
  readonly name: ObjectType;
  /** TYPE_COLORSのいずれか。nullなら種別の既定の色。 */
  readonly color: string | null;
  readonly builtin: boolean;
  /** 表示順。上にあるものほど優先して見せる。 */
  readonly fields: readonly FieldDefinition[];
}

/** Objectは独立した本文を持ち、文書には埋め込みBlockとして置かれる。 */
export interface ObjectRecord {
  readonly id: string;
  readonly type: ObjectType;
  /** インライン内容。Memoでは1行目がこれに当たる。 */
  readonly title: readonly DocNode[];
  readonly body: readonly DocNode[];
  readonly done: boolean;
  /** 文脈上の親。推移的に辿ってTimelineを組み立てる。 */
  readonly contexts: readonly string[];
  readonly createdAt: number;
}

/** 画面が参照チップやContextの表示に使う、本文を除いたObject。 */
export interface ObjectSummary {
  readonly id: string;
  readonly type: ObjectType;
  readonly title: string;
  readonly done: boolean;
  readonly contexts: readonly string[];
  readonly createdAt: number;
}

/** 文書を開いた時に、編集用の文書木と一緒に返す内容。 */
export interface ObjectPage {
  readonly doc: DocNode;
  /** 文書内のObject、参照先、それらのContext先 */
  readonly objects: Readonly<Record<string, ObjectSummary>>;
}

export type ObjectTimelineEntry =
  | {
      readonly kind: "object";
      readonly object: ObjectSummary;
      /** Contextで属するのではなく、@で言及しているだけ */
      readonly mentioned: boolean;
      readonly via: readonly string[];
      readonly time: number;
    }
  | {
      readonly kind: "unit";
      readonly hostId: string;
      readonly hostTitle: string;
      readonly unitId: string;
      /** listItem: 項目と子、section: 見出し以下、block: 段落 */
      readonly unitKind: "listItem" | "section" | "block";
      readonly text: string;
      readonly via: readonly string[];
      readonly time: number;
    };

/** インライン内容を、参照をTitleへ置き換えた文字列にする。 */
export const inlineText = (
  nodes: readonly DocNode[],
  titleOf: (id: string) => readonly DocNode[] | undefined,
  depth = 0,
): string =>
  nodes
    .map((node) => {
      if (node.type === "objectRef") {
        const title = titleOf(String(node.attrs?.objectId));
        // 参照が循環しても止まるよう、深さを制限する。
        return title && depth < 3
          ? inlineText(title, titleOf, depth + 1) || "無題"
          : "…";
      }
      return node.text ?? inlineText(node.content ?? [], titleOf, depth);
    })
    .join("");

/**
 * 作成位置からContextを継承する。Memo内ならMemoのContextを、
 * それ以外のObject内ならそのObject自体をContextにする。
 */
export const inheritedContexts = (
  parent: Pick<ObjectSummary, "id" | "type" | "contexts"> | undefined,
): readonly string[] =>
  !parent ? [] : parent.type === "memo" ? parent.contexts : [parent.id];
