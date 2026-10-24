import { describe, expect, it } from "vitest";
import type { PkmIndexChanges, PkmEntitySummary } from "@pkm/contracts";
import { entityQueryAffected } from "./query-invalidation.js";

const changes: PkmIndexChanges = {
  reset: false,
  entities: [{ id: "entry", type: "entry", fileHash: null }],
  types: ["entry"],
  scopeIds: ["old-area", "new-area", "topic"],
  backlinkIds: ["target"],
  namesChanged: false,
  countsChanged: false,
  calendarChanged: false,
  conflictsChanged: false,
};
describe("query dependency invalidation", () => {
  it("preserves a related Entry page when an unrelated Entry changes", () => {
    expect(
      entityQueryAffected(
        {
          type: "entry",
          relatedTo: "unrelated-area",
          entryRelationMode: "scoped",
        },
        changes,
      ),
    ).toBe(false);
    expect(
      entityQueryAffected(
        { type: "entry", relatedTo: "old-area", entryRelationMode: "scoped" },
        changes,
      ),
    ).toBe(true);
    expect(
      entityQueryAffected(
        { type: "entry", relatedTo: "target", entryRelationMode: "direct" },
        changes,
      ),
    ).toBe(true);
  });
  it("invalidates transitive membership after an intermediate Resource change", () => {
    const update = {
      ...changes,
      entities: [{ id: "intermediate", type: "resource", fileHash: null }],
      types: ["resource"],
      scopeIds: ["task"],
      backlinkIds: ["task"],
    };
    expect(
      entityQueryAffected(
        {
          relatedTo: "project",
          relatedResolution: "transitive",
          type: "entry",
        },
        update,
      ),
    ).toBe(true);
    expect(
      entityQueryAffected(
        { relatedTo: "project", relatedResolution: "direct", type: "entry" },
        update,
      ),
    ).toBe(false);
  });
  it("invalidates scoped Entries for newly referenced descendants and intermediate label changes", () => {
    const descendantChange = {
      ...changes,
      scopeIds: ["parent-area", "child-task"],
      backlinkIds: ["child-task"],
    };
    expect(
      entityQueryAffected(
        {
          type: "entry",
          relatedTo: "parent-area",
          entryRelationMode: "scoped",
        },
        descendantChange,
      ),
    ).toBe(true);
    const taskChange = {
      ...changes,
      entities: [{ id: "child-task", type: "task", fileHash: null }],
      types: ["task"],
      scopeIds: ["parent-area"],
      backlinkIds: [],
    };
    expect(
      entityQueryAffected(
        {
          type: "entry",
          relatedTo: "parent-area",
          entryRelationMode: "scoped",
        },
        taskChange,
      ),
    ).toBe(true);
  });
  it("invalidates Resource outgoing relations even when the changed type differs from the table", () => {
    const resourceChange = {
      ...changes,
      entities: [{ id: "resource", type: "resource", fileHash: null }],
      types: ["resource"],
      scopeIds: ["resource"],
      backlinkIds: ["project"],
    };
    expect(
      entityQueryAffected(
        { type: "project", relatedTo: "resource" },
        resourceChange,
      ),
    ).toBe(true);
    const targetChange = {
      ...resourceChange,
      entities: [{ id: "project", type: "project", fileHash: null }],
      types: ["project"],
      scopeIds: ["project"],
      backlinkIds: ["resource"],
    };
    expect(
      entityQueryAffected(
        { type: "area", relatedTo: "resource" },
        targetChange,
      ),
    ).toBe(true);
    expect(
      entityQueryAffected({ type: "area", relatedTo: "other" }, targetChange),
    ).toBe(false);
  });

  it("preserves unrelated types and scopes, invalidates new memberships and related targets", () => {
    expect(entityQueryAffected({ type: "task" }, changes)).toBe(false);
    expect(
      entityQueryAffected({ type: "entry", areaId: "other" }, changes),
    ).toBe(false);
    expect(
      entityQueryAffected({ type: "entry", areaId: "old-area" }, changes),
    ).toBe(true);
    expect(
      entityQueryAffected({ type: "entry", areaId: "new-area" }, changes),
    ).toBe(true);
    expect(entityQueryAffected({ relatedTo: "target" }, changes)).toBe(true);
    expect(entityQueryAffected({ topicIds: ["topic"] }, changes)).toBe(true);
    expect(entityQueryAffected({ ids: ["unrelated"] }, changes)).toBe(false);
  });
  it("invalidates parent labels even when the collection's type is unchanged", () => {
    const renamed = {
      ...changes,
      entities: [{ id: "parent", type: "area", fileHash: null }],
      types: ["area"],
    };
    expect(
      entityQueryAffected({ type: "entry" }, renamed, {
        items: [],
        included: [{ id: "parent" } as PkmEntitySummary],
        nextCursor: null,
      }),
    ).toBe(true);
  });
});
