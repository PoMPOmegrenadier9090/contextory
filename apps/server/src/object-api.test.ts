import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { ObjectPage, ObjectTimelineEntry } from "@pkm/core";
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
      (await second.inject({ url: "/api/next/objects?type=task" })).json(),
    ).toMatchObject([{ id: "task" }]);
    expect(
      (
        await second.inject({
          url: "/api/next/overview?from=0&to=1",
        })
      ).json(),
    ).toMatchObject({ recent: [] });
    const timeline = (
      await second.inject({ url: "/api/next/objects/project/timeline" })
    ).json<ObjectTimelineEntry[]>();
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
});
