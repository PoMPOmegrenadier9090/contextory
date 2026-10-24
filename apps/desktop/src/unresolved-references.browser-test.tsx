import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  PermanentlyDeleteEntityRequest,
  PkmEntitySummary,
  PkmUnresolvedReference,
} from "@pkm/contracts";
import { EntityTrashView } from "../../../packages/ui/src/entity-trash-view.js";
import { AppSettingsDialog } from "../../../packages/ui/src/app-settings-dialog.js";
import { UnresolvedReferencesPanel } from "../../../packages/ui/src/unresolved-references-panel.js";
import { useAppCommands } from "../../../packages/ui/src/use-app-commands.js";
import { AppearanceProvider } from "../../../packages/ui/src/appearance-provider.js";

export const runUnresolvedReferencesBrowserChecks = async (
  parent: HTMLElement,
) => {
  let checks = 0;
  const equal = (actual: unknown, expected: unknown, label = "") => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(
        `${label} Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    checks++;
  };
  const waitFor = async (predicate: () => boolean) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > 5000)
        throw new Error(
          `Reference screen timed out: ${document.body.innerText}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const fixture: PkmUnresolvedReference[] = [
    {
      sourceId: "entry",
      sourceName: "設計メモ",
      sourcePath: `entries/${"a".repeat(80)}.md`,
      sourceDeletedAt: null,
      targetId: "tsk_01997c2a-7b1c-7a01-8a10-000000000099",
      fieldPath: null,
      startOffset: 12,
    },
    {
      sourceId: "trash-entry",
      sourceName: "削除済みメモ",
      sourcePath: "entries/trash.md",
      sourceDeletedAt: "2026-10-17T00:00:00Z",
      targetId: "tsk_01997c2a-7b1c-7a01-8a10-000000000099",
      fieldPath: ["contexts", "task"],
      startOffset: null,
    },
  ];
  const deletedEntity: PkmEntitySummary = {
    id: "deleted-entry",
    type: "entry",
    path: "entries/deleted.md",
    displayName: "削除済みノート",
    body: "",
    origin: "human",
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
    createdAt: "2026-10-17T00:00:00Z",
    updatedAt: "2026-10-17T00:00:00Z",
    deletedAt: "2026-10-18T00:00:00Z",
    excludeFromAi: false,
  };
  let setReadOnly!: (value: boolean) => void;
  let failRestore = false;
  let failDelete = false;
  let deletion: PermanentlyDeleteEntityRequest | null = null;
  let resetTrash!: () => void;
  const deletionHash = `sha256:${"a".repeat(64)}` as const;
  let restoredId = "";
  let references: readonly PkmUnresolvedReference[] = [];
  let fail = false;
  let requests = 0;
  const load = () => {
    requests++;
    return fail
      ? Promise.reject(new Error("接続エラー"))
      : Promise.resolve(references);
  };
  const errors: unknown[] = [];
  let openSettings!: () => void;
  let selected = "";
  const Harness = () => {
    const [opened, setOpened] = useState(true);
    const [deleted, setDeleted] = useState<readonly PkmEntitySummary[]>([
      deletedEntity,
    ]);
    resetTrash = () => setDeleted([deletedEntity]);
    const [readOnly, updateReadOnly] = useState(false);
    setReadOnly = updateReadOnly;
    openSettings = () => setOpened(true);
    const commands = useAppCommands({
      enabled: false,
      handlers: {},
      onError: (reason) => errors.push(reason),
    });
    return (
      <AppearanceProvider>
        <AppSettingsDialog
          opened={opened}
          onClose={() => setOpened(false)}
          commands={commands}
          sections={[
            {
              id: "trash",
              label: "ゴミ箱",
              content: (
                <EntityTrashView
                  entities={deleted}
                  allEntities={deleted}
                  readOnly={readOnly}
                  loadEntity={() =>
                    Promise.resolve({
                      entity: deletedEntity,
                      content: "deleted",
                      fileHash: deletionHash,
                      draft: null,
                      hasExternalChange: false,
                    })
                  }
                  onPermanentlyDeleteEntity={(request) => {
                    if (failDelete)
                      return Promise.reject(new Error("削除テストのエラー"));
                    deletion = request;
                    setDeleted([]);
                    return Promise.resolve();
                  }}
                  onRestoreEntity={(id) => {
                    if (failRestore)
                      return Promise.reject(new Error("復元テストのエラー"));
                    restoredId = id;
                    setDeleted([]);
                    return Promise.resolve();
                  }}
                />
              ),
            },
            {
              id: "references",
              label: "参照切れ",
              content: (
                <UnresolvedReferencesPanel
                  listReferences={load}
                  onOpenEntity={(id) => {
                    selected = id;
                    setOpened(false);
                  }}
                />
              ),
            },
          ]}
        />
      </AppearanceProvider>
    );
  };
  const root = createRoot(parent);
  root.render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === text,
    )!;
  await waitFor(() => button("参照切れ") !== undefined);
  equal(requests, 0);
  button("参照切れ").click();
  await waitFor(() =>
    document.body.innerText.includes("参照切れはありません。"),
  );
  references = fixture;
  button("再確認").click();
  await waitFor(() =>
    document.body.innerText.includes("2件の参照切れがあります。"),
  );
  equal(document.body.innerText.includes(fixture[0]!.targetId), true);
  equal(document.body.innerText.includes("参照箇所：本文"), true);
  equal(document.body.innerText.includes("Context / Task"), true);
  equal(document.body.innerText.includes("ゴミ箱"), true);
  button("参照元を開く").click();
  await waitFor(() => document.querySelector('[role="dialog"]') === null);
  equal(selected, "entry");
  openSettings();
  await waitFor(() => button("参照切れ") !== undefined);
  fail = true;
  button("参照切れ").click();
  await waitFor(() => document.body.innerText.includes("接続エラー"));
  equal(document.querySelector('[role="alert"]') !== null, true);
  equal(document.body.innerText.includes("参照切れはありません。"), false);
  fail = false;
  references = [];
  button("再確認").click();
  await waitFor(() =>
    document.body.innerText.includes("参照切れはありません。"),
  );
  equal(document.querySelector('[role="alert"]'), null);
  references = fixture;
  button("再確認").click();
  await waitFor(() =>
    document.body.innerText.includes("2件の参照切れがあります。"),
  );
  equal(document.documentElement.scrollWidth <= window.innerWidth, true);
  const panel = document.getElementById(
    button("参照切れ").getAttribute("aria-controls")!,
  )!;
  equal(panel.scrollWidth <= panel.clientWidth + 1, true);
  button("ゴミ箱").click();
  await waitFor(() => button("復元") !== undefined);
  equal(document.body.innerText.includes("削除済みノート"), true);
  setReadOnly(true);
  await waitFor(() => button("復元").disabled);
  equal(restoredId, "");
  equal(button("完全に削除").disabled, true);
  setReadOnly(false);
  await waitFor(() => !button("復元").disabled);
  failRestore = true;
  button("復元").click();
  await waitFor(() => document.body.innerText.includes("復元テストのエラー"));
  equal(
    document.querySelector('[role="dialog"] [role="alert"]') !== null,
    true,
  );
  equal(document.body.innerText.includes("削除済みノート"), true);
  failRestore = false;
  await waitFor(() => !button("復元").disabled);
  button("復元").click();
  await waitFor(() =>
    document.body.innerText.includes("削除済みEntityはありません。"),
  );
  equal(restoredId, deletedEntity.id);
  equal(document.querySelector('[role="dialog"] [role="alert"]'), null);
  const trashPanel = document.getElementById(
    button("ゴミ箱").getAttribute("aria-controls")!,
  )!;
  equal(
    trashPanel.scrollWidth <= trashPanel.clientWidth + 1,
    true,
    `Trash overflow: ${trashPanel.scrollWidth}/${trashPanel.clientWidth}`,
  );
  resetTrash();
  await waitFor(() => button("完全に削除") !== undefined);
  button("完全に削除").click();
  await waitFor(() => button("完全に削除する") !== undefined);
  equal(deletion, null);
  equal(document.body.innerText.includes("アプリからは復元できません。"), true);
  button("キャンセル").click();
  await waitFor(() => button("完全に削除する") === undefined);
  equal(deletion, null);
  button("完全に削除").click();
  await waitFor(() => button("完全に削除する") !== undefined);
  failDelete = true;
  button("完全に削除する").click();
  await waitFor(() => document.body.innerText.includes("削除テストのエラー"));
  equal(deletion, null);
  failDelete = false;
  await waitFor(() => !button("完全に削除する").disabled);
  button("完全に削除する").click();
  await waitFor(() =>
    document.body.innerText.includes("削除済みEntityはありません。"),
  );
  equal(deletion, {
    entityId: deletedEntity.id,
    expectedFileHash: deletionHash,
  });
  equal(errors, []);
  return { checks };
};
