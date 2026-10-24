export interface TopicCreationEntity {
  readonly id: string;
  readonly type: string;
  readonly displayName: string | null;
}

export interface ResolvedTopicInputs {
  readonly existingIds: readonly string[];
  readonly newNames: readonly string[];
}

const topicKey = (value: string): string =>
  value.normalize("NFKC").trim().toLocaleLowerCase("ja");

export const resolveTopicInputs = (
  inputs: readonly string[],
  entities: readonly TopicCreationEntity[],
): ResolvedTopicInputs => {
  const existingByName = new Map<string, string>();
  for (const entity of entities) {
    if (entity.type !== "topic" || entity.displayName === null) continue;
    const key = topicKey(entity.displayName);
    if (key.length > 0 && !existingByName.has(key)) {
      existingByName.set(key, entity.id);
    }
  }

  const seen = new Set<string>();
  const existingIds: string[] = [];
  const newNames: string[] = [];
  for (const input of inputs) {
    const name = input.normalize("NFKC").trim();
    const key = topicKey(name);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    const existingId = existingByName.get(key);
    if (existingId === undefined) newNames.push(name);
    else existingIds.push(existingId);
  }
  return { existingIds, newNames };
};
