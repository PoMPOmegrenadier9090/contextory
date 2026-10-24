import { describe, expect, it } from "vitest";

import { parseMarkdownEntity } from "./markdown-parser.js";
import {
  serializeMarkdownEntity,
  serializeNewMarkdownEntity,
} from "./markdown-serializer.js";

const SOURCE = `---
id: ent_01997c2a-7b1c-7a01-8a10-000000000006
type: entry
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
origin: human
exclude_from_ai: false
unknown_field:
  nested: preserved # keep this comment
deleted_at: null
---

# 実装開始

本文の  空白は保持する。
`;

const parseSource = (source: string) => {
  const result = parseMarkdownEntity(source);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

describe("serializeMarkdownEntity", () => {
  it("serializes a new Entity with canonical key ordering", () => {
    const source = serializeNewMarkdownEntity(
      {
        id: "tsk_01997c2a-7b1c-7a01-8a10-000000000004",
        type: "task",
        title: "新しいTask",
        status: "not_started",
        project_id: null,
        area_id: null,
        created_at: "2026-09-22T01:23:45.000Z",
        updated_at: "2026-09-22T01:23:45.000Z",
      },
      { body: "本文\n" },
    );

    expect(source).toContain(
      "type: task\ntitle: 新しいTask\nstatus: not_started",
    );
    expect(source).toContain(
      "created_at: 2026-09-22T01:23:45.000Z\nupdated_at: 2026-09-22T01:23:45.000Z",
    );
    expect(source.endsWith("---\n本文\n")).toBe(true);
  });
  it("preserves the body byte-for-byte and retains unknown fields", () => {
    const parsed = parseSource(SOURCE);
    const serialized = serializeMarkdownEntity(parsed);
    const reparsed = parseSource(serialized);

    expect(reparsed.body).toBe(parsed.body);
    expect(serialized).toContain("nested: preserved # keep this comment");
    expect(reparsed.entity).toMatchObject({
      unknown_field: { nested: "preserved" },
      deleted_at: null,
    });
  });

  it("updates known fields without converting omitted fields to null", () => {
    const parsed = parseSource(SOURCE);
    const entity = {
      ...parsed.entity,
      updated_at: "2026-09-21T11:00:00+09:00",
    };
    const serialized = serializeMarkdownEntity(parsed, { entity });

    expect(serialized).toContain("updated_at: 2026-09-21T11:00:00+09:00");
    expect(serialized).not.toContain("occurred_at:");
    expect(serialized).toContain("deleted_at: null");
  });

  it("preserves CRLF in frontmatter and body", () => {
    const source = SOURCE.replaceAll("\n", "\r\n");
    const parsed = parseSource(source);
    const serialized = serializeMarkdownEntity(parsed);

    expect(serialized.replaceAll("\r\n", "")).not.toContain("\n");
    expect(parseSource(serialized).body).toBe(parsed.body);
  });
});
