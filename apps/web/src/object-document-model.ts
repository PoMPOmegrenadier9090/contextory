export type ObjectType = "area" | "project" | "task" | "decision" | "memo";
export type TaskStatus = "未着手" | "進行中" | "完了";
export type TextKind = "p" | "h" | "li";

export type Block =
  | {
      readonly id: string;
      readonly kind: TextKind;
      readonly text: string;
      readonly createdAt?: number;
    }
  | {
      readonly id: string;
      readonly kind: "embed";
      readonly objectId: string;
      readonly collapsed: boolean;
    };

export type TextBlock = Extract<Block, { kind: TextKind }>;

/** Objectは独立した本文を持ち、文書には埋め込みBlockとして置かれる。 */
export interface DocObject {
  readonly id: string;
  readonly type: ObjectType;
  readonly title: string;
  readonly status: TaskStatus | null;
  /** 文脈上の親。推移的に辿ってTimelineを組み立てる。 */
  readonly contexts: readonly string[];
  readonly derivedFrom: string | null;
  readonly createdAt: number;
  readonly body: readonly Block[];
}

export interface DemoState {
  readonly objects: Readonly<Record<string, DocObject>>;
  readonly daily: readonly Block[];
}

/** null はDailyの自由文書を表す。 */
export type HostId = string | null;

export const TYPE_LABEL: Record<ObjectType, string> = {
  area: "Area",
  project: "Project",
  task: "Task",
  decision: "Decision",
  memo: "Memo",
};

const REF = /@\[([^\]]+)\]/g;

export const refToken = (id: string): string => `@[${id}]`;

export const splitRefs = (
  text: string,
): readonly ({ text: string } | { ref: string })[] => {
  const parts: ({ text: string } | { ref: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(REF)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ ref: match[1] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
};

export const displayTitle = (
  object: DocObject | undefined,
  objects: DemoState["objects"],
): string => {
  if (!object) return "削除されたObject";
  if (object.type !== "memo") return object.title || "無題";
  const first = object.body.find(
    (block): block is TextBlock => block.kind !== "embed" && !!block.text,
  );
  // Memo同士の参照で循環しないよう、Memo内のMemo参照は種別名で表す。
  const preview = first
    ? first.text.replace(REF, (_, id: string) =>
        objects[id]?.type === "memo" ? "Memo" : displayTitle(objects[id], {}),
      )
    : "";
  return preview.trim().slice(0, 48) || "空のMemo";
};

export const plainText = (
  text: string,
  objects: DemoState["objects"],
): string =>
  text.replace(REF, (_, id: string) => displayTitle(objects[id], objects));

export const getBlocks = (
  state: DemoState,
  hostId: HostId,
): readonly Block[] =>
  hostId === null ? state.daily : (state.objects[hostId]?.body ?? []);

export const setBlocks = (
  state: DemoState,
  hostId: HostId,
  update: (blocks: readonly Block[]) => readonly Block[],
): DemoState => {
  if (hostId === null) return { ...state, daily: update(state.daily) };
  const host = state.objects[hostId];
  if (!host) return state;
  return updateObject(state, hostId, { body: update(host.body) });
};

export const updateObject = (
  state: DemoState,
  id: string,
  patch: Partial<Omit<DocObject, "id">>,
): DemoState => {
  const object = state.objects[id];
  if (!object) return state;
  return {
    ...state,
    objects: { ...state.objects, [id]: { ...object, ...patch } },
  };
};

export const addObject = (state: DemoState, object: DocObject): DemoState => ({
  ...state,
  objects: { ...state.objects, [object.id]: object },
});

/**
 * 作成位置からContextを継承する。Memo内ならMemoのContextを、
 * それ以外のObject内ならそのObject自体をContextにする。Dailyでは継承しない。
 */
export const inheritedContext = (
  objects: DemoState["objects"],
  hostId: HostId,
): {
  readonly contexts: readonly string[];
  readonly derivedFrom: string | null;
} => {
  const host = hostId === null ? undefined : objects[hostId];
  if (!host) return { contexts: [], derivedFrom: null };
  return host.type === "memo"
    ? { contexts: host.contexts, derivedFrom: host.id }
    : { contexts: [host.id], derivedFrom: null };
};

export const newObject = (
  id: string,
  type: ObjectType,
  title: string,
  createdAt: number,
  inherited: ReturnType<typeof inheritedContext>,
  body: readonly Block[],
): DocObject => ({
  id,
  type,
  title,
  status: type === "task" ? "未着手" : null,
  contexts: inherited.contexts,
  derivedFrom: inherited.derivedFrom,
  createdAt,
  body,
});

/** 1 BlockをObject化し、同じ位置に埋め込みBlockを残す。 */
export const convertBlockToObject = (
  state: DemoState,
  hostId: HostId,
  blockId: string,
  type: ObjectType,
  objectId: string,
  bodyBlockId: string,
  createdAt: number,
): DemoState => {
  const block = getBlocks(state, hostId).find((b) => b.id === blockId);
  if (!block || block.kind === "embed") return state;
  // MemoはBlockをそのまま本文にする。それ以外は本文をTitleにする。
  const body: readonly Block[] =
    type === "memo"
      ? [{ ...block, kind: "p" }]
      : [{ id: bodyBlockId, kind: "p", text: "" }];
  const title =
    type === "memo" ? "" : plainText(block.text, state.objects).trim();
  const object = newObject(
    objectId,
    type,
    title,
    createdAt,
    inheritedContext(state.objects, hostId),
    body,
  );
  return setBlocks(addObject(state, object), hostId, (blocks) =>
    blocks.map<Block>((b) =>
      b.id === blockId
        ? {
            id: `embed-${objectId}`,
            kind: "embed",
            objectId,
            // TaskやDecisionは1行で本文に馴染ませ、本文は必要な時だけ開く。
            collapsed: type !== "memo",
          }
        : b,
    ),
  );
};

/**
 * Context付与。Object内ならそのObjectへ追加する。
 * Dailyの素のBlockはContextを持てないため、Memo化してから付与する。
 */
export const assignContext = (
  state: DemoState,
  hostId: HostId,
  blockId: string,
  targetId: string,
  memoId: string,
  createdAt: number,
): DemoState => {
  if (hostId !== null) return addContext(state, hostId, targetId);
  const converted = convertBlockToObject(
    state,
    null,
    blockId,
    "memo",
    memoId,
    blockId,
    createdAt,
  );
  return converted === state ? state : addContext(converted, memoId, targetId);
};

export const addContext = (
  state: DemoState,
  objectId: string,
  targetId: string,
): DemoState => {
  const object = state.objects[objectId];
  if (!object || objectId === targetId || object.contexts.includes(targetId))
    return state;
  if (contextPath(state.objects, targetId, objectId)) return state; // 循環を作らない
  return updateObject(state, objectId, {
    contexts: [...object.contexts, targetId],
  });
};

export const removeContext = (
  state: DemoState,
  objectId: string,
  targetId: string,
): DemoState => {
  const object = state.objects[objectId];
  if (!object) return state;
  return updateObject(state, objectId, {
    contexts: object.contexts.filter((id) => id !== targetId),
  });
};

/** fromからtargetへContextを辿る最短経路の中間Object ID。届かなければnull。 */
export const contextPath = (
  objects: DemoState["objects"],
  fromId: string,
  targetId: string,
): readonly string[] | null => {
  const queue: (readonly string[])[] = [[fromId]];
  const seen = new Set([fromId]);
  while (queue.length) {
    const path = queue.shift()!;
    const current = objects[path[path.length - 1]!];
    for (const next of current?.contexts ?? []) {
      if (next === targetId) return path.slice(1);
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
};

export interface TimelineEntry {
  readonly object: DocObject;
  readonly via: readonly string[];
}

/** Context連鎖がtargetへ届くObjectを、新しい順に並べる。 */
export const collectTimeline = (
  objects: DemoState["objects"],
  targetId: string,
): readonly TimelineEntry[] =>
  Object.values(objects)
    .flatMap((object) => {
      if (object.id === targetId) return [];
      const via = contextPath(objects, object.id, targetId);
      return via ? [{ object, via }] : [];
    })
    .sort((a, b) => b.object.createdAt - a.object.createdAt);

export interface MentionEntry {
  readonly hostId: HostId;
  readonly block: TextBlock;
  /** 言及先からtargetまでの経路。target自身への言及なら空。 */
  readonly via: readonly string[];
}

/**
 * targetやその配下のObjectへ@で言及している段落。所属は変えず、段落だけを集める。
 * target自身の本文と、すでにContextで届くObjectの本文は重複するので除く。
 */
export const collectMentions = (
  state: DemoState,
  targetId: string,
): readonly MentionEntry[] => {
  const reach = (id: string): readonly string[] | null => {
    if (id === targetId) return [];
    const path = contextPath(state.objects, id, targetId);
    return path && [id, ...path];
  };
  const hosts: (readonly [HostId, readonly Block[]])[] = [
    [null, state.daily],
    ...Object.values(state.objects)
      .filter((object) => !reach(object.id))
      .map((object) => [object.id, object.body] as const),
  ];
  return hosts.flatMap(([hostId, blocks]) =>
    blocks.flatMap((block) => {
      if (block.kind === "embed") return [];
      for (const part of splitRefs(block.text)) {
        const via = "ref" in part ? reach(part.ref) : null;
        if (via) return [{ hostId, block, via }];
      }
      return [];
    }),
  );
};
