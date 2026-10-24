import type {
  PkmDraft as DraftRecord,
  PkmSyncthingConflictDraft as SyncthingConflictDraftRecord,
} from "@pkm/contracts";
export type {
  PkmDraft as DraftRecord,
  PkmSyncthingConflictDraft as SyncthingConflictDraftRecord,
} from "@pkm/contracts";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import Database from "better-sqlite3";

import type { FileHash } from "./vault-file.js";

export const LOCAL_STATE_SCHEMA_VERSION = 2;

interface DraftRow {
  readonly entity_id: string;
  readonly file_path: string;
  readonly base_hash: FileHash | null;
  readonly content: string;
  readonly updated_at: string;
}

interface SyncthingConflictDraftRow {
  readonly conflict_path: string;
  readonly canonical_hash: FileHash | null;
  readonly conflict_hash: FileHash;
  readonly content: string;
  readonly updated_at: string;
}

const fromDraftRow = (row: DraftRow): DraftRecord => ({
  entityId: row.entity_id,
  filePath: row.file_path,
  baseHash: row.base_hash,
  content: row.content,
  updatedAt: row.updated_at,
});

const fromSyncthingConflictDraftRow = (
  row: SyncthingConflictDraftRow,
): SyncthingConflictDraftRecord => ({
  conflictPath: row.conflict_path,
  canonicalHash: row.canonical_hash,
  conflictHash: row.conflict_hash,
  content: row.content,
  updatedAt: row.updated_at,
});

export class LocalStateDatabase {
  readonly database: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path);
    this.database.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    const version = this.database.pragma("user_version", {
      simple: true,
    }) as number;
    if (version > LOCAL_STATE_SCHEMA_VERSION) {
      this.database.close();
      throw new Error(
        `local-state.sqlite schema v${version} is newer than supported v${LOCAL_STATE_SCHEMA_VERSION}`,
      );
    }
    if (version < 1) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE drafts (
            entity_id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            base_hash TEXT,
            content TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        this.database.pragma("user_version = 1");
      })();
    }
    if (version < 2) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE conflict_drafts (
            conflict_path TEXT PRIMARY KEY,
            canonical_hash TEXT,
            conflict_hash TEXT NOT NULL,
            content TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
        this.database.pragma("user_version = 2");
      })();
    }
  }

  saveDraft(draft: DraftRecord): void {
    this.database
      .prepare(
        `INSERT INTO drafts (entity_id, file_path, base_hash, content, updated_at)
         VALUES (@entityId, @filePath, @baseHash, @content, @updatedAt)
         ON CONFLICT(entity_id) DO UPDATE SET
           file_path = excluded.file_path,
           base_hash = excluded.base_hash,
           content = excluded.content,
           updated_at = excluded.updated_at`,
      )
      .run(draft);
  }

  getDraft(entityId: string): DraftRecord | null {
    const row = this.database
      .prepare("SELECT * FROM drafts WHERE entity_id = ?")
      .get(entityId) as DraftRow | undefined;
    return row === undefined ? null : fromDraftRow(row);
  }

  listDrafts(): readonly DraftRecord[] {
    return (
      this.database
        .prepare("SELECT * FROM drafts ORDER BY updated_at DESC, entity_id")
        .all() as DraftRow[]
    ).map(fromDraftRow);
  }

  deleteDraft(entityId: string): void {
    this.database
      .prepare("DELETE FROM drafts WHERE entity_id = ?")
      .run(entityId);
  }

  saveSyncthingConflictDraft(draft: SyncthingConflictDraftRecord): void {
    this.database
      .prepare(
        `INSERT INTO conflict_drafts (
           conflict_path, canonical_hash, conflict_hash, content, updated_at
         ) VALUES (
           @conflictPath, @canonicalHash, @conflictHash, @content, @updatedAt
         )
         ON CONFLICT(conflict_path) DO UPDATE SET
           canonical_hash = excluded.canonical_hash,
           conflict_hash = excluded.conflict_hash,
           content = excluded.content,
           updated_at = excluded.updated_at`,
      )
      .run(draft);
  }

  getSyncthingConflictDraft(
    conflictPath: string,
  ): SyncthingConflictDraftRecord | null {
    const row = this.database
      .prepare("SELECT * FROM conflict_drafts WHERE conflict_path = ?")
      .get(conflictPath) as SyncthingConflictDraftRow | undefined;
    return row === undefined ? null : fromSyncthingConflictDraftRow(row);
  }

  deleteSyncthingConflictDraft(conflictPath: string): void {
    this.database
      .prepare("DELETE FROM conflict_drafts WHERE conflict_path = ?")
      .run(conflictPath);
  }

  close(): void {
    this.database.close();
  }
}

export const openVaultLocalState = (vaultRoot: string): LocalStateDatabase =>
  new LocalStateDatabase(join(vaultRoot, ".pkm", "local-state.sqlite"));
