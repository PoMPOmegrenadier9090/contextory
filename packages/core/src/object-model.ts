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

export const FIELD_KINDS = [
  "context",
  "text",
  "reference",
  "date",
  "select",
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface FieldDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: FieldKind;
  /** selectの選択肢 */
  readonly options?: readonly string[];
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

/** Fieldの値での絞り込み。selectは選択肢、dateは"today"・"week"・"past"。 */
export interface ViewFilter {
  readonly fieldId: string;
  readonly value: string;
}

/** 種別ごとに保存する、Objectの見せ方。 */
export interface ViewDefinition {
  readonly id: string;
  /** type: 種別のページに出す。object: その種別のObjectのページに出す。 */
  readonly scope: "type" | "object";
  readonly name: string;
  readonly layout: "table" | "timeline";
  /** scopeがobjectのときに絞る種別。nullなら絞らない。 */
  readonly type: ObjectType | null;
  /** scopeがobjectのときの範囲。direct: Contextが開いているObject。all: その配下まで。 */
  readonly reach: "direct" | "all";
  readonly done: "all" | "open" | "done";
  readonly filters: readonly ViewFilter[];
  /** "created"、"updated"、"title"、またはFieldのID */
  readonly sort: string;
  readonly desc: boolean;
  /** 表で隠すFieldのID */
  readonly hidden: readonly string[];
  /** 表で、配下のObjectを行の下に入れ子で出す。 */
  readonly nested: boolean;
}

export interface TypeDefinition {
  readonly name: ObjectType;
  /** TYPE_COLORSのいずれか。nullなら種別の既定の色。 */
  readonly color: string | null;
  readonly builtin: boolean;
  /** 行頭に完了のチェックボックスを出すか。 */
  readonly checkbox: boolean;
  /** この種別が自分で持つField。表示順で、上にあるものほど優先して見せる。 */
  readonly fields: readonly FieldDefinition[];
  /** Fieldを引き継ぐ元の種別 */
  readonly extends: ObjectType | null;
  /** 継承元から引き継いだField。自分のFieldの後ろに並ぶ。 */
  readonly inherited: readonly FieldDefinition[];
  readonly views: readonly ViewDefinition[];
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
  /** 開いた時点の文書の版。保存時に渡すと、他で変わっていれば保存を断る。 */
  readonly revision: string;
}

/** 他の画面や端末で文書が変わっていて、保存を断ったことを示す。 */
export const PAGE_CONFLICT = "PAGE_CONFLICT";

/** IPCやHTTPを越えるとエラーの型が失われるので、文言で見分ける。 */
export const isPageConflict = (error: unknown): boolean =>
  error instanceof Error && error.message.includes(PAGE_CONFLICT);

export type ObjectTimelineEntry =
  | {
      readonly kind: "object";
      readonly object: ObjectSummary;
      /** Contextで属するのではなく、@で言及しているだけ */
      readonly mentioned: boolean;
      /** Fieldの値で言及している場合の、Fieldの名前 */
      readonly field?: string;
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
