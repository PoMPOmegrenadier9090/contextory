import type {
  PkmSaveSuccess,
  PkmSaveConflict as WriteVaultFileConflict,
} from "@pkm/contracts";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import writeFileAtomic from "write-file-atomic";
import {
  entitySchema,
  parseMarkdownEntity,
  serializeMarkdownEntity,
} from "@pkm/core";

import type { DraftRecord } from "./local-state.js";
import {
  assertVaultWritePathSafe,
  readVaultFile,
  readVaultFileIfExists,
  resolveVaultPath,
  type FileHash,
  type VaultFileSnapshot,
} from "./vault-file.js";

export interface WriteVaultFileRequest {
  readonly path: string;
  readonly content: string;
  readonly expectedFileHash: FileHash | null;
  readonly assertCanWrite?: () => void | Promise<void>;
}

export interface WriteVaultFileSuccess extends PkmSaveSuccess {
  readonly snapshot: VaultFileSnapshot;
}
export type { PkmSaveConflict as WriteVaultFileConflict } from "@pkm/contracts";

export type WriteVaultFileResult =
  WriteVaultFileSuccess | WriteVaultFileConflict;

export interface SaveVaultFileRequest extends WriteVaultFileRequest {
  readonly entityId: string;
  readonly updatedAt: string;
}

export interface DraftStore {
  saveDraft(draft: DraftRecord): void;
  deleteDraft(entityId: string): void;
}

const writeVaultFileUnlocked = async (
  vaultRoot: string,
  request: WriteVaultFileRequest,
): Promise<WriteVaultFileResult> => {
  const absolutePath = resolveVaultPath(vaultRoot, request.path);
  await assertVaultWritePathSafe(vaultRoot, request.path);
  const actual = await readVaultFileIfExists(vaultRoot, request.path);
  if ((actual?.hash ?? null) !== request.expectedFileHash) {
    return {
      ok: false,
      reason: "hash-conflict",
      expectedFileHash: request.expectedFileHash,
      actual,
      draftContent: request.content,
    };
  }

  await mkdir(dirname(absolutePath), { recursive: true });
  await assertVaultWritePathSafe(vaultRoot, request.path);
  await request.assertCanWrite?.();
  await writeFileAtomic(absolutePath, request.content, { encoding: "utf8" });
  return {
    ok: true,
    snapshot: await readVaultFile(vaultRoot, request.path),
  };
};

// Serialize in-process writes so concurrent Todo/Entity saves cannot both
// pass the same hash check before either has written the next version.
const pendingWrites = new Map<string, Promise<void>>();
export const withVaultWriteLock = async <T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = pendingWrites.get(path) ?? Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  pendingWrites.set(path, pending);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (pendingWrites.get(path) === pending) pendingWrites.delete(path);
  }
};

export const writeVaultFile = (
  vaultRoot: string,
  request: WriteVaultFileRequest,
): Promise<WriteVaultFileResult> =>
  withVaultWriteLock(resolveVaultPath(vaultRoot, request.path), () =>
    writeVaultFileUnlocked(vaultRoot, request),
  );

const prepareEntityForSave = (
  content: string,
  entityId: string,
  updatedAt: string,
): string => {
  const parsed = parseMarkdownEntity(content);
  if (!parsed.ok) {
    throw new TypeError(
      `Cannot save invalid Entity Markdown: ${parsed.error.message}`,
    );
  }
  if (parsed.value.entity.id !== entityId) {
    throw new TypeError(
      `Cannot save Entity ${parsed.value.entity.id} as requested Entity ${entityId}`,
    );
  }
  const entity = entitySchema.safeParse({
    ...parsed.value.entity,
    updated_at: updatedAt,
  });
  if (!entity.success) {
    throw new Error(
      `Cannot save invalid updated_at: ${entity.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return serializeMarkdownEntity(parsed.value, { entity: entity.data });
};

export const saveVaultFileWithDraft = async (
  vaultRoot: string,
  request: SaveVaultFileRequest,
  drafts: DraftStore | null,
): Promise<WriteVaultFileResult> => {
  const content = prepareEntityForSave(
    request.content,
    request.entityId,
    request.updatedAt,
  );
  // Keep draft creation/cleanup in the same lock as the canonical write. A
  // successful earlier save must not delete a later save's conflict draft.
  return withVaultWriteLock(
    resolveVaultPath(vaultRoot, request.path),
    async () => {
      await request.assertCanWrite?.();
      drafts?.saveDraft({
        entityId: request.entityId,
        filePath: request.path,
        baseHash: request.expectedFileHash,
        content,
        updatedAt: request.updatedAt,
      });
      const result = await writeVaultFileUnlocked(vaultRoot, {
        ...request,
        content,
      });
      if (result.ok) drafts?.deleteDraft(request.entityId);
      return result;
    },
  );
};
