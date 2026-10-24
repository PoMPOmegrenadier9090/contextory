import { describe, expect, it } from "vitest";

import {
  parseCreateAssetRequest,
  parseCreateEntityRequest,
  parseResolveEntityConflictRequest,
  parseResolveSyncthingConflictRequest,
  parseSaveSyncthingConflictDraftRequest,
  parseSaveDraftRequest,
  parseSaveEntityRequest,
  parsePermanentlyDeleteEntityRequest,
  requireRequestString,
} from "./request-validation.js";

const HASH = `sha256:${"a".repeat(64)}`;

describe("application request validation", () => {
  it("requires an ID and exact hash for permanent deletion without accepting a file path", () => {
    expect(
      parsePermanentlyDeleteEntityRequest({
        entityId: "entry",
        expectedFileHash: HASH,
        path: "../outside",
      }),
    ).toEqual({ entityId: "entry", expectedFileHash: HASH });
    expect(() =>
      parsePermanentlyDeleteEntityRequest({ entityId: "entry" }),
    ).toThrow();
    expect(() =>
      parsePermanentlyDeleteEntityRequest({
        entityId: "",
        expectedFileHash: HASH,
      }),
    ).toThrow();
  });

  it("accepts asset bytes but never a renderer-supplied Vault path", () => {
    expect(
      parseCreateAssetRequest({
        fileName: "photo.png",
        dataBase64: "dGVzdA==",
        path: "../../outside",
      }),
    ).toEqual({ fileName: "photo.png", dataBase64: "dGVzdA==" });
    expect(() => parseCreateAssetRequest({ fileName: "photo.png" })).toThrow();
  });

  it("accepts the narrow serializable save contracts", () => {
    expect(
      parseCreateEntityRequest({
        type: "entry",
        displayName: "新規Entry",
        path: "/must/not/be/forwarded",
      }),
    ).toEqual({ type: "entry", displayName: "新規Entry" });
    expect(
      parseCreateEntityRequest({
        type: "entry",
        displayName: null,
        body: "- [ ] 買い物\n",
      }),
    ).toEqual({ type: "entry", displayName: null, body: "- [ ] 買い物\n" });
    expect(
      parseCreateEntityRequest({
        type: "entry",
        displayName: null,
        journalDate: "2026-09-20",
      }),
    ).toEqual({ type: "entry", displayName: null, journalDate: "2026-09-20" });
    expect(() =>
      parseCreateEntityRequest({
        type: "entry",
        displayName: null,
        journalDate: "2026-02-30",
      }),
    ).toThrow("Invalid journal date");
    expect(
      parseCreateEntityRequest({
        type: "resource",
        displayName: "資料",
        body: "# 全般メモ\n",
      }),
    ).toEqual({ type: "resource", displayName: "資料", body: "# 全般メモ\n" });
    expect(() =>
      parseCreateEntityRequest({
        type: "resource",
        displayName: "資料",
        body: 1,
      }),
    ).toThrow();
    expect(
      parseCreateEntityRequest({
        type: "project",
        displayName: "Project",
        body: "本文",
      }),
    ).toEqual({ type: "project", displayName: "Project", body: "本文" });
    expect(
      parseResolveEntityConflictRequest({
        entityId: "ent_example",
        resolution: "keep-draft",
        expectedExternalHash: HASH,
        path: "/must/not/be/forwarded",
      }),
    ).toEqual({
      entityId: "ent_example",
      resolution: "keep-draft",
      expectedExternalHash: HASH,
    });
    expect(
      parseResolveSyncthingConflictRequest({
        conflictPath: "entries/entity.sync-conflict-example.md",
        resolution: "manual",
        expectedCanonicalHash: HASH,
        expectedConflictHash: HASH,
        content: "merged",
        canonicalPath: "/must/not/be/forwarded",
      }),
    ).toEqual({
      conflictPath: "entries/entity.sync-conflict-example.md",
      resolution: "manual",
      expectedCanonicalHash: HASH,
      expectedConflictHash: HASH,
      content: "merged",
    });
    expect(
      parseSaveSyncthingConflictDraftRequest({
        conflictPath: "entries/entity.sync-conflict-example.md",
        canonicalHash: HASH,
        conflictHash: HASH,
        content: "merge draft",
        canonicalPath: "/must/not/be/forwarded",
      }),
    ).toEqual({
      conflictPath: "entries/entity.sync-conflict-example.md",
      canonicalHash: HASH,
      conflictHash: HASH,
      content: "merge draft",
    });
    expect(
      parseSaveEntityRequest({
        entityId: "ent_example",
        content: "---\n---\n",
        expectedFileHash: HASH,
        path: "/must/not/be/forwarded",
      }),
    ).toEqual({
      entityId: "ent_example",
      content: "---\n---\n",
      expectedFileHash: HASH,
    });
    expect(
      parseSaveDraftRequest({
        entityId: "ent_example",
        content: "draft",
        baseHash: HASH,
      }),
    ).toMatchObject({ baseHash: HASH });
  });

  it("rejects malformed channel arguments", () => {
    expect(() => requireRequestString(null, "entityId")).toThrow(
      "entityId must be a non-empty string",
    );
    expect(() =>
      parseSaveEntityRequest({
        entityId: "ent_example",
        content: "content",
        expectedFileHash: "not-a-hash",
      }),
    ).toThrow("must be a SHA-256 hash");
    expect(() => parseSaveDraftRequest([])).toThrow(
      "Request body must be an object",
    );
    expect(() =>
      parseCreateEntityRequest({ type: "unknown", displayName: "名前" }),
    ).toThrow("supported Entity type");
    expect(() =>
      parseResolveEntityConflictRequest({
        entityId: "ent_example",
        resolution: "merge",
        expectedExternalHash: null,
      }),
    ).toThrow("resolution must be");
    expect(() =>
      parseResolveSyncthingConflictRequest({
        conflictPath: "entries/conflict.md",
        resolution: "automatic",
        expectedCanonicalHash: HASH,
        expectedConflictHash: HASH,
      }),
    ).toThrow("resolution must be");
    expect(() =>
      parseSaveSyncthingConflictDraftRequest({
        conflictPath: "entries/conflict.md",
        canonicalHash: null,
        conflictHash: HASH,
        content: 42,
      }),
    ).toThrow("content must be a string");
  });
});

describe("transport-independent constraints", () => {
  it("retains an empty draft", () => {
    expect(
      parseSaveDraftRequest({ entityId: "entry", content: "", baseHash: HASH }),
    ).toEqual({ entityId: "entry", content: "", baseHash: HASH });
  });

  it("rejects Entry-only fields on other types", () => {
    expect(() =>
      parseCreateEntityRequest({
        type: "project",
        displayName: "project",
        journalDate: "2026-10-03",
      }),
    ).toThrow("Only Entry");
  });

  it("requires content for a manual merge before invoking storage", () => {
    expect(() =>
      parseResolveSyncthingConflictRequest({
        conflictPath: "entries/conflict.md",
        resolution: "manual",
        expectedCanonicalHash: null,
        expectedConflictHash: HASH,
      }),
    ).toThrow("requires content");
  });
});
