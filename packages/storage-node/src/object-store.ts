import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  collectMentionUnits,
  CONTEXT_FIELD,
  embeddedIds,
  FIELD_KINDS,
  fieldNode,
  inheritedContexts,
  inlineText,
  joinDocument,
  newId,
  normalizeObjectType,
  OBJECT_TYPES,
  PAGE_CONFLICT,
  parseView,
  refIds,
  splitDocument,
  timeFromId,
  TYPE_COLORS,
  type DayMemo,
  type DocNode,
  type FieldDefinition,
  type ObjectContent,
  type ObjectFieldContent,
  type ObjectOverview,
  type ObjectPage,
  type ObjectPatch,
  type ObjectRecord,
  type ObjectSummary,
  type ObjectTimelineEntry,
  type ObjectType,
  type TypeDefinition,
  type ViewDefinition,
  type ViewResult,
  type ViewRow,
} from "@pkm/core";

export const OBJECT_STORE_SCHEMA_VERSION = 5;

/** Objectに属さない文書のID。いまはDailyだけがこれに当たる。 */
const DOCUMENT_ID = /^daily:\d{4}-\d{2}-\d{2}$/;

export class ObjectStoreError extends Error {
  override readonly name = "ObjectStoreError";
  constructor(
    readonly code: "OBJECT_NOT_FOUND" | "INVALID_CONTEXT" | "PAGE_CONFLICT",
    message: string,
  ) {
    super(message);
  }
}

export interface ObjectWorkspace {
  readonly objects: readonly ObjectRecord[];
  readonly documents: Readonly<Record<string, readonly DocNode[]>>;
}

interface ObjectRow {
  readonly id: string;
  readonly type: ObjectType;
  readonly title: string;
  readonly body: string;
  readonly done: number;
  readonly created_at: number;
  readonly updated_at: number;
}

interface MentionRow {
  readonly host_id: string;
  readonly unit_id: string;
  /** field: Fieldの値での言及。unit_idは"field:"とFieldのID */
  readonly unit_kind: "object" | "field" | "listItem" | "section" | "block";
  readonly target_id: string;
  readonly unit: string;
  readonly time: number;
}

const nodes = (json: string): readonly DocNode[] =>
  JSON.parse(json) as readonly DocNode[];

const REACH = `WITH RECURSIVE reach(id) AS (
  SELECT ? UNION
  SELECT c.object_id FROM contexts c JOIN reach r ON c.target_id = r.id
)`;

/**
 * 次期のObject保存層。objects・documents・contextsが正本で、
 * placementsとmentionsは本文から作り直せる索引。
 */
export class ObjectStore {
  private readonly database: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path);
    this.database.pragma("journal_mode = WAL");
    const version = this.database.pragma("user_version", {
      simple: true,
    }) as number;
    if (version > OBJECT_STORE_SCHEMA_VERSION) {
      this.database.close();
      throw new Error(
        `object store schema v${version} is newer than supported v${OBJECT_STORE_SCHEMA_VERSION}`,
      );
    }
    if (version < 1)
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE objects (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            title_text TEXT NOT NULL,
            body TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          ) WITHOUT ROWID;
          CREATE INDEX objects_created ON objects(created_at);
          CREATE TABLE documents (
            id TEXT PRIMARY KEY,
            body TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          ) WITHOUT ROWID;
          CREATE TABLE contexts (
            object_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (object_id, target_id)
          ) WITHOUT ROWID;
          CREATE INDEX contexts_target ON contexts(target_id);
          CREATE TABLE placements (
            host_id TEXT NOT NULL,
            object_id TEXT NOT NULL,
            PRIMARY KEY (host_id, object_id)
          ) WITHOUT ROWID;
          CREATE INDEX placements_object ON placements(object_id);
          CREATE TABLE mentions (
            host_id TEXT NOT NULL,
            unit_id TEXT NOT NULL,
            unit_kind TEXT NOT NULL,
            target_id TEXT NOT NULL,
            unit TEXT NOT NULL,
            time INTEGER NOT NULL,
            PRIMARY KEY (host_id, unit_id, target_id)
          ) WITHOUT ROWID;
          CREATE INDEX mentions_target ON mentions(target_id);
        `);
        this.database.pragma("user_version = 1");
      })();
    if (version < 2)
      this.database.transaction(() => {
        // extendsは継承用。まだ読み書きしていない。
        this.database.exec(`
          CREATE TABLE types (
            name TEXT PRIMARY KEY,
            color TEXT,
            extends TEXT,
            created_at INTEGER NOT NULL
          ) WITHOUT ROWID;
          CREATE TABLE fields (
            type TEXT NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (type, id)
          ) WITHOUT ROWID;
          CREATE TABLE field_values (
            object_id TEXT NOT NULL,
            field_id TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY (object_id, field_id)
          ) WITHOUT ROWID;
          CREATE INDEX field_values_field ON field_values(field_id);
          INSERT INTO types (name, created_at) SELECT DISTINCT type, 0 FROM objects;
        `);
        this.database.pragma("user_version = 2");
      })();
    if (version < 3)
      this.database.transaction(() => {
        this.database.exec(`
          ALTER TABLE types ADD COLUMN checkbox INTEGER NOT NULL DEFAULT 0;
          UPDATE types SET checkbox = 1 WHERE name = 'task';
        `);
        this.database.pragma("user_version = 3");
      })();
    if (version < 4)
      this.database.transaction(() => {
        this.database.exec("ALTER TABLE fields ADD COLUMN options TEXT");
        this.database.pragma("user_version = 4");
      })();
    if (version < 5)
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE views (
            id TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            position INTEGER NOT NULL,
            config TEXT NOT NULL
          ) WITHOUT ROWID;
          CREATE INDEX views_owner ON views(owner);
        `);
        for (const name of this.database
          .prepare("SELECT name FROM types")
          .pluck()
          .all() as string[])
          this.setViews(name, this.defaultViews());
        this.database.pragma("user_version = 5");
      })();
    for (const type of OBJECT_TYPES) this.ensureType(type, 0);
  }

  close(): void {
    this.database.close();
  }

  /* ---------- rows ---------- */

  private row(id: string): ObjectRow | undefined {
    return this.database
      .prepare("SELECT * FROM objects WHERE id = ?")
      .get(id) as ObjectRow | undefined;
  }

  private requireRow(id: string): ObjectRow {
    const row = this.row(id);
    if (!row)
      throw new ObjectStoreError("OBJECT_NOT_FOUND", `Object not found: ${id}`);
    return row;
  }

  private contextsOf(id: string): string[] {
    return this.database
      .prepare(
        "SELECT target_id FROM contexts WHERE object_id = ? ORDER BY position",
      )
      .pluck()
      .all(id) as string[];
  }

  private readonly titleOf = (id: string): readonly DocNode[] | undefined => {
    const row = this.row(id);
    return row && nodes(row.title);
  };

  private text(content: readonly DocNode[]): string {
    return inlineText(content, this.titleOf).trim();
  }

  private summary(row: ObjectRow): ObjectSummary {
    return {
      id: row.id,
      type: row.type,
      title: this.text(nodes(row.title)) || "無題",
      done: row.done === 1,
      contexts: this.contextsOf(row.id),
      createdAt: row.created_at,
    };
  }

  private hostBody(hostId: string): readonly DocNode[] {
    const row = this.row(hostId);
    if (row) return nodes(row.body);
    if (!DOCUMENT_ID.test(hostId))
      throw new ObjectStoreError(
        "OBJECT_NOT_FOUND",
        `Object not found: ${hostId}`,
      );
    const body = this.database
      .prepare("SELECT body FROM documents WHERE id = ?")
      .pluck()
      .get(hostId) as string | undefined;
    return body === undefined ? [] : nodes(body);
  }

  /** hostの本文から埋め込みを辿って届くObject。 */
  private placedIds(hostId: string): string[] {
    return this.database
      .prepare(
        `WITH RECURSIVE placed(id) AS (
           SELECT object_id FROM placements WHERE host_id = ? UNION
           SELECT p.object_id FROM placements p JOIN placed ON p.host_id = placed.id
         ) SELECT id FROM placed`,
      )
      .pluck()
      .all(hostId) as string[];
  }

  private upsertObject(
    id: string,
    type: ObjectType,
    title: readonly DocNode[],
    body: readonly DocNode[],
    done: boolean,
    now: number,
  ): void {
    this.database
      .prepare(
        `INSERT INTO objects (id, type, title, title_text, body, done, created_at, updated_at)
         VALUES (@id, @type, @title, '', @body, @done, @now, @now)
         ON CONFLICT(id) DO UPDATE SET
           type = @type, title = @title, body = @body, done = @done, updated_at = @now`,
      )
      .run({
        id,
        type,
        title: JSON.stringify(title),
        body: JSON.stringify(body),
        done: done ? 1 : 0,
        now,
      });
    this.ensureType(type, now);
    // shortcut: 検索用のTitleは書き込み時点のもの。参照先のTitle変更には追従しない。
    this.database
      .prepare("UPDATE objects SET title_text = ? WHERE id = ?")
      .run(this.text(title), id);
  }

  private ensureType(name: ObjectType, now: number): void {
    const created = this.database
      .prepare(
        "INSERT OR IGNORE INTO types (name, checkbox, created_at) VALUES (?, ?, ?)",
      )
      .run(name, name === "task" ? 1 : 0, now).changes;
    if (created) this.setViews(name, this.defaultViews());
  }

  /** 種別を作ったときに持たせるView。種別のページの表と、ObjectのページのTimeline。 */
  private defaultViews(): ViewDefinition[] {
    return [
      parseView({ id: newId(), scope: "type", name: "すべて" }),
      parseView({
        id: newId(),
        scope: "object",
        name: "Timeline",
        layout: "timeline",
        reach: "all",
      }),
    ];
  }

  private viewsOf(type: ObjectType): ViewDefinition[] {
    return (
      this.database
        .prepare("SELECT config FROM views WHERE owner = ? ORDER BY position")
        .pluck()
        .all(type) as string[]
    ).map((config) => parseView(JSON.parse(config)));
  }

  private setViews(type: ObjectType, views: readonly ViewDefinition[]): void {
    this.database.prepare("DELETE FROM views WHERE owner = ?").run(type);
    const insert = this.database.prepare(
      "INSERT INTO views (id, owner, position, config) VALUES (?, ?, ?, ?)",
    );
    views.forEach((view, position) =>
      insert.run(view.id, type, position, JSON.stringify(view)),
    );
  }

  /** 種別が自分で持つField。Contextは保存が無くても先頭に持つ。 */
  private ownFields(type: ObjectType): FieldDefinition[] {
    const fields = (
      this.database
        .prepare(
          "SELECT id, name, kind, options FROM fields WHERE type = ? ORDER BY position",
        )
        .all(type) as (FieldDefinition & { options: string | null })[]
    ).map(({ options, ...field }) => ({
      ...field,
      ...(options ? { options: JSON.parse(options) as string[] } : {}),
    }));
    return fields.some((field) => field.id === CONTEXT_FIELD.id)
      ? fields
      : [CONTEXT_FIELD, ...fields];
  }

  /** 継承元を近い順に辿る。循環していても止まる。 */
  private ancestors(type: ObjectType): ObjectType[] {
    const chain: ObjectType[] = [];
    let current: ObjectType | null = type;
    while (current !== null) {
      current =
        (this.database
          .prepare("SELECT extends FROM types WHERE name = ?")
          .pluck()
          .get(current) as string | null | undefined) ?? null;
      if (current === null || current === type || chain.includes(current))
        break;
      chain.push(current);
    }
    return chain;
  }

  /** 継承元から引き継ぐField。遠い継承元のものを先に並べる。 */
  private inheritedFields(type: ObjectType): FieldDefinition[] {
    return this.ancestors(type)
      .reverse()
      .flatMap((ancestor) =>
        this.ownFields(ancestor).filter((f) => f.id !== CONTEXT_FIELD.id),
      );
  }

  /** Objectに並ぶField。自分のFieldの後ろに、引き継いだFieldが続く。 */
  private fieldsOf(type: ObjectType): FieldDefinition[] {
    return [...this.ownFields(type), ...this.inheritedFields(type)];
  }

  /** 文書木に並べるField行。Contextは参照チップの並びにする。 */
  private fieldContents(row: ObjectRow): ObjectFieldContent[] {
    const values = new Map(
      (
        this.database
          .prepare(
            "SELECT field_id, value FROM field_values WHERE object_id = ?",
          )
          .all(row.id) as { field_id: string; value: string }[]
      ).map((value) => [value.field_id, nodes(value.value)]),
    );
    return this.fieldsOf(row.type).map((field) => ({
      id: field.id,
      name: field.name,
      kind: field.kind,
      ...(field.options ? { options: field.options } : {}),
      value:
        field.kind === "context"
          ? this.contextsOf(row.id).flatMap((objectId): DocNode[] => [
              { type: "objectRef", attrs: { objectId } },
              { type: "text", text: " " },
            ])
          : (values.get(field.id) ?? []),
    }));
  }

  /** 文書木のField行を保存する。行が無いFieldには触れない。 */
  private saveFields(id: string, fields: readonly ObjectFieldContent[]): void {
    const row = this.requireRow(id);
    const known = new Map(this.fieldsOf(row.type).map((f) => [f.id, f]));
    for (const field of fields) {
      const kind = known.get(field.id)?.kind;
      if (kind === "context") {
        this.setContexts(id, []);
        // 存在しない相手や、循環になる相手は取り込まない。
        for (const target of new Set(refIds(field.value)))
          if (this.row(target) && !this.reaches(id, target))
            this.setContexts(id, [...this.contextsOf(id), target]);
      } else if (kind && field.value.length)
        this.database
          .prepare(
            `INSERT INTO field_values (object_id, field_id, value) VALUES (?, ?, ?)
             ON CONFLICT(object_id, field_id) DO UPDATE SET value = excluded.value`,
          )
          .run(id, field.id, JSON.stringify(field.value));
      else if (kind)
        this.database
          .prepare(
            "DELETE FROM field_values WHERE object_id = ? AND field_id = ?",
          )
          .run(id, field.id);
    }
  }

  /** targetがid自身か、すでにidの配下にあるか。 */
  private reaches(id: string, targetId: string): boolean {
    return Boolean(
      this.database
        .prepare(`${REACH} SELECT 1 FROM reach WHERE id = ?`)
        .get(id, targetId),
    );
  }

  private setContexts(id: string, contexts: readonly string[]): void {
    this.database.prepare("DELETE FROM contexts WHERE object_id = ?").run(id);
    const insert = this.database.prepare(
      "INSERT OR IGNORE INTO contexts (object_id, target_id, position) VALUES (?, ?, ?)",
    );
    contexts.forEach((target, position) => insert.run(id, target, position));
  }

  /** hostの本文から、配置と言及の索引を作り直す。 */
  private reindex(hostId: string, fallbackTime: number): void {
    const row = this.row(hostId);
    const body = this.hostBody(hostId);
    this.database
      .prepare("DELETE FROM placements WHERE host_id = ?")
      .run(hostId);
    this.database.prepare("DELETE FROM mentions WHERE host_id = ?").run(hostId);
    const place = this.database.prepare(
      "INSERT OR IGNORE INTO placements (host_id, object_id) VALUES (?, ?)",
    );
    for (const id of embeddedIds(body)) place.run(hostId, id);
    const mention = this.database.prepare(
      `INSERT OR IGNORE INTO mentions (host_id, unit_id, unit_kind, target_id, unit, time)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // TitleやMemo本文での言及は、Object全体をひとまとまりとして届ける。
    const whole = row
      ? [
          ...refIds(nodes(row.title)),
          ...(row.type === "memo" ? refIds(body) : []),
        ]
      : [];
    for (const target of whole)
      mention.run(hostId, hostId, "object", target, "", row!.created_at);
    // Fieldの値での言及は、どのFieldかを添えてObject全体として届ける。
    if (row)
      for (const value of this.database
        .prepare("SELECT field_id, value FROM field_values WHERE object_id = ?")
        .all(hostId) as { field_id: string; value: string }[])
        for (const target of refIds(nodes(value.value)))
          mention.run(
            hostId,
            `field:${value.field_id}`,
            "field",
            target,
            "",
            row.created_at,
          );
    if (row?.type === "memo") return;
    collectMentionUnits(body).forEach((unit, index) => {
      const id = unit.node.attrs?.id;
      mention.run(
        hostId,
        typeof id === "string" ? id : `#${index}`,
        unit.kind,
        unit.targetId,
        JSON.stringify(unit.node),
        timeFromId(id) ?? row?.created_at ?? fallbackTime,
      );
    });
  }

  private deleteObject(id: string): void {
    for (const sql of [
      "DELETE FROM objects WHERE id = ?",
      "DELETE FROM contexts WHERE object_id = ? OR target_id = ?",
      "DELETE FROM placements WHERE host_id = ?",
      "DELETE FROM mentions WHERE host_id = ?",
      "DELETE FROM field_values WHERE object_id = ?",
    ])
      this.database.prepare(sql).run(...(sql.includes("OR") ? [id, id] : [id]));
  }

  /* ---------- pages ---------- */

  /** hostの本文を、埋め込みObjectを展開した編集用の文書木として開く。 */
  loadPage(hostId: string): ObjectPage {
    const body = this.hostBody(hostId);
    const placed = this.placedIds(hostId);
    const contents: Record<string, ObjectContent> = {};
    const host = this.row(hostId);
    const hostFields = (host ? this.fieldContents(host) : []).map(fieldNode);
    const ids = new Set<string>([
      hostId,
      ...placed,
      ...refIds(body),
      ...refIds(hostFields),
    ]);
    for (const id of placed) {
      const row = this.row(id);
      if (!row) continue;
      const fields = this.fieldContents(row);
      contents[id] = {
        attrs: { type: row.type, done: row.done === 1 },
        title: nodes(row.title),
        fields,
        body: nodes(row.body),
      };
      for (const target of [
        ...refIds(contents[id].title),
        ...refIds(contents[id].body),
        ...refIds(fields.flatMap((field) => field.value)),
      ])
        ids.add(target);
    }
    const objects: Record<string, ObjectSummary> = {};
    const include = (id: string): ObjectSummary | undefined => {
      const row = objects[id] ? undefined : this.row(id);
      if (row) objects[id] = this.summary(row);
      return objects[id];
    };
    // 文書内のObject、参照先、それらのContext先まで含める。
    for (const id of ids)
      for (const context of include(id)?.contexts ?? []) include(context);
    const doc = joinDocument(
      { type: "doc", content: [...hostFields, ...body] },
      contents,
      new Set([hostId]),
    );
    // 埋め込んだObjectやField行まで含めた文書全体から版を作る。
    const revision = createHash("sha256")
      .update(JSON.stringify(doc))
      .digest("base64url");
    return { doc, objects, revision };
  }

  /**
   * 編集した文書木を保存する。Object単位へ分け、初めて現れたObjectは
   * 置かれた場所からContextを継承して作る。この文書から消え、他のどこにも
   * 置かれていないObjectは削除する。
   */
  savePage(
    hostId: string,
    doc: DocNode,
    now: number,
    baseRevision: string | null = null,
  ): ObjectPage {
    this.database.transaction(() => {
      if (
        baseRevision !== null &&
        this.loadPage(hostId).revision !== baseRevision
      )
        throw new ObjectStoreError(
          "PAGE_CONFLICT",
          `${PAGE_CONFLICT}: ${hostId} was changed elsewhere`,
        );
      const host = this.row(hostId);
      this.hostBody(hostId); // 存在しないhostならここで失敗させる
      const split = splitDocument(doc);
      const previous = this.placedIds(hostId);
      const saved = new Set<string>();
      const ensure = (id: string): void => {
        const content = split.objects[id];
        if (!content || saved.has(id)) return;
        saved.add(id);
        const parentId = split.parents[id] ?? (host ? hostId : null);
        // 親も今回初めて現れた場合に備え、親から先に作る。
        if (parentId !== null && parentId !== hostId) ensure(parentId);
        const isNew = !this.row(id);
        this.upsertObject(
          id,
          normalizeObjectType(content.attrs.type) ?? "task",
          content.title,
          content.body,
          Boolean(content.attrs.done),
          now,
        );
        // 文書木がContextの行を持つなら、後でその内容を正とする。
        const explicit = content.fields?.some(
          (field) => field.id === CONTEXT_FIELD.id,
        );
        if (isNew && parentId !== null && !explicit) {
          const parent = this.row(parentId);
          this.setContexts(
            id,
            inheritedContexts(parent && this.summary(parent)),
          );
        }
      };
      for (const id of Object.keys(split.objects)) ensure(id);
      // 参照先が同じ保存で作られることがあるので、Fieldは全件を作ってから保存する。
      for (const id of saved)
        this.saveFields(id, split.objects[id]?.fields ?? []);
      if (host) this.saveFields(hostId, split.hostFields);

      const body = JSON.stringify(split.host.content ?? []);
      if (host)
        this.database
          .prepare("UPDATE objects SET body = ?, updated_at = ? WHERE id = ?")
          .run(body, now, hostId);
      else
        this.database
          .prepare(
            `INSERT INTO documents (id, body, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
          )
          .run(hostId, body, now);
      this.reindex(hostId, now);
      for (const id of saved) this.reindex(id, now);

      const removed = previous.filter((id) => !saved.has(id));
      const placedElsewhere = this.database.prepare(
        `SELECT 1 FROM placements WHERE object_id = ?
         AND host_id NOT IN (SELECT value FROM json_each(?))`,
      );
      const removedJson = JSON.stringify(removed);
      for (const id of removed)
        if (!placedElsewhere.get(id, removedJson)) this.deleteObject(id);
    })();
    return this.loadPage(hostId);
  }

  /* ---------- objects ---------- */

  getObject(id: string): ObjectSummary {
    return this.summary(this.requireRow(id));
  }

  /** 文書に置かないObjectを作る。parentIdは入力位置を包むObject。 */
  createObject(
    input: {
      readonly id: string;
      readonly type: ObjectType;
      readonly title: string;
      readonly parentId: string | null;
    },
    now: number,
  ): ObjectSummary {
    this.database.transaction(() => {
      if (this.row(input.id)) throw new TypeError("Object already exists");
      const parent =
        input.parentId === null ? undefined : this.row(input.parentId);
      this.upsertObject(
        input.id,
        input.type,
        input.title ? [{ type: "text", text: input.title }] : [],
        [],
        false,
        now,
      );
      this.setContexts(
        input.id,
        inheritedContexts(parent && this.summary(parent)),
      );
    })();
    return this.getObject(input.id);
  }

  patchObject(id: string, patch: ObjectPatch, now: number): ObjectSummary {
    this.database.transaction(() => {
      const row = this.requireRow(id);
      this.upsertObject(
        id,
        row.type,
        patch.title === undefined
          ? nodes(row.title)
          : patch.title
            ? [{ type: "text", text: patch.title }]
            : [],
        nodes(row.body),
        patch.done ?? row.done === 1,
        now,
      );
      this.saveFields(
        id,
        Object.entries(patch.fields ?? {}).map(([fieldId, value]) => ({
          id: fieldId,
          name: "",
          value,
        })),
      );
      this.reindex(id, now);
    })();
    return this.getObject(id);
  }

  addContext(id: string, targetId: string): ObjectSummary {
    this.database.transaction(() => {
      this.requireRow(id);
      this.requireRow(targetId);
      // targetがすでにidの配下なら、循環になるので受け付けない。
      if (this.reaches(id, targetId))
        throw new ObjectStoreError(
          "INVALID_CONTEXT",
          "Context would create a cycle",
        );
      this.setContexts(id, [...new Set([...this.contextsOf(id), targetId])]);
    })();
    return this.getObject(id);
  }

  removeContext(id: string, targetId: string): ObjectSummary {
    this.requireRow(id);
    this.database
      .prepare("DELETE FROM contexts WHERE object_id = ? AND target_id = ?")
      .run(id, targetId);
    return this.getObject(id);
  }

  /** 参照候補。問い合わせが空のときは、Memoを除いた新しい順。 */
  search(query: string, excludeId: string | null, limit = 6): ObjectSummary[] {
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = this.database
      .prepare(
        `SELECT * FROM objects
         WHERE title_text LIKE ? ESCAPE '\\' AND id IS NOT ?
           AND (type != 'memo' OR ? != '')
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(pattern, excludeId, query, limit) as ObjectRow[];
    return rows.map((row) => this.summary(row));
  }

  /**
   * Viewの条件でObjectを集める。anchorIdは開いているObjectで、
   * todayは日付の条件に使う画面側の今日（YYYY-MM-DD）。
   */
  queryView(
    viewId: string,
    anchorId: string | null,
    today: string,
  ): ViewResult {
    const stored = this.database
      .prepare("SELECT owner, config FROM views WHERE id = ?")
      .get(viewId) as { owner: string; config: string } | undefined;
    if (!stored)
      throw new ObjectStoreError(
        "OBJECT_NOT_FOUND",
        `View not found: ${viewId}`,
      );
    const view = parseView(JSON.parse(stored.config));
    const type = view.scope === "type" ? stored.owner : view.type;
    const anchor =
      view.scope === "object" ? this.requireRow(anchorId ?? "").id : null;
    const kinds = new Map(
      type === null ? [] : this.fieldsOf(type).map((f) => [f.id, f.kind]),
    );
    const week = new Date(Date.parse(today) + 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    type Item = { row: ObjectRow; values: Record<string, readonly DocNode[]> };
    const item = (row: ObjectRow): Item => ({
      row,
      values: Object.fromEntries(
        (
          this.database
            .prepare(
              "SELECT field_id, value FROM field_values WHERE object_id = ?",
            )
            .all(row.id) as { field_id: string; value: string }[]
        ).map((value) => [value.field_id, nodes(value.value)]),
      ),
    });
    // shortcut: 条件はSQLでなくここで見る。件数が増えて遅くなったらSQLへ移す。
    const matches = ({ row, values }: Item): boolean =>
      (type === null || row.type === type) &&
      (view.done === "all" || (row.done === 1) === (view.done === "done")) &&
      view.filters.every((filter) => {
        const kind = kinds.get(filter.fieldId);
        const text = this.text(values[filter.fieldId] ?? []);
        // 種別から外したFieldの条件は無視する。
        if (kind === undefined) return true;
        if (kind !== "date") return text === filter.value;
        return filter.value === "today"
          ? text === today
          : filter.value === "week"
            ? text >= today && text <= week
            : text !== "" && text < today;
      });

    if (view.layout === "timeline") {
      const narrowed =
        type !== null || view.done !== "all" || view.filters.length > 0;
      const entries: ObjectTimelineEntry[] =
        anchor === null
          ? (
              this.database
                .prepare("SELECT * FROM objects WHERE type = ?")
                .all(type) as ObjectRow[]
            ).map((row) => ({
              kind: "object",
              object: this.summary(row),
              mentioned: false,
              via: [],
              time: row.created_at,
            }))
          : this.timeline(anchor).filter(
              (entry) => view.reach === "all" || entry.via.length === 0,
            );
      return {
        rows: [],
        // 条件で絞ったTimelineには、Objectでない言及を出さない。
        entries: entries
          .filter((entry) =>
            entry.kind === "object"
              ? matches(item(this.requireRow(entry.object.id)))
              : !narrowed,
          )
          .sort((a, b) => b.time - a.time),
        objects: {},
      };
    }

    const direct = (id: string): ObjectRow[] =>
      this.database
        .prepare(
          `SELECT o.* FROM objects o JOIN contexts c ON c.object_id = o.id
           WHERE c.target_id = ?`,
        )
        .all(id) as ObjectRow[];
    const key = ({ row, values }: Item): string | number =>
      view.sort === "created"
        ? row.created_at
        : view.sort === "updated"
          ? row.updated_at
          : view.sort === "title"
            ? this.text(nodes(row.title))
            : this.text(values[view.sort] ?? []);
    const shown = (rows: readonly ObjectRow[]): Item[] =>
      rows
        .map(item)
        .filter(matches)
        .sort((a, b) => {
          const [x, y] = [key(a), key(b)];
          const order =
            typeof x === "number"
              ? x - (y as number)
              : x.localeCompare(y as string, "ja");
          return view.desc ? -order : order;
        });
    const pool =
      anchor === null
        ? (
            this.database
              .prepare("SELECT * FROM objects WHERE type = ?")
              .all(type) as ObjectRow[]
          ).filter(
            // 階層では、同じ種別のObjectの配下にあるものを、その下に出す。
            (row) =>
              !view.nested ||
              !this.contextsOf(row.id).some(
                (id) => this.row(id)?.type === type,
              ),
          )
        : view.nested || view.reach === "direct"
          ? direct(anchor)
          : (this.database
              .prepare(
                `${REACH} SELECT o.* FROM objects o JOIN reach USING (id) WHERE o.id != ?`,
              )
              .all(anchor, anchor) as ObjectRow[]);
    const rows: ViewRow[] = [];
    const seen = new Set<string>();
    const push = (items: readonly Item[], depth: number): void => {
      for (const { row, values } of items) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push({ object: this.summary(row), values, depth });
        // 条件から外れたObjectの配下は辿らない。
        if (view.nested) push(shown(direct(row.id)), depth + 1);
      }
    };
    push(shown(pool), 0);
    const objects: Record<string, ObjectSummary> = {};
    for (const row of rows)
      for (const id of [
        ...row.object.contexts,
        ...Object.values(row.values).flatMap((value) => refIds(value)),
      ]) {
        const target = objects[id] ? undefined : this.row(id);
        if (target) objects[id] = this.summary(target);
      }
    return { rows, entries: [], objects };
  }

  /* ---------- types ---------- */

  /** 種別の定義。組み込みの種別を先に、ユーザーが作った種別を作成順に並べる。 */
  types(): TypeDefinition[] {
    const rows = this.database
      .prepare(
        "SELECT name, color, checkbox, extends FROM types ORDER BY created_at, name",
      )
      .all() as {
      name: string;
      color: string | null;
      checkbox: number;
      extends: string | null;
    }[];
    const builtins: readonly string[] = OBJECT_TYPES;
    const order = (name: string): number =>
      builtins.includes(name) ? builtins.indexOf(name) : builtins.length;
    return rows
      .sort((a, b) => order(a.name) - order(b.name))
      .map((row) => ({
        name: row.name,
        color: row.color,
        builtin: builtins.includes(row.name),
        checkbox: row.checkbox === 1,
        fields: this.ownFields(row.name),
        extends: row.extends,
        inherited: this.inheritedFields(row.name),
        views: this.viewsOf(row.name),
      }));
  }

  /** 種別の名前・色・Fieldを変える。外したFieldの値は消す。 */
  updateType(
    name: ObjectType,
    patch: {
      readonly name?: string;
      readonly color?: string | null;
      readonly checkbox?: boolean;
      readonly extends?: string | null;
      readonly fields?: readonly FieldDefinition[];
      readonly views?: readonly ViewDefinition[];
    },
  ): TypeDefinition {
    let current = name;
    this.database.transaction(() => {
      const builtins: readonly string[] = OBJECT_TYPES;
      if (
        !this.database.prepare("SELECT 1 FROM types WHERE name = ?").get(name)
      )
        throw new ObjectStoreError(
          "OBJECT_NOT_FOUND",
          `Type not found: ${name}`,
        );
      if (patch.color !== undefined) {
        if (patch.color !== null && !TYPE_COLORS.some((c) => c === patch.color))
          throw new TypeError("color is not a known type color");
        this.database
          .prepare("UPDATE types SET color = ? WHERE name = ?")
          .run(patch.color, name);
      }
      if (patch.checkbox !== undefined)
        this.database
          .prepare("UPDATE types SET checkbox = ? WHERE name = ?")
          .run(patch.checkbox ? 1 : 0, name);
      if (patch.extends !== undefined) {
        const exists =
          patch.extends === null ||
          this.database
            .prepare("SELECT 1 FROM types WHERE name = ?")
            .get(patch.extends);
        // 自分自身や、自分を継承している種別は継承元にできない。
        if (
          !exists ||
          patch.extends === name ||
          (patch.extends !== null &&
            this.ancestors(patch.extends).includes(name))
        )
          throw new TypeError("type cannot extend that type");
        this.database
          .prepare("UPDATE types SET extends = ? WHERE name = ?")
          .run(patch.extends, name);
      }
      if (patch.fields) {
        const rest = patch.fields.filter((f) => f.id !== CONTEXT_FIELD.id);
        const fields = patch.fields.some((f) => f.id === CONTEXT_FIELD.id)
          ? patch.fields.map((f) =>
              f.id === CONTEXT_FIELD.id ? CONTEXT_FIELD : f,
            )
          : [CONTEXT_FIELD, ...rest];
        for (const field of rest)
          if (
            !field.id ||
            !field.name.trim() ||
            field.name.length > 40 ||
            field.kind === "context" ||
            !FIELD_KINDS.includes(field.kind)
          )
            throw new TypeError("field is invalid");
        if (new Set(fields.map((f) => f.id)).size !== fields.length)
          throw new TypeError("field ids must be unique");
        const kept = JSON.stringify(fields.map((f) => f.id));
        this.database
          .prepare(
            `DELETE FROM field_values
             WHERE field_id IN (SELECT id FROM fields WHERE type = ?)
               AND field_id NOT IN (SELECT value FROM json_each(?))`,
          )
          .run(name, kept);
        this.database
          .prepare(
            `DELETE FROM mentions
             WHERE unit_kind = 'field'
               AND substr(unit_id, 7) IN (SELECT id FROM fields WHERE type = ?)
               AND substr(unit_id, 7) NOT IN (SELECT value FROM json_each(?))`,
          )
          .run(name, kept);
        this.database.prepare("DELETE FROM fields WHERE type = ?").run(name);
        const insert = this.database.prepare(
          "INSERT INTO fields (type, id, name, kind, position, options) VALUES (?, ?, ?, ?, ?, ?)",
        );
        fields.forEach((field, position) =>
          insert.run(
            name,
            field.id,
            field.name.trim(),
            field.kind,
            position,
            field.kind === "select" && field.options?.length
              ? JSON.stringify(field.options)
              : null,
          ),
        );
      }
      if (patch.views) this.setViews(name, patch.views.map(parseView));
      if (patch.name !== undefined && patch.name !== name) {
        const next = normalizeObjectType(patch.name);
        if (
          !next ||
          builtins.includes(name) ||
          this.database.prepare("SELECT 1 FROM types WHERE name = ?").get(next)
        )
          throw new TypeError("type cannot be renamed to that name");
        for (const sql of [
          "UPDATE types SET name = ? WHERE name = ?",
          "UPDATE fields SET type = ? WHERE type = ?",
          "UPDATE types SET extends = ? WHERE extends = ?",
          "UPDATE objects SET type = ? WHERE type = ?",
          "UPDATE views SET owner = ? WHERE owner = ?",
        ])
          this.database.prepare(sql).run(next, name);
        // ほかの種別のViewが、この種別で絞っていれば付け替える。
        this.database
          .prepare(
            `UPDATE views SET config = json_set(config, '$.type', ?)
             WHERE json_extract(config, '$.type') = ?`,
          )
          .run(next, name);
        current = next;
      }
    })();
    return this.types().find((type) => type.name === current)!;
  }

  /** 画面の入口に出すObjectと、指定期間に作成したObjectとMemo。 */
  overview(from: number, to = Number.MAX_SAFE_INTEGER): ObjectOverview {
    const select = (where: string, ...params: unknown[]): ObjectSummary[] =>
      (
        this.database
          .prepare(`SELECT * FROM objects WHERE ${where}`)
          .all(...params) as ObjectRow[]
      ).map((row) => this.summary(row));
    const recent = select(
      "created_at >= ? AND created_at < ? ORDER BY created_at DESC",
      from,
      to,
    );
    const memoIds = new Set(
      recent.filter((o) => o.type === "memo").map((o) => o.id),
    );
    const hostOf = this.database
      .prepare("SELECT host_id FROM placements WHERE object_id = ? LIMIT 1")
      .pluck();
    const memos: DayMemo[] = [];
    for (const object of [...recent].reverse()) {
      if (!memoIds.has(object.id)) continue;
      // 埋め込みを外側へ遡る。同じ日のMemoに入っていれば、そちらで読める。
      let hostId: string | null = null;
      let nested = false;
      const seen = new Set([object.id]);
      for (
        let id = hostOf.get(object.id) as string | undefined;
        id !== undefined && !seen.has(id);
        id = hostOf.get(id) as string | undefined
      ) {
        if (memoIds.has(id)) nested = true;
        seen.add(id);
        hostId = id;
      }
      if (nested) continue;
      const host = hostId === null ? undefined : this.row(hostId);
      memos.push({
        object,
        hostId,
        hostTitle: host ? this.summary(host).title : hostId ? "Daily" : "",
      });
    }
    return {
      navigation: select("type IN ('area', 'project') ORDER BY created_at"),
      recent,
      memos,
    };
  }

  /**
   * targetのTimeline。Contextで属するObjectと、@で言及している最小の構造を
   * 新しい順に並べる。配下のObjectに届くものも、経路付きで含める。
   */
  timeline(targetId: string): ObjectTimelineEntry[] {
    this.requireRow(targetId);
    /** idからtargetへContextを辿る最短経路の中間Object。 */
    const pathFrom = (id: string): string[] => {
      const queue: string[][] = [[id]];
      const seen = new Set([id]);
      while (queue.length) {
        const path = queue.shift()!;
        for (const next of this.contextsOf(path.at(-1)!)) {
          if (next === targetId) return path.slice(1);
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push([...path, next]);
        }
      }
      return [];
    };
    const titles = (ids: readonly string[]): string[] =>
      ids.map((id) => this.getObject(id).title);

    const entries: ObjectTimelineEntry[] = (
      this.database
        .prepare(
          `${REACH} SELECT o.* FROM objects o JOIN reach USING (id) WHERE o.id != ?`,
        )
        .all(targetId, targetId) as ObjectRow[]
    ).map((row) => ({
      kind: "object",
      object: this.summary(row),
      mentioned: false,
      via: titles(pathFrom(row.id)),
      time: row.created_at,
    }));

    const mentions = this.database
      .prepare(
        `${REACH} SELECT m.* FROM mentions m
         WHERE m.target_id IN (SELECT id FROM reach)
           AND m.host_id NOT IN (SELECT id FROM reach)`,
      )
      .all(targetId) as MentionRow[];
    const seen = new Set<string>();
    for (const row of mentions) {
      const key = `${row.host_id}\n${row.unit_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const via = titles(
        row.target_id === targetId
          ? []
          : [row.target_id, ...pathFrom(row.target_id)],
      );
      const host = this.row(row.host_id);
      if (row.unit_kind === "object" || row.unit_kind === "field") {
        const field =
          row.unit_kind === "field"
            ? (this.database
                .prepare("SELECT name FROM fields WHERE id = ?")
                .pluck()
                .get(row.unit_id.slice("field:".length)) as string | undefined)
            : undefined;
        if (host)
          entries.push({
            kind: "object",
            object: this.summary(host),
            mentioned: true,
            ...(field ? { field } : {}),
            via,
            time: row.time,
          });
        continue;
      }
      entries.push({
        kind: "unit",
        hostId: row.host_id,
        hostTitle: host ? this.summary(host).title : "Daily",
        unitId: row.unit_id,
        unitKind: row.unit_kind,
        text: this.text([JSON.parse(row.unit) as DocNode]),
        via,
        time: row.time,
      });
    }
    return entries.sort((a, b) => b.time - a.time);
  }

  /** 内容をすべて置き換える。試作データの投入と、将来のImportに使う。 */
  importWorkspace(workspace: ObjectWorkspace, now: number): void {
    this.database.transaction(() => {
      for (const table of [
        "objects",
        "documents",
        "contexts",
        "placements",
        "mentions",
        "field_values",
        "fields",
        "types",
        "views",
      ])
        this.database.exec(`DELETE FROM ${table}`);
      for (const type of OBJECT_TYPES) this.ensureType(type, 0);
      for (const object of workspace.objects) {
        this.upsertObject(
          object.id,
          object.type,
          object.title,
          object.body,
          object.done,
          object.createdAt,
        );
        this.setContexts(object.id, object.contexts);
      }
      const insert = this.database.prepare(
        "INSERT INTO documents (id, body, updated_at) VALUES (?, ?, ?)",
      );
      for (const [id, body] of Object.entries(workspace.documents)) {
        if (!DOCUMENT_ID.test(id))
          throw new TypeError(`Invalid document: ${id}`);
        insert.run(id, JSON.stringify(body), now);
      }
      // Titleの検索用文字列は参照先に依存するので、全件そろってから作り直す。
      for (const object of workspace.objects) {
        this.database
          .prepare("UPDATE objects SET title_text = ? WHERE id = ?")
          .run(this.text(object.title), object.id);
        this.reindex(object.id, now);
      }
      for (const id of Object.keys(workspace.documents)) this.reindex(id, now);
    })();
  }
}
