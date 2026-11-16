import {
  normalizeObjectType,
  parseObjectCreate,
  parseObjectOverviewRange,
  parseObjectPageSave,
  parseObjectPatch,
  parseObjectTypePatch,
  parseViewQuery,
  requireRequestRecord as requireRecord,
  requireRequestString as requireString,
  type DocNode,
  type ObjectRecord,
} from "@pkm/core";
import type { ObjectStore } from "@pkm/storage-node";
import type { FastifyInstance } from "fastify";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { zip } from "./zip.js";

const today = (): string => new Date().toISOString().slice(0, 10);

const param = (params: unknown, name: string): string =>
  requireString(requireRecord(params)[name], name);

const requireNodes = (value: unknown, name: string): readonly DocNode[] => {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value as readonly DocNode[];
};

const requireType = (value: unknown): ObjectRecord["type"] => {
  const type = normalizeObjectType(value);
  if (!type) throw new TypeError("type is not a valid object type");
  return type;
};

/** Object保存層のHTTP API。 */
export const registerObjectRoutes = (
  app: FastifyInstance,
  store: ObjectStore,
): void => {
  app.get("/api/next/pages/:hostId", (request) =>
    store.loadPage(param(request.params, "hostId")),
  );
  app.put("/api/next/pages/:hostId", (request) => {
    const { doc, baseRevision } = parseObjectPageSave(request.body);
    return store.savePage(
      param(request.params, "hostId"),
      doc,
      Date.now(),
      baseRevision,
    );
  });

  app.get("/api/next/objects", (request) => {
    const query = requireRecord(request.query);
    return store.search(
      typeof query.query === "string" ? query.query : "",
      typeof query.exclude === "string" ? query.exclude : null,
    );
  });
  app.post("/api/next/objects", (request, reply) => {
    return reply
      .code(201)
      .send(store.createObject(parseObjectCreate(request.body), Date.now()));
  });
  app.get("/api/next/objects/:id", (request) =>
    store.getObject(param(request.params, "id")),
  );
  app.patch("/api/next/objects/:id", (request) =>
    store.patchObject(
      param(request.params, "id"),
      parseObjectPatch(request.body),
      Date.now(),
    ),
  );
  app.post("/api/next/objects/:id/trash", (request) =>
    store.trashObject(param(request.params, "id"), Date.now()),
  );
  app.post("/api/next/objects/:id/restore", (request) =>
    store.restoreObject(param(request.params, "id")),
  );
  /** 完全に削除する。ゴミ箱にあるObjectだけ。 */
  app.delete("/api/next/objects/:id", (request, reply) => {
    store.purgeObject(param(request.params, "id"));
    return reply.code(204).send();
  });
  app.get("/api/next/trash", () => store.trash());
  app.delete("/api/next/trash", (_request, reply) => {
    store.emptyTrash();
    return reply.code(204).send();
  });
  app.put("/api/next/objects/:id/contexts/:targetId", (request) =>
    store.addContext(
      param(request.params, "id"),
      param(request.params, "targetId"),
    ),
  );
  app.delete("/api/next/objects/:id/contexts/:targetId", (request) =>
    store.removeContext(
      param(request.params, "id"),
      param(request.params, "targetId"),
    ),
  );
  app.get("/api/next/views/:id", (request) => {
    const { anchorId, today } = parseViewQuery(request.query);
    return store.queryView(param(request.params, "id"), anchorId, today);
  });

  app.get("/api/next/types", () => store.types());
  app.patch("/api/next/types/:name", (request) =>
    store.updateType(
      param(request.params, "name"),
      parseObjectTypePatch(request.body),
    ),
  );
  app.delete("/api/next/types/:name", (request, reply) => {
    store.deleteType(param(request.params, "name"));
    return reply.code(204).send();
  });

  app.get("/api/next/overview", (request) => {
    const { from, to } = parseObjectOverviewRange(request.query);
    return store.overview(from, to);
  });

  app.get("/api/next/backup", async (_request, reply) => {
    const dir = await mkdtemp(join(tmpdir(), "contextory-backup-"));
    try {
      const path = join(dir, "objects.sqlite");
      await store.backup(path);
      return reply
        .header("content-type", "application/vnd.sqlite3")
        .header(
          "content-disposition",
          `attachment; filename="contextory-${today()}.sqlite"`,
        )
        .send(await readFile(path));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  app.get("/api/next/export/markdown", (_request, reply) =>
    reply
      .header("content-type", "application/zip")
      .header(
        "content-disposition",
        `attachment; filename="contextory-${today()}.zip"`,
      )
      .send(
        zip(
          store
            .exportMarkdown()
            .map((file) => ({ path: file.path, data: Buffer.from(file.text) })),
        ),
      ),
  );

  /** 内容をすべて置き換える。試作データの投入用。 */
  app.put("/api/next/workspace", (request, reply) => {
    const body = requireRecord(request.body);
    const objects = (
      Array.isArray(body.objects) ? (body.objects as unknown[]) : []
    ).map((value): ObjectRecord => {
      const object = requireRecord(value);
      return {
        id: requireString(object.id, "id"),
        type: requireType(object.type),
        title: requireNodes(object.title, "title"),
        body: requireNodes(object.body, "body"),
        done: object.done === true,
        contexts: requireNodes(object.contexts, "contexts").map((id) =>
          requireString(id, "context"),
        ),
        createdAt: Number(object.createdAt) || Date.now(),
      };
    });
    const documents = Object.fromEntries(
      Object.entries(requireRecord(body.documents ?? {})).map(([id, nodes]) => [
        id,
        requireNodes(nodes, "document"),
      ]),
    );
    store.importWorkspace({ objects, documents }, Date.now());
    return reply.code(204).send();
  });
};
