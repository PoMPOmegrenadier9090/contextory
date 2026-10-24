import type { TodoQuery, ToggleTodoRequest } from "@pkm/contracts";
import { z } from "zod";

const queryNumber = (max: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
    z.number().int().min(0).max(max),
  );
const querySchema = z
  .object({
    state: z.enum(["unchecked", "checked", "all"]).optional(),
    limit: queryNumber(100)
      .refine((value) => value > 0)
      .optional(),
    cursor: z.string().max(2000).optional(),
    scopeType: z.enum(["area", "project", "task", "resource"]).optional(),
    scopeId: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (query) =>
      (query.scopeType === undefined) === (query.scopeId === undefined),
    "scopeType and scopeId must be supplied together",
  );
const toggleSchema = z
  .object({
    entryId: z.string().min(1),
    markerFrom: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    checked: z.boolean(),
    expectedFileHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict();

export const parseTodoQuery = (value: unknown): TodoQuery => {
  const result = querySchema.safeParse(value);
  if (!result.success)
    throw new TypeError(`Invalid Todo query: ${result.error.message}`);
  return result.data;
};
export const parseToggleTodoRequest = (value: unknown): ToggleTodoRequest => {
  const result = toggleSchema.safeParse(value);
  if (!result.success)
    throw new TypeError(`Invalid Todo update: ${result.error.message}`);
  return {
    ...result.data,
    expectedFileHash: result.data
      .expectedFileHash as ToggleTodoRequest["expectedFileHash"],
  };
};
