import type { ObjectClient, ObjectOverview } from "./object-client.js";
import type {
  ObjectPage,
  ObjectSummary,
  ObjectTimelineEntry,
  TypeDefinition,
} from "./object-model.js";

export interface HttpObjectClientOptions {
  /** 空なら同じoriginの`/api/next`へ送る。 */
  readonly baseUrl?: string;
  /** Cloudflare Accessのservice tokenなど、全リクエストに付けるヘッダー。 */
  readonly headers?: Readonly<Record<string, string>>;
}

const encode = encodeURIComponent;

export const createHttpObjectClient = ({
  baseUrl = "",
  headers = {},
}: HttpObjectClientOptions = {}): ObjectClient => {
  const root = `${baseUrl.replace(/\/+$/, "")}/api/next`;
  const request = async <T>(
    method: string,
    path: string,
    body?: unknown,
    keepalive = false,
  ): Promise<T> => {
    const response = await fetch(`${root}${path}`, {
      method,
      keepalive,
      // Accessのログイン画面へ転送されたら、HTMLを読まずに認証の失敗として扱う。
      redirect: "manual",
      headers:
        body === undefined
          ? { ...headers }
          : { ...headers, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).catch((error: unknown) => {
      throw new Error("サーバーに接続できません", { cause: error });
    });
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 && response.status < 400) ||
      response.status === 401 ||
      response.status === 403
    )
      throw new Error("サーバーの認証に失敗しました（Cloudflare Access）");
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(detail?.message ?? `HTTP ${response.status}`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  };

  return {
    loadPage: (hostId) =>
      request<ObjectPage>("GET", `/pages/${encode(hostId)}`),
    savePage: (hostId, doc, keepalive = false) =>
      request<ObjectPage>(
        "PUT",
        `/pages/${encode(hostId)}`,
        { doc },
        keepalive,
      ),
    searchObjects: (query, exclude = null) =>
      request<readonly ObjectSummary[]>(
        "GET",
        `/objects?query=${encode(query)}${exclude ? `&exclude=${encode(exclude)}` : ""}`,
      ),
    objectsOfType: (type) =>
      request<readonly ObjectSummary[]>("GET", `/objects?type=${encode(type)}`),
    createObject: (input) => request<ObjectSummary>("POST", "/objects", input),
    patchObject: (id, patch) =>
      request<ObjectSummary>("PATCH", `/objects/${encode(id)}`, patch),
    timeline: (id) =>
      request<readonly ObjectTimelineEntry[]>(
        "GET",
        `/objects/${encode(id)}/timeline`,
      ),
    types: () => request<readonly TypeDefinition[]>("GET", "/types"),
    updateType: (name, patch) =>
      request<TypeDefinition>("PATCH", `/types/${encode(name)}`, patch),
    overview: (from, to) =>
      request<ObjectOverview>("GET", `/overview?from=${from}&to=${to}`),
  };
};
