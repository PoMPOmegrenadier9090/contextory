import type { DocNode } from "./object-document.js";
import type {
  FieldDefinition,
  ObjectPage,
  ObjectSummary,
  ObjectTimelineEntry,
  ObjectType,
  TypeDefinition,
  ViewDefinition,
} from "./object-model.js";

/** その日に作ったMemoと、それを置いている文書（埋め込みを遡った一番外側）。 */
export interface DayMemo {
  readonly object: ObjectSummary;
  /** どの文書にも置いていなければnull */
  readonly hostId: string | null;
  readonly hostTitle: string;
}

export interface ObjectOverview {
  readonly navigation: readonly ObjectSummary[];
  readonly recent: readonly ObjectSummary[];
  /** 作った順。同じ日の別のMemoの中にあるMemoは、その中で読めるので除く。 */
  readonly memos: readonly DayMemo[];
  /** 所属が決まっていないProject・Task・Memo・Decision。新しい順。 */
  readonly inbox: readonly ObjectSummary[];
}

export interface ViewRow {
  readonly object: ObjectSummary;
  /** Titleが文字だけか。参照が混ざるTitleは、表では書き換えない。 */
  readonly titleEditable: boolean;
  /** FieldのIDごとの値。Contextは含まず、object.contextsで見る。 */
  readonly values: Readonly<Record<string, readonly DocNode[]>>;
  /** 階層で表示するときの深さ。最上位は0。 */
  readonly depth: number;
}

/** Viewで絞り込んだ結果。表ならrows、Timelineならentriesに入る。 */
export interface ViewResult {
  readonly rows: readonly ViewRow[];
  readonly entries: readonly ObjectTimelineEntry[];
  /** 行のContextやFieldの値が指すObject */
  readonly objects: Readonly<Record<string, ObjectSummary>>;
}

export const WORKSPACE_SEARCH_LIMIT = 50;

export type WorkspaceSearchResult =
  | { readonly kind: "type"; readonly id: string }
  | {
      readonly kind: "object" | "daily";
      readonly id: string;
      readonly title: string;
      readonly type?: ObjectType;
      readonly excerpt?: string;
    };

export interface ObjectPatch {
  readonly title?: string;
  /** 種別を変える。新しい種別に無いFieldの値は消える。 */
  readonly type?: string;
  readonly done?: boolean;
  /** FieldのIDごとの新しい値。Contextは参照の並びで渡す。 */
  readonly fields?: Readonly<Record<string, readonly DocNode[]>>;
}

export interface ObjectTypePatch {
  readonly name?: string;
  readonly color?: string | null;
  readonly checkbox?: boolean;
  readonly extends?: string | null;
  readonly fields?: readonly FieldDefinition[];
  /** この種別のViewをすべて置き換える。 */
  readonly views?: readonly ViewDefinition[];
}

/** WebとDesktopが共有するObject保存境界。 */
export interface ObjectClient {
  loadPage(hostId: string): Promise<ObjectPage>;
  /** baseRevisionがnullなら、他での変更を確かめずに上書きする。 */
  savePage(
    hostId: string,
    doc: DocNode,
    baseRevision: string | null,
    keepalive?: boolean,
  ): Promise<ObjectPage>;
  searchWorkspace(query: string): Promise<readonly WorkspaceSearchResult[]>;
  searchObjects(
    query: string,
    exclude?: string | null,
    limit?: number,
  ): Promise<readonly ObjectSummary[]>;
  createObject(input: {
    readonly id: string;
    readonly type: ObjectType;
    readonly title: string;
    readonly parentId: string | null;
  }): Promise<ObjectSummary>;
  patchObject(id: string, patch: ObjectPatch): Promise<ObjectSummary>;
  /** anchorIdは開いているObject。todayは日付の条件に使う、画面側の今日。 */
  queryView(
    viewId: string,
    anchorId: string | null,
    today: string,
  ): Promise<ViewResult>;
  /** ゴミ箱へ移す。置かれている文書の本文からは外れる。 */
  trashObject(id: string): Promise<ObjectSummary>;
  /** ゴミ箱から戻す。置き場所の無いObjectとして戻る。 */
  restoreObject(id: string): Promise<ObjectSummary>;
  /** ゴミ箱にあるObjectを完全に削除する。 */
  purgeObject(id: string): Promise<void>;
  /** ゴミ箱のObject。移した日時の新しい順。 */
  trash(): Promise<readonly ObjectSummary[]>;
  emptyTrash(): Promise<void>;
  types(): Promise<readonly TypeDefinition[]>;
  updateType(name: string, patch: ObjectTypePatch): Promise<TypeDefinition>;
  /** ユーザーが作った種別を消す。その種別のObjectが残っていれば断られる。 */
  deleteType(name: string): Promise<void>;
  overview(from: number, to: number): Promise<ObjectOverview>;
  /** 前回開いたViewや畳んだ行など、端末をまたいで共有する画面の状態。 */
  uiState(): Promise<Readonly<Record<string, unknown>>>;
  setUiState(key: string, value: unknown): Promise<void>;
}
