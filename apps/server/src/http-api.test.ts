import {
  gunzipSync,
  brotliDecompressSync,
  gzipSync,
  brotliCompressSync,
} from "node:zlib";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { FastifyInstance } from "fastify";
import { parseMarkdownEntity, updateEntityMetadata } from "@pkm/core";
import type { TodoPage } from "@pkm/core";
import type {
  RemoteEntityDocument,
  RemoteEntityPage,
  PkmBootstrap,
  PkmUnresolvedReference,
} from "@pkm/contracts";
import type {
  EntityDocument,
  FileHash,
  SyncthingConflictDocument,
  WriteVaultFileConflict,
} from "@pkm/storage-node";
import { afterEach, describe, expect, it } from "vitest";

import { openServerApp } from "./http-api.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../../fixtures/vault-v1/", import.meta.url),
);
const ENTRY_ID = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
const ENTRY_PATH = `entries/${ENTRY_ID}.md`;
const CONFLICT_PATH = `entries/${ENTRY_ID}.sync-conflict-20260922-120000-ABCDEFG.md`;
const temporaryDirectories: string[] = [];
const apps: FastifyInstance[] = [];

const copyFixtureVault = async (): Promise<string> => {
  const parent = await mkdtemp(join(tmpdir(), "pkms-http-api-"));
  temporaryDirectories.push(parent);
  const vaultRoot = join(parent, "vault");
  await cp(FIXTURE_ROOT, vaultRoot, { recursive: true });
  await rm(join(vaultRoot, ".pkm"), { recursive: true, force: true });
  return vaultRoot;
};

const openFixtureServer = async (
  vaultRoot: string,
): Promise<FastifyInstance> => {
  const app = await openServerApp(vaultRoot, {
    vault: { watch: false, now: () => new Date("2026-09-22T01:23:45.000Z") },
  });
  apps.push(app);
  return app;
};

const parseJson = (body: string): unknown => JSON.parse(body) as unknown;

const createConflictCopy = async (
  vaultRoot: string,
  heading: string,
): Promise<void> => {
  const canonical = await readFile(join(vaultRoot, ENTRY_PATH), "utf8");
  await writeFile(
    join(vaultRoot, CONFLICT_PATH),
    canonical.replace("# 実装開始", `# ${heading}`),
    "utf8",
  );
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("server HTTP API", () => {
  it("exposes preview fallback for invalid URLs and blocks local network destinations", async () => {
    const app = await openFixtureServer(await copyFixtureVault());
    for (const url of [
      "file:///etc/passwd",
      "http://127.0.0.1/private",
      "http://[::1]/",
      "https://user:pass@example.com",
    ]) {
      const response = await app.inject(
        `/api/link-preview?url=${encodeURIComponent(url)}`,
      );
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe("null");
    }
    expect((await app.inject("/api/link-preview")).statusCode).toBe(400);
  });
  it("creates and updates Resource bodies over HTTP without overwriting concurrent changes", async () => {
    const app = await openFixtureServer(await copyFixtureVault());
    const create = await app.inject({
      method: "POST",
      url: "/api/entities",
      payload: {
        type: "resource",
        displayName: "資料",
        body: "# 全般メモ\n",
        metadata: { authors: ["Author"] },
      },
    });
    expect(create.statusCode).toBe(201);
    const resource = create.json<EntityDocument>();
    const patch = await app.inject({
      method: "PATCH",
      url: `/api/entities/${resource.entity.id}/body`,
      payload: {
        body: "# 更新したメモ\n",
        expectedFileHash: resource.fileHash,
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json<{ ok: boolean }>().ok).toBe(true);
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/entities/${resource.entity.id}/body`,
      payload: { body: "stale", expectedFileHash: resource.fileHash },
    });
    expect(stale.statusCode).toBe(409);
    const loaded = await app.inject({
      method: "GET",
      url: `/api/entities/${resource.entity.id}`,
    });
    expect(
      parseMarkdownEntity(loaded.json<RemoteEntityDocument>().content),
    ).toMatchObject({
      ok: true,
      value: { body: "# 更新したメモ\n", entity: { authors: ["Author"] } },
    });
  });

  it("accepts Resource authors and related IDs over HTTP and returns relation labels", async () => {
    const app = await openFixtureServer(await copyFixtureVault());
    const projectId = "prj_01997c2a-7b1c-7a01-8a10-000000000003";
    const create = await app.inject({
      method: "POST",
      url: "/api/entities",
      payload: {
        type: "resource",
        displayName: "HTTP Resource",
        metadata: { authors: ["HTTP Author"], relatedEntityIds: [projectId] },
      },
    });
    expect(create.statusCode).toBe(201);
    const document = create.json<EntityDocument>();
    expect(document.entity).toMatchObject({
      authors: ["HTTP Author"],
      relatedEntityIds: [projectId],
    });
    const page = await app.inject({
      method: "GET",
      url: "/api/entities?type=resource",
    });
    const result = page.json<RemoteEntityPage>();
    expect(
      result.items.find((entity) => entity.id === document.entity.id)?.authors,
    ).toEqual(["HTTP Author"]);
    expect(result.included?.map((entity) => entity.id)).toContain(projectId);
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/entities/${document.entity.id}/metadata`,
      payload: {
        expectedFileHash: document.fileHash,
        patch: { authors: ["Updated HTTP Author"], relatedEntityIds: [] },
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(
      patched.json<{ entity: Record<string, unknown> }>().entity,
    ).toMatchObject({ authors: ["Updated HTTP Author"], relatedEntityIds: [] });
    const invalid = await app.inject({
      method: "PATCH",
      url: `/api/entities/${document.entity.id}/metadata`,
      payload: {
        expectedFileHash: document.fileHash,
        patch: {
          relatedEntityIds: ["ent_01997c2a-7b1c-7a01-8a10-000000000006"],
        },
      },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("serves compressed static bundles with immutable caching and revalidates HTML", async () => {
    const root = await copyFixtureVault();
    const webRoot = join(root, "web-build");
    await mkdir(join(webRoot, "assets"), { recursive: true });
    const source = "console.log('bundle');\n".repeat(100);
    await writeFile(join(webRoot, "assets", "index-hash.js"), source);
    await writeFile(
      join(webRoot, "assets", "index-hash.js.gz"),
      gzipSync(source),
    );
    await writeFile(
      join(webRoot, "assets", "index-hash.js.br"),
      brotliCompressSync(source),
    );
    await writeFile(join(webRoot, "index.html"), "<html>PKM</html>");
    const app = await openServerApp(root, { vault: { watch: false }, webRoot });
    apps.push(app);
    const javascript = await app.inject({
      method: "GET",
      url: "/assets/index-hash.js",
      headers: { "accept-encoding": "br, gzip" },
    });
    expect(javascript.headers["content-encoding"]).toBe("br");
    expect(brotliDecompressSync(javascript.rawPayload).toString()).toBe(source);
    expect(javascript.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(javascript.headers.vary).toBe("Accept-Encoding");
    expect(
      (await app.inject({ method: "GET", url: "/" })).headers["cache-control"],
    ).toBe("no-cache");
    for (const encoding of ["gzip, deflate, br", "gzip", "br"]) {
      const html = await app.inject({
        method: "GET",
        url: "/",
        headers: { "accept-encoding": encoding },
      });
      expect(html.statusCode).toBe(200);
      expect(html.body).toBe("<html>PKM</html>");
      expect(html.headers["cache-control"]).toBe("no-cache");
    }
  });
  it("replays missed SSE revisions and requests a reset for another server session", async () => {
    const app = await openFixtureServer(await copyFixtureVault());
    const health = (await app.inject({ method: "GET", url: "/health" })).json<{
      sessionId: string;
      revision: number;
    }>();
    for (let n = 0; n < 2; n++)
      await app.inject({
        method: "POST",
        url: "/api/entities",
        payload: { type: "entry", displayName: `Replay ${n}` },
      });
    const replay = app.inject({
      method: "GET",
      url: `/api/events?sessionId=${health.sessionId}&since=${health.revision}`,
    });
    const reset = app.inject({
      method: "GET",
      url: "/api/events?sessionId=old-session&since=0",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await app.close();
    const stream = (await replay).body;
    expect(stream).toContain('"reset":false');
    expect(stream.match(/event: vault-change/g)).toHaveLength(2);
    expect(stream).toContain(`id: ${health.sessionId}:${health.revision + 1}`);
    expect((await reset).body).toContain('"reset":true');
  });
  it("returns one Markdown copy, bounded previews and compressed conditional responses", async () => {
    const app = await openFixtureServer(await copyFixtureVault());
    const created = await app.inject({
      method: "POST",
      url: "/api/entities",
      payload: {
        type: "entry",
        displayName: "Large",
        body: "日本語の長い本文。".repeat(20_000),
      },
    });
    const document = created.json<RemoteEntityDocument>();
    expect(document.entity).not.toHaveProperty("body");
    expect(document).not.toHaveProperty("draft");
    const url = `/api/entities/${document.entity.id}`;
    const plain = await app.inject({ method: "GET", url });
    for (const encoding of ["gzip", "br"]) {
      const compressed = await app.inject({
        method: "GET",
        url,
        headers: { "accept-encoding": encoding },
      });
      const decoded =
        encoding === "gzip"
          ? gunzipSync(compressed.rawPayload)
          : brotliDecompressSync(compressed.rawPayload);
      expect(decoded.toString()).toBe(plain.body);
      expect(compressed.rawPayload.length).toBeLessThan(
        plain.rawPayload.length / 10,
      );
      expect(compressed.headers["content-encoding"]).toBe(encoding);
    }
    const unchanged = await app.inject({
      method: "GET",
      url,
      headers: {
        "if-none-match": plain.headers.etag!,
        "accept-encoding": "gzip",
      },
    });
    expect(unchanged.statusCode).toBe(304);
    expect(unchanged.rawPayload.length).toBe(0);
    expect(unchanged.headers.vary).toBe("Accept-Encoding");
    const preview = (
      await app.inject({
        method: "GET",
        url: `/api/entities?ids=${encodeURIComponent(JSON.stringify([document.entity.id]))}&view=timeline`,
      })
    ).json<RemoteEntityPage>().items[0]!;
    expect(preview.preview?.length).toBe(1200);
    expect(preview.bodyTruncated).toBe(true);
    expect(preview).not.toHaveProperty("body");
    const options = (
      await app.inject({ method: "GET", url: "/api/entity-options?q=Large" })
    ).json<Record<string, unknown>[]>();
    expect(Object.keys(options[0]!).sort()).toEqual([
      "displayName",
      "id",
      "type",
    ]);
  });
  it("creates context and Topics in one operation, updates fields without returning bodies and preserves conflict checks", async () => {
    const root = await copyFixtureVault();
    const app = await openFixtureServer(root);
    const before = (
      await app.inject({ method: "GET", url: "/api/bootstrap" })
    ).json<PkmBootstrap>();
    const created = await app.inject({
      method: "POST",
      url: "/api/entities",
      payload: {
        type: "entry",
        displayName: "Created",
        body: "- [ ] first",
        topicNames: ["Personal Knowledge Management", "New Topic", "new topic"],
        metadata: {
          entryContexts: { task: "tsk_01997c2a-7b1c-7a01-8a10-000000000004" },
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const document = created.json<RemoteEntityDocument>();
    expect(document.entity.topicIds).toHaveLength(2);
    expect(document.entity.taskId).toBe(
      "tsk_01997c2a-7b1c-7a01-8a10-000000000004",
    );
    const after = (
      await app.inject({ method: "GET", url: "/api/bootstrap" })
    ).json<PkmBootstrap>();
    expect(after.health.revision).toBe(before.health.revision + 1);
    expect(after.counts.types.topic).toBe(before.counts.types.topic + 1);
    const metadata = await app.inject({
      method: "PATCH",
      url: `/api/entities/${document.entity.id}/metadata`,
      payload: {
        patch: { displayName: "Renamed" },
        expectedFileHash: document.fileHash,
      },
    });
    expect(metadata.statusCode).toBe(200);
    const updated = metadata.json<{
      entity: Record<string, unknown>;
      fileHash: FileHash;
    }>();
    expect(updated.entity.displayName).toBe("Renamed");
    expect(metadata.body).not.toContain("- [ ] first");
    const body = await app.inject({
      method: "PATCH",
      url: `/api/entities/${document.entity.id}/body`,
      payload: { body: "- [x] first", expectedFileHash: updated.fileHash },
    });
    expect(body.statusCode).toBe(200);
    expect(body.body).not.toContain("- [x] first");
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/entities/${document.entity.id}/body`,
          payload: { body: "stale", expectedFileHash: document.fileHash },
        })
      ).statusCode,
    ).toBe(409);
    const loaded = (
      await app.inject({
        method: "GET",
        url: `/api/entities/${document.entity.id}`,
      })
    ).json<RemoteEntityDocument>();
    expect(loaded.content).toContain("- [x] first");
    expect(loaded).not.toHaveProperty("draft");
    await expect(
      readFile(join(root, ".pkm", "local-state.sqlite")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("returns lightweight Quick Open matches and rejects a missing query", async () => {
    const app = await openFixtureServer(await copyFixtureVault());
    const response = await app.inject({
      method: "GET",
      url: "/api/quick-open?q=実装開始",
    });
    expect(response.statusCode).toBe(200);
    expect(parseJson(response.body)).toMatchObject([
      {
        id: ENTRY_ID,
        displayName: "実装開始",
      },
    ]);
    const results = parseJson(response.body) as {
      snippet: string;
      breadcrumb: string;
    }[];
    expect(typeof results[0]?.snippet).toBe("string");
    expect(typeof results[0]?.breadcrumb).toBe("string");
    expect(results[0]).not.toHaveProperty("body");
    expect(
      (await app.inject({ method: "GET", url: "/api/quick-open" })).statusCode,
    ).toBe(400);
    expect(
      parseJson(
        (await app.inject({ method: "GET", url: "/api/quick-open?q=" })).body,
      ),
    ).toEqual([]);
  });

  it("lists paginated Todo snapshots, persists checks and refuses invalid or stale updates", async () => {
    const app = await openFixtureServer(await copyFixtureVault());
    const created = await app.inject({
      method: "POST",
      url: "/api/entities",
      payload: {
        type: "entry",
        displayName: "Todos",
        body: "- [ ] http todo\n- [x] done",
      },
    });
    expect(created.statusCode).toBe(201);
    const document = parseJson(created.body) as EntityDocument;
    const response = await app.inject({
      method: "GET",
      url: "/api/todos?state=all&limit=100",
    });
    expect(response.statusCode).toBe(200);
    const page = parseJson(response.body) as TodoPage;
    const todo = page.items.find(
      (item) => item.entryId === document.entity.id && !item.checked,
    )!;
    expect(todo.text).toBe("http todo");
    expect(todo).not.toHaveProperty("body");
    const request = {
      entryId: todo.entryId,
      markerFrom: todo.markerFrom,
      checked: true,
      expectedFileHash: todo.fileHash,
    };
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/todos/check",
          payload: request,
        })
      ).statusCode,
    ).toBe(200);
    const stale = await app.inject({
      method: "PUT",
      url: "/api/todos/check",
      payload: request,
    });
    expect(stale.statusCode).toBe(409);
    expect(parseJson(stale.body)).toMatchObject({ code: "TODO_CHANGED" });
    const after = parseJson(
      (await app.inject({ method: "GET", url: "/api/todos?state=checked" }))
        .body,
    ) as TodoPage;
    expect(
      after.items.filter((item) => item.entryId === document.entity.id),
    ).toHaveLength(2);
    for (const url of [
      "/api/todos?limit=0",
      "/api/todos?limit=101",
      "/api/todos?offset=-1",
      "/api/todos?state=invalid",
      "/api/todos?scopeType=area",
    ])
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/todos/check",
          payload: { ...request, checked: "false" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("creates and lists Entries by journal_date", async () => {
    const vaultRoot = await copyFixtureVault();
    const app = await openFixtureServer(vaultRoot);
    const created = await app.inject({
      method: "POST",
      url: "/api/entities",
      payload: {
        type: "entry",
        displayName: null,
        body: "別の日に記録\n",
        journalDate: "2026-09-20",
      },
    });
    expect(created.statusCode).toBe(201);
    const document = parseJson(created.body) as {
      entity: { id: string; journalDate: string };
    };
    expect(document.entity.journalDate).toBe("2026-09-20");
    const daily = await app.inject({
      method: "GET",
      url: "/api/entities?type=entry&journalDate=2026-09-20",
    });
    expect((parseJson(daily.body) as { items: unknown[] }).items).toEqual([
      expect.objectContaining({
        id: document.entity.id,
        journalDate: "2026-09-20",
      }),
    ]);
    const invalid = await app.inject({
      method: "GET",
      url: "/api/entities?type=entry&journalDate=2026-02-30",
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("uploads assets and serves images inline while forcing other files to download", async () => {
    const vaultRoot = await copyFixtureVault();
    const app = await openFixtureServer(vaultRoot);
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/assets",
      payload: {
        fileName: "図.png",
        dataBase64: png.toString("base64"),
      },
    });
    expect(uploaded.statusCode).toBe(201);
    const image = parseJson(uploaded.body) as { path: string };
    const loaded = await app.inject({
      method: "GET",
      url: `/api/${image.path}`,
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.headers["content-type"]).toContain("image/png");
    expect(loaded.headers["content-disposition"]).toBe("inline");
    expect(loaded.rawPayload).toEqual(png);
    const imageDownload = await app.inject({
      method: "GET",
      url: `/api/${image.path}?download=1&fileName=${encodeURIComponent("図①.png")}`,
    });
    expect(imageDownload.statusCode).toBe(200);
    expect(imageDownload.headers["content-disposition"]).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("図①.png")}`,
    );
    expect(imageDownload.rawPayload).toEqual(png);
    const unsafeName = await app.inject({
      method: "GET",
      url: `/api/${image.path}?download=1&fileName=bad%0D%0Aname.png`,
    });
    expect(unsafeName.statusCode).toBe(400);

    const file = await app.inject({
      method: "POST",
      url: "/api/assets",
      payload: {
        fileName: "notes.txt",
        dataBase64: Buffer.from("hello").toString("base64"),
      },
    });
    const filePath = (parseJson(file.body) as { path: string }).path;
    const download = await app.inject({
      method: "GET",
      url: `/api/${filePath}`,
    });
    expect(download.headers["content-disposition"]).toBe("attachment");
    expect(download.body).toBe("hello");
    const traversal = await app.inject({
      method: "GET",
      url: "/api/assets/files/not-an-id.txt",
    });
    expect(traversal.statusCode).toBe(400);
  });

  it("previews and explicitly deletes only aged, unreferenced assets", async () => {
    const vaultRoot = await copyFixtureVault();
    const app = await openFixtureServer(vaultRoot);
    const uploaded = await app.inject({
      method: "POST",
      url: "/api/assets",
      payload: {
        fileName: "orphan.txt",
        dataBase64: Buffer.from("unreferenced").toString("base64"),
      },
    });
    const { path } = parseJson(uploaded.body) as { path: string };
    const old = new Date("2026-09-10T00:00:00.000Z");
    await utimes(join(vaultRoot, path), old, old);
    const preview = await app.inject({
      method: "GET",
      url: "/api/orphan-assets",
    });
    expect(preview.statusCode).toBe(200);
    const candidates = parseJson(preview.body) as Array<{
      path: string;
      hash: string;
    }>;
    expect(candidates).toEqual([expect.objectContaining({ path })]);

    const removed = await app.inject({
      method: "POST",
      url: "/api/orphan-assets/delete",
      payload: { assets: candidates.map(({ path, hash }) => ({ path, hash })) },
    });
    expect(parseJson(removed.body)).toEqual({ deleted: [path], skipped: [] });
    await expect(readFile(join(vaultRoot, path))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("serves health, query, Entity, and backlink routes", async () => {
    const vaultRoot = await copyFixtureVault();
    const app = await openFixtureServer(vaultRoot);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(parseJson(health.body)).toMatchObject({
      status: "ok",
      accessMode: "read-write",
    });

    const search = await app.inject({
      method: "GET",
      url: "/api/entities?q=実装開始",
    });
    expect(parseJson(search.body)).toMatchObject({
      items: [{ id: ENTRY_ID }],
      nextCursor: null,
    });

    const entity = await app.inject({
      method: "GET",
      url: `/api/entities/${ENTRY_ID}`,
    });
    expect(parseJson(entity.body)).toMatchObject({
      entity: { id: ENTRY_ID, displayName: "実装開始" },
    });

    const backlinks = await app.inject({
      method: "GET",
      url: "/api/entities/tsk_01997c2a-7b1c-7a01-8a10-000000000004/backlinks",
    });
    expect(parseJson(backlinks.body)).toMatchObject({
      items: [{ sourceId: ENTRY_ID, sourceDisplayName: "実装開始", count: 2 }],
      nextCursor: null,
    });
  });

  it("exposes broken references with source locations through the read-only API", async () => {
    const vaultRoot = await copyFixtureVault();
    const taskId = "tsk_01997c2a-7b1c-7a01-8a10-000000000004";
    await rm(join(vaultRoot, "tasks", `${taskId}.md`));
    const app = await openFixtureServer(vaultRoot);
    const response = await app.inject({
      method: "GET",
      url: "/api/unresolved-references",
    });
    expect(response.statusCode).toBe(200);
    const references = response.json<PkmUnresolvedReference[]>();
    expect(references[0]?.startOffset).toBeTypeOf("number");
    expect(references).toMatchObject([
      {
        sourceId: ENTRY_ID,
        sourcePath: ENTRY_PATH,
        sourceName: "実装開始",
        sourceDeletedAt: null,
        targetId: taskId,
        fieldPath: null,
      },
      {
        sourceId: ENTRY_ID,
        sourcePath: ENTRY_PATH,
        sourceName: "実装開始",
        sourceDeletedAt: null,
        targetId: taskId,
        fieldPath: ["contexts", "task"],
        startOffset: null,
      },
    ]);
  });

  it("permanently deletes only a trashed route target with its current hash", async () => {
    const root = await copyFixtureVault();
    const app = await openFixtureServer(root);
    const entry = (
      await app.inject({ method: "GET", url: `/api/entities/${ENTRY_ID}` })
    ).json<RemoteEntityDocument>();
    const remove = (payload: Record<string, unknown>) =>
      app.inject({
        method: "DELETE",
        url: `/api/entities/${ENTRY_ID}`,
        payload,
      });
    expect(
      (await remove({ expectedFileHash: entry.fileHash })).statusCode,
    ).toBe(409);
    expect((await remove({})).statusCode).toBe(400);
    const saved = await app.inject({
      method: "PUT",
      url: `/api/entities/${ENTRY_ID}`,
      payload: {
        expectedFileHash: entry.fileHash,
        content: updateEntityMetadata(entry.content, {
          deletedAt: "2026-10-18T00:00:00Z",
        }).content,
      },
    });
    expect(saved.statusCode).toBe(200);
    const trashed = (
      await app.inject({ method: "GET", url: `/api/entities/${ENTRY_ID}` })
    ).json<RemoteEntityDocument>();
    expect(
      (await remove({ expectedFileHash: entry.fileHash })).statusCode,
    ).toBe(409);
    expect(
      (
        await remove({
          expectedFileHash: trashed.fileHash,
          entityId: "other",
          path: "../outside",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: `/api/entities/${ENTRY_ID}` }))
        .statusCode,
    ).toBe(404);
    await expect(readFile(join(root, ENTRY_PATH))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/entities/tsk_01997c2a-7b1c-7a01-8a10-000000000004",
        })
      ).statusCode,
    ).toBe(200);
  });

  it("lists logically deleted Entities only through the trash query", async () => {
    const vaultRoot = await copyFixtureVault();
    const app = await openFixtureServer(vaultRoot);
    const before = (await app.inject({ method: "GET", url: "/health" })).json<{
      cacheVersion: string;
    }>().cacheVersion;
    expect(typeof before).toBe("string");
    expect(
      (await app.inject({ method: "GET", url: "/health" })).json<{
        cacheVersion: string;
      }>().cacheVersion,
    ).toBe(before);
    const loadedResponse = await app.inject({
      method: "GET",
      url: `/api/entities/${ENTRY_ID}`,
    });
    const loaded = parseJson(loadedResponse.body) as EntityDocument;
    const deleted = updateEntityMetadata(loaded.content, {
      deletedAt: "2026-09-22T01:23:45.000Z",
    });

    const saved = await app.inject({
      method: "PUT",
      url: `/api/entities/${ENTRY_ID}`,
      payload: {
        content: deleted.content,
        expectedFileHash: loaded.fileHash,
      },
    });
    expect(saved.statusCode).toBe(200);

    expect(
      (await app.inject({ method: "GET", url: "/health" })).json<{
        cacheVersion: string;
      }>().cacheVersion,
    ).not.toBe(before);

    const active = await app.inject({ method: "GET", url: "/api/entities" });
    const activeEntities = (
      parseJson(active.body) as { items: readonly { id: string }[] }
    ).items;
    expect(activeEntities.some((entity) => entity.id === ENTRY_ID)).toBe(false);
    const trash = await app.inject({
      method: "GET",
      url: "/api/entities?deleted=only",
    });
    expect((parseJson(trash.body) as { items: unknown[] }).items).toEqual([
      expect.objectContaining({
        id: ENTRY_ID,
        deletedAt: "2026-09-22T01:23:45.000Z",
      }),
    ]);
  });

  it("creates and saves through Entity-scoped commands without accepting a path", async () => {
    const vaultRoot = await copyFixtureVault();
    const app = await openFixtureServer(vaultRoot);
    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/entities",
      payload: {
        type: "topic",
        displayName: "HTTP Topic",
        path: "../outside.md",
      },
    });

    expect(createdResponse.statusCode).toBe(201);
    const created = parseJson(createdResponse.body) as EntityDocument;
    expect(created.entity).toMatchObject({
      type: "topic",
      displayName: "HTTP Topic",
    });

    const updated = created.content.replace(
      "name: HTTP Topic",
      "name: API Topic",
    );
    const saved = await app.inject({
      method: "PUT",
      url: `/api/entities/${created.entity.id}`,
      payload: {
        content: updated,
        expectedFileHash: created.fileHash,
        path: "../outside.md",
      },
    });
    expect(saved.statusCode).toBe(200);
    await expect(
      readFile(join(vaultRoot, created.entity.path), "utf8"),
    ).resolves.toContain("name: API Topic");
  });

  it("creates a Quick Capture Entry with its body in one request", async () => {
    const vaultRoot = await copyFixtureVault();
    const app = await openFixtureServer(vaultRoot);
    const response = await app.inject({
      method: "POST",
      url: "/api/entities",
      payload: {
        type: "entry",
        displayName: null,
        body: "- [ ] 買い物\n",
      },
    });

    expect(response.statusCode).toBe(201);
    const created = parseJson(response.body) as EntityDocument;
    expect(created.entity.displayName).toBeNull();
    expect(created.content).toContain("title: null");
    expect(created.content).toContain("- [ ] 買い物\n");
    await expect(
      readFile(join(vaultRoot, created.entity.path), "utf8"),
    ).resolves.toBe(created.content);
  });

  it("returns a recoverable 409 conflict and resolves it after rechecking the hash", async () => {
    const vaultRoot = await copyFixtureVault();
    const app = await openFixtureServer(vaultRoot);
    const loadedResponse = await app.inject({
      method: "GET",
      url: `/api/entities/${ENTRY_ID}`,
    });
    const loaded = parseJson(loadedResponse.body) as EntityDocument;
    await writeFile(
      join(vaultRoot, ENTRY_PATH),
      loaded.content.replace("# 実装開始", "# 外部版"),
      "utf8",
    );

    const saveResponse = await app.inject({
      method: "PUT",
      url: `/api/entities/${ENTRY_ID}`,
      payload: {
        content: loaded.content.replace("# 実装開始", "# HTTP Draft"),
        expectedFileHash: loaded.fileHash,
      },
    });
    expect(saveResponse.statusCode).toBe(409);
    const conflict = parseJson(saveResponse.body) as WriteVaultFileConflict;
    expect(conflict).toMatchObject({ ok: false, reason: "hash-conflict" });

    const resolveResponse = await app.inject({
      method: "POST",
      url: `/api/entities/${ENTRY_ID}/resolve-conflict`,
      payload: {
        resolution: "keep-draft",
        content: conflict.draftContent,
        expectedExternalHash: conflict.actual?.hash as FileHash,
      },
    });
    expect(resolveResponse.statusCode).toBe(200);
    await expect(
      readFile(join(vaultRoot, ENTRY_PATH), "utf8"),
    ).resolves.toContain("# HTTP Draft");
  });

  it("saves and resolves browser-owned drafts without persisting them on the server", async () => {
    const root = await copyFixtureVault();
    const app = await openFixtureServer(root);
    const loaded = parseJson(
      (await app.inject({ method: "GET", url: `/api/entities/${ENTRY_ID}` }))
        .body,
    ) as EntityDocument;
    const local = loaded.content.replace("# 実装開始", "# Browser draft");
    await writeFile(
      join(root, ENTRY_PATH),
      loaded.content.replace("# 実装開始", "# External"),
    );
    const failed = await app.inject({
      method: "PUT",
      url: `/api/entities/${ENTRY_ID}`,
      payload: {
        content: local,
        expectedFileHash: loaded.fileHash,
      },
    });
    expect(failed.statusCode).toBe(409);
    const conflict = parseJson(failed.body) as WriteVaultFileConflict;
    expect(
      (
        parseJson(
          (
            await app.inject({
              method: "GET",
              url: `/api/entities/${ENTRY_ID}`,
            })
          ).body,
        ) as EntityDocument
      ).draft,
    ).toBeUndefined();
    const stale = await app.inject({
      method: "POST",
      url: `/api/entities/${ENTRY_ID}/resolve-conflict`,
      payload: {
        content: local,
        resolution: "keep-draft",
        expectedExternalHash: loaded.fileHash,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(await readFile(join(root, ENTRY_PATH), "utf8")).toContain(
      "# External",
    );
    const resolved = await app.inject({
      method: "POST",
      url: `/api/entities/${ENTRY_ID}/resolve-conflict`,
      payload: {
        content: local,
        resolution: "keep-draft",
        expectedExternalHash: conflict.actual?.hash,
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(await readFile(join(root, ENTRY_PATH), "utf8")).toContain(
      "# Browser draft",
    );
    expect(
      (parseJson(resolved.body) as { document: EntityDocument }).document.draft,
    ).toBeUndefined();
    const saved = await app.inject({
      method: "PUT",
      url: `/api/entities/${ENTRY_ID}`,
      payload: {
        content: local,
        expectedFileHash: (
          parseJson(resolved.body) as { document: EntityDocument }
        ).document.fileHash,
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(
      (
        parseJson(
          (
            await app.inject({
              method: "GET",
              url: `/api/entities/${ENTRY_ID}`,
            })
          ).body,
        ) as EntityDocument
      ).draft,
    ).toBeUndefined();
  });

  it("adopts the external version without a server draft and validates browser draft requests", async () => {
    const app = await openFixtureServer(await copyFixtureVault());
    const loaded = parseJson(
      (await app.inject({ method: "GET", url: `/api/entities/${ENTRY_ID}` }))
        .body,
    ) as EntityDocument;
    const resolved = await app.inject({
      method: "POST",
      url: `/api/entities/${ENTRY_ID}/resolve-conflict`,
      payload: {
        content: "local unsaved content",
        resolution: "keep-external",
        expectedExternalHash: loaded.fileHash,
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(
      (parseJson(resolved.body) as { document: EntityDocument }).document
        .content,
    ).toBe(loaded.content);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/entities/${ENTRY_ID}`,
          payload: {
            content: loaded.content,
            expectedFileHash: "invalid-hash",
          },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/entities/${ENTRY_ID}/resolve-conflict`,
          payload: {
            content: 123,
            resolution: "keep-draft",
            expectedExternalHash: loaded.fileHash,
          },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("lists, loads, rechecks, and resolves Syncthing conflict copies", async () => {
    const vaultRoot = await copyFixtureVault();
    await createConflictCopy(vaultRoot, "HTTP競合版1");
    const app = await openFixtureServer(vaultRoot);

    const list = await app.inject({ method: "GET", url: "/api/conflicts" });
    expect(list.statusCode).toBe(200);
    expect(parseJson(list.body)).toMatchObject([
      {
        path: CONFLICT_PATH,
        canonicalEntityId: ENTRY_ID,
        canonicalDisplayName: "実装開始",
      },
    ]);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/conflicts/detail?path=${encodeURIComponent(CONFLICT_PATH)}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    const detail = parseJson(detailResponse.body) as SyncthingConflictDocument;
    expect(detail.conflicting.content).toContain("# HTTP競合版1");

    const savedDraft = await app.inject({
      method: "PUT",
      url: "/api/conflicts/draft",
      payload: {
        conflictPath: CONFLICT_PATH,
        canonicalHash: detail.canonical?.hash ?? null,
        conflictHash: detail.conflicting.hash,
        content: "HTTP手動マージ途中",
      },
    });
    expect(savedDraft.statusCode).toBe(404);
    const detailWithDraft = await app.inject({
      method: "GET",
      url: `/api/conflicts/detail?path=${encodeURIComponent(CONFLICT_PATH)}`,
    });
    expect(parseJson(detailWithDraft.body)).not.toHaveProperty("draft");

    await createConflictCopy(vaultRoot, "HTTP競合版2");
    const raced = await app.inject({
      method: "POST",
      url: "/api/conflicts/resolve",
      payload: {
        conflictPath: CONFLICT_PATH,
        resolution: "keep-conflict",
        expectedCanonicalHash: detail.canonical?.hash ?? null,
        expectedConflictHash: detail.conflicting.hash,
      },
    });
    expect(raced.statusCode).toBe(409);
    const changed = parseJson(raced.body) as {
      readonly current: SyncthingConflictDocument;
    };
    expect(changed.current.conflicting.content).toContain("# HTTP競合版2");

    const resolved = await app.inject({
      method: "POST",
      url: "/api/conflicts/resolve",
      payload: {
        conflictPath: CONFLICT_PATH,
        resolution: "keep-conflict",
        expectedCanonicalHash: changed.current.canonical?.hash ?? null,
        expectedConflictHash: changed.current.conflicting.hash,
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(parseJson(resolved.body)).toMatchObject({
      ok: true,
      resolution: "keep-conflict",
    });
    await expect(
      readFile(join(vaultRoot, ENTRY_PATH), "utf8"),
    ).resolves.toContain("# HTTP競合版2");
    await expect(
      readFile(join(vaultRoot, CONFLICT_PATH), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid or missing Syncthing conflict requests", async () => {
    const vaultRoot = await copyFixtureVault();
    const app = await openFixtureServer(vaultRoot);

    const missing = await app.inject({
      method: "GET",
      url: `/api/conflicts/detail?path=${encodeURIComponent(CONFLICT_PATH)}`,
    });
    expect(missing.statusCode).toBe(404);
    expect(parseJson(missing.body)).toMatchObject({
      code: "CONFLICT_NOT_FOUND",
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/conflicts/resolve",
      payload: {
        conflictPath: CONFLICT_PATH,
        resolution: "merge-automatically",
        expectedCanonicalHash: null,
        expectedConflictHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("maps invalid requests and missing Entities to stable client errors", async () => {
    const vaultRoot = await copyFixtureVault();
    const app = await openFixtureServer(vaultRoot);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/entities",
      payload: { type: "unknown", displayName: "Invalid" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(parseJson(invalid.body)).toMatchObject({ error: "TypeError" });

    const malformed = await app.inject({
      method: "POST",
      url: "/api/entities",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(malformed.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: "/api/entities/ent_01997c2a-7b1c-7a01-8a10-999999999999",
    });
    expect(missing.statusCode).toBe(404);
    expect(parseJson(missing.body)).toMatchObject({
      code: "ENTITY_NOT_FOUND",
    });

    const loaded = parseJson(
      (
        await app.inject({
          method: "GET",
          url: `/api/entities/${ENTRY_ID}`,
        })
      ).body,
    ) as EntityDocument;
    const invalidMarkdown = await app.inject({
      method: "PUT",
      url: `/api/entities/${ENTRY_ID}`,
      payload: {
        content: "not an Entity document",
        expectedFileHash: loaded.fileHash,
      },
    });
    expect(invalidMarkdown.statusCode).toBe(400);
    expect(parseJson(invalidMarkdown.body)).toMatchObject({
      error: "TypeError",
    });
  });

  it("serves the Web application from the configured static root", async () => {
    const vaultRoot = await copyFixtureVault();
    const webRoot = join(vaultRoot, "web-dist");
    await mkdir(webRoot);
    await writeFile(
      join(webRoot, "index.html"),
      "<!doctype html><title>PKM Web fixture</title>",
      "utf8",
    );
    const app = await openServerApp(vaultRoot, {
      vault: { watch: false },
      webRoot,
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("PKM Web fixture");
  });
});

describe("shared HTTP request validation", () => {
  it("does not expose server drafts or return them with documents", async () => {
    const root = await copyFixtureVault();
    const app = await openFixtureServer(root);
    const loaded = await app.inject({
      method: "GET",
      url: `/api/entities/${ENTRY_ID}`,
    });
    const document = parseJson(loaded.body) as EntityDocument;
    const response = await app.inject({
      method: "PUT",
      url: `/api/entities/${ENTRY_ID}/draft`,
      payload: {
        entityId: "must-not-override-the-route",
        content: "",
        baseHash: document.fileHash,
        path: "../../must-not-be-used",
      },
    });
    expect(response.statusCode).toBe(404);
    const reopened = await app.inject({
      method: "GET",
      url: `/api/entities/${ENTRY_ID}`,
    });
    expect(parseJson(reopened.body)).not.toHaveProperty("draft");
    expect(await readFile(join(root, ENTRY_PATH), "utf8")).toBe(
      document.content,
    );
  });

  it("rejects manual merges without content and Entry-only fields on other types", async () => {
    const app = await openFixtureServer(await copyFixtureVault());
    const invalidCreate = await app.inject({
      method: "POST",
      url: "/api/entities",
      payload: {
        type: "project",
        displayName: "project",
        journalDate: "2026-10-03",
      },
    });
    expect(invalidCreate.statusCode).toBe(400);
    const invalidMerge = await app.inject({
      method: "POST",
      url: "/api/conflicts/resolve",
      payload: {
        conflictPath: CONFLICT_PATH,
        resolution: "manual",
        expectedCanonicalHash: null,
        expectedConflictHash: `sha256:${"a".repeat(64)}`,
      },
    });
    expect(invalidMerge.statusCode).toBe(400);
  });

  it("enforces the same cleanup batch limit as IPC", async () => {
    const app = await openFixtureServer(await copyFixtureVault());
    const response = await app.inject({
      method: "POST",
      url: "/api/orphan-assets/delete",
      payload: {
        assets: Array.from({ length: 1001 }, () => ({
          path: "assets/files/example.txt",
          hash: `sha256:${"a".repeat(64)}`,
        })),
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
