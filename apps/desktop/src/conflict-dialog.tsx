import {
  Alert,
  Button,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import type {
  ResolveEntityConflictRequest,
  WriteVaultFileConflict,
} from "@pkm/storage-node";

export interface ConflictDialogProps {
  readonly conflict: WriteVaultFileConflict | null;
  readonly resolving: ResolveEntityConflictRequest["resolution"] | null;
  readonly onClose: () => void;
  readonly onResolve: (
    resolution: ResolveEntityConflictRequest["resolution"],
  ) => void;
}

const VersionPane = ({
  title,
  content,
}: {
  readonly title: string;
  readonly content: string | null;
}): React.JSX.Element => (
  <section className="conflict-version">
    <Text fw={600} mb="xs">
      {title}
    </Text>
    <ScrollArea h={420} type="always" offsetScrollbars>
      <pre>{content ?? "（ファイルは削除されています）"}</pre>
    </ScrollArea>
  </section>
);

export const ConflictDialog = ({
  conflict,
  resolving,
  onClose,
  onResolve,
}: ConflictDialogProps): React.JSX.Element => (
  <Modal
    opened={conflict !== null}
    onClose={onClose}
    size="min(1200px, 94vw)"
    title="外部更新との競合を解決"
  >
    {conflict !== null && (
      <Stack>
        <Alert color="orange">
          保存開始後に外部版が変わっていたため、どちらも保持しています。内容を比較して採用する版を選んでください。
        </Alert>
        <div className="conflict-grid">
          <VersionPane
            title="外部版（現在のVault）"
            content={conflict.actual?.content ?? null}
          />
          <VersionPane title="未保存Draft" content={conflict.draftContent} />
        </div>
        <Group justify="space-between">
          <Button
            variant="default"
            onClick={onClose}
            disabled={resolving !== null}
          >
            編集に戻る
          </Button>
          <Group>
            <Button
              color="red"
              variant="light"
              loading={resolving === "keep-external"}
              disabled={resolving !== null}
              onClick={() => onResolve("keep-external")}
            >
              外部版を採用してDraftを破棄
            </Button>
            <Button
              loading={resolving === "keep-draft"}
              disabled={resolving !== null}
              onClick={() => onResolve("keep-draft")}
            >
              Draftで外部版を上書き
            </Button>
          </Group>
        </Group>
      </Stack>
    )}
  </Modal>
);
