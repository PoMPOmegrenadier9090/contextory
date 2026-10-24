import { expect, it } from "vitest";
import { agentCommandSchema } from "./agent-contract.js";

const types = ["project", "resource", "topic", "area"] as const;
const update = {
  operationId: "strict-update",
  entityId: "prj_01997c2a-7b1c-7a01-8a10-000000000003",
  expectedFileHash: `sha256:${"a".repeat(64)}`,
};

it.each(types)("restricts %s creation and edits to allowed fields", (type) => {
  const create = {
    kind: `create_${type}`,
    operationId: "strict-create",
    displayName: "Valid",
  };
  expect(agentCommandSchema.safeParse(create).success).toBe(true);
  expect(
    agentCommandSchema.safeParse({ ...create, displayName: " " }).success,
  ).toBe(false);
  expect(
    agentCommandSchema.safeParse({ ...create, body: "補足" }).success,
  ).toBe(true);
  expect(
    agentCommandSchema.safeParse({
      ...update,
      kind: `update_${type}`,
      patch: { body: "補足" },
    }).success,
  ).toBe(true);
  for (const field of [
    "id",
    "type",
    "createdAt",
    "updatedAt",
    "deletedAt",
    "origin",
    "excludeFromAi",
    "assetPath",
    "x_unknown",
  ]) {
    expect(
      agentCommandSchema.safeParse({ ...create, [field]: "protected" }).success,
    ).toBe(false);
    expect(
      agentCommandSchema.safeParse({
        ...update,
        kind: `update_${type}`,
        patch: { [field]: "protected" },
      }).success,
    ).toBe(false);
  }
  expect(
    agentCommandSchema.safeParse({ ...create, description: "two\nlines" })
      .success,
  ).toBe(false);
  expect(
    agentCommandSchema.safeParse({ ...create, description: "x".repeat(20_001) })
      .success,
  ).toBe(false);
  expect(
    agentCommandSchema.safeParse({ ...create, description: null }).success,
  ).toBe(true);
});

it("rejects Resource authors, relationship types and URLs that cannot be saved", () => {
  const create = {
    kind: "create_resource",
    operationId: "resource-fields",
    displayName: "Resource",
  };
  for (const fields of [
    { authors: ["Author", "Author"] },
    { authors: ["Author\nName"] },
    { relatedEntityIds: ["ent_01997c2a-7b1c-7a01-8a10-000000000006"] },
    { sourceUri: "invalid URL" },
  ])
    expect(agentCommandSchema.safeParse({ ...create, ...fields }).success).toBe(
      false,
    );
  expect(
    agentCommandSchema.safeParse({
      kind: "create_topic",
      operationId: "topic-fields",
      displayName: "Topic",
      topics: [],
    }).success,
  ).toBe(false);
  expect(
    agentCommandSchema.safeParse({
      ...update,
      kind: "update_area",
      patch: { status: "done" },
    }).success,
  ).toBe(false);
});

it("allows bounded Resource body edits, including clearing the memo", () => {
  for (const body of ["# Summary\n", ""]) {
    expect(
      agentCommandSchema.safeParse({
        kind: "create_resource",
        operationId: "resource-body",
        displayName: "Resource",
        body,
      }).success,
    ).toBe(true);
    expect(
      agentCommandSchema.safeParse({
        ...update,
        kind: "update_resource",
        patch: { body },
      }).success,
    ).toBe(true);
  }
  for (const body of [null, 1, "x".repeat(256 * 1024 + 1)])
    expect(
      agentCommandSchema.safeParse({
        ...update,
        kind: "update_resource",
        patch: { body },
      }).success,
    ).toBe(false);
});
