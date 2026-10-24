import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export interface AgentOperationRecord {
  key: string;
  digest: string;
  entityId: string;
  timestamp: string;
  beforeHash: string | null;
  afterHash: string;
  state: "pending" | "completed" | "failed";
  error: string | null;
}
const owners = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();
export const operationDigest = (value: unknown): string => {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, stable(x)]),
      );
    return v;
  };
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
};

// Durable intent contains identifiers and hashes only; no note bodies or tokens.
export class AgentOperationStore {
  private readonly database: Database.Database;
  readonly path: string;
  constructor(path: string) {
    this.path = resolve(path);
    mkdirSync(dirname(this.path), { recursive: true });
    this.database = new Database(this.path);
    const version = this.database.pragma("user_version", {
      simple: true,
    }) as number;
    if (version > 1) {
      this.database.close();
      throw new Error("Unsupported agent operation store schema");
    }
    owners.set(this.path, (owners.get(this.path) ?? 0) + 1);
    chmodSync(this.path, 0o600);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("synchronous = FULL");
    this.database.exec(`CREATE TABLE IF NOT EXISTS operations (
      key TEXT PRIMARY KEY, digest TEXT NOT NULL, entityId TEXT NOT NULL,
      timestamp TEXT NOT NULL, beforeHash TEXT, afterHash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','completed','failed')), error TEXT
    )`);
    this.database.pragma("user_version = 1");
  }
  get(key: string): AgentOperationRecord | undefined {
    return this.database
      .prepare("SELECT * FROM operations WHERE key=?")
      .get(key) as AgentOperationRecord | undefined;
  }
  insert(record: AgentOperationRecord): void {
    this.database
      .prepare(
        "INSERT INTO operations VALUES (@key,@digest,@entityId,@timestamp,@beforeHash,@afterHash,@state,@error)",
      )
      .run(record);
  }
  complete(key: string): void {
    this.database
      .prepare(
        "UPDATE operations SET state='completed', error=NULL WHERE key=?",
      )
      .run(key);
  }
  fail(key: string, code: string): void {
    this.database
      .prepare("UPDATE operations SET state='failed', error=? WHERE key=?")
      .run(code, key);
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = (queues.get(this.path) ?? Promise.resolve()).then(operation);
    queues.set(
      this.path,
      next.catch(() => {}),
    );
    return next;
  }
  async close(): Promise<void> {
    await queues.get(this.path);
    this.database.close();
    const remaining = (owners.get(this.path) ?? 1) - 1;
    if (remaining === 0) {
      owners.delete(this.path);
      queues.delete(this.path);
    } else owners.set(this.path, remaining);
  }
}
