import { describe, expect, it, vi } from "vitest";
import {
  configureStaticWorker,
  type StaticWorkerScope,
} from "./service-worker.js";

const key = (request: RequestInfo | URL) =>
  typeof request === "string"
    ? request
    : request instanceof URL
      ? request.href
      : request.url;
class MemoryCache {
  readonly records = new Map<string, Response>();
  match(request: RequestInfo | URL) {
    return Promise.resolve(this.records.get(key(request))?.clone());
  }
  put(request: RequestInfo | URL, response: Response) {
    this.records.set(key(request), response.clone());
    return Promise.resolve();
  }
}
interface CapturedEvent {
  readonly request?: Request;
  waitUntil(work: Promise<unknown>): void;
  respondWith(work: Promise<Response>): void;
}
const harness = () => {
  const handlers = new Map<string, unknown>();
  const stores = new Map<string, MemoryCache>();
  const network = vi.fn((request: Request) =>
    Promise.resolve(new Response(`network: ${request.url}`)),
  );
  const scope: StaticWorkerScope = {
    location: { origin: "https://pkm.test" },
    caches: {
      open: (name) => {
        if (!stores.has(name)) stores.set(name, new MemoryCache());
        return Promise.resolve(stores.get(name)!);
      },
      keys: () => Promise.resolve([...stores.keys()]),
      delete: (name) => Promise.resolve(stores.delete(name)),
    },
    clients: { claim: () => Promise.resolve() },
    fetch: network,
    addEventListener: (type: string, listener: unknown) => {
      handlers.set(type, listener);
    },
  };
  const fire = async (type: string, request?: Request) => {
    const work: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    (handlers.get(type) as (event: CapturedEvent) => void)({
      ...(request ? { request } : {}),
      waitUntil: (promise) => {
        work.push(promise);
      },
      respondWith: (promise) => {
        response = promise;
      },
    });
    const result = await response;
    await Promise.all(work);
    return result;
  };
  const request = (path: string, navigation = false) => {
    const value = new Request(`https://pkm.test${path}`);
    if (navigation) Object.defineProperty(value, "mode", { value: "navigate" });
    return value;
  };
  return { scope, network, stores, fire, request };
};
const core = ["/assets/app-hash.js", "/assets/style-hash.css"];
const editor = "/assets/editor-hash.js";

describe("PWA static cache", () => {
  it("precaches only the shell/core, caches the editor on demand and excludes API/attachments", async () => {
    const h = harness();
    configureStaticWorker(h.scope, {
      version: "first",
      coreFiles: core,
      assetFiles: [...core, editor],
      shell: "<html>shell</html>",
    });
    await h.fire("install");
    expect(
      h.network.mock.calls
        .map(([request]) => new URL(request.url).pathname)
        .sort(),
    ).toEqual([...core].sort());
    expect(await (await h.fire("fetch", h.request("/", true)))?.text()).toBe(
      "<html>shell</html>",
    );
    await h.fire("fetch", h.request(core[0]!));
    expect(h.network).toHaveBeenCalledTimes(2);
    await h.fire("fetch", h.request(editor));
    await h.fire("fetch", h.request(editor));
    expect(h.network).toHaveBeenCalledTimes(3);
    expect(await h.fire("fetch", h.request("/api/bootstrap"))).toBeUndefined();
    expect(
      await h.fire("fetch", h.request("/api/assets/image.png", true)),
    ).toBeUndefined();
    expect(
      await h.fire(
        "fetch",
        new Request("https://other.test/assets/app-hash.js"),
      ),
    ).toBeUndefined();
  });
  it("copies unchanged cached chunks across updates and only downloads the changed core", async () => {
    const h = harness();
    configureStaticWorker(h.scope, {
      version: "first",
      coreFiles: core,
      assetFiles: [...core, editor],
      shell: "old",
    });
    await h.fire("install");
    await h.fire("fetch", h.request(editor));
    const nextCore = ["/assets/app-new.js", core[1]!];
    configureStaticWorker(h.scope, {
      version: "second",
      coreFiles: nextCore,
      assetFiles: [...nextCore, editor],
      shell: "new",
    });
    await h.fire("install");
    expect(h.network).toHaveBeenCalledTimes(4);
    await h.fire("activate");
    expect([...h.stores.keys()]).toEqual(["pkm-static-second"]);
    await h.fire("fetch", h.request(editor));
    expect(h.network).toHaveBeenCalledTimes(4);
    expect(await (await h.fire("fetch", h.request("/", true)))?.text()).toBe(
      "new",
    );
  });
});
