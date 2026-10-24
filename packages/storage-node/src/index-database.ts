import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { createSearchSchema, createNameSearchSchema } from "./search.js";

export const INDEX_SCHEMA_VERSION = 16;

// This database contains only derived data. Schema changes reset its projections;
// the next synchronization repopulates them from Markdown, without a migration chain.
export class IndexDatabase {
  readonly database: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path);
    try {
      this.database.pragma("journal_mode = WAL");
      this.initialize();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  private initialize(): void {
    const version = this.database.pragma("user_version", {
      simple: true,
    }) as number;
    if (version > INDEX_SCHEMA_VERSION) {
      throw new Error(
        `index.sqlite schema v${version} is newer than supported v${INDEX_SCHEMA_VERSION}`,
      );
    }
    if (version === INDEX_SCHEMA_VERSION) return;
    this.database.transaction(() => {
      // SQLite reports FTS shadow tables separately; dropping the virtual table
      // removes its shadow tables as well. Never touch local-state.sqlite here.
      const tables = this.database
        .prepare(
          "SELECT name FROM pragma_table_list WHERE schema = 'main' AND type IN ('table', 'virtual') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC",
        )
        .all() as { readonly name: string }[];
      for (const { name } of tables) {
        this.database.exec(`DROP TABLE "${name.replaceAll('"', '""')}"`);
      }
      this.database.exec(`
          CREATE TABLE files (
            path TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            hash TEXT NOT NULL,
            mtime_ms REAL NOT NULL,
            ctime_ms REAL NOT NULL,
            device INTEGER NOT NULL,
            inode INTEGER NOT NULL,
            size INTEGER NOT NULL,
            entity_id TEXT,
            canonical_entity_path TEXT
          );

          CREATE TABLE entities (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            display_name TEXT,
            description TEXT,
            authors TEXT NOT NULL DEFAULT '[]',
            related_entity_ids TEXT NOT NULL DEFAULT '[]',
            name_key TEXT,
            origin TEXT,
            status TEXT,
            priority TEXT,
            project_id TEXT,
            area_id TEXT,
            task_id TEXT,
            resource_id TEXT,
            resource_type TEXT,
            canonical_identifier TEXT,
            source_uri TEXT,
            asset_path TEXT,
            journal_date TEXT,
            occurred_at TEXT,
            due_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            exclude_from_ai INTEGER NOT NULL,
            body TEXT NOT NULL
          );

          CREATE TABLE entity_topics (
            entity_id TEXT NOT NULL,
            topic_id TEXT NOT NULL,
            PRIMARY KEY (entity_id, topic_id)
          );

          CREATE TABLE entity_references (
            reference_id INTEGER PRIMARY KEY,
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            target_type TEXT,
            reference_kind TEXT NOT NULL,
            label TEXT,
            field_path TEXT,
            start_offset INTEGER,
            end_offset INTEGER
          );

          CREATE INDEX entity_references_target_idx
            ON entity_references(target_id, source_id, reference_kind);

          CREATE TABLE validation_issues (
            issue_id INTEGER PRIMARY KEY,
            file_path TEXT NOT NULL,
            entity_id TEXT,
            target_id TEXT,
            code TEXT NOT NULL,
            severity TEXT NOT NULL,
            message TEXT NOT NULL,
            field_path TEXT,
            start_offset INTEGER,
            end_offset INTEGER
          );

          CREATE INDEX validation_issues_file_idx
            ON validation_issues(file_path, severity);

          CREATE TABLE conflicts (
            path TEXT PRIMARY KEY,
            canonical_entity_path TEXT NOT NULL,
            hash TEXT NOT NULL,
            mtime_ms REAL NOT NULL,
            size INTEGER NOT NULL
          );
          CREATE TABLE entity_scopes (
            entity_id TEXT NOT NULL,
            scope_type TEXT NOT NULL CHECK (
              scope_type IN ('area', 'project', 'task', 'resource')
            ),
            scope_id TEXT NOT NULL,
            relation TEXT NOT NULL CHECK (
              relation IN ('direct', 'inherited')
            ),
            via_entity_id TEXT,
            PRIMARY KEY (entity_id, scope_type, scope_id)
          );

          CREATE INDEX entity_scopes_scope_idx
            ON entity_scopes(scope_type, scope_id, entity_id);

          CREATE INDEX entity_scopes_entity_idx
            ON entity_scopes(entity_id, scope_type);

          CREATE TABLE entry_todos (
            entity_id TEXT NOT NULL,
            marker_from INTEGER NOT NULL,
            marker_to INTEGER NOT NULL,
            text TEXT NOT NULL,
            checked INTEGER NOT NULL CHECK (checked IN (0, 1)),
            depth INTEGER NOT NULL,
            source_hash TEXT NOT NULL,
            PRIMARY KEY (entity_id, marker_from)
          );
          CREATE INDEX entry_todos_checked_idx ON entry_todos(checked, entity_id, marker_from);
          CREATE INDEX entity_references_source_idx ON entity_references(source_id);
          CREATE INDEX files_entity_idx ON files(entity_id);
          CREATE INDEX entity_topics_topic_idx ON entity_topics(topic_id, entity_id);
          CREATE INDEX entities_global_name_key_idx ON entities(name_key) WHERE deleted_at IS NULL;
          CREATE INDEX entities_name_key_idx ON entities(type, name_key) WHERE deleted_at IS NULL;
          CREATE INDEX entities_collection_idx ON entities(type, COALESCE(display_name, '') COLLATE NOCASE, id) WHERE deleted_at IS NULL;
          CREATE INDEX entities_created_idx ON entities(type, created_at DESC, id DESC) WHERE deleted_at IS NULL;
          CREATE INDEX entities_updated_idx ON entities(updated_at DESC, id DESC) WHERE deleted_at IS NULL;
          CREATE INDEX entities_deleted_idx ON entities(deleted_at DESC, id DESC) WHERE deleted_at IS NOT NULL;
          CREATE INDEX entities_global_name_idx ON entities(COALESCE(display_name, '') COLLATE NOCASE,id) WHERE deleted_at IS NULL;
          CREATE INDEX entities_global_created_idx ON entities(created_at DESC,id DESC) WHERE deleted_at IS NULL;
          CREATE INDEX entities_due_sort_idx ON entities(type,COALESCE(due_at,''),id) WHERE type='task' AND deleted_at IS NULL;
          CREATE INDEX entities_due_idx ON entities(due_at, id) WHERE type = 'task' AND deleted_at IS NULL;
          CREATE INDEX entities_project_idx ON entities(project_id);
          CREATE INDEX entities_task_idx ON entities(task_id);
          CREATE INDEX entities_journal_date_idx
            ON entities(journal_date, created_at DESC, id)
            WHERE type = 'entry' AND deleted_at IS NULL;
      `);
      createSearchSchema(this.database);
      createNameSearchSchema(this.database);
      this.database.pragma(`user_version = ${INDEX_SCHEMA_VERSION}`);
    })();
  }

  close(): void {
    this.database.close();
  }
}

export const openVaultIndex = (vaultRoot: string): IndexDatabase =>
  new IndexDatabase(join(vaultRoot, ".pkm", "index.sqlite"));
