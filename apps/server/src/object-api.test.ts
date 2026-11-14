import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { ObjectPage, TypeDefinition, ViewResult } from "@pkm/core";
import { openServerApp } from "./http-api.js";

const directories: string[] = [];
const apps: FastifyInstance[] = [];

const open = async (dataDir: string): Promise<FastifyInstance> => {
  const app = await openServerApp({
    objectStorePath: join(dataDir, "objects.sqlite"),
  });
  apps.push(app);
  return app;
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("object API", () => {
  it("persists pages across restarts and serves the timeline from the index", async () => {
    const parent = await mkdtemp(join(tmpdir(), "pkms-object-api-"));
    directories.push(parent);

    const first = await open(parent);
    const created = await first.inject({
      method: "POST",
      url: "/api/next/objects",
      payload: { id: "project", type: "project", title: "計画" },
    });
    expect(created.statusCode).toBe(201);
    const saved = await first.inject({
      method: "PUT",
      url: "/api/next/pages/project",
      payload: {
        doc: {
          type: "doc",
          content: [
            {
              type: "objectBlock",
              attrs: { id: "b1", objectId: "task", type: "task" },
              content: [
                {
                  type: "objectTitle",
                  content: [{ type: "text", text: "やること" }],
                },
              ],
            },
          ],
        },
      },
    });
    expect(saved.statusCode).toBe(200);
    await first.inject({
      method: "PUT",
      url: "/api/next/pages/daily:2026-11-12",
      payload: {
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { id: "d1" },
              content: [
                { type: "objectRef", attrs: { objectId: "task" } },
                { type: "text", text: " を進めた" },
              ],
            },
          ],
        },
      },
    });
    await first.close();
    apps.length = 0;

    const second = await open(parent);
    const page = (
      await second.inject({ url: "/api/next/pages/project" })
    ).json<ObjectPage>();
    expect(page.objects.task).toMatchObject({
      title: "やること",
      contexts: ["project"],
    });
    // 先頭はProject自身のField行、その次が埋め込んだTask。
    expect(page.doc.content?.map((node) => node.type)).toEqual([
      "objectField",
      "objectBlock",
    ]);
    const patched = await second.inject({
      method: "PATCH",
      url: "/api/next/types/task",
      payload: { fields: [{ id: "due", name: "期限", kind: "text" }] },
    });
    expect(patched.json()).toMatchObject({
      name: "task",
      fields: [{ id: "context" }, { id: "due", name: "期限" }],
    });
    expect(
      (
        await second.inject({
          url: "/api/next/overview?from=0&to=1",
        })
      ).json(),
    ).toMatchObject({ recent: [] });
    const types = (await second.inject({ url: "/api/next/types" })).json<
      TypeDefinition[]
    >();
    const view = (name: string, scope: string): string =>
      types
        .find((type) => type.name === name)!
        .views.find((candidate) => candidate.scope === scope)!.id;
    const query = async (url: string): Promise<ViewResult> =>
      (await second.inject({ url })).json<ViewResult>();
    expect(
      (
        await query(`/api/next/views/${view("task", "type")}?today=2026-11-15`)
      ).rows.map((row) => row.object.id),
    ).toEqual(["task"]);
    const timeline = (
      await query(
        `/api/next/views/${view("project", "object")}?today=2026-11-15&anchor=project`,
      )
    ).entries;
    expect(
      timeline.map((entry) =>
        entry.kind === "object" ? entry.object.id : entry.text,
      ),
    ).toEqual(["やること を進めた", "task"]);
  });

  it("rejects unknown hosts and invalid input", async () => {
    const parent = await mkdtemp(join(tmpdir(), "pkms-object-api-"));
    directories.push(parent);
    const app = await open(parent);
    expect(
      (await app.inject({ url: "/api/next/pages/missing" })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/next/objects",
          payload: { id: "x", type: "not a type" },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("answers 409 when the page changed since it was opened", async () => {
    const parent = await mkdtemp(join(tmpdir(), "pkms-object-api-"));
    directories.push(parent);
    const app = await open(parent);
    const url = "/api/next/pages/daily%3A2026-11-14";
    const opened = (await app.inject({ url })).json<ObjectPage>();
    const save = (text: string, baseRevision: string) =>
      app.inject({
        method: "PUT",
        url,
        payload: {
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { id: "p" },
                content: [{ type: "text", text }],
              },
            ],
          },
          baseRevision,
        },
      });
    expect((await save("一台目", opened.revision)).statusCode).toBe(200);
    const stale = await save("二台目", opened.revision);
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ message: string }>().message).toContain(
      "PAGE_CONFLICT",
    );
  });
});
