import { describe, expect, it } from "vitest";

import {
  captureContextOptions,
  captureContextForEntity,
  composeCaptureBody,
  hasCaptureContent,
  removeTrailingEmptyTodoItem,
} from "./quick-capture.js";

describe("Quick Capture helpers", () => {
  it("does not save an empty checklist marker", () => {
    expect(hasCaptureContent("- [ ] ")).toBe(false);
    expect(hasCaptureContent("- [ ] 買い物")).toBe(true);
    expect(hasCaptureContent("短いメモ")).toBe(true);
  });

  it("removes only a trailing empty marker when saving", () => {
    expect(removeTrailingEmptyTodoItem("- [ ] ")).toBe("");
    expect(removeTrailingEmptyTodoItem("メモ\n- [ ] ")).toBe("メモ");
    expect(removeTrailingEmptyTodoItem("- [ ] 買い物")).toBe("- [ ] 買い物");
  });
});

describe("Quick Capture attachments and context", () => {
  it("appends attachments only on capture and permits an attachment-only entry", () => {
    const image = {
      path: "assets/images/01997c2a-7b1c-7a01-8a10-000000000099.webp",
      fileName: "写真.webp",
      mimeType: "image/webp",
      size: 2048,
    };
    expect(composeCaptureBody("短いメモ", [image])).toBe(
      "短いメモ\n![写真.webp](../assets/images/01997c2a-7b1c-7a01-8a10-000000000099.webp)\n",
    );
    expect(composeCaptureBody("", [image])).toBe(
      "![写真.webp](../assets/images/01997c2a-7b1c-7a01-8a10-000000000099.webp)\n",
    );
  });

  it("suggests context-capable entities and Topics with hierarchy", () => {
    const base = {
      areaId: null,
      projectId: null,
      taskId: null,
      resourceId: null,
    };
    const options = captureContextOptions([
      { ...base, id: "area-1", type: "area", displayName: "仕事" },
      {
        ...base,
        id: "project-1",
        type: "project",
        displayName: "PKM",
        areaId: "area-1",
      },
      {
        ...base,
        id: "task-1",
        type: "task",
        displayName: "設計",
        projectId: "project-1",
      },
      { ...base, id: "topic-1", type: "topic", displayName: "UX" },
    ]);
    expect(options.map((option) => option.id)).toEqual([
      "area-1",
      "project-1",
      "task-1",
      "topic-1",
    ]);
    expect(options.find((option) => option.id === "task-1")?.hierarchy).toBe(
      "仕事 > PKM",
    );
  });

  it("offers the current entity or an opened Entry's most specific context", () => {
    const task = {
      id: "task-1",
      type: "task",
      displayName: "設計",
      areaId: null,
      projectId: "project-1",
      taskId: null,
      resourceId: null,
      topicIds: [],
    };
    const entity = task;
    expect(captureContextForEntity(entity, [])).toBe(entity);
    expect(
      captureContextForEntity({ ...entity, type: "entry", taskId: task.id }, [
        task,
      ]),
    ).toBe(task);
    expect(
      captureContextForEntity(
        { ...entity, type: "entry", projectId: "project-2" },
        [],
      ),
    ).toMatchObject({
      id: "project-2",
      type: "project",
    });
    expect(
      captureContextForEntity(
        { ...entity, type: "entry", projectId: null },
        [],
      ),
    ).toBeNull();
    expect(captureContextForEntity(null, [])).toBeNull();
  });
});
