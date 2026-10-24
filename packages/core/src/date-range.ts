import { z } from "zod";

const range = (boundary: z.ZodType<string>, datetime: boolean) =>
  z
    .strictObject({ from: boundary.optional(), to: boundary.optional() })
    .refine(
      (value) => value.from !== undefined || value.to !== undefined,
      "Supply at least one range boundary",
    )
    .refine(
      (value) =>
        value.from === undefined ||
        value.to === undefined ||
        (datetime
          ? Date.parse(value.from) < Date.parse(value.to)
          : value.from < value.to),
      "from must be earlier than to",
    )
    .describe("Inclusive from, exclusive to; either boundary may be omitted.");

export const entityDateRangeFields = {
  createdAt: range(z.iso.datetime({ offset: true }), true).optional(),
  updatedAt: range(z.iso.datetime({ offset: true }), true).optional(),
  occurredAt: range(z.iso.datetime({ offset: true }), true).optional(),
  dueAt: range(z.iso.datetime({ offset: true }), true).optional(),
  journalDateRange: range(z.iso.date(), false).optional(),
};
