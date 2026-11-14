import { createHash } from "node:crypto";
import { relative } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import fastifyStatic from "@fastify/static";
import { ObjectStore, ObjectStoreError } from "@pkm/storage-node";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";

import { registerObjectRoutes } from "./object-api.js";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

const statusForError = (error: Error): number => {
  if (error instanceof TypeError) return 400;
  if (error instanceof ObjectStoreError)
    return error.code === "OBJECT_NOT_FOUND" ? 404 : 409;
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

export interface OpenServerAppOptions {
  /** Object正本のSQLite。 */
  readonly objectStorePath: string;
  readonly logger?: boolean | FastifyBaseLogger;
  readonly webRoot?: string;
}

export const openServerApp = async (
  options: OpenServerAppOptions,
): Promise<FastifyInstance> => {
  const app = Fastify({ logger: options.logger ?? false });
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

  app.get("/health", () => ({ status: "ok" }));
  app.setErrorHandler((error, _request, reply) => {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    const statusCode = statusForError(normalizedError);
    return reply.code(statusCode).send({
      error: normalizedError.name,
      message:
        statusCode === 500 ? "Internal Server Error" : normalizedError.message,
    });
  });
  const objects = new ObjectStore(options.objectStorePath);
  app.addHook("onClose", () => {
    objects.close();
  });
  registerObjectRoutes(app, objects);
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
  return app;
};
