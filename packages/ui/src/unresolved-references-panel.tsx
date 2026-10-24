import { Alert, Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type { PkmClient, PkmUnresolvedReference } from "@pkm/contracts";

const REFERENCE_FIELDS: Readonly<Record<string, string>> = {
  contexts: "Context",
  area: "Area",
  project: "Project",
  task: "Task",
  resource: "Resource",
  area_id: "Area",
  project_id: "Project",
  topics: "Topics",
  source_entity_ids: "生成元",
  related_entity_ids: "関連Entity",
};

export const UnresolvedReferencesPanel = ({
  listReferences,
  onOpenEntity,
}: {
  readonly listReferences: PkmClient["listUnresolvedReferences"];
  readonly onOpenEntity: (entityId: string) => void;
}): React.JSX.Element => {
  const [references, setReferences] = useState<
    readonly PkmUnresolvedReference[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void listReferences().then(
      (items) => {
        if (active) {
          setReferences(items);
          setLoading(false);
        }
      },
      (reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [listReferences, revision]);

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text fw={600}>参照切れ</Text>
        <Button
          size="xs"
          variant="light"
          loading={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          再確認
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        参照先のノートが見つからない箇所です。参照元を開いて、本文のリンクや関連付けを修正できます。ゴミ箱内の参照元も含みます。
      </Text>
      {error !== null && (
        <Alert color="red" role="alert">
          参照切れを取得できませんでした。{error}
        </Alert>
      )}
      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <Text size="sm">確認中…</Text>
        ) : (
          error === null && (
            <Stack gap="sm">
              <Text size="sm">
                {references.length === 0
                  ? "参照切れはありません。"
                  : `${references.length}件の参照切れがあります。`}
              </Text>
              {references.map((reference, index) => (
                <Paper
                  withBorder
                  p="sm"
                  key={index}
                  style={{ overflowWrap: "anywhere" }}
                >
                  <Stack gap={4}>
                    <Group gap="xs">
                      <Text fw={500} size="sm">
                        {reference.sourceName ?? reference.sourcePath}
                      </Text>
                      {reference.sourceDeletedAt !== null && (
                        <Badge size="xs" color="gray">
                          ゴミ箱
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {reference.sourcePath}
                    </Text>
                    <Text size="sm">
                      参照箇所：
                      {reference.fieldPath === null
                        ? "本文"
                        : reference.fieldPath
                            .map((part) =>
                              typeof part === "number"
                                ? `${part + 1}件目`
                                : (REFERENCE_FIELDS[part] ?? part),
                            )
                            .join(" / ")}
                    </Text>
                    <Text size="sm">参照先ID：{reference.targetId}</Text>
                    <Button
                      size="xs"
                      variant="light"
                      style={{ alignSelf: "flex-start" }}
                      onClick={() => onOpenEntity(reference.sourceId)}
                    >
                      参照元を開く
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )
        )}
      </div>
    </Stack>
  );
};
