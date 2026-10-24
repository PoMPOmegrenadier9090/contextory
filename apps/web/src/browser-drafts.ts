import type {
  PkmClient,
  PkmRemoteClient,
  PkmDraft,
  PkmEntityDocument,
  PkmSyncthingConflictDocument,
  PkmSyncthingConflictDraft,
} from "@pkm/contracts";

type DraftStorage = Pick<Storage, "getItem" | "setItem">;
type Draft = PkmDraft | PkmSyncthingConflictDraft;
const isHash = (value: unknown): boolean =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isCommonDraft = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  typeof value.content === "string" &&
  typeof value.updatedAt === "string" &&
  Number.isFinite(Date.parse(value.updatedAt));

// Drafts are user data: no TTL, eviction or page-cache invalidation applies.
// Synchronous writes also let pagehide/unload flush the last pending edit.
export class BrowserDraftStore {
  constructor(
    private readonly vaultId: string,
    private readonly storage: () => DraftStorage = () => window.localStorage,
  ) {}
  private key(kind: "entity" | "conflict", id: string): string {
    return `pkm:web:drafts:v1:${encodeURIComponent(this.vaultId)}:${kind}:${encodeURIComponent(id)}`;
  }
  private read(
    kind: "entity" | "conflict",
    id: string,
  ): Draft | null | undefined {
    try {
      const raw = this.storage().getItem(this.key(kind, id));
      if (raw === null) return undefined;
      const record: unknown = JSON.parse(raw);
      if (!isRecord(record) || record.version !== 1) throw new Error("format");
      if (record.draft === null) return null;
      const draft = record.draft;
      if (!isCommonDraft(draft)) throw new Error("format");
      if (kind === "entity") {
        if (
          draft.entityId !== id ||
          typeof draft.filePath !== "string" ||
          !(draft.baseHash === null || isHash(draft.baseHash))
        )
          throw new Error("format");
        return draft as unknown as PkmDraft;
      }
      if (
        draft.conflictPath !== id ||
        !(draft.canonicalHash === null || isHash(draft.canonicalHash)) ||
        !isHash(draft.conflictHash)
      )
        throw new Error("format");
      return draft as unknown as PkmSyncthingConflictDraft;
    } catch {
      throw new Error(
        "ブラウザー内の下書きを読み取れません。保存領域と下書きデータを確認してください。",
      );
    }
  }
  private write(
    kind: "entity" | "conflict",
    id: string,
    draft: Draft | null,
  ): void {
    try {
      // A tombstone prevents importing a discarded server draft again.
      this.storage().setItem(
        this.key(kind, id),
        JSON.stringify({ version: 1, draft }),
      );
    } catch {
      throw new Error(
        "このブラウザーに下書きを保存できません。保存領域の空き容量・設定を確認してください。編集内容は画面に残っています。",
      );
    }
  }
  entity(id: string): PkmDraft | null | undefined {
    return this.read("entity", id) as PkmDraft | null | undefined;
  }
  saveEntity(draft: PkmDraft): void {
    this.write("entity", draft.entityId, draft);
  }
  discardEntity(id: string): void {
    this.write("entity", id, null);
  }
  conflict(path: string): PkmSyncthingConflictDraft | null | undefined {
    return this.read("conflict", path) as
      PkmSyncthingConflictDraft | null | undefined;
  }
  saveConflict(draft: PkmSyncthingConflictDraft): void {
    this.write("conflict", draft.conflictPath, draft);
  }
  discardConflict(path: string): void {
    this.write("conflict", path, null);
  }
}

const localWrite = (write: () => void): Promise<void> => {
  try {
    write();
    return Promise.resolve();
  } catch (reason) {
    return Promise.reject(
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  }
};

export const withBrowserDrafts = (
  remote: PkmRemoteClient,
  storage: () => DraftStorage = () => window.localStorage,
): PkmClient &
  Pick<
    PkmRemoteClient,
    "bootstrap" | "queryOptions" | "patchMetadata" | "patchBody"
  > => {
  let store: BrowserDraftStore | null = null;
  let vaultId: string | null = null;
  const paths = new Map<string, string>();
  const health = async () => {
    const next = await remote.health();
    if (next.vaultId !== vaultId) {
      vaultId = next.vaultId;
      store = new BrowserDraftStore(vaultId, storage);
      paths.clear();
    }
    return next;
  };
  const currentStore = (): BrowserDraftStore => {
    if (store === null) throw new Error("Vaultの接続確認が完了していません。");
    return store;
  };
  const readyStore = async () => {
    if (store === null) await health();
    return currentStore();
  };
  const localEntity = (
    document: PkmEntityDocument,
    drafts: BrowserDraftStore,
  ): PkmEntityDocument => {
    paths.set(document.entity.id, document.entity.path);
    let draft = drafts.entity(document.entity.id);
    draft ??= null;
    return {
      ...document,
      draft,
      hasExternalChange: draft !== null && draft.baseHash !== document.fileHash,
    };
  };
  const localConflict = (
    document: PkmSyncthingConflictDocument,
    drafts: BrowserDraftStore,
  ) => {
    const draft = drafts.conflict(document.conflict.path);
    return { ...document, draft: draft ?? null };
  };
  const writeEntity = (
    request: Parameters<PkmClient["saveDraft"]>[0],
    drafts: BrowserDraftStore,
  ) => {
    const previous = drafts.entity(request.entityId);
    const draft: PkmDraft = {
      ...request,
      filePath:
        paths.get(request.entityId) ?? previous?.filePath ?? request.entityId,
      baseHash:
        previous === null || previous === undefined
          ? request.baseHash
          : previous.baseHash,
      updatedAt: new Date().toISOString(),
    };
    drafts.saveEntity(draft);
    return draft;
  };
  return {
    ...remote,
    health,
    bootstrap: async (signal) => {
      const result = await remote.bootstrap(signal);
      vaultId = result.health.vaultId;
      store = new BrowserDraftStore(vaultId, storage);
      return result;
    },
    patchBody: async (id, body, hash) => {
      const drafts = await readyStore();
      if (drafts.entity(id))
        throw new Error(
          "このEntityには未保存の下書きがあります。保存または破棄してください。",
        );
      return remote.patchBody(id, body, hash);
    },
    patchMetadata: async (id, patch, hash) => {
      const drafts = await readyStore();
      if (drafts.entity(id))
        throw new Error(
          "このEntityには未保存の下書きがあります。保存または破棄してください。",
        );
      return remote.patchMetadata(id, patch, hash);
    },
    loadEntity: async (id, signal) => {
      const drafts = await readyStore();
      return localEntity(await remote.loadEntity(id, signal), drafts);
    },
    // Execute the write before returning a Promise, including during unload.
    saveDraft: (request) =>
      localWrite(() => {
        writeEntity(request, currentStore());
      }),
    discardDraft: (id) => localWrite(() => currentStore().discardEntity(id)),
    permanentlyDeleteEntity: async (request) => {
      const drafts = await readyStore();
      await remote.permanentlyDeleteEntity(request);
      drafts.discardEntity(request.entityId);
    },
    saveEntity: async (request) => {
      const drafts = await readyStore();
      const submitted = writeEntity(
        { ...request, baseHash: request.expectedFileHash },
        drafts,
      );
      const result = await remote.saveEntity({
        ...request,
        expectedFileHash: submitted.baseHash ?? request.expectedFileHash,
      });
      if (result.ok) {
        const current = drafts.entity(request.entityId);
        if (JSON.stringify(current) === JSON.stringify(submitted))
          drafts.discardEntity(request.entityId);
        else if (current && current.baseHash === submitted.baseHash)
          drafts.saveEntity({ ...current, baseHash: result.snapshot.hash });
      }
      return result;
    },
    resolveConflict: async (request) => {
      const drafts = await readyStore();
      const submitted = drafts.entity(request.entityId);
      if (!submitted) throw new Error("ブラウザー内の下書きが見つかりません。");
      const result = await remote.resolveConflict({
        ...request,
        content: submitted.content,
      });
      if (
        result.ok &&
        JSON.stringify(drafts.entity(request.entityId)) ===
          JSON.stringify(submitted)
      )
        drafts.discardEntity(request.entityId);
      return result.ok && result.document !== null
        ? { ...result, document: localEntity(result.document, drafts) }
        : result;
    },
    toggleTodo: async (request) => {
      const drafts = await readyStore();
      if (drafts.entity(request.entryId))
        throw new Error(
          "このEntryにはブラウザー内の未保存の下書きがあります。詳細画面で保存または破棄してください。",
        );
      return remote.toggleTodo(request);
    },
    loadSyncthingConflict: async (path) => {
      const drafts = await readyStore();
      return localConflict(await remote.loadSyncthingConflict(path), drafts);
    },
    saveSyncthingConflictDraft: (request) =>
      localWrite(() => {
        currentStore().saveConflict({
          ...request,
          updatedAt: new Date().toISOString(),
        });
      }),
    discardSyncthingConflictDraft: (path) =>
      localWrite(() => currentStore().discardConflict(path)),
    resolveSyncthingConflict: async (request) => {
      const drafts = await readyStore();
      const submitted = drafts.conflict(request.conflictPath);
      const result = await remote.resolveSyncthingConflict(request);
      if (
        result.ok &&
        JSON.stringify(drafts.conflict(request.conflictPath)) ===
          JSON.stringify(submitted)
      )
        drafts.discardConflict(request.conflictPath);
      return !result.ok && result.current !== null
        ? { ...result, current: localConflict(result.current, drafts) }
        : result;
    },
  };
};
