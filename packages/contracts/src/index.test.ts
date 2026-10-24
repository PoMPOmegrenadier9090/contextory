import { describe, expect, it } from "vitest";

import {
  createEntityId,
  createUuidV7,
  ENTITY_DIRECTORIES,
  ENTITY_ID_PREFIXES,
  ENTITY_TYPES,
  FRONTMATTER_KEY_ORDER,
  getEntityRelativePath,
} from "./index.js";

describe("schema v1 contracts", () => {
  it("defines a directory and ID prefix for every entity type", () => {
    expect(Object.keys(ENTITY_DIRECTORIES)).toEqual(ENTITY_TYPES);
    expect(Object.keys(ENTITY_ID_PREFIXES)).toEqual(ENTITY_TYPES);
  });

  it("starts every frontmatter key order with identity fields", () => {
    for (const type of ENTITY_TYPES) {
      expect(FRONTMATTER_KEY_ORDER[type].slice(0, 2)).toEqual(["id", "type"]);
    }
  });
});

describe("UUIDv7 entity identity", () => {
  it("creates a UUIDv7 with the expected timestamp, version, and variant", () => {
    const timestampMs = 1_758_420_000_123;
    const uuid = createUuidV7({
      timestampMs,
      randomBytes: new Uint8Array(16).fill(0xff),
    });
    const compact = uuid.replaceAll("-", "");

    expect(Number.parseInt(compact.slice(0, 12), 16)).toBe(timestampMs);
    expect(uuid[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(uuid[19]);
  });

  it("creates a typed entity ID and canonical relative path", () => {
    const id = createEntityId("task", {
      timestampMs: 1_758_420_000_123,
      randomBytes: new Uint8Array(16),
    });

    expect(id).toMatch(/^tsk_[0-9a-f-]+$/);
    expect(getEntityRelativePath("task", id)).toBe(`tasks/${id}.md`);
  });
});
