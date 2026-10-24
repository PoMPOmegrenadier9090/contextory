import { describe, expect, it } from "vitest";

import { entityParentTrail } from "./entity-parent-links.js";
import type { PkmEntitySummary } from "@pkm/contracts";

const entity = (
  id: string,
  type: string,
  overrides: Partial<PkmEntitySummary> = {},
): PkmEntitySummary => ({
  id,
  type,
  path: `${type}s/${id}.md`,
  displayName: id,
  origin: null,
  status: null,
  priority: null,
  projectId: null,
  areaId: null,
  taskId: null,
  resourceId: null,
  canonicalIdentifier: null,
  sourceUri: null,
  assetPath: null,
  journalDate: null,
  occurredAt: null,
  dueAt: null,
  topicIds: [],
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: "2026-10-03T00:00:00Z",
  deletedAt: null,
  excludeFromAi: false,
  body: "",
  ...overrides,
});

describe("entityParentTrail", () => {
  it("resolves area and project for a task", () => {
    const area = entity("area-1", "area");
    const project = entity("project-1", "project", { areaId: area.id });
    const task = entity("task-1", "task", { projectId: project.id });
    expect(
      entityParentTrail(task, [task, project, area]).map(({ id }) => id),
    ).toEqual([area.id, project.id]);
  });

  it("links Entry contexts and inherits the task's project and area", () => {
    const area = entity("area", "area");
    const project = entity("project", "project", { areaId: area.id });
    const task = entity("task", "task", { projectId: project.id });
    const entry = entity("entry", "entry", { taskId: task.id });
    expect(entityParentTrail(entry, [entry, task, project, area])).toEqual([
      area,
      project,
      task,
    ]);
    expect(
      entityParentTrail({ ...entry, projectId: project.id }, [
        entry,
        project,
        area,
      ]),
    ).toEqual([area, project]);
  });

  it("resolves the area for a project", () => {
    const area = entity("area-1", "area");
    const project = entity("project-1", "project", { areaId: area.id });
    expect(entityParentTrail(project, [project, area])).toEqual([area]);
  });
});
