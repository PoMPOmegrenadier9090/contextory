import { describe, expect, it } from "vitest";

import { resolveTopicInputs } from "./topic-creation.js";

describe("resolveTopicInputs", () => {
  it("reuses existing topics and returns normalized new names", () => {
    expect(
      resolveTopicInputs(
        ["PKM", " 新しいTopic ", "ｐｋｍ", "新しいTopic"],
        [
          {
            id: "topic-1",
            type: "topic",
            displayName: "pkm",
          },
        ],
      ),
    ).toEqual({
      existingIds: ["topic-1"],
      newNames: ["新しいTopic"],
    });
  });
});
