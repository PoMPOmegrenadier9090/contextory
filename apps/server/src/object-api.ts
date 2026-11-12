import {
  normalizeObjectType,
  parseObjectCreate,
  parseObjectOverviewRange,
  parseObjectPageSave,
  parseObjectPatch,
  parseObjectTypePatch,
  requireRequestRecord as requireRecord,
  requireRequestString as requireString,
  type DocNode,
  type ObjectRecord,
} from "@pkm/core";
import type { ObjectStore } from "@pkm/storage-node";
import type { FastifyInstance } from "fastify";

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
  app.put("/api/next/pages/:hostId", (request) =>
    store.savePage(
      param(request.params, "hostId"),
      parseObjectPageSave(request.body),
      Date.now(),
    ),
  );

  app.get("/api/next/objects", (request) => {
    const query = requireRecord(request.query);
    if (typeof query.type === "string") return store.objectsOfType(query.type);
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
  app.get("/api/next/objects/:id/timeline", (request) =>
    store.timeline(param(request.params, "id")),
  );

  app.get("/api/next/types", () => store.types());
  app.patch("/api/next/types/:name", (request) =>
    store.updateType(
      param(request.params, "name"),
      parseObjectTypePatch(request.body),
    ),
  );

  app.get("/api/next/overview", (request) => {
    const { from, to } = parseObjectOverviewRange(request.query);
    return store.overview(from, to);
  });

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
