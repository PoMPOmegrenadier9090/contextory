import type { PkmLinkPreview } from "@pkm/contracts";
import { lookup } from "node:dns/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { BlockList, isIP } from "node:net";
import { parse, type DefaultTreeAdapterMap } from "parse5";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("3fff::", 20, "ipv6");

export const isPublicPreviewAddress = (address: string): boolean => {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
};

export const previewUrl = (value: unknown): URL => {
  if (typeof value !== "string" || value.length > 4096)
    throw Error("Invalid URL");
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    throw Error("Unsupported URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !isPublicPreviewAddress(host))
    throw Error("Private address");
  url.hash = "";
  return url;
};

export const parseLinkPreview = (
  html: string,
  url: string,
): Omit<PkmLinkPreview, "faviconDataUrl"> & { readonly faviconUrl: string } => {
  const meta = new Map<string, string>();
  let title = "";
  let icon: string | undefined;
  let touchIcon: string | undefined;
  let baseUrl = url;
  const walk = (node: DefaultTreeAdapterMap["node"]) => {
    if ("tagName" in node && node.tagName === "meta") {
      const attrs = new Map(node.attrs.map((a) => [a.name, a.value]));
      const key = (attrs.get("property") ?? attrs.get("name"))?.toLowerCase();
      if (key && !meta.has(key)) meta.set(key, attrs.get("content") ?? "");
    }
    if ("tagName" in node && node.tagName === "base") {
      const href = node.attrs.find((a) => a.name === "href")?.value;
      if (href) {
        try {
          baseUrl = new URL(href, url).href;
        } catch {
          /* Ignore invalid base URLs. */
        }
      }
    }
    if ("tagName" in node && node.tagName === "link") {
      const attrs = new Map(node.attrs.map((a) => [a.name, a.value]));
      const rel = attrs.get("rel")?.toLowerCase().split(/\s+/) ?? [];
      if (rel.includes("icon")) icon ??= attrs.get("href");
      if (rel.includes("apple-touch-icon")) touchIcon ??= attrs.get("href");
    }
    if ("tagName" in node && node.tagName === "title")
      title = node.childNodes
        .map((child) => ("value" in child ? child.value : ""))
        .join("");
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  walk(parse(html));
  const clean = (value: string | undefined, max: number) =>
    value?.replace(/\s+/g, " ").trim().slice(0, max) || null;
  let faviconUrl = new URL("/favicon.ico", url).href;
  try {
    if (icon || touchIcon)
      faviconUrl = new URL((icon || touchIcon)!, baseUrl).href;
  } catch {
    /* Use the default icon. */
  }
  return {
    faviconUrl,
    url,
    title: clean(
      meta.get("og:title") || meta.get("twitter:title") || title,
      300,
    ),
    description: clean(
      meta.get("og:description") ||
        meta.get("twitter:description") ||
        meta.get("description"),
      600,
    ),
    siteName: clean(meta.get("og:site_name"), 100),
  };
};

const fetchPreviewResource = async (
  input: string,
  kind: "page" | "icon",
  signal: AbortSignal,
): Promise<{ bytes: Buffer; contentType: string; url: string }> => {
  let url = previewUrl(input);
  for (let redirects = 0; redirects <= 3; redirects++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(Error("Preview timed out")),
          { once: true },
        ),
      ),
    ]);
    signal.throwIfAborted();
    if (
      !addresses.length ||
      addresses.some((a) => !isPublicPreviewAddress(a.address))
    )
      throw Error("Private address");
    const address = addresses[0]!;
    const result = await new Promise<{
      bytes: Buffer;
      contentType: string;
      location?: string;
    }>((resolve, reject) => {
      const get = url.protocol === "https:" ? httpsGet : httpGet;
      const request = get(
        url,
        {
          signal,
          agent: false,
          family: address.family,
          // Pin the checked address so DNS rebinding cannot reach a local service.
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
          headers: {
            Accept:
              kind === "page" ? "text/html, application/xhtml+xml" : "image/*",
            "User-Agent": "PKMS-LinkPreview/1.0",
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (
            [301, 302, 303, 307, 308].includes(status) &&
            response.headers.location
          ) {
            resolve({
              bytes: Buffer.alloc(0),
              contentType: "",
              location: response.headers.location,
            });
            response.destroy();
            return;
          }
          if (
            status < 200 ||
            status >= 300 ||
            (kind === "page" &&
              !/^(text\/html|application\/xhtml\+xml)\b/i.test(
                response.headers["content-type"] ?? "",
              ))
          ) {
            reject(Error("Not an HTML page"));
            response.destroy();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > (kind === "page" ? 512 : 128) * 1024) {
              reject(Error("Page too large"));
              response.destroy();
            } else chunks.push(chunk);
          });
          response.on("end", () =>
            resolve({
              bytes: Buffer.concat(chunks),
              contentType: response.headers["content-type"] ?? "",
            }),
          );
          response.on("error", reject);
        },
      );
      request.on("error", reject);
    });
    if (!result.location) return { ...result, url: url.href };
    url = previewUrl(new URL(result.location, url).href);
  }
  throw Error("Too many redirects");
};

// shortcut: raster icons only; add sanitized SVG support when SVG-only sites need it.
const faviconDataUrl = (bytes: Buffer): string | null => {
  const type = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))
      ? "image/x-icon"
      : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        ? "image/jpeg"
        : /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))
          ? "image/gif"
          : bytes.toString("ascii", 0, 4) === "RIFF" &&
              bytes.toString("ascii", 8, 12) === "WEBP"
            ? "image/webp"
            : null;
  return type ? `data:${type};base64,${bytes.toString("base64")}` : null;
};

const fetchPreview = async (input: string): Promise<PkmLinkPreview> => {
  const page = await fetchPreviewResource(
    input,
    "page",
    AbortSignal.timeout(6000),
  );
  const charset =
    /charset\s*=\s*["']?([^\s;"']+)/i.exec(page.contentType)?.[1] ??
    /charset\s*=\s*["']?([^\s>"'/;]+)/i.exec(
      page.bytes.toString("ascii", 0, 2048),
    )?.[1] ??
    "utf-8";
  let html: string;
  try {
    html = new TextDecoder(charset).decode(page.bytes);
  } catch {
    html = page.bytes.toString("utf8");
  }
  const { faviconUrl, ...preview } = parseLinkPreview(html, page.url);
  const signal = AbortSignal.timeout(3000);
  let favicon: string | null = null;
  for (const url of new Set([
    faviconUrl,
    new URL("/favicon.ico", page.url).href,
  ])) {
    try {
      favicon = faviconDataUrl(
        (await fetchPreviewResource(url, "icon", signal)).bytes,
      );
      if (favicon) break;
    } catch {
      /* Icon failures must not discard page metadata. */
    }
  }
  return { ...preview, url: input, faviconDataUrl: favicon };
};

export const createLinkPreviewLoader = () => {
  const cache = new Map<
    string,
    { expires: number; result: Promise<PkmLinkPreview | null> }
  >();
  const lanes: Promise<unknown>[] = Array.from({ length: 4 }, () =>
    Promise.resolve(),
  );
  let nextLane = 0;
  let pending = 0;
  return (input: unknown): Promise<PkmLinkPreview | null> => {
    let url: string;
    try {
      url = previewUrl(input).href;
    } catch {
      return Promise.resolve(null);
    }
    const cached = cache.get(url);
    if (cached && cached.expires > Date.now()) return cached.result;
    if (pending >= 192) return Promise.resolve(null);
    pending++;
    const lane = nextLane++ % lanes.length;
    const result = lanes[lane]!.then(() => fetchPreview(url))
      .catch(() => null)
      .finally(() => {
        pending--;
      });
    lanes[lane] = result;
    cache.delete(url);
    cache.set(url, { expires: Date.now() + 10 * 60 * 1000, result });
    if (cache.size > 256) cache.delete(cache.keys().next().value!);
    return result;
  };
};
