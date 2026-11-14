import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpObjectClient } from "./object-http-client.js";

afterEach(() => vi.unstubAllGlobals());

const respond = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("HTTP Object client", () => {
  it("encodes page IDs and sends document saves", async () => {
    const fetch = respond({ doc: { type: "doc" }, objects: {} });
    vi.stubGlobal("fetch", fetch);

    await createHttpObjectClient().savePage(
      "daily:2026-11-12",
      { type: "doc" },
      true,
    );

    expect(fetch).toHaveBeenCalledWith("/api/next/pages/daily%3A2026-11-12", {
      method: "PUT",
      keepalive: true,
      redirect: "manual",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ doc: { type: "doc" } }),
    });
  });

  it("sends service token headers to the configured server", async () => {
    const fetch = respond({ navigation: [], recent: [] });
    vi.stubGlobal("fetch", fetch);

    await createHttpObjectClient({
      baseUrl: "https://pkm.example.com/",
      headers: { "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "s" },
    }).overview(10, 20);

    expect(fetch).toHaveBeenCalledWith(
      "https://pkm.example.com/api/next/overview?from=10&to=20",
      {
        method: "GET",
        keepalive: false,
        redirect: "manual",
        headers: {
          "CF-Access-Client-Id": "id",
          "CF-Access-Client-Secret": "s",
        },
      },
    );
  });

  it.each([302, 401, 403])(
    "reports an Access rejection (%i) as an authentication error",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status })),
      );
      await expect(createHttpObjectClient().types()).rejects.toThrow(
        "サーバーの認証に失敗しました",
      );
    },
  );

  it("reports a network failure in words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(createHttpObjectClient().types()).rejects.toThrow(
      "サーバーに接続できません",
    );
  });

  it("passes server error messages through", async () => {
    vi.stubGlobal("fetch", respond({ message: "type is invalid" }, 400));
    await expect(createHttpObjectClient().types()).rejects.toThrow(
      "type is invalid",
    );
  });
});
