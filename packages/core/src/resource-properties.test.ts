import { describe, expect, it } from "vitest";
import { parseMarkdownEntity } from "./markdown-parser.js";
import { updateEntityMetadata } from "./entity-metadata.js";
import { parseMetadataPatch } from "./request-validation.js";
import { collectEntityReferences } from "./validator.js";

const resourceId = "res_01997c2a-7b1c-7a01-8a10-000000000005";
const targetIds = [
  "area_01997c2a-7b1c-7a01-8a10-000000000002",
  "prj_01997c2a-7b1c-7a01-8a10-000000000003",
  "tsk_01997c2a-7b1c-7a01-8a10-000000000004",
  "res_01997c2a-7b1c-7a01-8a10-000000000007",
];
const source = `---\nid: ${resourceId}\ntype: resource\ntitle: Paper\ncreated_at: 2026-10-04T00:00:00Z\nupdated_at: 2026-10-04T00:00:00Z\nx-plugin:\n  keep: true\n---\n`;

describe("Resource authors and relations", () => {
  it("retains ordered author names and all four relation types through edit and roundtrip", () => {
    const updated = updateEntityMetadata(source, {
      authors: [" 山田 太郎 ", "Alice Smith"],
      relatedEntityIds: targetIds,
    });
    expect(updated.entity).toMatchObject({
      authors: ["山田 太郎", "Alice Smith"],
      related_entity_ids: targetIds,
    });
    expect(updated.content).toContain("x-plugin:\n  keep: true");
    const parsed = parseMarkdownEntity(updated.content);
    expect(parsed.ok && parsed.value.entity).toEqual(updated.entity);
    expect(collectEntityReferences(updated.entity)).toEqual(
      targetIds.map((targetId, index) => ({
        targetId,
        targetType: ["area", "project", "task", "resource"][index],
        kind: "related",
        fieldPath: ["related_entity_ids", index],
      })),
    );
    expect(
      updateEntityMetadata(updated.content, {
        authors: [],
        relatedEntityIds: [],
      }).entity,
    ).toMatchObject({ authors: [], related_entity_ids: [] });
    expect(parseMarkdownEntity(source).ok).toBe(true);
  });
  it("rejects self references, duplicates, unsupported targets, and invalid author names", () => {
    for (const relatedEntityIds of [
      [resourceId],
      [targetIds[0], targetIds[0]],
      ["ent_01997c2a-7b1c-7a01-8a10-000000000006"],
      ["topic_01997c2a-7b1c-7a01-8a10-000000000001"],
    ]) {
      expect(() =>
        updateEntityMetadata(source, {
          relatedEntityIds: relatedEntityIds as string[],
        }),
      ).toThrow();
    }
    for (const authors of [[""], ["山田\n太郎"], ["same", "same"]])
      expect(() => updateEntityMetadata(source, { authors })).toThrow();
    expect(() =>
      updateEntityMetadata(
        source
          .replace("res_", "prj_")
          .replace("type: resource", "type: project\nstatus: not_started"),
        { authors: [] },
      ),
    ).toThrow();
    expect(
      parseMetadataPatch({ authors: ["Alice"], relatedEntityIds: targetIds }),
    ).toEqual({ authors: ["Alice"], relatedEntityIds: targetIds });
    expect(() =>
      parseMetadataPatch({ relatedEntityIds: ["invalid"] }),
    ).toThrow();
  });
});
