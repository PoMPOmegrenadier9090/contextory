export interface StaticBuild {
  readonly version: string;
  readonly coreFiles: readonly string[];
  readonly assetFiles: readonly string[];
  readonly shell: string;
}
interface WorkerEvent {
  waitUntil(work: Promise<unknown>): void;
}
interface WorkerFetchEvent extends WorkerEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}
export interface StaticWorkerScope {
  readonly location: { readonly origin: string };
  readonly caches: {
    open(name: string): Promise<Pick<Cache, "match" | "put">>;
    keys(): Promise<string[]>;
    delete(name: string): Promise<boolean>;
  };
  readonly clients: { claim(): Promise<void> };
  fetch(request: Request): Promise<Response>;
  addEventListener(
    type: "install" | "activate",
    listener: (event: WorkerEvent) => void,
  ): void;
  addEventListener(
    type: "fetch",
    listener: (event: WorkerFetchEvent) => void,
  ): void;
}

export const configureStaticWorker = (
  scope: StaticWorkerScope,
  build: StaticBuild,
): void => {
  const prefix = "pkm-static-";
  const name = prefix + build.version;
  const assets = new Set(build.assetFiles);
  const requestFor = (path: string) =>
    new Request(new URL(path, scope.location.origin));
  const previous = async (request: Request) => {
    for (const key of await scope.caches.keys()) {
      if (!key.startsWith(prefix) || key === name) continue;
      const found = await (await scope.caches.open(key)).match(request);
      if (found) return found;
    }
    return undefined;
  };
  scope.addEventListener("install", (event) => {
    event.waitUntil(
      (async () => {
        const cache = await scope.caches.open(name);
        await cache.put(
          requestFor("/"),
          new Response(build.shell, {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        );
        // Copy unchanged chunks already used by the previous build. Only core
        // files may trigger downloads; the editor stays on-demand.
        await Promise.all(
          build.assetFiles.map(async (path) => {
            const request = requestFor(path);
            const found = await previous(request);
            if (found) await cache.put(request, found);
            else if (build.coreFiles.includes(path)) {
              const response = await scope.fetch(request);
              if (!response.ok)
                throw new Error(`Static cache install failed: ${path}`);
              await cache.put(request, response);
            }
          }),
        );
      })(),
    );
  });
  scope.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        for (const key of await scope.caches.keys())
          if (key.startsWith(prefix) && key !== name)
            await scope.caches.delete(key);
        await scope.clients.claim();
      })(),
    );
  });
  // Keep the normal waiting lifecycle. Activating during an open editing
  // session could mix the old UI and a new HTTP contract.
  scope.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== "GET" || url.origin !== scope.location.origin)
      return;
    const navigation = event.request.mode === "navigate";
    if (navigation && url.pathname !== "/" && url.pathname !== "/index.html")
      return;
    if (!navigation && !assets.has(url.pathname)) return;
    event.respondWith(
      (async () => {
        const cache = await scope.caches.open(name).catch(() => undefined);
        const request = navigation ? requestFor("/") : requestFor(url.pathname);
        const cached = await cache?.match(request).catch(() => undefined);
        if (cached) return cached;
        const response = await scope.fetch(event.request);
        if (response.ok && cache) {
          const write = cache.put(request, response.clone()).catch(() => {});
          event.waitUntil(write);
        }
        return response;
      })(),
    );
  });
};
