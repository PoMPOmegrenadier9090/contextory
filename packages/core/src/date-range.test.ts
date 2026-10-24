import { expect, it } from "vitest";
import { agentQuerySchema } from "./agent-contract.js";
import { parseEntityPageQuery } from "./entity-query.js";

it("accepts one-sided date ranges and timezone-aware datetime ranges", () => {
  const query = {
    createdAt: {
      from: "2026-09-01T00:00:00+09:00",
      to: "2026-10-01T00:00:00+09:00",
    },
    journalDateRange: { from: "2026-09-01" },
  };
  expect(agentQuerySchema.parse(query)).toMatchObject(query);
  expect(parseEntityPageQuery(query)).toEqual(query);
});

it.each([
  { createdAt: {} },
  { createdAt: { from: "2026-09-01" } },
  { createdAt: { from: "2026-09-01T00:00:00" } },
  { createdAt: { from: "2026-02-30T00:00:00Z" } },
  {
    createdAt: {
      from: "2026-09-01T09:00:00+09:00",
      to: "2026-09-01T00:00:00Z",
    },
  },
  { updatedAt: { from: "2026-10-01T00:00:00Z", to: "2026-09-01T00:00:00Z" } },
  { journalDateRange: { from: "2026-02-30" } },
  { journalDateRange: { from: "2026-10-01", to: "2026-09-01" } },
  { dueAt: { after: "2026-09-01T00:00:00Z" } },
])("rejects invalid or empty date ranges: %j", (query) => {
  expect(agentQuerySchema.safeParse(query).success).toBe(false);
  expect(() => parseEntityPageQuery(query)).toThrow();
});

it("decodes JSON range query parameters for the HTTP API", () => {
  expect(
    parseEntityPageQuery({ createdAt: '{"from":"2026-09-01T00:00:00Z"}' }),
  ).toMatchObject({ createdAt: { from: "2026-09-01T00:00:00Z" } });
});
