import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  validateEntityFile,
  validateVault,
  type VaultSourceFile,
} from "./validator.js";

const FIXTURE_ROOT = new URL("../../../fixtures/vault-v1/", import.meta.url);
const FIXTURE_PATHS = [
  "entries/ent_01997c2a-7b1c-7a01-8a10-000000000006.md",
  "projects/prj_01997c2a-7b1c-7a01-8a10-000000000003.md",
  "tasks/tsk_01997c2a-7b1c-7a01-8a10-000000000004.md",
  "resources/res_01997c2a-7b1c-7a01-8a10-000000000005.md",
  "topics/topic_01997c2a-7b1c-7a01-8a10-000000000002.md",
  "areas/area_01997c2a-7b1c-7a01-8a10-000000000001.md",
] as const;

const readFixtures = async (): Promise<readonly VaultSourceFile[]> =>
  Promise.all(
    FIXTURE_PATHS.map(async (path) => ({
      path,
      source: await readFile(new URL(path, FIXTURE_ROOT), "utf8"),
    })),
  );

describe("validateEntityFile", () => {
  it("reports identity mismatches while allowing untitled Entries", () => {
    const result = validateEntityFile({
      path: "tasks/wrong.md",
      source: `---
id: ent_01997c2a-7b1c-7a01-8a10-000000000099
type: entry
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
origin: human
exclude_from_ai: false
---

本文だけ。
`,
    });

    expect(result.issues.map((issue) => issue.code)).toEqual([
      "IdentityMismatch",
    ]);
  });

  it("separates missing, invalid-type, and invalid-value issues", () => {
    const result = validateEntityFile({
      path: "projects/prj_01997c2a-7b1c-7a01-8a10-000000000098.md",
      source: `---
id: prj_01997c2a-7b1c-7a01-8a10-000000000098
type: project
title: Invalid
status: active
created_at: 123
---
`,
    });

    expect(result.issues.map((issue) => issue.code)).toEqual([
      "InvalidValue",
      "InvalidType",
      "MissingField",
    ]);
  });

  it("accepts Resource Markdown bodies", () => {
    const result = validateEntityFile({
      path: "resources/res_01997c2a-7b1c-7a01-8a10-000000000098.md",
      source: `---
id: res_01997c2a-7b1c-7a01-8a10-000000000098
type: resource
title: Resource memo
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
---
# 全般メモ
資料についての理解。
`,
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("accepts a Markdown body on a Project", () => {
    const result = validateEntityFile({
      path: "projects/prj_01997c2a-7b1c-7a01-8a10-000000000098.md",
      source: `---
id: prj_01997c2a-7b1c-7a01-8a10-000000000098
type: project
title: Body should be an Entry
status: not_started
created_at: 2026-09-21T10:00:00+09:00
updated_at: 2026-09-21T10:00:00+09:00
---

This content should live in an Entry.
`,
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

describe("validateVault", () => {
  it("accepts the complete v1 fixture vault", async () => {
    const result = validateVault(await readFixtures());

    expect(result.issues).toEqual([]);
  });

  it("reports duplicate IDs and unresolved references", async () => {
    const fixtures = await readFixtures();
    const task = fixtures.find((file) => file.path.startsWith("tasks/"));
    if (task === undefined) throw new Error("Task fixture is missing");
    const missingProject = "prj_01997c2a-7b1c-7a01-8a10-000000000099";
    const duplicate = {
      path: task.path,
      source: task.source.replace(
        "prj_01997c2a-7b1c-7a01-8a10-000000000003",
        missingProject,
      ),
    };

    const result = validateVault([...fixtures, duplicate]);

    expect(
      result.issues.filter((issue) => issue.code === "DuplicateId"),
    ).toHaveLength(2);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "UnresolvedReference",
        severity: "warning",
        targetId: missingProject,
      }),
    );
  });
});
