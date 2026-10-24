import { parseMarkdownEntity, updateEntityMetadata } from "@pkm/core";
import type { TopicId } from "@pkm/contracts";

interface EntityDraft {
  readonly entityId: string;
  readonly content: string;
  readonly selection: number;
}

export const editEntityTopics = async (
  inputs: readonly string[],
  options: {
    readonly getDraft: () => EntityDraft | null;
    readonly resolveTopics: (names: readonly string[]) => Promise<{
      readonly existingIds: readonly string[];
      readonly newNames: readonly string[];
    }>;
    readonly createTopic: (name: string) => Promise<string>;
    readonly applyContent: (content: string) => void;
  },
): Promise<void> => {
  const initial = options.getDraft();
  const readCurrentEntity = () => {
    const draft = options.getDraft();
    if (
      !initial ||
      !draft ||
      draft.entityId !== initial.entityId ||
      draft.selection !== initial.selection
    )
      throw new Error("Entityが切り替わったため、Topicsの変更を中止しました。");
    const parsed = parseMarkdownEntity(draft.content);
    if (
      !parsed.ok ||
      (parsed.value.entity.type !== "entry" &&
        parsed.value.entity.type !== "resource") ||
      parsed.value.entity.id !== draft.entityId
    )
      throw new Error(
        "Topicsを更新する前にRaw Markdownのfrontmatterを修正してください。",
      );
    return { draft, entity: parsed.value.entity };
  };
  const { entity } = readCurrentEntity();
  // Keep unresolved existing IDs as references, rather than creating Topics
  // named after IDs when their labels are not yet in the lookup cache.
  const existing = new Set<string>(entity.topics ?? []);
  const retainedIds = inputs.filter((input) => existing.has(input));
  const names = inputs.filter((input) => !existing.has(input));
  const resolved = await options.resolveTopics(names);
  readCurrentEntity();
  const topicIds = [...retainedIds, ...resolved.existingIds];
  for (const name of resolved.newNames) {
    readCurrentEntity();
    topicIds.push(await options.createTopic(name));
  }
  const { draft } = readCurrentEntity();
  options.applyContent(
    updateEntityMetadata(draft.content, {
      topics: [...new Set(topicIds)] as TopicId[],
    }).content,
  );
};
