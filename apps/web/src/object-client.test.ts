import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpObjectClient } from "./object-client.js";

afterEach(() => vi.unstubAllGlobals());

describe("HTTP Object client", () => {
  it("encodes page IDs and sends document saves", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ doc: { type: "doc" }, objects: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await createHttpObjectClient().savePage(
      "daily:2026-11-12",
      { type: "doc" },
      true,
    );

    expect(fetch).toHaveBeenCalledWith("/api/next/pages/daily%3A2026-11-12", {
      method: "PUT",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc: { type: "doc" } }),
    });
  });

  it("requests one day's overview", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ navigation: [], recent: [] }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await createHttpObjectClient().overview(10, 20);

    expect(fetch).toHaveBeenCalledWith("/api/next/overview?from=10&to=20", {
      method: "GET",
      keepalive: false,
    });
  });
});
