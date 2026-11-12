import type {
  ObjectClient,
  ObjectOverview,
  ObjectPage,
  ObjectSummary,
  ObjectTimelineEntry,
  TypeDefinition,
} from "@pkm/core";

const encode = encodeURIComponent;

const request = async <T>(
  method: string,
  path: string,
  body?: unknown,
  keepalive = false,
): Promise<T> => {
  const response = await fetch(`/api/next${path}`, {
    method,
    keepalive,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(detail?.message ?? `HTTP ${response.status}`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
};

export const createHttpObjectClient = (): ObjectClient => ({
  loadPage: (hostId) => request<ObjectPage>("GET", `/pages/${encode(hostId)}`),
  savePage: (hostId, doc, keepalive = false) =>
    request<ObjectPage>("PUT", `/pages/${encode(hostId)}`, { doc }, keepalive),
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
});
