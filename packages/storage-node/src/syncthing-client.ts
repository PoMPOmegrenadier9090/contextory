import { resolve } from "node:path";

export const DEFAULT_SYNCTHING_URL = "http://127.0.0.1:8384";

export class SyncthingApiError extends Error {
  override readonly name = "SyncthingApiError";

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SyncthingClientOptions {
  readonly baseUrl?: string;
  readonly apiKey: string;
  readonly fetcher?: typeof fetch;
}

export interface SyncthingSystemStatus {
  readonly myID: string;
  readonly uptime: number;
}

export interface SyncthingFolderDevice {
  readonly deviceID: string;
  readonly [key: string]: unknown;
}

export interface SyncthingFolderConfig {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly type: string;
  readonly devices: readonly SyncthingFolderDevice[];
  readonly [key: string]: unknown;
}

export interface SyncthingFolderStatus {
  readonly state: string;
  readonly stateChanged: string;
  readonly needBytes: number;
  readonly needTotalItems: number;
  readonly pullErrors: number;
}

export interface SyncthingStatus {
  readonly health: string;
  readonly deviceId: string;
  readonly uptimeSeconds: number;
  readonly folder: {
    readonly configured: boolean;
    readonly id: string;
    readonly path: string | null;
    readonly type: string | null;
    readonly state: string | null;
    readonly stateChanged: string | null;
    readonly needBytes: number | null;
    readonly needTotalItems: number | null;
    readonly pullErrors: number | null;
    readonly devices: readonly string[];
  };
}

export interface BootstrapSyncthingFolderRequest {
  readonly folderId: string;
  readonly label: string;
  readonly path: string;
  readonly deviceIds?: readonly string[];
}

export interface BootstrapSyncthingFolderResult {
  readonly created: boolean;
  readonly folderId: string;
  readonly path: string;
  readonly devices: readonly string[];
}

const requireRecord = (
  value: unknown,
  context: string,
): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Invalid Syncthing ${context} response`);
  }
  return value as Record<string, unknown>;
};

const requireString = (
  record: Record<string, unknown>,
  key: string,
  context: string,
): string => {
  const value = record[key];
  if (typeof value !== "string") {
    throw new TypeError(`Invalid Syncthing ${context}.${key}`);
  }
  return value;
};

const requireNumber = (
  record: Record<string, unknown>,
  key: string,
  context: string,
): number => {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`Invalid Syncthing ${context}.${key}`);
  }
  return value;
};

const normalizeBaseUrl = (source: string): URL => {
  const url = new URL(source);
  if (url.username.length > 0 || url.password.length > 0) {
    throw new TypeError("Syncthing URL must not contain credentials");
  }
  const loopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TypeError("Syncthing URL must use HTTPS unless it is loopback");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
};

const responseMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  } catch {
    // Fall back to the HTTP status below.
  }
  return `${response.status} ${response.statusText}`.trim();
};

const folderConfig = (value: unknown): SyncthingFolderConfig => {
  const record = requireRecord(value, "folder config");
  const devicesValue = record.devices;
  if (!Array.isArray(devicesValue)) {
    throw new TypeError("Invalid Syncthing folder config.devices");
  }
  const devices = devicesValue.map((device) => {
    const entry = requireRecord(device, "folder device");
    return {
      ...entry,
      deviceID: requireString(entry, "deviceID", "folder device"),
    };
  });
  return {
    ...record,
    id: requireString(record, "id", "folder config"),
    label: requireString(record, "label", "folder config"),
    path: requireString(record, "path", "folder config"),
    type: requireString(record, "type", "folder config"),
    devices,
  };
};

export class SyncthingClient {
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: SyncthingClientOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new TypeError("Syncthing API key must not be empty");
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_SYNCTHING_URL);
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  private async request(
    path: string,
    init: RequestInit = {},
    allowNotFound = false,
    authenticate = true,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.baseUrl), {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(5_000),
        headers: {
          accept: "application/json",
          ...(authenticate ? { "X-API-Key": this.options.apiKey } : {}),
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...init.headers,
        },
      });
    } catch (error) {
      throw new SyncthingApiError(
        0,
        `Cannot reach Syncthing at ${this.baseUrl.origin}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      throw new SyncthingApiError(
        response.status,
        await responseMessage(response),
      );
    }
    if (response.status === 204) return null;
    const source = await response.text();
    return source.trim().length === 0 ? null : (JSON.parse(source) as unknown);
  }

  async getHealth(): Promise<string> {
    const value = requireRecord(
      await this.request("/rest/noauth/health", {}, false, false),
      "health",
    );
    return requireString(value, "status", "health");
  }

  async getSystemStatus(): Promise<SyncthingSystemStatus> {
    const value = requireRecord(
      await this.request("/rest/system/status"),
      "system status",
    );
    return {
      myID: requireString(value, "myID", "system status"),
      uptime: requireNumber(value, "uptime", "system status"),
    };
  }

  async getFolderConfig(
    folderId: string,
  ): Promise<SyncthingFolderConfig | null> {
    const value = await this.request(
      `/rest/config/folders/${encodeURIComponent(folderId)}`,
      {},
      true,
    );
    return value === null ? null : folderConfig(value);
  }

  async getDefaultFolderConfig(): Promise<Record<string, unknown>> {
    return requireRecord(
      await this.request("/rest/config/defaults/folder"),
      "default folder config",
    );
  }

  async createFolder(config: SyncthingFolderConfig): Promise<void> {
    await this.request("/rest/config/folders", {
      method: "POST",
      body: JSON.stringify(config),
    });
  }

  async getFolderStatus(folderId: string): Promise<SyncthingFolderStatus> {
    const value = requireRecord(
      await this.request(
        `/rest/db/status?folder=${encodeURIComponent(folderId)}`,
      ),
      "folder status",
    );
    return {
      state: requireString(value, "state", "folder status"),
      stateChanged: requireString(value, "stateChanged", "folder status"),
      needBytes: requireNumber(value, "needBytes", "folder status"),
      needTotalItems: requireNumber(value, "needTotalItems", "folder status"),
      pullErrors: requireNumber(value, "pullErrors", "folder status"),
    };
  }

  async getStatus(folderId: string): Promise<SyncthingStatus> {
    const [health, system, folder] = await Promise.all([
      this.getHealth(),
      this.getSystemStatus(),
      this.getFolderConfig(folderId),
    ]);
    const status =
      folder === null ? null : await this.getFolderStatus(folderId);
    return {
      health,
      deviceId: system.myID,
      uptimeSeconds: system.uptime,
      folder: {
        configured: folder !== null,
        id: folderId,
        path: folder?.path ?? null,
        type: folder?.type ?? null,
        state: status?.state ?? null,
        stateChanged: status?.stateChanged ?? null,
        needBytes: status?.needBytes ?? null,
        needTotalItems: status?.needTotalItems ?? null,
        pullErrors: status?.pullErrors ?? null,
        devices: folder?.devices.map((device) => device.deviceID) ?? [],
      },
    };
  }

  async bootstrapFolder(
    request: BootstrapSyncthingFolderRequest,
  ): Promise<BootstrapSyncthingFolderResult> {
    const path = resolve(request.path);
    const existing = await this.getFolderConfig(request.folderId);
    if (existing !== null) {
      if (resolve(existing.path) !== path) {
        throw new Error(
          `Syncthing folder ${request.folderId} already points to ${existing.path}`,
        );
      }
      return {
        created: false,
        folderId: existing.id,
        path: existing.path,
        devices: existing.devices.map((device) => device.deviceID),
      };
    }

    const template = await this.getDefaultFolderConfig();
    const deviceIds = [...new Set(request.deviceIds ?? [])];
    const config = folderConfig({
      ...template,
      id: request.folderId,
      label: request.label,
      path,
      type: "sendreceive",
      devices: deviceIds.map((deviceID) => ({ deviceID })),
    });
    await this.createFolder(config);
    return {
      created: true,
      folderId: config.id,
      path: config.path,
      devices: deviceIds,
    };
  }
}
