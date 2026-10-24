import type {
  EntityType,
  Status,
  Priority,
  ResourceType,
  AreaId,
  ProjectId,
  TopicId,
  EntryContexts,
} from "./entity.js";
import type { TodoPage, TodoQuery, ToggleTodoRequest } from "./todo.js";

export type PkmFileHash = `sha256:${string}`;

export type EntryRelationMode = "direct" | "scoped";
export interface EntryRelation {
  readonly kind: "direct" | "inherited";
  /** Representative path from the viewed Entity to the Entry's direct context. */
  readonly path: readonly {
    readonly id: string;
    readonly type: string;
    readonly displayName: string | null;
  }[];
}

export interface PkmEntitySummary {
  readonly relatedVia?: {
    readonly relation: "direct" | "transitive";
    readonly kind: "structured" | "reference";
    readonly via: readonly {
      readonly id: string;
      readonly type: string;
      readonly displayName: string | null;
    }[];
  };
  readonly authors?: readonly string[];
  readonly relatedEntityIds?: readonly string[];
  readonly id: string;
  readonly type: string;
  readonly path: string;
  readonly displayName: string | null;
  readonly description?: string | null;
  readonly origin: string | null;
  readonly status: string | null;
  readonly priority: string | null;
  readonly projectId: string | null;
  readonly areaId: string | null;
  readonly taskId: string | null;
  readonly resourceId: string | null;
  readonly resourceType?: ResourceType | null;
  readonly canonicalIdentifier: string | null;
  readonly sourceUri: string | null;
  readonly assetPath: string | null;
  readonly journalDate: string | null;
  readonly occurredAt: string | null;
  readonly dueAt: string | null;
  readonly topicIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
  readonly excludeFromAi: boolean;
  readonly body: string;
  readonly fileHash?: PkmFileHash;
  readonly bodyTruncated?: boolean;
  readonly entryRelation?: EntryRelation;
}

export interface PkmUnresolvedReference {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly sourceName: string | null;
  readonly sourceDeletedAt: string | null;
  readonly targetId: string;
  readonly fieldPath: readonly (string | number)[] | null;
  readonly startOffset: number | null;
}

export interface PkmOrphanAsset {
  readonly path: string;
  readonly hash: PkmFileHash;
  readonly size: number;
  readonly mtimeMs: number;
}

export interface PkmOrphanAssetCleanupResult {
  readonly deleted: readonly string[];
  readonly skipped: readonly string[];
}

export interface PkmSearchResult extends PkmEntitySummary {
  readonly searchContent: string;
}

export interface PkmQuickOpenResult extends Pick<
  PkmEntitySummary,
  "id" | "type" | "path" | "displayName" | "updatedAt"
> {
  readonly snippet: string;
  readonly breadcrumb: string;
}

export interface PkmDraft {
  readonly entityId: string;
  readonly filePath: string;
  readonly baseHash: PkmFileHash | null;
  readonly content: string;
  readonly updatedAt: string;
}

export interface PkmEntityDocument {
  readonly entity: PkmEntitySummary;
  readonly content: string;
  readonly fileHash: PkmFileHash;
  readonly draft: PkmDraft | null;
  readonly hasExternalChange: boolean;
}

export interface PkmBacklink {
  readonly sourceId: string;
  readonly sourceType: EntityType;
  readonly sourceDisplayName: string | null;
  readonly targetId: string;
  readonly targetType: EntityType | null;
  readonly kind: string;
  readonly label: string | null;
  readonly fieldPath: readonly (string | number)[] | null;
  readonly startOffset: number | null;
  readonly endOffset: number | null;
}

export interface PkmFileSnapshot {
  readonly path: string;
  readonly content: string;
  readonly hash: PkmFileHash;
}

export interface PkmSyncthingConflictSummary {
  readonly path: string;
  readonly canonicalEntityPath: string;
  readonly canonicalEntityId: string | null;
  readonly canonicalDisplayName: string | null;
  readonly hash: PkmFileHash;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface PkmSyncthingConflictDocument {
  readonly conflict: PkmSyncthingConflictSummary;
  readonly canonical: PkmFileSnapshot | null;
  readonly conflicting: PkmFileSnapshot;
  readonly draft: PkmSyncthingConflictDraft | null;
}

export interface PkmSyncthingConflictDraft {
  readonly conflictPath: string;
  readonly canonicalHash: PkmFileHash | null;
  readonly conflictHash: PkmFileHash;
  readonly content: string;
  readonly updatedAt: string;
}

export interface PkmResolvedSyncthingConflict {
  readonly ok: true;
  readonly resolution: "keep-canonical" | "keep-conflict" | "manual";
  readonly document: PkmEntityDocument | null;
}

export interface PkmChangedSyncthingConflict {
  readonly ok: false;
  readonly reason: "hash-conflict";
  readonly current: PkmSyncthingConflictDocument | null;
}

export type PkmResolveSyncthingConflictResult =
  PkmResolvedSyncthingConflict | PkmChangedSyncthingConflict;

export interface PkmSaveSuccess {
  readonly ok: true;
  readonly snapshot: PkmFileSnapshot;
  readonly entity?: PkmEntitySummary;
}

export interface PkmSaveConflict {
  readonly ok: false;
  readonly reason: "hash-conflict";
  readonly expectedFileHash: PkmFileHash | null;
  readonly actual: PkmFileSnapshot | null;
  readonly draftContent: string;
}

export type PkmSaveResult = PkmSaveSuccess | PkmSaveConflict;

export interface PkmResolvedConflict {
  readonly ok: true;
  readonly resolution: "keep-external" | "keep-draft";
  readonly document: PkmEntityDocument | null;
}

export type PkmResolveConflictResult = PkmResolvedConflict | PkmSaveConflict;

export interface PkmHealth {
  readonly cacheVersion?: string;
  readonly status: "ok";
  readonly vaultId: string;
  readonly accessMode: "read-write" | "migration-required" | "read-only";
  readonly sessionId: string;
  readonly revision: number;
}

export interface PkmEntityOption {
  readonly id: string;
  readonly type: string;
  readonly displayName: string | null;
}
export interface PkmBootstrap {
  readonly health: PkmHealth;
  readonly counts: EntityCounts;
  readonly conflictsCount: number;
  readonly page: EntityPage;
}
export interface PkmRemoteClient extends Omit<
  PkmClient,
  | "saveDraft"
  | "discardDraft"
  | "saveSyncthingConflictDraft"
  | "discardSyncthingConflictDraft"
> {
  bootstrap(signal?: AbortSignal): Promise<PkmBootstrap>;
  queryOptions(
    query: EntityPageQuery,
    signal?: AbortSignal,
  ): Promise<readonly PkmEntityOption[]>;
  patchBody(
    entityId: string,
    body: string,
    expectedFileHash: PkmFileHash,
  ): ReturnType<PkmRemoteClient["patchMetadata"]>;
  patchMetadata(
    entityId: string,
    patch: PkmMetadataPatch,
    expectedFileHash: PkmFileHash,
  ): Promise<
    | PkmSaveConflict
    | {
        readonly ok: true;
        readonly entity: PkmEntitySummary;
        readonly fileHash: PkmFileHash;
      }
  >;
}

export interface PkmIndexSyncResult {
  readonly mode: "incremental" | "full-rebuild";
  readonly scannedFiles: number;
  readonly addedFiles: number;
  readonly changedFiles: number;
  readonly deletedFiles: number;
  readonly indexedEntities: number;
  readonly conflicts: number;
  readonly validationIssues: number;
  readonly changes: PkmIndexChanges;
}

export interface PkmIndexChanges {
  readonly reset: boolean;
  readonly entities: readonly {
    readonly id: string;
    readonly type: string;
    readonly fileHash: PkmFileHash | null;
  }[];
  readonly types: readonly string[];
  readonly scopeIds: readonly string[];
  readonly backlinkIds: readonly string[];
  readonly namesChanged: boolean;
  readonly countsChanged: boolean;
  readonly calendarChanged: boolean;
  readonly conflictsChanged: boolean;
}

export interface PkmVaultChangeEvent {
  readonly sessionId: string;
  readonly revision: number;
  readonly sync: PkmIndexSyncResult;
}

export interface PkmLinkPreview {
  readonly faviconDataUrl: string | null;
  readonly url: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly siteName: string | null;
}

export interface PkmClient {
  linkPreview(url: string): Promise<PkmLinkPreview | null>;
  health(): Promise<PkmHealth>;
  subscribeToChanges(
    listener: (event: PkmVaultChangeEvent) => void,
  ): () => void;
  queryEntities(
    query?: EntityPageQuery,
    signal?: AbortSignal,
  ): Promise<EntityPage>;
  entityCounts(): Promise<EntityCounts>;
  calendarCounts(
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<readonly CalendarCount[]>;
  quickOpen(
    query: string,
    signal?: AbortSignal,
  ): Promise<readonly PkmQuickOpenResult[]>;
  listTodos(query?: TodoQuery, signal?: AbortSignal): Promise<TodoPage>;
  toggleTodo(request: ToggleTodoRequest): Promise<void>;
  loadEntity(
    entityId: string,
    signal?: AbortSignal,
  ): Promise<PkmEntityDocument>;
  queryBacklinks(
    entityId: string,
    query?: BacklinkPageQuery,
    signal?: AbortSignal,
  ): Promise<BacklinkPage>;
  listSyncthingConflicts(): Promise<readonly PkmSyncthingConflictSummary[]>;
  loadSyncthingConflict(path: string): Promise<PkmSyncthingConflictDocument>;
  saveSyncthingConflictDraft(
    request: SaveSyncthingConflictDraftRequest,
  ): Promise<void>;
  discardSyncthingConflictDraft(conflictPath: string): Promise<void>;
  createEntity(request: CreateEntityRequest): Promise<PkmEntityDocument>;
  createAsset(request: PkmAssetUpload): Promise<PkmAsset>;
  listUnresolvedReferences(): Promise<readonly PkmUnresolvedReference[]>;
  listOrphanAssets(): Promise<readonly PkmOrphanAsset[]>;
  deleteOrphanAssets(
    assets: readonly Pick<PkmOrphanAsset, "path" | "hash">[],
  ): Promise<PkmOrphanAssetCleanupResult>;
  saveDraft(request: SaveEntityDraftRequest): Promise<void>;
  discardDraft(entityId: string): Promise<void>;
  saveEntity(request: SaveEntityDocumentRequest): Promise<PkmSaveResult>;
  permanentlyDeleteEntity(
    request: PermanentlyDeleteEntityRequest,
  ): Promise<void>;
  resolveConflict(
    request: ResolveEntityConflictRequest,
  ): Promise<PkmResolveConflictResult>;
  resolveSyncthingConflict(
    request: ResolveSyncthingConflictRequest,
  ): Promise<PkmResolveSyncthingConflictResult>;
}

export interface CreateEntityRequest {
  readonly type: EntityType;
  readonly displayName: string | null;
  readonly description?: string | null;
  /** Optional Markdown body for any Entity type. */
  readonly body?: string;
  readonly journalDate?: string;
  readonly metadata?: PkmMetadataPatch;
  readonly topicNames?: readonly string[];
}

export interface PermanentlyDeleteEntityRequest {
  readonly entityId: string;
  readonly expectedFileHash: PkmFileHash;
}

export interface SaveEntityDocumentRequest {
  readonly entityId: string;
  readonly content: string;
  readonly expectedFileHash: PkmFileHash;
}

export interface PkmMetadataPatch {
  readonly authors?: readonly string[] | null;
  readonly relatedEntityIds?: readonly string[] | null;
  readonly description?: string | null;
  readonly displayName?: string | null;
  readonly status?: Status;
  readonly priority?: Priority | null;
  readonly excludeFromAi?: boolean;
  readonly areaId?: AreaId | null;
  readonly projectId?: ProjectId | null;
  readonly topics?: readonly TopicId[] | null;
  readonly entryContexts?: EntryContexts | null;
  readonly resourceType?: ResourceType | null;
  readonly canonicalIdentifier?: string | null;
  readonly sourceUri?: string | null;
  readonly assetPath?: string | null;
  readonly journalDate?: string | null;
  readonly dueAt?: string | null;
  readonly occurredAt?: string | null;
  readonly deletedAt?: string | null;
}

// HTTP representations carry Markdown once and never contain server drafts.
export type RemoteEntityDocument = Pick<
  PkmEntityDocument,
  "content" | "fileHash"
> & {
  readonly entity: Omit<PkmEntitySummary, "body">;
};
export interface RemoteEntityPage {
  readonly items: readonly (Omit<PkmEntitySummary, "body"> & {
    readonly preview?: string;
  })[];
  readonly included: readonly Omit<PkmEntitySummary, "body">[];
  readonly nextCursor: string | null;
}

export interface SaveEntityDraftRequest {
  readonly entityId: string;
  readonly content: string;
  readonly baseHash: PkmFileHash;
}

export interface SaveSyncthingConflictDraftRequest {
  readonly conflictPath: string;
  readonly canonicalHash: PkmFileHash | null;
  readonly conflictHash: PkmFileHash;
  readonly content: string;
}

export interface ResolveSyncthingConflictRequest {
  readonly conflictPath: string;
  readonly resolution: "keep-canonical" | "keep-conflict" | "manual";
  readonly expectedCanonicalHash: PkmFileHash | null;
  readonly expectedConflictHash: PkmFileHash;
  readonly content?: string;
}

export interface ResolveEntityConflictRequest {
  readonly content?: string;
  readonly entityId: string;
  readonly resolution: "keep-external" | "keep-draft";
  readonly expectedExternalHash: PkmFileHash | null;
}

export interface PkmAsset {
  readonly path: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
}

export interface PkmAssetUpload {
  readonly fileName: string;
  readonly dataBase64: string;
}

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

export type EntitySort =
  | "workflow"
  | "resourceType"
  | "name"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "dueAt"
  | "status"
  | "priority"
  | "project"
  | "area"
  | "topics"
  | "origin"
  | "authors"
  | "canonicalIdentifier"
  | "sourceUri"
  | "description";
export interface EntityDateRange {
  readonly from?: string;
  readonly to?: string;
}
export interface EntityPageQuery {
  /** Inclusive from, exclusive to; datetimes require an explicit timezone. */
  readonly createdAt?: EntityDateRange;
  readonly updatedAt?: EntityDateRange;
  readonly occurredAt?: EntityDateRange;
  readonly dueAt?: EntityDateRange;
  readonly journalDateRange?: EntityDateRange;
  readonly type?: EntityType;
  readonly types?: readonly EntityType[];
  readonly q?: string;
  readonly nameOnly?: boolean;
  readonly nameKeys?: readonly string[];
  readonly ids?: readonly string[];
  readonly deleted?: "only";
  readonly journalDate?: string;
  readonly todosOnly?: boolean;
  readonly activeOnly?: boolean;
  readonly resourceType?: ResourceType;
  readonly status?: string;
  readonly priority?: string;
  readonly origin?: string;
  readonly areaId?: string;
  readonly projectId?: string;
  readonly topicIds?: readonly string[];
  readonly scopeType?: "area" | "project" | "task" | "resource";
  readonly scopeId?: string;
  readonly relatedTo?: string;
  readonly entryRelationMode?: EntryRelationMode;
  readonly relatedResolution?: "direct" | "transitive";
  readonly deadline?:
    "overdue" | "today" | "next7days" | "scheduled" | "unscheduled";
  readonly dueDate?: string;
  readonly view?: "timeline";
  readonly sort?: EntitySort;
  readonly direction?: "asc" | "desc";
  readonly limit?: number;
  readonly cursor?: string;
}
export interface EntityPage {
  readonly items: readonly PkmEntitySummary[];
  readonly included?: readonly PkmEntitySummary[];
  readonly nextCursor: string | null;
}
export interface EntityCounts {
  readonly types: Readonly<Record<EntityType, number>>;
  readonly deleted: number;
}
export interface CalendarCount {
  readonly date: string;
  readonly entries: number;
  readonly tasks: number;
}

export interface BacklinkGroup {
  readonly sourceId: string;
  readonly sourceType: string;
  readonly sourceDisplayName: string | null;
  readonly kinds: readonly string[];
  readonly labels: readonly string[];
  readonly count: number;
}
export interface BacklinkPage {
  readonly items: readonly BacklinkGroup[];
  readonly nextCursor: string | null;
}
export interface BacklinkPageQuery {
  readonly limit?: number;
  readonly cursor?: string;
}
