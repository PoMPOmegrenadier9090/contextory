import { describe, expect, it } from "vitest";

import { parseMarkdownEntity } from "./markdown-parser.js";

const VALID_ENTRY = `---
id: ent_01997c2a-7b1c-7a01-8a10-000000000006
type: entry
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
origin: human
exclude_from_ai: false
unknown_field:
  nested: preserved
deleted_at: null
---

# 実装開始

本文。
`;

describe("parseMarkdownEntity", () => {
  it("separates frontmatter while retaining the exact original source", () => {
    const result = parseMarkdownEntity(VALID_ENTRY);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.source).toBe(VALID_ENTRY);
      expect(result.value.body).toBe("\n# 実装開始\n\n本文。\n");
      expect(result.value.entity).toMatchObject({
        id: "ent_01997c2a-7b1c-7a01-8a10-000000000006",
        unknown_field: { nested: "preserved" },
      });
    }
  });

  it("supports CRLF without normalizing the body", () => {
    const source = VALID_ENTRY.replaceAll("\n", "\r\n");
    const result = parseMarkdownEntity(source);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lineEnding).toBe("\r\n");
      expect(result.value.source).toBe(source);
      expect(result.value.body).toContain("\r\n");
    }
  });

  it("reports malformed YAML without discarding the source", () => {
    const source = "---\nid: [\n---\nbody\n";
    const result = parseMarkdownEntity(source);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_YAML", source },
    });
  });

  it("rejects a project task that also stores an area", () => {
    const result = parseMarkdownEntity(`---
id: tsk_01997c2a-7b1c-7a01-8a10-000000000004
type: task
title: Invalid placement
status: not_started
project_id: prj_01997c2a-7b1c-7a01-8a10-000000000003
area_id: area_01997c2a-7b1c-7a01-8a10-000000000001
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
deleted_at: null
---
`);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_ENTITY" },
    });
  });
});
