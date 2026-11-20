import { describe, expect, it } from "vitest";

import {
  parseObjectCreate,
  parseObjectOverviewRange,
  parseObjectPageSave,
  parseObjectPatch,
  parseObjectTypePatch,
} from "./object-request-validation.js";

describe("Object request validation", () => {
  it("accepts shared HTTP and IPC inputs", () => {
    expect(
      parseObjectCreate({
        id: "project",
        type: "Project",
        title: "計画",
        parentId: null,
      }),
    ).toEqual({
      id: "project",
      type: "project",
      title: "計画",
      parentId: null,
    });
    expect(parseObjectPageSave({ doc: { type: "doc" } })).toEqual({
      doc: { type: "doc" },
      baseRevision: null,
    });
    expect(
      parseObjectPageSave({ doc: { type: "doc" }, baseRevision: "r1" })
        .baseRevision,
    ).toBe("r1");
    expect(parseObjectOverviewRange({ from: "10", to: 20 })).toEqual({
      from: 10,
      to: 20,
    });
  });

  it("rejects invalid types, documents, ranges and fields", () => {
    expect(() => parseObjectCreate({ id: "x", type: "not valid" })).toThrow();
    expect(() => parseObjectPageSave({ doc: { type: "paragraph" } })).toThrow();
    expect(() =>
      parseObjectPageSave({ doc: { type: "doc" }, baseRevision: 1 }),
    ).toThrow();
    expect(() => parseObjectOverviewRange({ from: 20, to: 10 })).toThrow();
    expect(() =>
      parseObjectTypePatch({
        fields: [{ id: "x", name: "期限", kind: null }],
      }),
    ).toThrow();
  });

  it("accepts explicit creation contexts and the no-activity flag", () => {
    for (const contextId of ["project", null])
      expect(
        parseObjectCreate({ id: "x", type: "memo", contextId }).contextId,
      ).toBe(contextId);
    for (const contextId of ["", 1, {}, false])
      expect(() =>
        parseObjectCreate({ id: "x", type: "memo", contextId }),
      ).toThrow(TypeError);
    expect(parseObjectPatch({ noActivity: true })).toEqual({
      noActivity: true,
    });
    expect(parseObjectPatch({ noActivity: false })).toEqual({
      noActivity: false,
    });
    expect(parseObjectPatch({ noActivity: "true" })).toEqual({});
  });
});
