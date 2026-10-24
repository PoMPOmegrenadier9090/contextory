import { openMcpHost } from "@pkm/mcp";
import type { McpHostOptions } from "@pkm/mcp";
import { relative } from "node:path";
import type { EntityPageQuery, PkmVaultChangeEvent } from "@pkm/contracts";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip, brotliCompress, constants } from "node:zlib";
import type {
  PkmEntityDocument,
  PkmSyncthingConflictDocument,
  PkmEntitySummary,
  RemoteEntityDocument,
  RemoteEntityPage,
} from "@pkm/contracts";
import { parseMetadataPatch, requireFileHash } from "@pkm/core";
const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);
const metadata = (entity: PkmEntitySummary): Omit<PkmEntitySummary, "body"> => {
  const { body: _body, ...rest } = entity;
  void _body;
  return rest;
};
const remoteDocument = (document: PkmEntityDocument): RemoteEntityDocument => ({
  entity: metadata(document.entity),
  content: document.content,
  fileHash: document.fileHash,
});
const remoteConflict = (document: PkmSyncthingConflictDocument) => {
  const { draft: _draft, ...rest } = document;
  void _draft;
  return rest;
};
import { parseEntityPageQuery, parseBacklinkPageQuery } from "@pkm/core";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import {
  parseTodoQuery,
  parseToggleTodoRequest,
  requireRequestRecord as requireRecord,
  requireRequestString as requireString,
  parseCreateAssetRequest,
  parseCreateEntityRequest,
  parseOrphanAssetDeletion,
  parseResolveEntityConflictRequest,
  parseResolveSyncthingConflictRequest,
  parseSaveEntityRequest,
  parsePermanentlyDeleteEntityRequest,
} from "@pkm/core";
import {
  createLinkPreviewLoader,
  LocalVaultError,
  openLocalVault,
  type LocalVaultService,
  type OpenLocalVaultOptions,
} from "@pkm/storage-node";

const entityIdParam = (params: unknown): string =>
  requireString(requireRecord(params).entityId, "entityId");

const registerRoutes = (
  app: FastifyInstance,
  service: LocalVaultService,
): void => {
  const linkPreview = createLinkPreviewLoader();
  app.get("/api/link-preview", (request) =>
    linkPreview(requireString(requireRecord(request.query).url, "url")),
  );
  const eventStreams = new Set<() => void>();
  const remotePage = (query: EntityPageQuery): RemoteEntityPage => {
    const page = service.queryEntities(query);
    const ids = [
      ...new Set(
        page.items
          .flatMap((e) => [
            e.areaId,
            e.projectId,
            e.taskId,
            e.resourceId,
            ...e.topicIds,
            ...(e.relatedEntityIds ?? []),
          ])
          .filter((id): id is string => id !== null),
      ),
    ];
    return {
      items: page.items.map((entity) => ({
        ...metadata(entity),
        ...(query.view === "timeline" ? { preview: entity.body } : {}),
      })),
      included: service.entityLabels(ids).map(metadata),
      nextCursor: page.nextCursor,
    };
  };
  const history: PkmVaultChangeEvent[] = [];
  const stopHistory = service.subscribeToChanges((event) => {
    history.push(event);
    if (history.length > 128) history.shift();
  });
  app.addHook("onClose", () => {
    stopHistory();
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (
      reply.statusCode >= 300 ||
      !String(reply.getHeader("content-type") ?? "").startsWith(
        "application/json",
      ) ||
      (typeof payload !== "string" && !Buffer.isBuffer(payload))
    )
      return payload;
    reply.header("vary", "Accept-Encoding");
    if (request.method === "GET") {
      const etag =
        'W/"' + createHash("sha256").update(payload).digest("hex") + '"';
      reply.header("etag", etag).header("cache-control", "private, no-cache");
      if (
        request.headers["if-none-match"]
          ?.split(",")
          .map((x) => x.trim().replace(/^W\//, ""))
          .includes(etag.replace(/^W\//, ""))
      ) {
        reply.code(304);
        reply.removeHeader("content-length");
        return "";
      }
    }
    if (Buffer.byteLength(payload) < 1024) return payload;
    reply.header("vary", "Accept-Encoding");
    const accepted = String(request.headers["accept-encoding"] ?? "")
      .split(",")
      .map((part) => {
        const [name, ...params] = part.trim().split(";");
        return {
          name,
          q: Number(
            params
              .find((x) => x.trim().startsWith("q="))
              ?.trim()
              .slice(2) ?? "1",
          ),
        };
      })
      .filter((x) => x.q > 0)
      .sort((a, b) => b.q - a.q);
    for (const { name } of accepted) {
      if (name === "br") {
        reply.header("content-encoding", "br");
        reply.removeHeader("content-length");
        return brotliAsync(payload, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
        });
      }
      if (name === "gzip" || name === "*") {
        reply.header("content-encoding", "gzip");
        reply.removeHeader("content-length");
        return gzipAsync(payload);
      }
    }
    return payload;
  });

  const health = () => ({
    status: "ok",
    vaultId: service.vaultId,
    accessMode: service.accessMode,
    cacheVersion: service.cacheVersion,
    sessionId: service.sessionId,
    revision: service.revision,
  });
  app.get("/health", health);
  app.get("/api/bootstrap", () => ({
    health: health(),
    counts: service.entityCounts(),
    conflictsCount: service.listSyncthingConflicts().length,
    page: remotePage({ type: "area" }),
  }));

  app.get("/api/events", (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const query = requireRecord(request.query);
    const since = Number(
      typeof request.headers["last-event-id"] === "string"
        ? request.headers["last-event-id"].split(":").at(-1)
        : (query.since ?? service.revision),
    );
    const session =
      typeof request.headers["last-event-id"] === "string"
        ? request.headers["last-event-id"].split(":")[0]
        : query.sessionId;
    const reset =
      session !== service.sessionId ||
      !Number.isSafeInteger(since) ||
      since > service.revision ||
      since < (history[0]?.revision ?? service.revision + 1) - 1;
    const ready = {
      sessionId: service.sessionId,
      revision: service.revision,
      reset,
    };
    reply.raw.write(`event: ready\ndata: ${JSON.stringify(ready)}\n\n`);
    if (!reset)
      for (const event of history.filter((e) => e.revision > since))
        reply.raw.write(
          `id: ${event.sessionId}:${event.revision}\nevent: vault-change\ndata: ${JSON.stringify(event)}\n\n`,
        );

    const unsubscribe = service.subscribeToChanges((event) => {
      if (!reply.raw.destroyed) {
        reply.raw.write(
          `id: ${event.sessionId}:${event.revision}\nevent: vault-change\ndata: ${JSON.stringify(event)}\n\n`,
        );
      }
    });
    const keepAlive = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(": keepalive\n\n");
    }, 15_000);
    keepAlive.unref();

    let closed = false;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(keepAlive);
      unsubscribe();
      eventStreams.delete(closeStream);
    };
    const closeStream = (): void => {
      cleanup();
      if (!reply.raw.destroyed) reply.raw.end();
    };
    eventStreams.add(closeStream);
    reply.raw.once("close", cleanup);
  });

  app.addHook("onClose", () => {
    for (const closeStream of [...eventStreams]) closeStream();
  });

  app.get("/api/entities", (request) =>
    remotePage(parseEntityPageQuery(request.query)),
  );
  app.get("/api/entity-options", (request) =>
    service
      .queryEntities({ ...parseEntityPageQuery(request.query), nameOnly: true })
      .items.map((e) => ({
        id: e.id,
        type: e.type,
        displayName: e.displayName?.slice(0, 160) ?? null,
      })),
  );
  app.get("/api/entity-counts", () => service.entityCounts());
  app.get("/api/calendar-counts", (request) => {
    const query = request.query as Record<string, unknown>;
    return service.calendarCounts(
      requireString(query.from, "from"),
      requireString(query.to, "to"),
    );
  });

  app.get("/api/quick-open", (request) => {
    const query = requireRecord(request.query).q;
    return service.quickOpen(
      typeof query === "string" ? query : requireString(query, "q"),
    );
  });

  app.get("/api/todos", (request) =>
    service.listTodos(parseTodoQuery(request.query)),
  );
  app.put("/api/todos/check", async (request) => {
    await service.toggleTodo(parseToggleTodoRequest(request.body));
    return { ok: true };
  });

  app.get("/api/entities/:entityId", async (request) =>
    remoteDocument(await service.loadEntity(entityIdParam(request.params))),
  );

  app.get("/api/entities/:entityId/backlinks", (request) =>
    service.queryBacklinks(
      entityIdParam(request.params),
      parseBacklinkPageQuery(request.query),
    ),
  );

  app.post(
    "/api/assets",
    { bodyLimit: 15 * 1024 * 1024 },
    async (request, reply) => {
      const asset = await service.createAsset(
        parseCreateAssetRequest(request.body),
      );
      return reply.code(201).send(asset);
    },
  );

  app.get("/api/assets/*", async (request, reply) => {
    const path = `assets/${requireString(requireRecord(request.params)["*"], "path")}`;
    const asset = await service.readAsset(path);
    const query = requireRecord(request.query);
    const download = query.download === "1";
    let fileName: string | undefined;
    if (download && query.fileName !== undefined) {
      fileName = requireString(query.fileName, "fileName")
        .replaceAll("\\", "/")
        .split("/")
        .at(-1);
      if (
        !fileName ||
        fileName.length > 255 ||
        [...fileName].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new TypeError("Invalid download file name");
    }
    reply.header("content-type", asset.mimeType);
    reply.header("x-content-type-options", "nosniff");
    reply.header(
      "content-disposition",
      !download && asset.mimeType.startsWith("image/")
        ? "inline"
        : fileName
          ? `attachment; filename*=UTF-8''${encodeURIComponent(fileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`
          : "attachment",
    );
    return reply.send(asset.data);
  });

  app.delete("/api/entities/:entityId", async (request) => {
    await service.permanentlyDeleteEntity(
      parsePermanentlyDeleteEntityRequest({
        ...requireRecord(request.body),
        entityId: entityIdParam(request.params),
      }),
    );
    return { ok: true };
  });

  app.get("/api/unresolved-references", () =>
    service.listUnresolvedReferences(),
  );

  app.get("/api/orphan-assets", () => service.listOrphanAssets());

  app.post("/api/orphan-assets/delete", async (request) => {
    const body = requireRecord(request.body);
    return service.deleteOrphanAssets(parseOrphanAssetDeletion(body.assets));
  });

  app.get("/api/conflicts", () => service.listSyncthingConflicts());

  app.get("/api/conflicts/detail", async (request) =>
    remoteConflict(
      await service.loadSyncthingConflict(
        requireString(requireRecord(request.query).path, "path"),
      ),
    ),
  );

  app.post("/api/conflicts/resolve", async (request, reply) => {
    const result = await service.resolveSyncthingConflict(
      parseResolveSyncthingConflictRequest(request.body),
    );
    return reply.code(result.ok ? 200 : 409).send(
      result.ok
        ? {
            ...result,
            document: result.document ? remoteDocument(result.document) : null,
          }
        : {
            ...result,
            current: result.current ? remoteConflict(result.current) : null,
          },
    );
  });

  app.post("/api/entities", async (request, reply) => {
    const document = await service.createEntity(
      parseCreateEntityRequest(request.body),
    );
    return reply.code(201).send(remoteDocument(document));
  });

  app.put("/api/entities/:entityId", async (request, reply) => {
    const result = await service.saveEntity(
      parseSaveEntityRequest({
        ...requireRecord(request.body),
        entityId: entityIdParam(request.params),
      }),
    );
    return reply.code(result.ok ? 200 : 409).send(
      result.ok
        ? {
            ...result,
            entity: metadata(
              service.entitySummary(entityIdParam(request.params)),
            ),
          }
        : result,
    );
  });
  app.patch("/api/entities/:entityId/metadata", async (request, reply) => {
    const body = requireRecord(request.body);
    const result = await service.patchMetadata(
      entityIdParam(request.params),
      parseMetadataPatch(body.patch),
      requireFileHash(body.expectedFileHash),
    );
    return reply
      .code(result.ok ? 200 : 409)
      .send(
        result.ok ? { ...result, entity: metadata(result.entity) } : result,
      );
  });

  app.patch("/api/entities/:entityId/body", async (request, reply) => {
    const body = requireRecord(request.body);
    if (typeof body.body !== "string")
      throw new TypeError("body must be a string");
    const result = await service.patchBody(
      entityIdParam(request.params),
      body.body,
      requireFileHash(body.expectedFileHash),
    );
    return reply
      .code(result.ok ? 200 : 409)
      .send(
        result.ok ? { ...result, entity: metadata(result.entity) } : result,
      );
  });

  app.post(
    "/api/entities/:entityId/resolve-conflict",
    async (request, reply) => {
      requireString(requireRecord(request.body).content, "content");
      const result = await service.resolveEntityConflict(
        parseResolveEntityConflictRequest({
          ...requireRecord(request.body),
          entityId: entityIdParam(request.params),
        }),
      );
      return reply.code(result.ok ? 200 : 409).send(
        result.ok
          ? {
              ...result,
              document: result.document
                ? remoteDocument(result.document)
                : null,
            }
          : result,
      );
    },
  );
};

const statusForError = (error: Error): number => {
  if (error instanceof TypeError) return 400;
  if ("code" in error && error.code === "ENOENT") return 404;
  if (error instanceof LocalVaultError) {
    return error.code === "ENTITY_NOT_FOUND" ||
      error.code === "CONFLICT_NOT_FOUND"
      ? 404
      : 409;
  }
  if (
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return error.statusCode;
  }
  return 500;
};

export interface BuildServerAppOptions {
  readonly logger?: boolean | FastifyBaseLogger;
}

export const buildServerApp = (
  service: LocalVaultService,
  options: BuildServerAppOptions = {},
): FastifyInstance => {
  const app = Fastify({ logger: options.logger ?? false });
  registerRoutes(app, service);
  app.setErrorHandler((error, _request, reply) => {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    const statusCode = statusForError(normalizedError);
    return reply.code(statusCode).send({
      error: normalizedError.name,
      message:
        statusCode === 500 ? "Internal Server Error" : normalizedError.message,
      ...(normalizedError instanceof LocalVaultError
        ? { code: normalizedError.code }
        : {}),
    });
  });
  return app;
};

export interface OpenServerAppOptions extends BuildServerAppOptions {
  readonly mcp?: McpHostOptions;
  readonly vault?: OpenLocalVaultOptions;
  readonly webRoot?: string;
}

export const openServerApp = async (
  vaultRoot: string,
  options: OpenServerAppOptions = {},
): Promise<FastifyInstance> => {
  const service = await openLocalVault(vaultRoot, {
    ...options.vault,
    localDrafts: false,
  });
  const app = buildServerApp(service, options);
  const webRoot = options.webRoot;
  if (webRoot !== undefined) {
    await app.register(fastifyStatic, {
      root: webRoot,
      index: ["index.html"],
      preCompressed: true,
      setHeaders: (reply, path) => {
        reply.header("vary", "Accept-Encoding");
        reply.header(
          "cache-control",
          relative(webRoot, path).replaceAll("\\", "/").startsWith("assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
        );
      },
    });
  }
  let mcp: Awaited<ReturnType<typeof openMcpHost>> | undefined;
  try {
    if (options.mcp) mcp = await openMcpHost(service, options.mcp);
  } catch (error) {
    await app.close();
    await service.close();
    throw error;
  }
  app.addHook("onClose", async () => {
    await mcp?.close();
    await service.close();
  });
  return app;
};
