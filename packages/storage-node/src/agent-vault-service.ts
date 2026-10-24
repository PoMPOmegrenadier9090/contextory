import {
  randomBytes,
  randomUUID,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import type { EntityPageQuery, EntityType, PkmFileHash } from "@pkm/contracts";
import { ENTITY_ID_PREFIXES } from "@pkm/contracts";
import {
  agentCommandSchema,
  agentAssetUploadSchema,
  agentQuerySchema,
  collectEntityReferences,
  createEntityId,
  entityIdSchema,
  entitySchema,
  parseMetadataPatch,
  extractDirectReferences,
  getEntityDisplayName,
  parseMarkdownEntity,
  serializeMarkdownEntity,
  serializeNewMarkdownEntity,
  todayJournalDate,
  updateEntityMetadata,
} from "@pkm/core";
import type { AgentCommand, ParsedMarkdownEntity } from "@pkm/core";
import type { LocalVaultService } from "./local-vault-service.js";
import { hashFileContent } from "./vault-file.js";
import { prepareVaultAsset } from "./vault-asset.js";
import {
  type AgentOperationStore,
  operationDigest,
} from "./agent-operation-store.js";

export class AgentVaultError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const fail = (code: string): never => {
  throw new AgentVaultError(code);
};
const typeOf = (id: string): EntityType => {
  if (!entityIdSchema.safeParse(id).success) return fail("INVALID_ARGUMENT");
  return Object.entries(ENTITY_ID_PREFIXES).find(([, prefix]) =>
    id.startsWith(`${prefix}_`),
  )![0] as EntityType;
};
const unavailable = new Set(["NOT_FOUND", "ENTITY_CONFLICT"]);
const creationTypes = {
  create_entry: "entry",
  create_task: "task",
  create_project: "project",
  create_resource: "resource",
  create_topic: "topic",
  create_area: "area",
} as const;
type CreateCommand = Extract<
  AgentCommand,
  { kind: keyof typeof creationTypes }
>;
const isCreateCommand = (command: AgentCommand): command is CreateCommand =>
  command.kind in creationTypes;
export interface AgentSnapshot {
  parsed: ParsedMarkdownEntity;
  fileHash: PkmFileHash;
}
export interface AgentEntityDto {
  id: string;
  type: EntityType;
  title: string;
  fileHash: PkmFileHash;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}
export class AgentVaultService {
  private readonly cursorKey = randomBytes(32);
  private encodeCursor(cursor: string | null): string | null {
    if (cursor === null) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.cursorKey, iv);
    const content = Buffer.concat([
      cipher.update(cursor, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), content]).toString(
      "base64url",
    );
  }
  private decodeCursor(cursor: string): string {
    try {
      const data = Buffer.from(cursor, "base64url");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.cursorKey,
        data.subarray(0, 12),
      );
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return fail("INVALID_ARGUMENT");
    }
  }
  constructor(
    readonly vault: LocalVaultService,
    readonly operations?: AgentOperationStore,
  ) {}

  async read(
    id: string,
    seen = new Set<string>(),
    budget = { remaining: 128 },
  ): Promise<AgentSnapshot> {
    const type = typeOf(id);
    if (seen.has(id) || --budget.remaining < 0 || seen.size >= 16)
      return fail("NOT_FOUND");
    const snapshot = await this.vault.readAgentFile(id, type);
    if (!snapshot) return fail("NOT_FOUND");
    const parsed = parseMarkdownEntity(snapshot.content);
    if (
      !parsed.ok ||
      parsed.value.entity.id !== id ||
      parsed.value.entity.type !== type
    )
      return fail("NOT_FOUND");
    const entity = parsed.value.entity;
    if (
      entity.deleted_at != null ||
      (entity.type === "entry" && entity.exclude_from_ai)
    )
      return fail("NOT_FOUND");
    // Uncurated derived notes inherit source visibility, including transitive sources.
    if (
      entity.type === "entry" &&
      entity.origin === "ai" &&
      !entity.curated_at
    ) {
      for (const sourceId of entity.source_entity_ids ?? []) {
        try {
          await this.read(sourceId, new Set([...seen, id]), budget);
        } catch (error) {
          if (error instanceof AgentVaultError && unavailable.has(error.code))
            return fail("NOT_FOUND");
          throw error;
        }
      }
    }
    if (await this.vault.hasAgentConflict(id, type))
      return fail("ENTITY_CONFLICT");
    return { parsed: parsed.value, fileHash: snapshot.hash };
  }
  async visible(id: string): Promise<boolean> {
    try {
      await this.read(id);
      return true;
    } catch (error) {
      if (error instanceof AgentVaultError && unavailable.has(error.code))
        return false;
      throw error;
    }
  }
  async dto(snapshot: AgentSnapshot): Promise<AgentEntityDto> {
    const entity = snapshot.parsed.entity;
    const metadata: Record<string, unknown> = {};
    const fields = [
      "description",
      "origin",
      "status",
      "priority",
      "journal_date",
      "occurred_at",
      "due_at",
      "completed_at",
      "generated_at",
      "curated_at",
      "authors",
      "resource_type",
      "canonical_identifier",
      "source_uri",
    ];
    for (const key of fields)
      if (entity[key] !== undefined) metadata[key] = entity[key];
    for (const key of ["topics", "source_entity_ids", "related_entity_ids"]) {
      const values = entity[key];
      if (Array.isArray(values))
        metadata[key] = (
          await Promise.all(
            values.map(async (id: unknown) =>
              typeof id === "string" && (await this.visible(id)) ? id : null,
            ),
          )
        ).filter((id) => id !== null);
    }
    for (const key of ["area_id", "project_id"])
      if (typeof entity[key] === "string" && (await this.visible(entity[key])))
        metadata[key] = entity[key];
    if (entity.type === "entry" && entity.contexts) {
      metadata.contexts = Object.fromEntries(
        await Promise.all(
          Object.entries(entity.contexts).map(
            async ([key, id]) =>
              [
                key,
                typeof id === "string" && (await this.visible(id)) ? id : null,
              ] as const,
          ),
        ),
      );
    }
    return {
      id: entity.id,
      type: entity.type,
      title: getEntityDisplayName(entity) ?? "Untitled",
      fileHash: snapshot.fileHash,
      createdAt: entity.created_at,
      updatedAt: entity.updated_at,
      metadata,
    };
  }
  async search(input: unknown = {}) {
    const query = agentQuerySchema.parse(input);
    for (const id of [
      query.projectId,
      query.areaId,
      query.scopeId,
      query.relatedTo,
      ...(query.topicIds ?? []),
    ])
      if (id) await this.read(id);
    const page = this.vault.queryEntities(
      {
        ...query,
        ...(query.cursor ? { cursor: this.decodeCursor(query.cursor) } : {}),
      } as EntityPageQuery,
      { forAi: true },
    );
    const items: (AgentEntityDto & { snippet: string })[] = [];
    for (const candidate of page.items) {
      try {
        const current = await this.read(candidate.id);
        // Never return a match based on stale, potentially hidden index content.
        if (current.fileHash !== candidate.fileHash) continue;
        items.push({
          ...(await this.dto(current)),
          snippet: current.parsed.body.slice(0, 400),
        });
      } catch (error) {
        if (!(error instanceof AgentVaultError && unavailable.has(error.code)))
          throw error;
      }
    }
    return { items, nextCursor: this.encodeCursor(page.nextCursor) };
  }
  async backlinks(id: string, cursor?: string) {
    await this.read(id);
    const page = this.vault.queryBacklinks(
      id,
      { limit: 20, ...(cursor ? { cursor: this.decodeCursor(cursor) } : {}) },
      { forAi: true },
    );
    const items: {
      entity: AgentEntityDto;
      kinds: readonly string[];
      count: number;
    }[] = [];
    for (const item of page.items) {
      try {
        const snapshot = await this.read(item.sourceId);
        const indexed = this.vault.entitySummary(item.sourceId);
        if (snapshot.fileHash !== indexed.fileHash) continue;
        items.push({
          entity: await this.dto(snapshot),
          kinds: item.kinds,
          count: item.count,
        });
      } catch (error) {
        if (!(error instanceof AgentVaultError && unavailable.has(error.code)))
          throw error;
      }
    }
    return { items, nextCursor: this.encodeCursor(page.nextCursor) };
  }
  private async checkReferences(
    parsed: ParsedMarkdownEntity,
    command: AgentCommand,
  ): Promise<void> {
    const assetPath =
      command.kind === "create_resource"
        ? command.assetPath
        : command.kind === "update_resource"
          ? command.patch.assetPath
          : undefined;
    if (assetPath) {
      try {
        await this.vault.readAsset(assetPath);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return fail("ASSET_NOT_FOUND");
        throw error;
      }
    }
    const ids = [
      ...new Set([
        ...collectEntityReferences(parsed.entity).map(
          (reference) => reference.targetId,
        ),
        ...extractDirectReferences(parsed.body).map(
          (reference) => reference.targetId,
        ),
      ]),
    ];
    if (ids.length > 100) return fail("TOO_MANY_REFERENCES");
    for (const id of ids) if (id !== parsed.entity.id) await this.read(id);
    if (Buffer.byteLength(parsed.body) > 256 * 1024)
      return fail("DOCUMENT_TOO_LARGE");
  }
  private async prepare(
    command: AgentCommand,
    id: string,
    timestamp: string,
  ): Promise<{ content: string; beforeHash: PkmFileHash | null }> {
    if (isCreateCommand(command)) {
      const type = creationTypes[command.kind];
      const entity = entitySchema.parse(
        command.kind === "create_entry"
          ? {
              id,
              type: "entry",
              title: command.displayName,
              origin: "ai",
              exclude_from_ai: false,
              created_at: timestamp,
              updated_at: timestamp,
              generated_at: timestamp,
              journal_date:
                command.journalDate ?? todayJournalDate(new Date(timestamp)),
              contexts: command.contexts,
              topics: command.topics,
              source_entity_ids: command.sourceEntityIds,
            }
          : {
              id,
              type,
              ...(type === "topic" || type === "area"
                ? { name: command.displayName }
                : { title: command.displayName }),
              ...(type === "project" || type === "task"
                ? { status: "not_started" }
                : {}),
              created_at: timestamp,
              updated_at: timestamp,
              ...("topics" in command ? { topics: command.topics } : {}),
            },
      );
      let content = serializeNewMarkdownEntity(entity, {
        body: "body" in command ? (command.body ?? "") : "",
      });
      if (command.kind !== "create_entry") {
        const { kind: _kind, operationId: _op, ...fields } = command;
        const patch = Object.fromEntries(
          Object.entries(fields).filter(
            ([key]) => key !== "topics" && key !== "body",
          ),
        );
        void _kind;
        void _op;
        content = updateEntityMetadata(content, parseMetadataPatch(patch), {
          now: () => new Date(timestamp),
        }).content;
      }
      return { content, beforeHash: null };
    }
    const current = await this.read(id);
    if (current.fileHash !== command.expectedFileHash)
      return fail("HASH_CONFLICT");
    const entity = current.parsed.entity;
    let content: string;
    switch (command.kind) {
      case "update_entry":
      case "update_resource": {
        if (command.kind !== `update_${entity.type}`)
          return fail("INVALID_ARGUMENT");
        const { body, ...patch } = command.patch;
        content = updateEntityMetadata(
          current.parsed.source,
          parseMetadataPatch(patch),
        ).content;
        if (body !== undefined) {
          const parsed = parseMarkdownEntity(content);
          if (!parsed.ok) return fail("INVALID_ARGUMENT");
          content = serializeMarkdownEntity(parsed.value, { body });
        }
        break;
      }
      case "update_task":
      case "update_project":
      case "update_topic":
      case "update_area": {
        if (command.kind !== `update_${entity.type}`)
          return fail("INVALID_ARGUMENT");
        const { body, ...patch } = command.patch;
        content = updateEntityMetadata(
          current.parsed.source,
          parseMetadataPatch(patch),
          { now: () => new Date(timestamp) },
        ).content;
        if (body !== undefined) {
          const parsed = parseMarkdownEntity(content);
          if (!parsed.ok) return fail("INVALID_ARGUMENT");
          content = serializeMarkdownEntity(parsed.value, { body });
        }
        break;
      }
      case "update_topics": {
        if (
          entity.type === "topic" ||
          command.add.some((topic) => command.remove.includes(topic))
        )
          return fail("INVALID_ARGUMENT");
        const next = [
          ...new Set([
            ...((entity.topics as readonly string[] | null) ?? []).filter(
              (topic) => !command.remove.includes(topic),
            ),
            ...command.add,
          ]),
        ];
        content = updateEntityMetadata(
          current.parsed.source,
          parseMetadataPatch({ topics: next }),
        ).content;
        break;
      }
      case "set_entry_context":
        if (entity.type !== "entry") return fail("INVALID_ARGUMENT");
        content = updateEntityMetadata(
          current.parsed.source,
          parseMetadataPatch({ entryContexts: command.contexts }),
        ).content;
    }
    const parsed = parseMarkdownEntity(content);
    if (!parsed.ok) return fail("INVALID_ARGUMENT");
    return {
      content: serializeMarkdownEntity(parsed.value, {
        entity: { ...parsed.value.entity, updated_at: timestamp },
      }),
      beforeHash: current.fileHash,
    };
  }
  async validate(input: unknown) {
    const command = agentCommandSchema.parse(input);
    const id = isCreateCommand(command)
      ? createEntityId(creationTypes[command.kind])
      : command.entityId;
    const plan = await this.prepare(command, id, new Date().toISOString());
    const parsed = parseMarkdownEntity(plan.content);
    if (!parsed.ok) return fail("INVALID_ARGUMENT");
    await this.checkReferences(parsed.value, command);
    return {
      valid: true,
      kind: command.kind,
      entityType: parsed.value.entity.type,
    };
  }

  execute(input: unknown, principal: string) {
    const command = agentCommandSchema.parse(input);
    const store = this.operations;
    if (!store) return Promise.reject(new AgentVaultError("WRITE_DISABLED"));
    if (this.vault.accessMode !== "read-write")
      return Promise.reject(new AgentVaultError("READ_ONLY_SCHEMA"));
    const key = operationDigest([
      this.vault.vaultId,
      principal,
      command.operationId,
    ]);
    const digest = operationDigest(command);
    return store.run(async () => {
      const record = store.get(key);
      if (record && record.digest !== digest)
        return fail("OPERATION_ID_REUSED");
      if (record?.state === "failed")
        return fail(record.error ?? "OPERATION_RECOVERY_REQUIRED");
      if (record?.state === "completed") {
        await this.read(record.entityId);
        return {
          entityId: record.entityId,
          fileHash: record.afterHash,
          replayed: true,
        };
      }
      const id =
        record?.entityId ??
        (isCreateCommand(command)
          ? createEntityId(creationTypes[command.kind])
          : command.entityId);
      const timestamp = record?.timestamp ?? new Date().toISOString();
      if (record) {
        const actual = await this.vault.readAgentFile(id, typeOf(id));
        if (actual?.hash === record.afterHash) {
          await this.read(id);
          await this.vault.rescan();
          store.complete(key);
          return { entityId: id, fileHash: record.afterHash, replayed: true };
        }
        if ((actual?.hash ?? null) !== record.beforeHash)
          return fail("OPERATION_RECOVERY_REQUIRED");
      }
      const plan = await this.prepare(command, id, timestamp);
      const parsed = parseMarkdownEntity(plan.content);
      if (!parsed.ok) return fail("INVALID_ARGUMENT");
      await this.checkReferences(parsed.value, command);
      const afterHash = hashFileContent(plan.content);
      if (record && record.afterHash !== afterHash)
        return fail("OPERATION_RECOVERY_REQUIRED");
      if (!record)
        store.insert({
          key,
          digest,
          entityId: id,
          timestamp,
          beforeHash: plan.beforeHash,
          afterHash,
          state: "pending",
          error: null,
        });
      try {
        const fileHash = await this.vault.writeAgentEntity(
          id,
          plan.content,
          plan.beforeHash,
          async () => {
            if (plan.beforeHash !== null) await this.read(id);
            else if (await this.vault.hasAgentConflict(id, typeOf(id)))
              return fail("ENTITY_CONFLICT");
            await this.checkReferences(parsed.value, command);
          },
        );
        store.complete(key);
        return { entityId: id, fileHash, replayed: false };
      } catch (error) {
        const code =
          error instanceof AgentVaultError
            ? error.code
            : error instanceof Error &&
                ["HASH_CONFLICT", "LOCAL_DRAFT_PRESENT"].includes(error.message)
              ? error.message
              : null;
        // Unknown errors may occur after the write; keep pending for hash-based recovery.
        if (code) {
          store.fail(key, code);
          return fail(code);
        }
        throw error;
      }
    });
  }

  uploadAsset(input: unknown, principal: string) {
    const command = agentAssetUploadSchema.parse(input);
    const store = this.operations;
    if (!store) return Promise.reject(new AgentVaultError("WRITE_DISABLED"));
    if (this.vault.accessMode !== "read-write")
      return Promise.reject(new AgentVaultError("READ_ONLY_SCHEMA"));
    // Share the operation namespace with Entity writes, so IDs cannot cross tools.
    const key = operationDigest([
      this.vault.vaultId,
      principal,
      command.operationId,
    ]);
    const digest = operationDigest({ kind: "upload_asset", ...command });
    return store.run(async () => {
      const record = store.get(key);
      if (record && record.digest !== digest)
        return fail("OPERATION_ID_REUSED");
      const assetId = record
        ? record.entityId.split("/").at(-1)!.split(".")[0]!
        : randomUUID();
      const { asset, data } = prepareVaultAsset(command, assetId);
      const afterHash = createHash("sha256").update(data).digest("hex");
      if (record) {
        if (record.entityId !== asset.path || record.afterHash !== afterHash)
          return fail("OPERATION_RECOVERY_REQUIRED");
        try {
          const existing = await this.vault.readAsset(asset.path);
          if (
            createHash("sha256").update(existing.data).digest("hex") !==
            afterHash
          )
            return fail("OPERATION_RECOVERY_REQUIRED");
          store.complete(key);
          return { ...asset, replayed: true };
        } catch (error) {
          // A pending intent with no file is safe to resume; never overwrite changed data.
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ))
            throw error;
          if (record.state !== "pending")
            return fail("OPERATION_RECOVERY_REQUIRED");
        }
      } else {
        store.insert({
          key,
          digest,
          entityId: asset.path,
          timestamp: new Date().toISOString(),
          beforeHash: null,
          afterHash,
          state: "pending",
          error: null,
        });
      }
      await this.vault.createAsset(command, assetId);
      store.complete(key);
      return { ...asset, replayed: false };
    });
  }
}
