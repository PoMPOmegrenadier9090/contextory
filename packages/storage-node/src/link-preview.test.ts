import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLinkPreviewLoader,
  isPublicPreviewAddress,
  parseLinkPreview,
  previewUrl,
} from "./link-preview.js";

const fixture = vi.hoisted(() => ({
  address: "93.184.216.34",
  responses: [] as {
    status?: number;
    location?: string;
    type?: string;
    body: string | Buffer;
  }[],
  requests: [] as { url: string; options: RequestOptions }[],
}));
vi.mock("node:dns/promises", () => ({
  lookup: () => Promise.resolve([{ address: fixture.address, family: 4 }]),
}));
vi.mock("node:https", () => ({
  get: (
    url: URL,
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => {
    fixture.requests.push({ url: url.href, options });
    const data = fixture.responses.shift() ?? {
      body: "<title>Example</title>",
    };
    const request = new EventEmitter();
    queueMicrotask(() => {
      const stream = Object.assign(new PassThrough(), {
        statusCode: data.status ?? 200,
        headers: {
          "content-type": data.type ?? "text/html",
          location: data.location,
        },
      });
      callback(stream as unknown as IncomingMessage);
      if (!stream.destroyed) stream.end(data.body);
    });
    return request as ClientRequest;
  },
}));
beforeEach(() => {
  fixture.address = "93.184.216.34";
  fixture.responses = [];
  fixture.requests = [];
});

describe("link previews", () => {
  it("reads HTML metadata, decodes entities, prefers OG and treats script content as text only", () => {
    expect(
      parseLinkPreview(
        `<title>Fallback</title><meta content='調査 &amp; 記録' property='og:title'>
      <meta name=description content='  ひとつ\n  ふたつ  '><meta property=og:site_name content=Example>
      <script><meta property=og:title content=Bad></script>`,
        "https://example.com/",
      ),
    ).toEqual({
      url: "https://example.com/",
      title: "調査 & 記録",
      description: "ひとつ ふたつ",
      siteName: "Example",
      faviconUrl: "https://example.com/favicon.ico",
    });
    expect(
      parseLinkPreview("<title>A &lt; B</title>", "https://example.com/").title,
    ).toBe("A < B");
    expect(
      parseLinkPreview(
        '<meta name="twitter:title" content="Twitter">',
        "https://example.com/",
      ).title,
    ).toBe("Twitter");
  });
  it("rejects credentials, arbitrary ports, non-HTTP protocols and private/reserved IP ranges", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:pass@example.com",
      "http://example.com:8080",
      "a".repeat(4097),
    ])
      expect(() => previewUrl(url)).toThrow();
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "224.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "2002:7f00:1::",
      "not-an-ip",
    ])
      expect(isPublicPreviewAddress(address), address).toBe(false);
    expect(isPublicPreviewAddress("8.8.8.8")).toBe(true);
    expect(isPublicPreviewAddress("2606:4700::1111")).toBe(true);
  });
  it("deduplicates requests, pins the checked address and does not send cookies or credentials", async () => {
    const load = createLinkPreviewLoader();
    const first = load("https://example.com/#one");
    expect(load("https://example.com/#two")).toBe(first);
    expect(await first).toMatchObject({ title: "Example" });
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests[0]!.options).toMatchObject({
      agent: false,
      family: 4,
    });
    expect(fixture.requests[0]!.options.headers).not.toHaveProperty("Cookie");
    const lookup = fixture.requests[0]!.options.lookup!;
    const callback = vi.fn();
    lookup("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, fixture.address, 4);
  });
  it("blocks DNS resolving to local services and validates redirect destinations", async () => {
    fixture.address = "127.0.0.1";
    expect(await createLinkPreviewLoader()("https://example.com")).toBeNull();
    expect(fixture.requests).toHaveLength(0);
    fixture.address = "93.184.216.34";
    fixture.responses.push({
      status: 302,
      location: "http://127.0.0.1/admin",
      body: "",
    });
    expect(await createLinkPreviewLoader()("https://example.com")).toBeNull();
    expect(fixture.requests).toHaveLength(1);
  });
  it("follows relative redirects, rejects oversized/non-HTML responses and caches failures", async () => {
    fixture.responses.push(
      { status: 302, location: "/article", body: "" },
      { body: "<title>Article</title>" },
    );
    expect(
      await createLinkPreviewLoader()("https://example.com"),
    ).toMatchObject({ title: "Article" });
    expect(fixture.requests[1]!.url).toBe("https://example.com/article");
    fixture.responses.push({ body: "x".repeat(512 * 1024 + 1) });
    const load = createLinkPreviewLoader();
    expect(await load("https://example.com/large")).toBeNull();
    const count = fixture.requests.length;
    expect(await load("https://example.com/large")).toBeNull();
    expect(fixture.requests).toHaveLength(count);
    fixture.responses.push({ type: "application/pdf", body: "PDF" });
    expect(await load("https://example.com/document")).toBeNull();
  });
});

const png = Buffer.from("89504e470d0a1a0a", "hex");
describe("favicons", () => {
  it("resolves icon links against the final page URL and base, preferring icon over touch-icon", () => {
    expect(
      parseLinkPreview(
        '<base href="/assets/"><link rel="apple-touch-icon" href="touch.png"><link rel="shortcut ICON" href="site.png">',
        "https://example.com/final/page",
      ).faviconUrl,
    ).toBe("https://example.com/assets/site.png");
    expect(
      parseLinkPreview(
        '<link rel="apple-touch-icon" href="//cdn.example.com/touch.png">',
        "https://example.com/a",
      ).faviconUrl,
    ).toBe("https://cdn.example.com/touch.png");
  });
  it("fetches the declared favicon and returns raster data without remote image URLs", async () => {
    fixture.responses.push(
      {
        body: '<title>Article</title><link rel="icon" href="/icons/site.png">',
      },
      { type: "image/png", body: png },
    );
    const load = createLinkPreviewLoader();
    const preview = await load("https://example.com/article");
    expect(preview).toMatchObject({
      title: "Article",
      faviconDataUrl: `data:image/png;base64,${png.toString("base64")}`,
    });
    expect(preview).not.toHaveProperty("faviconUrl");
    expect(fixture.requests[1]!.url).toBe("https://example.com/icons/site.png");
    await load("https://example.com/article");
    expect(fixture.requests).toHaveLength(2);
  });
  it("falls back to the redirected site's default icon and rejects private icon targets", async () => {
    fixture.responses.push(
      { status: 302, location: "https://other.example.com/article", body: "" },
      {
        body: '<title>Article</title><link rel="icon" href="http://127.0.0.1/private">',
      },
      { body: png },
    );
    const preview = await createLinkPreviewLoader()("https://example.com/");
    expect(preview?.url).toBe("https://example.com/");
    expect(preview?.faviconDataUrl).toContain("data:image/png;base64,");
    expect(fixture.requests.map((r) => r.url)).toEqual([
      "https://example.com/",
      "https://other.example.com/article",
      "https://other.example.com/favicon.ico",
    ]);
  });
  it("checks icon redirects and retains metadata when fallback icons are missing", async () => {
    fixture.responses.push(
      { body: '<title>Article</title><link rel="icon" href="/icon">' },
      { status: 302, location: "http://[::1]/private", body: "" },
      { status: 404, body: "" },
    );
    expect(
      await createLinkPreviewLoader()("https://example.com/"),
    ).toMatchObject({ title: "Article", faviconDataUrl: null });
    expect(fixture.requests).toHaveLength(3);
  });
  it("rejects oversized images and HTML/SVG masquerading as icons while retaining metadata", async () => {
    fixture.responses.push(
      { body: '<title>Article</title><link rel="icon" href="/icon">' },
      {
        type: "image/png",
        body: Buffer.concat([png, Buffer.alloc(128 * 1024)]),
      },
      {
        type: "image/png",
        body: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      },
    );
    expect(
      await createLinkPreviewLoader()("https://example.com/"),
    ).toMatchObject({ title: "Article", faviconDataUrl: null });
  });
  it.each([
    ["image/x-icon", Buffer.from([0, 0, 1, 0, 1, 0])],
    ["image/jpeg", Buffer.from([255, 216, 255, 0])],
    ["image/gif", Buffer.from("GIF89a")],
    ["image/webp", Buffer.from("RIFF0000WEBP")],
  ])("recognizes %s by file signature", async (type, bytes) => {
    fixture.responses.push({ body: "<title>Article</title>" }, { body: bytes });
    expect(
      (await createLinkPreviewLoader()("https://example.com/"))?.faviconDataUrl,
    ).toBe(`data:${type};base64,${bytes.toString("base64")}`);
  });
});
