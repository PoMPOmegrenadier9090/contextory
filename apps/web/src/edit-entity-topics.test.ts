import { describe, expect, it, vi } from "vitest";
import { parseMarkdownEntity } from "@pkm/core";
import { editEntityTopics } from "./edit-entity-topics.js";

const entityId = "ent_01997c2a-7b1c-7a01-8a10-000000000006";
const existingId = "topic_01997c2a-7b1c-7a01-8a10-000000000002";
const newId = "topic_01997c2a-7b1c-7a01-8a10-000000000007";
const source = `---
id: ${entityId}
type: entry
title: 編集中
topics:
  - ${existingId}
created_at: 2026-10-04T00:00:00+09:00
updated_at: 2026-10-04T00:00:00+09:00
origin: human
exclude_from_ai: false
x-custom: keep
---
未保存の本文
`;
const setup = () => {
  let draft = { entityId, content: source, selection: 1 };
  return {
    getDraft: () => draft,
    setDraft: (next: typeof draft) => {
      draft = next;
    },
    resolveTopics: vi
      .fn<
        (
          names: readonly string[],
        ) => Promise<{ existingIds: string[]; newNames: string[] }>
      >()
      .mockResolvedValue({ existingIds: [existingId], newNames: [] }),
    createTopic: vi
      .fn<(name: string) => Promise<string>>()
      .mockResolvedValue(newId),
    applyContent: vi.fn((content: string) => {
      draft = { ...draft, content };
    }),
  };
};

describe("Entry Topics draft editing", () => {
  it("adds existing/new Topics to the latest draft without losing intervening body edits", async () => {
    const options = setup();
    const pending = Promise.withResolvers<{
      existingIds: string[];
      newNames: string[];
    }>();
    options.resolveTopics.mockReturnValueOnce(pending.promise);
    const edit = editEntityTopics(["Existing", "New"], options);
    options.setDraft({
      ...options.getDraft(),
      content: source.replace("未保存の本文", "検索中に追記した本文"),
    });
    pending.resolve({ existingIds: [existingId], newNames: ["New"] });
    await edit;
    expect(options.createTopic).toHaveBeenCalledWith("New");
    expect(parseMarkdownEntity(options.getDraft().content)).toMatchObject({
      ok: true,
      value: {
        entity: { topics: [existingId, newId], "x-custom": "keep" },
        body: "検索中に追記した本文\n",
      },
    });
  });

  it("retains unresolved IDs and removes all Topics through the same draft path", async () => {
    const options = setup();
    options.resolveTopics.mockResolvedValue({ existingIds: [], newNames: [] });
    await editEntityTopics([existingId], options);
    expect(options.resolveTopics).toHaveBeenCalledWith([]);
    expect(options.createTopic).not.toHaveBeenCalled();
    expect(parseMarkdownEntity(options.getDraft().content)).toMatchObject({
      ok: true,
      value: { entity: { topics: [existingId] } },
    });
    await editEntityTopics([], options);
    expect(parseMarkdownEntity(options.getDraft().content)).toMatchObject({
      ok: true,
      value: { entity: { topics: [] }, body: "未保存の本文\n" },
    });
  });

  it("discards delayed results after the Entry selection changes, including reopening the same ID", async () => {
    const options = setup();
    const pending = Promise.withResolvers<{
      existingIds: string[];
      newNames: string[];
    }>();
    options.resolveTopics.mockReturnValueOnce(pending.promise);
    const edit = editEntityTopics(["New"], options);
    options.setDraft({ ...options.getDraft(), selection: 2 });
    pending.resolve({ existingIds: [], newNames: ["New"] });
    await expect(edit).rejects.toThrow("Entityが切り替わった");
    expect(options.createTopic).not.toHaveBeenCalled();
    expect(options.applyContent).not.toHaveBeenCalled();
  });

  it("keeps the draft when Topic creation fails", async () => {
    const options = setup();
    options.resolveTopics.mockResolvedValue({
      existingIds: [],
      newNames: ["New"],
    });
    options.createTopic.mockRejectedValue(new Error("offline"));
    await expect(editEntityTopics(["New"], options)).rejects.toThrow("offline");
    expect(options.getDraft().content).toBe(source);
    expect(options.applyContent).not.toHaveBeenCalled();
  });

  it("rejects invalid Raw frontmatter before resolving or creating Topics", async () => {
    const options = setup();
    options.setDraft({
      ...options.getDraft(),
      content: "---\nid: [\n---\n本文",
    });
    await expect(editEntityTopics(["New"], options)).rejects.toThrow(
      "frontmatter",
    );
    expect(options.resolveTopics).not.toHaveBeenCalled();
    expect(options.createTopic).not.toHaveBeenCalled();
    expect(options.applyContent).not.toHaveBeenCalled();
  });
});

it("edits Resource Topics without losing its unsaved body or metadata", async () => {
  const options = setup();
  options.resolveTopics.mockResolvedValue({ existingIds: [], newNames: [] });
  const resourceId = entityId.replace("ent_", "res_");
  options.setDraft({
    entityId: resourceId,
    selection: 1,
    content: source
      .replace(entityId, resourceId)
      .replace("type: entry", "type: resource")
      .replace(
        "origin: human\nexclude_from_ai: false\n",
        "authors: [Author]\n",
      ),
  });
  await editEntityTopics([], options);
  expect(parseMarkdownEntity(options.getDraft().content)).toMatchObject({
    ok: true,
    value: {
      entity: {
        type: "resource",
        authors: ["Author"],
        topics: [],
        "x-custom": "keep",
      },
      body: "未保存の本文\n",
    },
  });
});
