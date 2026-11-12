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
  normalizeObjectType,
  OBJECT_TYPES,
  refIds,
  splitDocument,
  timeFromId,
  TYPE_COLORS,
  type DocNode,
  type FieldDefinition,
  type ObjectContent,
  type ObjectFieldContent,
  type ObjectPage,
  type ObjectRecord,
  type ObjectSummary,
  type ObjectTimelineEntry,
  type ObjectType,
  type TypeDefinition,
} from "@pkm/core";

export const OBJECT_STORE_SCHEMA_VERSION = 3;

/** Objectに属さない文書のID。いまはDailyだけがこれに当たる。 */
const DOCUMENT_ID = /^daily:\d{4}-\d{2}-\d{2}$/;

export class ObjectStoreError extends Error {
  override readonly name = "ObjectStoreError";
  constructor(
    readonly code: "OBJECT_NOT_FOUND" | "INVALID_CONTEXT",
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
}

interface MentionRow {
  readonly host_id: string;
  readonly unit_id: string;
  readonly unit_kind: "object" | "listItem" | "section" | "block";
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
    this.database
      .prepare(
        "INSERT OR IGNORE INTO types (name, checkbox, created_at) VALUES (?, ?, ?)",
      )
      .run(name, name === "task" ? 1 : 0, now);
  }

  /** 種別のField。Contextは保存が無くても先頭に持つ。 */
  private fieldsOf(type: ObjectType): FieldDefinition[] {
    const fields = this.database
      .prepare(
        "SELECT id, name, kind FROM fields WHERE type = ? ORDER BY position",
      )
      .all(type) as FieldDefinition[];
    return fields.some((field) => field.id === CONTEXT_FIELD.id)
      ? fields
      : [CONTEXT_FIELD, ...fields];
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
    return {
      doc: joinDocument(
        { type: "doc", content: [...hostFields, ...body] },
        contents,
        new Set([hostId]),
      ),
      objects,
    };
  }

  /**
   * 編集した文書木を保存する。Object単位へ分け、初めて現れたObjectは
   * 置かれた場所からContextを継承して作る。この文書から消え、他のどこにも
   * 置かれていないObjectは削除する。
   */
  savePage(hostId: string, doc: DocNode, now: number): ObjectPage {
    this.database.transaction(() => {
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

  patchObject(
    id: string,
    patch: { readonly title?: string; readonly done?: boolean },
    now: number,
  ): ObjectSummary {
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

  /** 種別のObjectを新しい順に返す。 */
  objectsOfType(type: ObjectType): ObjectSummary[] {
    return (
      this.database
        .prepare(
          "SELECT * FROM objects WHERE type = ? ORDER BY created_at DESC",
        )
        .all(type) as ObjectRow[]
    ).map((row) => this.summary(row));
  }

  /* ---------- types ---------- */

  /** 種別の定義。組み込みの種別を先に、ユーザーが作った種別を作成順に並べる。 */
  types(): TypeDefinition[] {
    const rows = this.database
      .prepare(
        "SELECT name, color, checkbox FROM types ORDER BY created_at, name",
      )
      .all() as { name: string; color: string | null; checkbox: number }[];
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
        fields: this.fieldsOf(row.name),
      }));
  }

  /** 種別の名前・色・Fieldを変える。外したFieldの値は消す。 */
  updateType(
    name: ObjectType,
    patch: {
      readonly name?: string;
      readonly color?: string | null;
      readonly checkbox?: boolean;
      readonly fields?: readonly FieldDefinition[];
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
        this.database.prepare("DELETE FROM fields WHERE type = ?").run(name);
        const insert = this.database.prepare(
          "INSERT INTO fields (type, id, name, kind, position) VALUES (?, ?, ?, ?, ?)",
        );
        fields.forEach((field, position) =>
          insert.run(name, field.id, field.name.trim(), field.kind, position),
        );
      }
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
          "UPDATE objects SET type = ? WHERE type = ?",
        ])
          this.database.prepare(sql).run(next, name);
        current = next;
      }
    })();
    return this.types().find((type) => type.name === current)!;
  }

  /** 画面の入口に出すObjectと、since以降に作成したObject。 */
  overview(since: number): {
    readonly navigation: ObjectSummary[];
    readonly recent: ObjectSummary[];
  } {
    const select = (where: string, ...params: unknown[]): ObjectSummary[] =>
      (
        this.database
          .prepare(`SELECT * FROM objects WHERE ${where}`)
          .all(...params) as ObjectRow[]
      ).map((row) => this.summary(row));
    return {
      navigation: select("type IN ('area', 'project') ORDER BY created_at"),
      recent: select("created_at >= ? ORDER BY created_at DESC", since),
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
      if (row.unit_kind === "object") {
        if (host)
          entries.push({
            kind: "object",
            object: this.summary(host),
            mentioned: true,
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
