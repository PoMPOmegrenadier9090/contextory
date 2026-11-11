import {
  collectMentionUnits,
  embeddedIds,
  joinDocument,
  refIds,
  splitDocument,
  timeFromId,
  type DocNode,
  type MentionUnit,
} from "./document-model.js";

export type ObjectType = "area" | "project" | "task" | "decision" | "memo";

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

export interface Workspace {
  readonly objects: Readonly<Record<string, ObjectRecord>>;
  readonly daily: readonly DocNode[];
}

/** null はDailyの自由文書を表す。 */
export type HostId = string | null;

type Objects = Workspace["objects"];

export const inlineText = (
  nodes: readonly DocNode[],
  objects: Objects,
  depth = 0,
): string =>
  nodes
    .map((node) => {
      if (node.type === "objectRef") {
        const target = objects[String(node.attrs?.objectId)];
        // 参照が循環しても止まるよう、深さを制限する。
        return target && depth < 3
          ? inlineText(target.title, objects, depth + 1) || "無題"
          : "…";
      }
      return node.text ?? inlineText(node.content ?? [], objects, depth);
    })
    .join("");

export const titleText = (
  object: ObjectRecord | undefined,
  objects: Objects,
): string =>
  object
    ? inlineText(object.title, objects).trim() || "無題"
    : "削除されたObject";

/**
 * 作成位置からContextを継承する。Memo内ならMemoのContextを、
 * それ以外のObject内ならそのObject自体をContextにする。Dailyでは継承しない。
 */
export const inheritedContexts = (
  objects: Objects,
  parentId: HostId,
): readonly string[] => {
  const parent = parentId === null ? undefined : objects[parentId];
  if (!parent) return [];
  return parent.type === "memo" ? parent.contexts : [parent.id];
};

/** fromからtargetへContextを辿る最短経路の中間Object ID。届かなければnull。 */
export const contextPath = (
  objects: Objects,
  fromId: string,
  targetId: string,
): readonly string[] | null => {
  const queue: (readonly string[])[] = [[fromId]];
  const seen = new Set([fromId]);
  while (queue.length) {
    const path = queue.shift()!;
    for (const next of objects[path.at(-1)!]?.contexts ?? []) {
      if (next === targetId) return path.slice(1);
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
};

export const addContext = (
  workspace: Workspace,
  objectId: string,
  targetId: string,
): Workspace => {
  const object = workspace.objects[objectId];
  if (!object || objectId === targetId || object.contexts.includes(targetId))
    return workspace;
  // 循環を作らない
  if (contextPath(workspace.objects, targetId, objectId)) return workspace;
  return patchObject(workspace, objectId, {
    contexts: [...object.contexts, targetId],
  });
};

export const patchObject = (
  workspace: Workspace,
  id: string,
  patch: Partial<Omit<ObjectRecord, "id">>,
): Workspace => {
  const object = workspace.objects[id];
  if (!object) return workspace;
  return {
    ...workspace,
    objects: { ...workspace.objects, [id]: { ...object, ...patch } },
  };
};

const hostBody = (workspace: Workspace, hostId: HostId): readonly DocNode[] =>
  hostId === null ? workspace.daily : (workspace.objects[hostId]?.body ?? []);

/** hostの本文を、埋め込みObjectを展開した編集用の文書木として開く。 */
export const openDocument = (workspace: Workspace, hostId: HostId): DocNode =>
  joinDocument(
    { type: "doc", content: hostBody(workspace, hostId) },
    Object.fromEntries(
      Object.values(workspace.objects).map((object) => [
        object.id,
        {
          attrs: { type: object.type, done: object.done },
          title: object.title,
          body: object.body,
        },
      ]),
    ),
    new Set(hostId === null ? [] : [hostId]),
  );

/** hostの本文から埋め込みを辿って届くObject。 */
const placedIds = (
  workspace: Workspace,
  hostId: HostId,
): ReadonlySet<string> => {
  const seen = new Set<string>();
  const visit = (nodes: readonly DocNode[]): void => {
    for (const id of embeddedIds(nodes)) {
      if (seen.has(id)) continue;
      seen.add(id);
      visit(workspace.objects[id]?.body ?? []);
    }
  };
  visit(hostBody(workspace, hostId));
  return seen;
};

/**
 * 編集した文書木を保存する。Object単位へ分け、初めて現れたObjectは
 * 置かれた場所からContextを継承して作る。この文書から消え、他のどこにも
 * 置かれていないObjectは削除する。
 */
export const saveDocument = (
  workspace: Workspace,
  hostId: HostId,
  doc: DocNode,
  now: number,
): Workspace => {
  const split = splitDocument(doc);
  const objects: Record<string, ObjectRecord> = { ...workspace.objects };
  const ensure = (id: string): void => {
    const content = split.objects[id];
    if (!content) return;
    const parent = split.parents[id] ?? hostId;
    // 親も今回初めて現れた場合に備え、親から先に作る。
    if (parent !== null && parent !== hostId && !objects[parent])
      ensure(parent);
    const current = objects[id];
    objects[id] = {
      id,
      type: (content.attrs.type as ObjectType | undefined) ?? "task",
      title: content.title,
      body: content.body,
      done: Boolean(content.attrs.done),
      contexts: current?.contexts ?? inheritedContexts(objects, parent),
      createdAt: current?.createdAt ?? now,
    };
  };
  for (const id of Object.keys(split.objects)) ensure(id);

  const body = split.host.content ?? [];
  let next: Workspace =
    hostId === null
      ? { objects, daily: body }
      : patchObject({ ...workspace, objects }, hostId, { body });

  const removed = [...placedIds(workspace, hostId)].filter(
    (id) => !split.objects[id],
  );
  if (removed.length) {
    const remaining = { ...next.objects };
    const stillPlaced = new Set([
      ...embeddedIds(next.daily),
      ...Object.values(remaining)
        .filter((object) => !removed.includes(object.id))
        .flatMap((object) => embeddedIds(object.body)),
    ]);
    for (const id of removed) if (!stillPlaced.has(id)) delete remaining[id];
    next = { ...next, objects: remaining };
  }
  return next;
};

export type TimelineEntry =
  | {
      readonly kind: "object";
      readonly object: ObjectRecord;
      /** Contextで属するのではなく、@で言及しているだけ */
      readonly mentioned: boolean;
      readonly via: readonly string[];
      readonly time: number;
    }
  | {
      readonly kind: "unit";
      readonly hostId: HostId;
      readonly unit: MentionUnit;
      readonly via: readonly string[];
      readonly time: number;
    };

/**
 * targetのTimeline。Contextで属するObjectと、@で言及している最小の構造を
 * 新しい順に並べる。配下のObjectに届くものも、経路付きで含める。
 */
export const collectTimeline = (
  workspace: Workspace,
  targetId: string,
  now: number,
): readonly TimelineEntry[] => {
  const { objects } = workspace;
  /** idからtargetまでの経路（id自身を含む）。target自身なら空。 */
  const reach = (id: string): readonly string[] | null => {
    if (id === targetId) return [];
    const path = contextPath(objects, id, targetId);
    return path && [id, ...path];
  };
  const firstReach = (ids: readonly string[]): readonly string[] | null => {
    for (const id of ids) {
      const via = reach(id);
      if (via) return via;
    }
    return null;
  };
  const units = (
    hostId: HostId,
    nodes: readonly DocNode[],
    fallbackTime: number,
  ): TimelineEntry[] => {
    const seen = new Set<DocNode>();
    return collectMentionUnits(nodes).flatMap((unit) => {
      const via = reach(unit.targetId);
      if (!via || seen.has(unit.node)) return [];
      seen.add(unit.node);
      const time = timeFromId(unit.node.attrs?.id) ?? fallbackTime;
      return [{ kind: "unit", hostId, unit, via, time }];
    });
  };

  const entries: TimelineEntry[] = units(null, workspace.daily, now);
  for (const object of Object.values(objects)) {
    if (object.id === targetId) continue;
    const path = contextPath(objects, object.id, targetId);
    if (path) {
      entries.push({
        kind: "object",
        object,
        mentioned: false,
        via: path,
        time: object.createdAt,
      });
      continue;
    }
    // TitleやMemo本文での言及は、Object全体をひとまとまりとして届ける。
    const whole = firstReach([
      ...refIds(object.title),
      ...(object.type === "memo" ? refIds(object.body) : []),
    ]);
    if (whole)
      entries.push({
        kind: "object",
        object,
        mentioned: true,
        via: whole,
        time: object.createdAt,
      });
    else if (object.type !== "memo")
      entries.push(...units(object.id, object.body, object.createdAt));
  }
  return entries.sort((a, b) => b.time - a.time);
};
