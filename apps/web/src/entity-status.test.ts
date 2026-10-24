import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EntityIcon } from "../../../packages/ui/src/entity-icon.js";
import {
  EntityStatusLabel,
  EntityStatusLight,
} from "../../../packages/ui/src/entity-status.js";

const icon = (status?: string) =>
  renderToStaticMarkup(createElement(EntityIcon, { type: "task", status }));

describe("Entity status appearance", () => {
  it("distinguishes all four Task states by shape, retaining the generic Tasks navigation icon", () => {
    const states = ["not_started", "in_progress", "on_hold", "done"].map(icon);
    expect(
      new Set(states.map((markup) => markup.slice(markup.indexOf("<circle"))))
        .size,
    ).toBe(4);
    expect(states[0]).not.toContain("<path");
    expect(states[1]).toContain('fill="currentColor"');
    expect(states[2]).toContain('d="M9 8v8M15 8v8"');
    expect(states[3]).toContain('d="m8 12 3 3 5-6"');
    expect(icon()).toContain('d="m8 12 3 3 5-6"');
  });
  it("shows a light only while in progress and retains a text label for each state", () => {
    for (const [status, label] of [
      ["not_started", "未着手"],
      ["in_progress", "進行中"],
      ["on_hold", "保留"],
      ["done", "完了"],
    ]) {
      const light = renderToStaticMarkup(
        createElement(EntityStatusLight, { status }),
      );
      expect(light.includes("entity-status-light")).toBe(
        status === "in_progress",
      );
      expect(
        renderToStaticMarkup(createElement(EntityStatusLabel, { status })),
      ).toContain(label);
    }
  });
});
