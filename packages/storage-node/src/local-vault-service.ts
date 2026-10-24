import type { PkmMetadataPatch, PkmFileHash, TopicId } from "@pkm/contracts";
import { randomUUID } from "node:crypto";
import { queryIndexedBacklinkPage } from "./index-query.js";
import type { BacklinkPageQuery } from "@pkm/contracts";
import type { EntityPageQuery } from "@pkm/contracts";
import {
  queryIndexedEntityPage,
  queryEntityLabels,
  countIndexedEntities,
  countIndexedCalendarDays,
} from "./index-query.js";
import { descriptionSchema } from "@pkm/core";
import type {
  PkmQuickOpenResult,
  PkmUnresolvedReference,
  PermanentlyDeleteEntityRequest,
  CreateEntityRequest,
  SaveEntityDocumentRequest,
  SaveEntityDraftRequest,
  SaveSyncthingConflictDraftRequest,
  ResolveSyncthingConflictRequest,
  ResolveEntityConflictRequest,
  PkmEntityDocument as EntityDocument,
  PkmSyncthingConflictDocument as SyncthingConflictDocument,
  PkmResolveSyncthingConflictResult as ResolveSyncthingConflictResult,
  PkmResolveConflictResult as ResolveEntityConflictResult,
  PkmVaultChangeEvent as VaultChangeEvent,
} from "@pkm/contracts";
export type {
  CreateEntityRequest,
  SaveEntityDocumentRequest,
  SaveEntityDraftRequest,
  SaveSyncthingConflictDraftRequest,
  ResolveSyncthingConflictRequest,
  ResolveEntityConflictRequest,
  PkmEntityDocument as EntityDocument,
  PkmSyncthingConflictDocument as SyncthingConflictDocument,
  PkmResolvedSyncthingConflict as ResolvedSyncthingConflict,
  PkmChangedSyncthingConflict as ChangedSyncthingConflict,
  PkmResolveSyncthingConflictResult as ResolveSyncthingConflictResult,
  PkmResolvedConflict as ResolvedEntityConflict,
  PkmResolveConflictResult as ResolveEntityConflictResult,
  PkmVaultChangeEvent as VaultChangeEvent,
} from "@pkm/contracts";
import { quickOpenIndexedEntities } from "./quick-open.js";
import { readdir, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import {
  createEntityId,
  ENTITY_DIRECTORIES,
  parseVaultConfig,
  normalizeEntityDisplayName,
  parseMarkdownEntity,
  serializeMarkdownEntity,
  extractMarkdownTodos,
  parseToggleTodoRequest,
  requireJournalDate,
  serializeNewMarkdownEntity,
  todayJournalDate,
  updateEntityMetadata,
  type EntityType,
  type ParsedEntity,
  type VaultAccessMode,
} from "@pkm/core";
import type { TodoPage, TodoQuery, ToggleTodoRequest } from "@pkm/core";
import { listIndexedTodos } from "./todo-index.js";

import {
  getBacklinks,
  getIndexedConflict,
  getIndexedEntity,
  listEntityScopes,
  listIndexedConflicts,
  listIndexedEntities,
  listIndexedEntitiesInScope,
  listIndexedJournalEntries,
  searchIndexedEntities,
  type EntityQueryOptions,
  type IndexedConflict,
  type IndexedEntity,
  type IndexedReference,
  type IndexedSearchResult,
} from "./index-query.js";
import type { EntityScopeType, IndexedEntityScope } from "./entity-scope.js";
import { openVaultIndex, type IndexDatabase } from "./index-database.js";
import {
  openVaultLocalState,
  type DraftRecord,
  type LocalStateDatabase,
  type SyncthingConflictDraftRecord,
} from "./local-state.js";
import {
  assertVaultWritePathSafe,
  hashFileContent,
  readVaultFile,
  readVaultFileIfExists,
  isMissingFileError,
  resolveVaultPath,
} from "./vault-file.js";
import {
  startVaultIndexWatcher,
  type VaultIndexWatcher,
  type VaultIndexWatcherOptions,
} from "./index-watcher.js";
import { synchronizeVaultIndex, type IndexSyncResult } from "./index-sync.js";
import {
  createVaultAsset,
  readVaultAsset,
  vaultAssetAbsolutePath,
  type CreateVaultAssetRequest,
  type VaultAssetContent,
  type VaultAssetInfo,
} from "./vault-asset.js";
import {
  deleteOrphanAssets,
  listOrphanAssets,
  type OrphanAsset,
  type OrphanAssetCleanupResult,
} from "./orphan-assets.js";
import {
  saveVaultFileWithDraft,
  withVaultWriteLock,
  type WriteVaultFileResult,
  writeVaultFile,
} from "./vault-store.js";

export type LocalVaultErrorCode =
  | "INVALID_VAULT_CONFIG"
  | "CONFLICT_NOT_FOUND"
  | "ENTITY_NOT_FOUND"
  | "DRAFT_NOT_FOUND"
  | "TODO_CHANGED"
  | "TODO_DRAFT_PRESENT"
  | "READ_ONLY_SCHEMA"
  | "DELETE_BLOCKED";

export class LocalVaultError extends Error {
  override readonly name = "LocalVaultError";

  constructor(
    readonly code: LocalVaultErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface OpenLocalVaultOptions {
  readonly watch?: boolean;
  readonly watcherOptions?: VaultIndexWatcherOptions;
  readonly now?: () => Date;
  readonly localDrafts?: boolean;
}

export type VaultChangeListener = (event: VaultChangeEvent) => void;

interface VaultChangeHub {
  revision: number;
  readonly listeners: Set<VaultChangeListener>;
  readonly sessionId: string;
}

const createEntityRecord = (
  type: EntityType,
  displayName: string | null,
  timestamp: string,
  journalDate: string,
): ParsedEntity => {
  switch (type) {
    case "entry":
      return {
        id: createEntityId("entry"),
        type,
        title: displayName,
        created_at: timestamp,
        updated_at: timestamp,
        journal_date: journalDate,
        origin: "human",
        exclude_from_ai: false,
      };
    case "project":
      return {
        id: createEntityId("project"),
        type,
        title: displayName ?? "",
        status: "not_started",
        created_at: timestamp,
        updated_at: timestamp,
      };
    case "task":
      return {
        id: createEntityId("task"),
        type,
        title: displayName ?? "",
        status: "not_started",
        created_at: timestamp,
        updated_at: timestamp,
      };
    case "resource":
      return {
        id: createEntityId("resource"),
        type,
        title: displayName ?? "",
        created_at: timestamp,
        updated_at: timestamp,
      };
    case "topic":
      return {
        id: createEntityId("topic"),
        type,
        name: displayName ?? "",
        created_at: timestamp,
        updated_at: timestamp,
      };
    case "area":
      return {
        id: createEntityId("area"),
        type,
        name: displayName ?? "",
        created_at: timestamp,
        updated_at: timestamp,
      };
  }
};

export class LocalVaultService {
  private closed = false;
  private pendingScan: Promise<unknown> = Promise.resolve();

  get cacheVersion(): string {
    return `${this.changes.sessionId}:${this.changes.revision}`;
  }

  constructor(
    private readonly vaultRoot: string,
    private readonly index: IndexDatabase,
    private readonly localState: LocalStateDatabase | null,
    private readonly watcher: VaultIndexWatcher | null,
    private readonly now: () => Date,
    private readonly changes: VaultChangeHub,
    readonly vaultId: string,
    readonly accessMode: VaultAccessMode,
  ) {}

  private ensureOpen(): void {
    if (this.closed) throw new Error("Local Vault service is closed");
  }

  private requireEntity(entityId: string): IndexedEntity {
    const entity = getIndexedEntity(this.index, entityId);
    if (entity === null) {
      throw new LocalVaultError(
        "ENTITY_NOT_FOUND",
        `Entity ${entityId} was not found`,
      );
    }
    return entity;
  }

  private ensureWritable(): void {
    if (this.accessMode !== "read-write") {
      throw new LocalVaultError(
        "READ_ONLY_SCHEMA",
        `Vault is ${this.accessMode} and cannot be modified`,
      );
    }
  }

  subscribeToChanges(listener: VaultChangeListener): () => void {
    this.ensureOpen();
    this.changes.listeners.add(listener);
    return () => this.changes.listeners.delete(listener);
  }

  queryEntities(query: EntityPageQuery = {}, options: EntityQueryOptions = {}) {
    this.ensureOpen();
    return queryIndexedEntityPage(this.index, query, options);
  }
  get sessionId(): string {
    return this.changes.sessionId;
  }
  get revision(): number {
    return this.changes.revision;
  }
  async patchMetadata(
    entityId: string,
    patch: PkmMetadataPatch,
    expectedFileHash: PkmFileHash,
  ) {
    this.ensureWritable();
    const current = await this.loadEntity(entityId);
    if (current.draft !== null)
      throw new LocalVaultError(
        "TODO_DRAFT_PRESENT",
        "Entity has an unsaved local draft",
      );
    const updated = updateEntityMetadata(current.content, patch, {
      now: this.now,
    });
    const result = await this.saveEntity({
      entityId,
      content: updated.content,
      expectedFileHash,
    });
    if (!result.ok) return result;
    return {
      ok: true as const,
      entity: this.requireEntity(entityId),
      fileHash: result.snapshot.hash,
    };
  }
  async patchBody(
    entityId: string,
    body: string,
    expectedFileHash: PkmFileHash,
  ) {
    this.ensureWritable();
    const current = await this.loadEntity(entityId);
    const parsed = parseMarkdownEntity(current.content);
    if (current.draft || !parsed.ok)
      throw new TypeError(
        "Cannot update an invalid Entity or one with a local draft",
      );
    const result = await this.saveEntity({
      entityId,
      expectedFileHash,
      content: serializeMarkdownEntity(parsed.value, { body }),
    });
    return result.ok
      ? {
          ok: true as const,
          entity: this.requireEntity(entityId),
          fileHash: result.snapshot.hash,
        }
      : result;
  }
  entitySummary(id: string) {
    return this.requireEntity(id);
  }
  entityLabels(ids: readonly string[]) {
    return queryEntityLabels(this.index, ids);
  }
  entityCounts() {
    this.ensureOpen();
    return countIndexedEntities(this.index);
  }
  calendarCounts(from: string, to: string) {
    this.ensureOpen();
    return countIndexedCalendarDays(this.index, from, to);
  }

  listEntities(options: EntityQueryOptions = {}): readonly IndexedEntity[] {
    this.ensureOpen();
    return listIndexedEntities(this.index, options);
  }

  listJournalEntries(date: string): readonly IndexedEntity[] {
    this.ensureOpen();
    return listIndexedJournalEntries(this.index, requireJournalDate(date));
  }

  listTodos(query: TodoQuery = {}): TodoPage {
    this.ensureOpen();
    return listIndexedTodos(this.index, query);
  }

  async toggleTodo(input: ToggleTodoRequest): Promise<void> {
    this.ensureOpen();
    this.ensureWritable();
    const request = parseToggleTodoRequest(input);
    const entity = this.requireEntity(request.entryId);
    const checkDraft = (): void => {
      if ((this.localState?.getDraft(request.entryId) ?? null) !== null)
        throw new LocalVaultError(
          "TODO_DRAFT_PRESENT",
          "このEntryには未保存draftがあります。詳細画面で保存または破棄してください。",
        );
    };
    checkDraft();
    const current = await readVaultFile(this.vaultRoot, entity.path);
    if (current.hash !== request.expectedFileHash)
      throw new LocalVaultError(
        "TODO_CHANGED",
        "Entryが変更されています。一覧を更新してください。",
      );
    const parsed = parseMarkdownEntity(current.content);
    if (
      !parsed.ok ||
      parsed.value.entity.id !== request.entryId ||
      parsed.value.entity.type !== "entry" ||
      parsed.value.entity.deleted_at != null
    )
      throw new LocalVaultError(
        "TODO_CHANGED",
        "Entryが変更されています。一覧を更新してください。",
      );
    const todo = extractMarkdownTodos(parsed.value.body).find(
      (item) => item.from === request.markerFrom,
    );
    if (todo === undefined)
      throw new LocalVaultError(
        "TODO_CHANGED",
        "Todoが変更されています。一覧を更新してください。",
      );
    checkDraft();
    const body = `${parsed.value.body.slice(0, todo.from)}${request.checked ? "[x]" : "[ ]"}${parsed.value.body.slice(todo.to)}`;
    const content = serializeMarkdownEntity(parsed.value, {
      body,
      entity: { ...parsed.value.entity, updated_at: this.now().toISOString() },
    });
    const result = await writeVaultFile(this.vaultRoot, {
      path: entity.path,
      content,
      expectedFileHash: request.expectedFileHash,
      assertCanWrite: checkDraft,
    });
    if (!result.ok)
      throw new LocalVaultError(
        "TODO_CHANGED",
        "外部更新と競合しました。一覧を更新してください。",
      );
    await this.rescan([entity.path]);
  }

  searchEntities(
    query: string,
    options: EntityQueryOptions = {},
  ): readonly IndexedSearchResult[] {
    this.ensureOpen();
    return searchIndexedEntities(this.index, query, options);
  }

  quickOpen(query: string): readonly PkmQuickOpenResult[] {
    this.ensureOpen();
    return quickOpenIndexedEntities(this.index, query);
  }

  listEntityScopes(entityId: string): readonly IndexedEntityScope[] {
    this.ensureOpen();
    return listEntityScopes(this.index, entityId);
  }

  listEntitiesInScope(
    scopeType: EntityScopeType,
    scopeId: string,
    options: EntityQueryOptions = {},
  ): readonly IndexedEntity[] {
    this.ensureOpen();
    return listIndexedEntitiesInScope(this.index, scopeType, scopeId, options);
  }

  queryBacklinks(
    targetId: string,
    query: BacklinkPageQuery = {},
    options: EntityQueryOptions = {},
  ) {
    this.ensureOpen();
    return queryIndexedBacklinkPage(this.index, targetId, query, options);
  }

  getBacklinks(
    targetId: string,
    options: EntityQueryOptions = {},
  ): readonly IndexedReference[] {
    this.ensureOpen();
    return getBacklinks(this.index, targetId, options);
  }

  listSyncthingConflicts(): readonly IndexedConflict[] {
    this.ensureOpen();
    return listIndexedConflicts(this.index);
  }

  async loadSyncthingConflict(
    conflictPath: string,
  ): Promise<SyncthingConflictDocument> {
    this.ensureOpen();
    const conflict = getIndexedConflict(this.index, conflictPath);
    if (conflict === null) {
      throw new LocalVaultError(
        "CONFLICT_NOT_FOUND",
        `Syncthing conflict ${conflictPath} was not found`,
      );
    }
    const [canonical, conflicting] = await Promise.all([
      readVaultFileIfExists(this.vaultRoot, conflict.canonicalEntityPath),
      readVaultFileIfExists(this.vaultRoot, conflict.path),
    ]);
    if (conflicting === null) {
      await this.rescan();
      throw new LocalVaultError(
        "CONFLICT_NOT_FOUND",
        `Syncthing conflict ${conflictPath} was not found`,
      );
    }
    return {
      conflict,
      canonical,
      conflicting,
      draft: this.localState?.getSyncthingConflictDraft(conflictPath) ?? null,
    };
  }

  async saveSyncthingConflictDraft(
    request: SaveSyncthingConflictDraftRequest,
  ): Promise<SyncthingConflictDraftRecord> {
    this.ensureOpen();
    await this.loadSyncthingConflict(request.conflictPath);
    const draft: SyncthingConflictDraftRecord = {
      ...request,
      updatedAt: this.now().toISOString(),
    };
    if (!this.localState) throw new Error("Local drafts are disabled");
    this.localState.saveSyncthingConflictDraft(draft);
    return draft;
  }

  discardSyncthingConflictDraft(conflictPath: string): void {
    this.ensureOpen();
    this.localState?.deleteSyncthingConflictDraft(conflictPath);
  }

  async loadEntity(entityId: string): Promise<EntityDocument> {
    this.ensureOpen();
    const entity = this.requireEntity(entityId);
    const snapshot = await readVaultFile(this.vaultRoot, entity.path);
    const draft = this.localState?.getDraft(entityId) ?? null;
    return {
      entity,
      content: snapshot.content,
      fileHash: snapshot.hash,
      draft,
      hasExternalChange: draft !== null && draft.baseHash !== snapshot.hash,
    };
  }

  async readAgentFile(entityId: string, type: EntityType) {
    this.ensureOpen();
    return readVaultFileIfExists(
      this.vaultRoot,
      `${ENTITY_DIRECTORIES[type]}/${entityId}.md`,
    );
  }

  async hasAgentConflict(entityId: string, type: EntityType): Promise<boolean> {
    this.ensureOpen();
    const path = `${ENTITY_DIRECTORIES[type]}/${entityId}.md`;
    if (
      this.listSyncthingConflicts().some((c) => c.canonicalEntityPath === path)
    )
      return true;
    // Recheck directory names so a just-arrived conflict cannot bypass watcher lag.
    try {
      const names = await readdir(
        dirname(resolveVaultPath(this.vaultRoot, path)),
      );
      return names.some(
        (name) =>
          name.startsWith(`${entityId}.sync-conflict-`) &&
          /\.sync-conflict-\d{8}-\d{6}-[a-z0-9]+\.md$/i.test(name),
      );
    } catch (error) {
      if (isMissingFileError(error)) return false;
      throw error;
    }
  }

  // Trusted agent service primitive: never creates or removes a human draft.
  async writeAgentEntity(
    entityId: string,
    content: string,
    expectedFileHash: PkmFileHash | null,
    assertPolicy: () => Promise<void>,
  ): Promise<PkmFileHash> {
    this.ensureOpen();
    this.ensureWritable();
    const parsed = parseMarkdownEntity(content);
    if (!parsed.ok || parsed.value.entity.id !== entityId)
      throw new TypeError("Invalid agent Entity");
    const path = `${ENTITY_DIRECTORIES[parsed.value.entity.type]}/${entityId}.md`;
    const result = await writeVaultFile(this.vaultRoot, {
      path,
      content,
      expectedFileHash,
      assertCanWrite: async () => {
        if (this.localState?.getDraft(entityId))
          throw new Error("LOCAL_DRAFT_PRESENT");
        await assertPolicy();
        if (this.localState?.getDraft(entityId))
          throw new Error("LOCAL_DRAFT_PRESENT");
      },
    });
    if (!result.ok) throw new Error("HASH_CONFLICT");
    await this.rescan([path]);
    return result.snapshot.hash;
  }

  private creationQueue: Promise<unknown> = Promise.resolve();
  createEntity(request: CreateEntityRequest): Promise<EntityDocument> {
    const operation = this.creationQueue.then(() =>
      this.createEntityWithTopics(request),
    );
    this.creationQueue = operation.catch(() => {});
    return operation;
  }
  private async createEntityWithTopics(
    request: CreateEntityRequest,
  ): Promise<EntityDocument> {
    this.ensureOpen();
    this.ensureWritable();
    if (request.body !== undefined && typeof request.body !== "string") {
      throw new TypeError("Markdown body must be a string");
    }
    if (request.journalDate !== undefined && request.type !== "entry") {
      throw new TypeError("Only Entry can have a journal date");
    }
    const displayName =
      request.type === "entry" && !request.displayName?.trim()
        ? null
        : normalizeEntityDisplayName(request.displayName ?? "", true);
    const now = this.now();
    const timestamp = now.toISOString();
    const entity = createEntityRecord(
      request.type,
      displayName,
      timestamp,
      request.journalDate === undefined
        ? todayJournalDate(now)
        : requireJournalDate(request.journalDate),
    );
    if (request.description !== undefined) {
      if (entity.type === "entry")
        throw new TypeError("Entry does not have a description field");
      Object.assign(entity, {
        description: descriptionSchema.parse(request.description),
      });
    }
    const newTopics: { path: string; content: string }[] = [];
    const topicIds = [...(request.metadata?.topics ?? [])];
    if (request.topicNames?.length) {
      if (request.type === "topic")
        throw new TypeError("Topic cannot have topics");
      const names = new Map(
        request.topicNames.map((name) => [
          name.normalize("NFKC").trim().toLocaleLowerCase("ja"),
          normalizeEntityDisplayName(name),
        ]),
      );
      const existing = this.index.database
        .prepare(
          "SELECT id, display_name AS displayName FROM entities WHERE id IN (SELECT min(id) FROM entities WHERE type='topic' AND deleted_at IS NULL AND name_key IN (SELECT value FROM json_each(?)) GROUP BY name_key)",
        )
        .all(JSON.stringify([...names.keys()])) as {
        id: TopicId;
        displayName: string;
      }[];
      for (const [key, name] of names) {
        const found = existing.find(
          (topic) =>
            topic.displayName
              ?.normalize("NFKC")
              .trim()
              .toLocaleLowerCase("ja") === key,
        );
        if (found) {
          topicIds.push(found.id);
          continue;
        }
        const topic = createEntityRecord(
          "topic",
          name,
          timestamp,
          todayJournalDate(now),
        );
        topicIds.push(topic.id as TopicId);
        newTopics.push({
          path: `${ENTITY_DIRECTORIES.topic}/${topic.id}.md`,
          content: serializeNewMarkdownEntity(topic),
        });
      }
    }
    const path = `${ENTITY_DIRECTORIES[entity.type]}/${entity.id}.md`;
    let content = serializeNewMarkdownEntity(entity, {
      body: request.body ?? "",
    });
    if (request.metadata || topicIds.length)
      content = updateEntityMetadata(
        content,
        {
          ...request.metadata,
          ...(topicIds.length ? { topics: [...new Set(topicIds)] } : {}),
        },
        {
          now: this.now,
        },
      ).content;
    const paths: string[] = [];
    try {
      for (const file of [...newTopics, { path, content }]) {
        const result = await writeVaultFile(this.vaultRoot, {
          ...file,
          expectedFileHash: null,
        });
        if (!result.ok)
          throw new Error(`Generated Entity path already exists: ${file.path}`);
        paths.push(file.path);
      }
    } finally {
      if (paths.length) await this.rescan(paths);
    }
    const snapshotHash = hashFileContent(content);
    return {
      entity: { ...this.requireEntity(entity.id), fileHash: snapshotHash },
      content,
      fileHash: snapshotHash,
      draft: null,
      hasExternalChange: false,
    };
  }

  async createAsset(
    request: CreateVaultAssetRequest,
    assetId?: string,
  ): Promise<VaultAssetInfo> {
    this.ensureOpen();
    this.ensureWritable();
    return createVaultAsset(this.vaultRoot, request, assetId);
  }

  async readAsset(path: string): Promise<VaultAssetContent> {
    this.ensureOpen();
    return readVaultAsset(this.vaultRoot, path);
  }

  async assetAbsolutePath(path: string): Promise<string> {
    this.ensureOpen();
    return vaultAssetAbsolutePath(this.vaultRoot, path);
  }

  private assetReferenceContents(): readonly string[] {
    const contents = (this.localState?.listDrafts() ?? []).map(
      (draft) => draft.content,
    );
    for (const conflict of listIndexedConflicts(this.index)) {
      const draft =
        this.localState?.getSyncthingConflictDraft(conflict.path) ?? null;
      if (draft !== null) contents.push(draft.content);
    }
    return contents;
  }

  listUnresolvedReferences(): readonly PkmUnresolvedReference[] {
    this.ensureOpen();
    const rows = this.index.database
      .prepare(
        `
      SELECT source.id AS sourceId, source.path AS sourcePath,
             source.display_name AS sourceName, source.deleted_at AS sourceDeletedAt,
             issue.target_id AS targetId, issue.field_path AS fieldPath,
             issue.start_offset AS startOffset
      FROM validation_issues issue JOIN entities source ON source.id = issue.entity_id
      WHERE issue.code = 'UnresolvedReference' AND issue.target_id IS NOT NULL
      ORDER BY source.path, issue.target_id, issue.field_path, issue.start_offset
    `,
      )
      .all() as Array<
      Omit<PkmUnresolvedReference, "fieldPath"> & { fieldPath: string | null }
    >;
    return rows.map((row) => ({
      ...row,
      fieldPath:
        row.fieldPath === null
          ? null
          : (JSON.parse(row.fieldPath) as (string | number)[]),
    }));
  }

  async listOrphanAssets(): Promise<readonly OrphanAsset[]> {
    this.ensureOpen();
    return listOrphanAssets(
      this.vaultRoot,
      this.assetReferenceContents(),
      this.now().getTime(),
    );
  }

  async deleteOrphanAssets(
    requested: readonly Pick<OrphanAsset, "path" | "hash">[],
  ): Promise<OrphanAssetCleanupResult> {
    this.ensureOpen();
    this.ensureWritable();
    const result = await deleteOrphanAssets(
      this.vaultRoot,
      requested,
      this.assetReferenceContents(),
      this.now().getTime(),
    );
    if (result.deleted.length > 0) await this.rescan();
    return result;
  }

  saveDraft(request: SaveEntityDraftRequest): DraftRecord {
    this.ensureOpen();
    const entity = this.requireEntity(request.entityId);
    const draft: DraftRecord = {
      entityId: request.entityId,
      filePath: entity.path,
      baseHash: request.baseHash,
      content: request.content,
      updatedAt: this.now().toISOString(),
    };
    if (!this.localState) throw new Error("Local drafts are disabled");
    this.localState.saveDraft(draft);
    return draft;
  }

  listDrafts(): readonly DraftRecord[] {
    this.ensureOpen();
    return this.localState?.listDrafts() ?? [];
  }

  discardDraft(entityId: string): void {
    this.ensureOpen();
    this.localState?.deleteDraft(entityId);
  }

  async permanentlyDeleteEntity(
    request: PermanentlyDeleteEntityRequest,
  ): Promise<void> {
    this.ensureOpen();
    this.ensureWritable();
    const entity = this.requireEntity(request.entityId);
    await withVaultWriteLock(
      resolveVaultPath(this.vaultRoot, entity.path),
      async () => {
        this.ensureOpen();
        this.ensureWritable();
        await assertVaultWritePathSafe(this.vaultRoot, entity.path);
        const snapshot = await readVaultFile(this.vaultRoot, entity.path);
        if (snapshot.hash !== request.expectedFileHash)
          throw new LocalVaultError(
            "DELETE_BLOCKED",
            "内容が変更されています。ゴミ箱を開き直して確認してください。",
          );
        const parsed = parseMarkdownEntity(snapshot.content);
        if (
          !parsed.ok ||
          parsed.value.entity.id !== request.entityId ||
          parsed.value.entity.type !== entity.type ||
          parsed.value.entity.deleted_at == null
        )
          throw new LocalVaultError(
            "DELETE_BLOCKED",
            "完全に削除できるのはゴミ箱内のEntityだけです。",
          );
        if (
          await this.hasAgentConflict(
            request.entityId,
            parsed.value.entity.type,
          )
        )
          throw new LocalVaultError(
            "DELETE_BLOCKED",
            "同期競合を解決してから完全に削除してください。",
          );
        await assertVaultWritePathSafe(this.vaultRoot, entity.path);
        if (
          (await readVaultFile(this.vaultRoot, entity.path)).hash !==
          request.expectedFileHash
        )
          throw new LocalVaultError(
            "DELETE_BLOCKED",
            "内容が変更されています。ゴミ箱を開き直して確認してください。",
          );
        await unlink(resolveVaultPath(this.vaultRoot, entity.path));
        try {
          await this.rescan([entity.path]);
        } finally {
          this.localState?.deleteDraft(request.entityId);
        }
      },
    );
  }

  async saveEntity(
    request: SaveEntityDocumentRequest,
  ): Promise<WriteVaultFileResult> {
    this.ensureOpen();
    this.ensureWritable();
    const entity = this.requireEntity(request.entityId);
    const result = await saveVaultFileWithDraft(
      this.vaultRoot,
      {
        entityId: request.entityId,
        path: entity.path,
        content: request.content,
        expectedFileHash: request.expectedFileHash,
        updatedAt: this.now().toISOString(),
        assertCanWrite: () => {
          this.requireEntity(request.entityId);
        },
      },
      this.localState,
    );
    if (result.ok) await this.rescan([entity.path]);
    return result;
  }

  async resolveEntityConflict(
    request: ResolveEntityConflictRequest,
  ): Promise<ResolveEntityConflictResult> {
    this.ensureOpen();
    const browserDraft = request.content !== undefined;
    const draft = browserDraft
      ? {
          filePath: this.requireEntity(request.entityId).path,
          content: request.content,
        }
      : (this.localState?.getDraft(request.entityId) ?? null);
    if (draft === null) {
      throw new LocalVaultError(
        "DRAFT_NOT_FOUND",
        `Entity ${request.entityId} does not have a saved draft`,
      );
    }

    let actual: Awaited<ReturnType<typeof readVaultFile>> | null;
    try {
      actual = await readVaultFile(this.vaultRoot, draft.filePath);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      actual = null;
    }
    if ((actual?.hash ?? null) !== request.expectedExternalHash) {
      return {
        ok: false,
        reason: "hash-conflict",
        expectedFileHash: request.expectedExternalHash,
        actual,
        draftContent: draft.content,
      };
    }

    if (request.resolution === "keep-external") {
      if (!browserDraft) this.localState?.deleteDraft(request.entityId);
      await this.rescan([draft.filePath]);
      const indexed = getIndexedEntity(this.index, request.entityId);
      return {
        ok: true,
        resolution: request.resolution,
        document:
          actual === null || indexed === null
            ? null
            : await this.loadEntity(request.entityId),
      };
    }

    this.ensureWritable();
    const result = await saveVaultFileWithDraft(
      this.vaultRoot,
      {
        entityId: request.entityId,
        path: draft.filePath,
        content: draft.content,
        expectedFileHash: request.expectedExternalHash,
        updatedAt: this.now().toISOString(),
        assertCanWrite: () => {
          if (browserDraft) this.requireEntity(request.entityId);
          else if (!this.localState?.getDraft(request.entityId))
            throw new LocalVaultError(
              "DRAFT_NOT_FOUND",
              "下書きが見つかりません。",
            );
        },
      },
      browserDraft ? null : this.localState,
    );
    if (!result.ok) return result;
    await this.rescan([draft.filePath]);
    return {
      ok: true,
      resolution: request.resolution,
      document: await this.loadEntity(request.entityId),
    };
  }

  async resolveSyncthingConflict(
    request: ResolveSyncthingConflictRequest,
  ): Promise<ResolveSyncthingConflictResult> {
    this.ensureOpen();
    this.ensureWritable();
    let current: SyncthingConflictDocument;
    try {
      current = await this.loadSyncthingConflict(request.conflictPath);
    } catch (error) {
      if (
        error instanceof LocalVaultError &&
        error.code === "CONFLICT_NOT_FOUND"
      ) {
        return { ok: false, reason: "hash-conflict", current: null };
      }
      throw error;
    }
    if (
      (current.canonical?.hash ?? null) !== request.expectedCanonicalHash ||
      current.conflicting.hash !== request.expectedConflictHash
    ) {
      return { ok: false, reason: "hash-conflict", current };
    }

    const entityId =
      current.conflict.canonicalEntityId ??
      basename(current.conflict.canonicalEntityPath, ".md");
    if (request.resolution === "manual" && request.content === undefined) {
      throw new TypeError("Manual conflict resolution requires content");
    }
    let resolvedCanonicalHash = request.expectedCanonicalHash;
    if (request.resolution !== "keep-canonical") {
      const content =
        request.resolution === "keep-conflict"
          ? current.conflicting.content
          : request.content;
      if (content === undefined) {
        throw new TypeError("Conflict resolution content is required");
      }
      const saved = await saveVaultFileWithDraft(
        this.vaultRoot,
        {
          entityId,
          path: current.conflict.canonicalEntityPath,
          content,
          expectedFileHash: request.expectedCanonicalHash,
          updatedAt: this.now().toISOString(),
        },
        this.localState,
      );
      if (!saved.ok) {
        const refreshed = await this.loadSyncthingConflict(
          request.conflictPath,
        );
        return { ok: false, reason: "hash-conflict", current: refreshed };
      }
      resolvedCanonicalHash = saved.snapshot.hash;
    }

    const [canonicalBeforeDelete, conflictBeforeDelete] = await Promise.all([
      readVaultFileIfExists(
        this.vaultRoot,
        current.conflict.canonicalEntityPath,
      ),
      readVaultFileIfExists(this.vaultRoot, current.conflict.path),
    ]);
    if (
      (canonicalBeforeDelete?.hash ?? null) !== resolvedCanonicalHash ||
      conflictBeforeDelete?.hash !== request.expectedConflictHash
    ) {
      await this.rescan([
        current.conflict.canonicalEntityPath,
        current.conflict.path,
      ]);
      return {
        ok: false,
        reason: "hash-conflict",
        current:
          conflictBeforeDelete === null
            ? null
            : await this.loadSyncthingConflict(request.conflictPath),
      };
    }
    await assertVaultWritePathSafe(this.vaultRoot, current.conflict.path);
    try {
      await unlink(resolveVaultPath(this.vaultRoot, current.conflict.path));
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      await this.rescan();
      return { ok: false, reason: "hash-conflict", current: null };
    }
    await this.rescan([
      current.conflict.canonicalEntityPath,
      current.conflict.path,
    ]);
    this.localState?.deleteSyncthingConflictDraft(request.conflictPath);
    const resolvedEntity = getIndexedEntity(this.index, entityId);
    return {
      ok: true,
      resolution: request.resolution,
      document:
        resolvedEntity === null ? null : await this.loadEntity(entityId),
    };
  }

  async rescan(paths?: readonly string[]): Promise<IndexSyncResult> {
    this.ensureOpen();
    if (this.watcher !== null) return this.watcher.rescan(paths);
    const scan = this.pendingScan.then(async () => {
      const result = await synchronizeVaultIndex(
        this.vaultRoot,
        this.index,
        paths,
      );
      publishVaultChange(this.changes, result);
      return result;
    });
    this.pendingScan = scan.catch(() => {});
    return scan;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.watcher?.close();
    this.localState?.close();
    this.index.close();
  }
}

const loadVaultConfig = async (
  vaultRoot: string,
): Promise<ReturnType<typeof parseVaultConfig> & { readonly ok: true }> => {
  let source: string;
  try {
    source = (await readVaultFile(vaultRoot, "vault.yaml")).content;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new LocalVaultError(
        "INVALID_VAULT_CONFIG",
        "vault.yaml is required",
      );
    }
    throw error;
  }
  const config = parseVaultConfig(source);
  if (!config.ok) {
    throw new LocalVaultError("INVALID_VAULT_CONFIG", config.error.message);
  }
  return config;
};

const publishVaultChange = (
  hub: VaultChangeHub,
  result: IndexSyncResult,
): void => {
  if (
    result.addedFiles === 0 &&
    result.changedFiles === 0 &&
    result.deletedFiles === 0
  ) {
    return;
  }
  const event: VaultChangeEvent = {
    sessionId: hub.sessionId,
    revision: ++hub.revision,
    sync: result,
  };
  for (const listener of hub.listeners) listener(event);
};

export const openLocalVault = async (
  vaultRoot: string,
  options: OpenLocalVaultOptions = {},
): Promise<LocalVaultService> => {
  const root = resolve(vaultRoot);
  const config = await loadVaultConfig(root);
  const index = openVaultIndex(root);
  const localState =
    options.localDrafts === false ? null : openVaultLocalState(root);
  const changes: VaultChangeHub = {
    sessionId: randomUUID(),
    revision: 0,
    listeners: new Set(),
  };
  let watcher: VaultIndexWatcher | null = null;
  try {
    if (options.watch ?? true) {
      const configuredOnRebuild = options.watcherOptions?.onRebuild;
      watcher = await startVaultIndexWatcher(root, index, {
        ...options.watcherOptions,
        onRebuild: (result) => {
          configuredOnRebuild?.(result);
          publishVaultChange(changes, result);
        },
      });
    } else {
      await synchronizeVaultIndex(root, index);
    }
    return new LocalVaultService(
      root,
      index,
      localState,
      watcher,
      options.now ?? (() => new Date()),
      changes,
      config.value.vault_id,
      config.compatibility.accessMode,
    );
  } catch (error) {
    await watcher?.close();
    localState?.close();
    index.close();
    throw error;
  }
};
