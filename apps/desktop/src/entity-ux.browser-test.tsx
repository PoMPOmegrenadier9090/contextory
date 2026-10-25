import { MantineProvider, Stack } from "@mantine/core";
import { createRoot } from "react-dom/client";
import { useState, type ComponentType, type ReactNode } from "react";
import type {
  EntityPageQuery,
  ResourceType,
  PkmEntitySummary,
  ToggleTodoRequest,
} from "@pkm/contracts";
import { parseMarkdownEntity } from "@pkm/core";
import { ENTITY_ID_PREFIXES } from "@pkm/contracts";
import {
  EntityEntryViewControls,
  EntityCollectionView,
  EntitySidebar,
  RESOURCE_TYPE_OPTIONS,
  HierarchyListView,
  QuickCaptureDialog,
  FloatingActions,
  entityRelationTables,
  type QuickCaptureInput,
  EntityIdCopyButton,
  EntityQueryContext,
  MarkdownLiveEditor,
  TodoListView,
} from "@pkm/ui";
import { EntityMetadataForm } from "./entity-metadata-form.js";

export const runEntityUxBrowserChecks = async (
  parent: HTMLElement,
  entity: (id: string, type?: string) => PkmEntitySummary,
) => {
  const mobile = window.matchMedia("(max-width: 47.99em)").matches;
  let checks = 0;
  const equal = (actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw Error(
        `UX check ${checks}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    checks++;
  };
  const waitFor = async (check: () => boolean) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > 5000)
        throw Error(
          `UX check timed out: ${document.body.innerText.slice(-700)} active=${document.activeElement?.outerHTML.slice(0, 200)} check=${check.toString()}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const root = createRoot(parent);
  const render = (children: ReactNode) =>
    root.render(<MantineProvider>{children}</MantineProvider>);
  const id = "ent_01997c2a-7b1c-7a01-8a10-000000000099";
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith("pkm:ux-browser:")) localStorage.removeItem(key);
    for (const type of ["task", "resource", "area", "project"]) {
      render(
        <EntityEntryViewControls
          entityType={type}
          mode="detail"
          relationMode="direct"
          onModeChange={() => {}}
          onRelationModeChange={() => {}}
        />,
      );
      await waitFor(
        () => parent.querySelector('[aria-label="Entity表示モード"]') !== null,
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      equal(
        parent.querySelector('[aria-label="Entryの関連範囲"]') !== null,
        type === "area" || type === "project",
      );
      equal(parent.textContent?.includes("所属階層の配下がありません"), false);
    }

    const parsed = parseMarkdownEntity(`---
id: tsk_01997c2a-7b1c-7a01-8a10-000000000003
type: task
title: 調査
status: in_progress
priority: highest
created_at: 2026-10-18T00:00:00Z
updated_at: 2026-10-18T00:00:00Z
deleted_at: null
---
`);
    if (!parsed.ok) throw Error(JSON.stringify(parsed.error));
    render(
      <EntityMetadataForm
        entity={parsed.value.entity}
        entities={[]}
        onPatch={() => {}}
      />,
    );
    await waitFor(
      () => parent.querySelector(".mantine-Accordion-control") !== null,
    );
    parent
      .querySelector<HTMLButtonElement>(".mantine-Accordion-control")!
      .click();
    await waitFor(
      () =>
        parent.querySelector<HTMLInputElement>('input[aria-haspopup="listbox"]')
          ?.value === "進行中",
    );
    const values = [
      ...parent.querySelectorAll<HTMLInputElement>(
        'input:not([type="hidden"])',
      ),
    ].map((input) => input.value);
    equal(values.includes("最高"), true);
    equal(values.includes("in_progress"), false);
    equal(values.includes("highest"), false);

    equal(parent.querySelector('input[value="task"]'), null);
    const systemControl = [
      ...parent.querySelectorAll<HTMLButtonElement>(
        ".mantine-Accordion-control",
      ),
    ].find((button) => button.textContent === "システム情報")!;
    equal(systemControl.getAttribute("aria-expanded"), "false");
    systemControl.click();
    await waitFor(() => systemControl.getAttribute("aria-expanded") === "true");
    equal(parent.textContent?.includes(parsed.value.entity.id), true);

    const area = {
      ...entity("active-area", "area"),
      displayName: "活動中の領域",
    };
    const emptyArea = {
      ...entity("empty-area", "area"),
      displayName: "空の領域",
    };
    const inactiveArea = {
      ...entity("inactive-area", "area"),
      displayName: "完了のみの領域",
    };
    const first = {
      ...entity("first", "project"),
      areaId: area.id,
      status: "in_progress",
      priority: "highest",
    };
    const second = {
      ...entity("second", "project"),
      areaId: area.id,
      status: "in_progress",
      priority: "low",
    };
    const third = {
      ...entity("third", "project"),
      areaId: area.id,
      status: "not_started",
      priority: "highest",
    };
    const done = {
      ...entity("done", "project"),
      areaId: inactiveArea.id,
      status: "done",
    };
    const hold = {
      ...entity("hold", "task"),
      areaId: inactiveArea.id,
      status: "on_hold",
    };
    const work = [
      area,
      emptyArea,
      inactiveArea,
      third,
      done,
      second,
      hold,
      first,
    ];
    render(
      <HierarchyListView
        entities={work}
        view="area"
        groupMode="area"
        onOpenEntity={() => {}}
        onViewChange={() => {}}
        onGroupModeChange={() => {}}
      />,
    );
    await waitFor(() => parent.querySelector(".hierarchy-view") !== null);
    equal(parent.textContent?.includes("活動中の領域"), true);
    equal(parent.textContent?.includes("空の領域"), false);
    equal(parent.textContent?.includes("完了のみの領域"), false);
    equal(
      [...parent.querySelectorAll("[data-open-entity]")]
        .map((node) => node.getAttribute("data-open-entity"))
        .filter((value) =>
          [first.id, second.id, third.id].includes(value ?? ""),
        ),
      [first.id, second.id, third.id],
    );

    const remoteModule = "/apps/web/src/remote-views.tsx";
    const { PagedWorkspace, PagedCollection } = (await import(
      /* @vite-ignore */ remoteModule
    )) as {
      PagedCollection: ComponentType<{
        type: "resource";
        resourceScope?: ResourceType | undefined;
        entities: readonly PkmEntitySummary[];
        onOpenEntity: () => void;
      }>;
      PagedWorkspace: ComponentType<{
        entities: readonly PkmEntitySummary[];
        view: "area";
        onViewChange: () => void;
        onOpenEntity: () => void;
      }>;
    };
    const homeQueries: EntityPageQuery[] = [];
    render(
      <EntityQueryContext.Provider
        value={{
          vaultId: "ux-browser-remote",
          revision: 0,
          calendarRevision: 0,
          options: () => Promise.resolve([]),
          query: (query) => {
            homeQueries.push(query);
            return Promise.resolve({
              items: work
                .filter(
                  (item) =>
                    query.type === undefined || item.type === query.type,
                )
                .filter(
                  (item) =>
                    !query.activeOnly ||
                    (item.status !== "done" && item.status !== "on_hold"),
                ),
              nextCursor: null,
            });
          },
        }}
      >
        <PagedWorkspace
          entities={work}
          view="area"
          onViewChange={() => {}}
          onOpenEntity={() => {}}
        />
      </EntityQueryContext.Provider>,
    );
    await waitFor(
      () =>
        homeQueries.some((query) => query.type === "task") &&
        parent.querySelector(".workspace-project-section") !== null,
    );
    equal(parent.textContent?.includes("空の領域"), false);
    equal(parent.textContent?.includes("完了のみの領域"), false);
    equal(
      homeQueries.some(
        (query) =>
          query.type === "project" &&
          query.activeOnly &&
          query.sort === "workflow",
      ),
      true,
    );
    equal(
      homeQueries.some(
        (query) =>
          query.type === "task" &&
          query.activeOnly &&
          query.sort === "workflow",
      ),
      true,
    );

    const resources = [
      null,
      ...RESOURCE_TYPE_OPTIONS.map((option) => option.value),
    ].map((resourceType, index) => ({
      ...entity(`resource-${index}`, "resource"),
      resourceType,
    }));
    const resourceQueries: EntityPageQuery[] = [];
    const ResourceLibrary = ({ remote }: { remote: boolean }) => {
      const [scope, setScope] = useState<ResourceType | undefined>();
      return (
        <>
          <EntitySidebar
            entities={resources}
            selectedId={null}
            activeType="resource"
            activeResourceType={scope}
            pinnedIds={new Set()}
            onOpenWorkspace={() => {}}
            onOpenEntity={() => {}}
            onTogglePinned={() => {}}
            onOpenCollection={(_type, resourceType) => setScope(resourceType)}
          />
          {remote ? (
            <EntityQueryContext.Provider
              value={{
                vaultId: "ux-browser-resources",
                revision: 0,
                calendarRevision: 0,
                options: () => Promise.resolve([]),
                query: (query) => {
                  resourceQueries.push(query);
                  return Promise.resolve({
                    items: resources.filter(
                      (item) =>
                        !query.resourceType ||
                        item.resourceType === query.resourceType,
                    ),
                    nextCursor: null,
                  });
                },
              }}
            >
              <PagedCollection
                key={scope ?? "all"}
                type="resource"
                resourceScope={scope}
                entities={resources}
                onOpenEntity={() => {}}
              />
            </EntityQueryContext.Provider>
          ) : (
            <EntityCollectionView
              key={scope ?? "all"}
              type="resource"
              resourceScope={scope}
              storageKey={`pkm:ux-browser:resources:${scope ?? "all"}`}
              entities={resources}
              pinnedIds={new Set()}
              onOpenEntity={() => {}}
              onTogglePinned={() => {}}
            />
          )}
        </>
      );
    };
    for (const remote of [false, true]) {
      const storageKey = remote
        ? "pkm:web:ux-browser-resources:collection:resource:{}"
        : "pkm:ux-browser:resources:all";
      localStorage.setItem(
        `${storageKey}:resourceType`,
        JSON.stringify("paper"),
      );
      const previousExpand = parent.querySelector(
        '[aria-label="Resourceの種別を選ぶ"]',
      );
      render(<ResourceLibrary key={String(remote)} remote={remote} />);
      await waitFor(() => {
        const expand = parent.querySelector(
          '[aria-label="Resourceの種別を選ぶ"]',
        );
        return expand !== null && expand !== previousExpand;
      });
      const visibleIds = () =>
        [...parent.querySelectorAll("[data-open-entity]")].map((node) =>
          node.getAttribute("data-open-entity"),
        );
      await waitFor(
        () =>
          JSON.stringify(visibleIds()) === JSON.stringify([resources[2]!.id]),
      );
      const expand = parent.querySelector<HTMLButtonElement>(
        '[aria-label="Resourceの種別を選ぶ"]',
      )!;
      equal(expand.getAttribute("aria-expanded"), "false");
      expand.click();
      await waitFor(() => expand.getAttribute("aria-expanded") === "true");
      equal(visibleIds(), [resources[2]!.id]);
      const sidebarButton = (label: string) =>
        [
          ...parent.querySelectorAll<HTMLButtonElement>(
            ".sidebar-collection-button",
          ),
        ].find((button) => button.textContent?.trim() === label)!;
      for (const [index, option] of RESOURCE_TYPE_OPTIONS.entries()) {
        sidebarButton(option.label).click();
        await waitFor(
          () =>
            JSON.stringify(visibleIds()) ===
            JSON.stringify([resources[index + 1]!.id]),
        );
        equal(sidebarButton(option.label).getAttribute("data-active"), "true");
        equal(
          parent.querySelector("h2")?.textContent,
          `Resources / ${option.label}`,
        );
        if (remote) equal(resourceQueries.at(-1)?.resourceType, option.value);
      }
      [
        ...parent.querySelectorAll<HTMLButtonElement>(
          ".sidebar-collection-button",
        ),
      ]
        .find((button) => button.textContent?.startsWith("Resources"))!
        .click();
      await waitFor(
        () =>
          JSON.stringify(visibleIds()) === JSON.stringify([resources[2]!.id]),
      );
      equal(
        localStorage.getItem(`${storageKey}:resourceType`),
        JSON.stringify("paper"),
      );
      localStorage.removeItem(`${storageKey}:resourceType`);
    }

    const parsedResource = parseMarkdownEntity(`---
id: res_01997c2a-7b1c-7a01-8a10-000000000005
type: resource
title: 資料
resource_type: paper
created_at: 2026-10-18T00:00:00Z
updated_at: 2026-10-18T00:00:00Z
---
`);
    if (!parsedResource.ok) throw Error(JSON.stringify(parsedResource.error));
    let changedType: string | null | undefined;
    render(
      <EntityMetadataForm
        entity={parsedResource.value.entity}
        entities={[]}
        onPatch={(patch) => {
          changedType = patch.resourceType;
        }}
      />,
    );
    await waitFor(
      () => parent.querySelector(".mantine-Accordion-control") !== null,
    );
    const resourceProperties = [
      ...parent.querySelectorAll<HTMLButtonElement>(
        ".mantine-Accordion-control",
      ),
    ].find((button) => button.textContent === "プロパティを編集")!;
    equal(resourceProperties.getAttribute("aria-expanded"), "false");
    resourceProperties.click();
    await waitFor(() => parent.querySelector('input[value="論文"]') !== null);
    parent.querySelector<HTMLInputElement>('input[value="論文"]')!.click();
    await waitFor(() =>
      [...document.querySelectorAll('[role="option"]')].some(
        (option) => option.textContent === "書籍",
      ),
    );
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent === "書籍")!
      .click();
    await waitFor(() => changedType !== undefined);
    equal(changedType, "book");

    const viewKey = "pkm:ux-browser:project";
    const renderProjects = (key: string, storageKey: string) =>
      render(
        <EntityCollectionView
          key={key}
          storageKey={storageKey}
          type="project"
          entities={work}
          pinnedIds={new Set()}
          onOpenEntity={() => {}}
          onTogglePinned={() => {}}
        />,
      );
    renderProjects("initial", viewKey);
    await waitFor(
      () => parent.querySelector(".entity-collection-view") !== null,
    );
    equal(
      [
        ...parent.querySelectorAll(
          ".entity-collection-table-wrap [data-open-entity]",
        ),
      ].map((node) => node.getAttribute("data-open-entity")),
      [first.id, second.id, third.id, done.id],
    );
    [...parent.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "絞り込み")!
      .click();
    await waitFor(() => parent.querySelector('input[value=""]') !== null);
    const statusInput = [
      ...parent.querySelectorAll<HTMLInputElement>(
        'input[aria-haspopup="listbox"]',
      ),
    ].find((input) =>
      input
        .closest(".mantine-InputWrapper-root")
        ?.textContent?.includes("ステータス"),
    )!;
    statusInput.click();
    await waitFor(() =>
      [...document.querySelectorAll('[role="option"]')].some(
        (option) => option.textContent === "完了",
      ),
    );
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent === "完了")!
      .click();
    await waitFor(
      () =>
        parent.querySelectorAll(
          ".entity-collection-table-wrap [data-open-entity]",
        ).length === 1,
    );
    // A header override must survive leaving and reopening the collection.
    [...parent.querySelectorAll<HTMLButtonElement>("th button")]
      .find((button) => button.textContent?.includes("名前"))!
      .click();
    await waitFor(
      () => localStorage.getItem(`${viewKey}:table:sort`) === '"name"',
    );
    renderProjects("remounted", viewKey);
    await waitFor(
      () =>
        parent.querySelector<HTMLInputElement>(
          '.entity-filter-grid input[value="完了"]',
        ) !== null,
    );
    equal(
      [
        ...parent.querySelectorAll(
          ".entity-collection-table-wrap [data-open-entity]",
        ),
      ].map((node) => node.getAttribute("data-open-entity")),
      [done.id],
    );
    renderProjects("remounted", `${viewKey}:other`);
    await waitFor(
      () =>
        parent.querySelectorAll(
          ".entity-collection-table-wrap [data-open-entity]",
        ).length === 4,
    );
    equal(parent.querySelector('button[aria-expanded="true"]') !== null, false);

    let captured: QuickCaptureInput | null = null;
    const captureKey = "pkm:ux-browser:capture";
    const renderCapture = (target: PkmEntitySummary | null, opened = true) =>
      render(
        <QuickCaptureDialog
          opened={opened}
          onClose={() => {}}
          currentContext={target}
          defaultCurrentContext={target !== null}
          storageKey={`${captureKey}:${target?.id ?? "global"}`}
          contextEntities={[first, second, area]}
          onCapture={(input) => {
            captured = input;
            return Promise.resolve();
          }}
        />,
      );
    const captureEditor = () =>
      document.querySelector<HTMLElement>('[role="dialog"] .cm-content');
    const captureFocusTargets: EventTarget[] = [];
    const recordCaptureFocus = (event: FocusEvent) => {
      if (event.target) captureFocusTargets.push(event.target);
    };
    document.addEventListener("focusin", recordCaptureFocus);
    renderCapture(first);
    await waitFor(
      () =>
        captureEditor() !== null && document.activeElement === captureEditor(),
    );
    equal(
      document
        .querySelector('[aria-label="Contextを切り替え"]')
        ?.textContent?.includes(first.displayName!),
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    document.removeEventListener("focusin", recordCaptureFocus);
    equal(captureEditor()!.hasAttribute("data-autofocus"), true);
    equal(
      captureFocusTargets.includes(
        document.querySelector(".quick-capture-dialog-content")!,
      ),
      false,
    );
    equal(document.activeElement === captureEditor(), true);
    const captureBox = document
      .querySelector(".quick-capture-dialog")!
      .getBoundingClientRect();
    equal(captureBox.width >= Math.min(900, window.innerWidth * 0.9), true);
    const editorHeight = captureEditor()!
      .closest(".quick-capture-body-editor")!
      .getBoundingClientRect().height;
    equal(
      mobile ? editorHeight === 128 : editorHeight > window.innerHeight * 0.45,
      true,
    );
    const captureSave = () =>
      document.querySelector<HTMLButtonElement>(
        '[role="dialog"] button[type="submit"]',
      )!;
    equal(captureSave().disabled, true);
    captureEditor()!.closest("form")!.requestSubmit();
    equal(captured, null);
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((button) => button.textContent === "＋ タイトルを追加")!
      .click();
    await waitFor(
      () => document.querySelector('[aria-label="タイトル（任意）"]') !== null,
    );
    const emptyBodyTitle = document.querySelector<HTMLInputElement>(
      '[aria-label="タイトル（任意）"]',
    )!;
    emptyBodyTitle.focus();
    document.execCommand("insertText", false, "   ");
    await waitFor(() => emptyBodyTitle.value === "   ");
    equal(captureSave().disabled, true);
    captureEditor()!.closest("form")!.requestSubmit();
    equal(captured, null);
    emptyBodyTitle.select();
    document.execCommand("insertText", false, "  タイトルだけ  ");
    await waitFor(() => !captureSave().disabled);
    captureSave().click();
    await waitFor(() => captured !== null);
    equal(captured!.title, "タイトルだけ");
    equal(captured!.body.trim(), "");
    equal(captured!.contextId, first.id);
    await waitFor(
      () =>
        document.querySelector('[aria-label="タイトル（任意）"]') === null &&
        captureSave().disabled,
    );
    captured = null;
    captureEditor()!.focus();
    document.execCommand("insertText", false, "先頭\n対象行\n末尾");
    const currentLine = [
      ...captureEditor()!.querySelectorAll<HTMLElement>(".cm-line"),
    ].find((line) => line.textContent === "対象行")!;
    const caret = document.createRange();
    caret.setStart(currentLine.firstChild!, 2);
    caret.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(caret);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    document
      .querySelector<HTMLInputElement>(
        '.quick-capture-tools input[value="todo"]',
      )!
      .click();
    await waitFor(
      () =>
        localStorage
          .getItem(`${captureKey}:${first.id}`)
          ?.includes("先頭\\n- [ ] 対象行\\n末尾") === true,
    );
    equal(
      window.getSelection()?.anchorNode?.textContent?.includes("対象行"),
      true,
    );
    document
      .querySelector<HTMLInputElement>(
        '.quick-capture-tools input[value="memo"]',
      )!
      .click();
    await waitFor(
      () =>
        localStorage
          .getItem(`${captureKey}:${first.id}`)
          ?.includes("先頭\\n対象行\\n末尾") === true,
    );
    const all = document.createRange();
    all.selectNodeContents(captureEditor()!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(all);
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    document.execCommand("insertText", false, "");
    equal(
      entityRelationTables({ type: "project" }).map((table) => table.type),
      ["task", "entry", "resource"],
    );
    document.execCommand("insertText", false, "Projectでの下書き");
    await waitFor(
      () =>
        localStorage
          .getItem(`${captureKey}:${first.id}`)
          ?.includes("Projectでの下書き") === true,
    );
    const contextToggle = document.querySelector<HTMLButtonElement>(
      '[aria-label="Contextを切り替え"]',
    )!;
    equal(
      contextToggle.getBoundingClientRect().top >=
        document.querySelector(".quick-capture-tools")!.getBoundingClientRect()
          .bottom,
      true,
    );
    const toolsHeight = document
      .querySelector(".quick-capture-tools")!
      .getBoundingClientRect().height;
    contextToggle.click();
    await waitFor(() => contextToggle.getAttribute("aria-pressed") === "false");
    equal(contextToggle.textContent?.includes(first.displayName!), true);
    equal(
      document.querySelector(".quick-capture-tools")!.getBoundingClientRect()
        .height,
      toolsHeight,
    );
    [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((button) => button.textContent === "＋ タイトルを追加")!
      .click();
    await waitFor(
      () => document.querySelector('[aria-label="タイトル（任意）"]') !== null,
    );
    const titleInput = document.querySelector<HTMLInputElement>(
      '[aria-label="タイトル（任意）"]',
    )!;
    equal(titleInput.closest(".quick-capture-tools") !== null, true);
    equal(titleInput.getBoundingClientRect().height < 36, true);
    titleInput.focus();
    document.execCommand("insertText", false, "短いタイトル");
    await waitFor(
      () =>
        localStorage
          .getItem(`${captureKey}:${first.id}`)
          ?.includes("短いタイトル") === true,
    );
    renderCapture(first, false);
    await waitFor(
      () =>
        document.querySelector('[role="dialog"]')?.getClientRects().length ===
        0,
    );
    renderCapture(first);
    await waitFor(
      () =>
        captureEditor() !== null &&
        captureEditor()!.getClientRects().length > 0 &&
        document.activeElement === captureEditor(),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    equal(document.activeElement === captureEditor(), true);
    equal(contextToggle.getAttribute("aria-pressed"), "false");
    contextToggle.click();
    await waitFor(() => contextToggle.getAttribute("aria-pressed") === "true");
    renderCapture(null);
    await waitFor(
      () =>
        captureEditor() !== null &&
        captureEditor()?.textContent?.includes("Projectでの下書き") === false,
    );
    equal(
      document
        .querySelector('[aria-label="Contextを切り替え"]')
        ?.textContent?.includes("所属なし"),
      true,
    );
    captureEditor()!.focus();
    document.execCommand("insertText", false, "グローバルの下書き");
    await waitFor(
      () =>
        localStorage
          .getItem(`${captureKey}:global`)
          ?.includes("グローバルの下書き") === true,
    );
    renderCapture(first);
    await waitFor(
      () =>
        captureEditor()?.textContent?.includes("Projectでの下書き") === true,
    );
    captureEditor()!.closest("form")!.requestSubmit();
    await waitFor(() => captured !== null);
    equal(captured!.contextId, first.id);
    equal(captured!.body.trim(), "Projectでの下書き");
    equal(captured!.title, "短いタイトル");
    renderCapture(null);
    await waitFor(
      () =>
        captureEditor()?.textContent?.includes("グローバルの下書き") === true,
    );
    captureEditor()!.closest("form")!.requestSubmit();
    await waitFor(() => captured?.contextId === null);
    equal(captured!.body.trim(), "グローバルの下書き");

    await waitFor(
      () =>
        document.querySelector<HTMLButtonElement>('[aria-label="記録先を変更"]')
          ?.disabled === false,
    );
    const captureFrame = document
      .querySelector(".quick-capture-dialog")!
      .getBoundingClientRect();
    let checkCaptureFrame = true;
    const stableCaptureFrame = async () => {
      if (!mobile || !checkCaptureFrame) return;
      for (let frame = 0; frame < 12; frame++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const box = document
          .querySelector(".quick-capture-dialog")!
          .getBoundingClientRect();
        if (
          Math.abs(box.top - captureFrame.top) > 1 ||
          Math.abs(box.height - captureFrame.height) > 1
        )
          throw new Error(
            `Capture moved: ${captureFrame.top}/${captureFrame.height} -> ${box.top}/${box.height}`,
          );
      }
      checks++;
    };
    document
      .querySelector<HTMLButtonElement>('[aria-label="記録先を変更"]')!
      .click();
    await waitFor(
      () => document.querySelector('[aria-label="Contextを検索"]') !== null,
    );
    equal(
      document.querySelector<HTMLInputElement>('[aria-label="Contextを検索"]')!
        .disabled,
      false,
    );
    equal(
      [...document.querySelectorAll('[role="option"]')]
        .filter((option) => option.getBoundingClientRect().height > 0)
        .map((option) => option.textContent),
      [],
    );
    const globalContextSearch = document.querySelector<HTMLInputElement>(
      '[aria-label="Contextを検索"]',
    )!;
    equal(document.activeElement === globalContextSearch, false);
    globalContextSearch.focus();
    globalContextSearch.click();
    await waitFor(() =>
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(area.displayName),
      ),
    );
    equal(
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(second.displayName!),
      ),
      true,
    );
    const chooseContextType = async (label: string) => {
      const searchInput = document.querySelector(
        '[aria-label="Contextを検索"]',
      );
      const typeInput = document.querySelector('[aria-label="Contextの種別"]');
      if (typeInput instanceof HTMLSelectElement) {
        typeInput.focus();
        typeInput.value = [...typeInput.options].find(
          (option) => option.textContent === label,
        )!.value;
        typeInput.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        equal(document.activeElement === typeInput, true);
        if (searchInput instanceof HTMLInputElement && !searchInput.disabled)
          equal(
            document.querySelector('[aria-label="Contextを検索"]') ===
              searchInput,
            true,
          );
        document
          .querySelector<HTMLInputElement>('[aria-label="Contextを検索"]')!
          .click();
        await stableCaptureFrame();
        return;
      }
      document
        .querySelector<HTMLInputElement>('[aria-label="Contextの種別"]')!
        .focus();
      document
        .querySelector<HTMLInputElement>('[aria-label="Contextの種別"]')!
        .click();
      await waitFor(() =>
        [...document.querySelectorAll('[role="option"]')].some(
          (option) => option.textContent === label,
        ),
      );
      [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((option) => option.textContent === label)!
        .click();
      await waitFor(
        () =>
          document.querySelector<HTMLInputElement>(
            '[aria-label="Contextの種別"]',
          )?.value === label,
      );
      document
        .querySelector<HTMLInputElement>('[aria-label="Contextを検索"]')!
        .click();
    };
    await chooseContextType("Project");
    await waitFor(() =>
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(second.displayName!),
      ),
    );
    const projectOption = [
      ...document.querySelectorAll('[role="option"]'),
    ].find((option) => option.textContent?.startsWith(second.displayName!))!;
    equal(
      projectOption.getBoundingClientRect().top >=
        document
          .querySelector('[aria-label="Contextの種別"]')!
          .getBoundingClientRect().bottom,
      true,
    );
    const typeField = document.querySelector('[aria-label="Contextの種別"]')!;
    const typeBounds = typeField.getBoundingClientRect();
    equal(
      document.elementFromPoint(
        typeBounds.x + typeBounds.width / 2,
        typeBounds.y + typeBounds.height / 2,
      ) === typeField,
      true,
    );
    if (mobile) {
      equal(getComputedStyle(captureEditor()!).visibility, "hidden");
      await stableCaptureFrame();
      equal(
        document.activeElement ===
          document.querySelector('[aria-label="Contextを検索"]'),
        false,
      );
      const viewport = window.visualViewport!;
      const originalHeight = Object.getOwnPropertyDescriptor(
        viewport,
        "height",
      );
      try {
        Object.defineProperty(viewport, "height", {
          configurable: true,
          value: 320,
        });
        viewport.dispatchEvent(new Event("resize"));
        await stableCaptureFrame();
        const search = document.querySelector<HTMLInputElement>(
          '[aria-label="Contextを検索"]',
        )!;
        search.focus();
        search.click();
        await waitFor(
          () => document.querySelectorAll('[role="option"]').length >= 2,
        );
        const bounds = document
          .querySelector(".quick-capture-composer")!
          .getBoundingClientRect();
        const visibleOptions = [
          ...document.querySelectorAll('[role="option"]'),
        ].filter((option) => {
          const box = option.getBoundingClientRect();
          return (
            box.height > 0 &&
            box.top >= bounds.top &&
            box.bottom <= bounds.bottom
          );
        });
        equal(visibleOptions.length >= 2, true);
        equal(document.activeElement === search, true);
        await stableCaptureFrame();
      } finally {
        if (originalHeight)
          Object.defineProperty(viewport, "height", originalHeight);
        else Reflect.deleteProperty(viewport, "height");
        viewport.dispatchEvent(new Event("resize"));
      }
    }
    await chooseContextType("Area");
    await waitFor(() =>
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(area.displayName),
      ),
    );
    equal(
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(second.displayName!),
      ),
      false,
    );
    await chooseContextType("Project");
    await waitFor(() =>
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(second.displayName!),
      ),
    );
    equal(
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(area.displayName),
      ),
      false,
    );
    await chooseContextType("すべての種別");
    await waitFor(() =>
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(area.displayName),
      ),
    );
    await chooseContextType("Resource");
    equal(
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(second.displayName!),
      ),
      false,
    );
    await chooseContextType("Project");
    document
      .querySelector<HTMLInputElement>('[aria-label="Contextを検索"]')!
      .click();
    await waitFor(() =>
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(second.displayName!),
      ),
    );
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent?.startsWith(second.displayName!))!
      .click();
    await waitFor(
      () =>
        document
          .querySelector('[aria-label="Contextを切り替え"]')
          ?.textContent?.includes(second.displayName!) === true,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    equal(document.activeElement === captureEditor(), !mobile);
    equal(document.querySelector('[aria-label="Contextを検索"]'), null);
    captureEditor()!.focus();
    document.execCommand("insertText", false, "選択したContextへの記録");
    await waitFor(
      () =>
        captureEditor()!
          .closest("form")!
          .querySelector('button[type="submit"]:not(:disabled)') !== null,
    );
    captureEditor()!.closest("form")!.requestSubmit();
    await waitFor(() => captured?.contextId === second.id);
    equal(captured!.body.trim(), "選択したContextへの記録");
    await stableCaptureFrame();
    checkCaptureFrame = false;
    const longCapture = Array.from(
      { length: 100 },
      (_, index) => `スクロール確認 ${index}`,
    ).join("\n");
    localStorage.setItem(
      `${captureKey}:scroll`,
      JSON.stringify({ mode: "memo", title: "", body: longCapture }),
    );
    render(
      <QuickCaptureDialog
        opened
        onClose={() => {}}
        storageKey={`${captureKey}:scroll`}
        onCapture={() => Promise.resolve()}
      />,
    );
    await waitFor(() =>
      captureEditor()!.textContent.includes("スクロール確認"),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const captureScroller = document.querySelector<HTMLElement>(
      ".quick-capture-dialog .cm-scroller",
    )!;
    const captureEditorHeight = captureEditor()!
      .closest(".quick-capture-body-editor")!
      .getBoundingClientRect().height;
    equal(captureScroller.clientHeight <= captureEditorHeight, true);
    equal(captureScroller.scrollHeight > captureScroller.clientHeight, true);
    captureScroller.scrollTop = 0;
    captureScroller.scrollTop = 100;
    equal(captureScroller.scrollTop, 100);
    const contextQueries: EntityPageQuery[] = [];
    render(
      <EntityQueryContext.Provider
        value={{
          vaultId: "ux-browser-context",
          revision: 0,
          calendarRevision: 0,
          options: (query) => {
            contextQueries.push(query);
            return Promise.resolve(
              [first, area].filter(
                (item) => !query.type || item.type === query.type,
              ),
            );
          },
          query: () => Promise.resolve({ items: [first], nextCursor: null }),
        }}
      >
        <QuickCaptureDialog
          opened
          onClose={() => {}}
          defaultCurrentContext
          currentContext={{ ...first, displayName: null }}
          storageKey={`${captureKey}:remote`}
          onCapture={() => Promise.resolve()}
        />
      </EntityQueryContext.Provider>,
    );
    await waitFor(
      () =>
        document
          .querySelector('[aria-label="Contextを切り替え"]')
          ?.textContent?.includes(first.displayName!) === true,
    );
    equal(
      document
        .querySelector('[aria-label="Contextを切り替え"]')
        ?.getAttribute("aria-pressed"),
      "true",
    );
    document
      .querySelector<HTMLButtonElement>('[aria-label="記録先を変更"]')!
      .click();
    await waitFor(
      () => document.querySelector('[aria-label="Contextの種別"]') !== null,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    equal(contextQueries.length, 0);
    equal(
      document.querySelector<HTMLInputElement>('[aria-label="Contextを検索"]')!
        .disabled,
      false,
    );
    const remoteSearch = document.querySelector<HTMLInputElement>(
      '[aria-label="Contextを検索"]',
    )!;
    equal(document.activeElement === remoteSearch, false);
    remoteSearch.focus();
    await new Promise((resolve) => setTimeout(resolve, 200));
    equal(contextQueries.length, 0);
    remoteSearch.click();
    await waitFor(() =>
      contextQueries.some((query) => query.types?.length === 5),
    );
    await chooseContextType("Area");
    await waitFor(() => contextQueries.some((query) => query.type === "area"));
    await waitFor(() =>
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(area.displayName),
      ),
    );
    equal(
      [...document.querySelectorAll('[role="option"]')].some((option) =>
        option.textContent?.startsWith(first.displayName!),
      ),
      false,
    );
    equal(
      document
        .querySelector('[aria-label="Contextを切り替え"]')
        ?.textContent?.includes(first.displayName!),
      true,
    );
    let createType: string | null = null;
    render(
      <FloatingActions
        navigationKey="ux-test"
        onCapture={() => {}}
        onCreate={(type) => {
          createType = type;
        }}
      />,
    );
    await waitFor(
      () => parent.querySelector('[aria-label="新規作成"]') !== null,
    );
    parent.querySelector<HTMLButtonElement>('[aria-label="新規作成"]')!.click();
    await waitFor(() => document.querySelector('[role="menu"]') !== null);
    const menuItems = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    equal(
      menuItems.map((item) => item.textContent),
      ["Task", "Project", "Resource", "Topic", "Area"],
    );
    menuItems.find((item) => item.textContent === "Resource")!.click();
    await waitFor(() => createType !== null);
    equal(createType, "resource");
    const clipboard = navigator.clipboard;
    const write = clipboard.writeText.bind(clipboard);
    let copied = "";
    clipboard.writeText = (value) => {
      copied = value;
      return Promise.resolve();
    };
    try {
      for (const entityType of [
        "task",
        "project",
        "resource",
        "topic",
        "area",
        "entry",
      ] as const) {
        const entityId = id.replace(
          "ent_",
          `${ENTITY_ID_PREFIXES[entityType]}_`,
        );
        render(
          <EntityIdCopyButton
            key={entityType}
            entityId={entityId}
            entityType={entityType}
          />,
        );
        await waitFor(
          () =>
            parent.querySelector('[aria-label="Entityリンクをコピー"]') !==
            null,
        );
        parent
          .querySelector<HTMLButtonElement>(
            '[aria-label="Entityリンクをコピー"]',
          )!
          .click();
        await waitFor(
          () =>
            parent.querySelector('[aria-label="リンクをコピーしました"]') !==
            null,
        );
        equal(copied, `[[${entityType}:${entityId}]]`);
      }
    } finally {
      clipboard.writeText = write;
    }

    const target = {
      ...entity(id),
      displayName: null,
      body: "# 実験結果\n追加の調査が必要",
    };
    const queries: EntityPageQuery[] = [];
    let opened = "";
    let toggled: ToggleTodoRequest | undefined;
    render(
      <EntityQueryContext.Provider
        value={{
          vaultId: "ux-check",
          revision: 0,
          calendarRevision: 0,
          options: (q) => {
            queries.push(q);
            return Promise.resolve([
              {
                id: target.id,
                type: target.type,
                displayName: target.displayName,
              },
            ]);
          },
          query: () =>
            Promise.reject(Error("Reference labels must not fetch bodies")),
        }}
      >
        <Stack>
          <TodoListView
            entities={[]}
            revision={0}
            onChanged={async () => {}}
            loadTodos={() =>
              Promise.resolve({
                items: [
                  {
                    entryId: "todo-source",
                    entryTitle: "調査メモ",
                    createdAt: target.createdAt,
                    markerFrom: 2,
                    markerTo: 5,
                    fileHash: "sha256:fixture",
                    checked: false,
                    depth: 0,
                    text: `確認 ${copied}\n\n|項目|値|\n|---|---|\n|件数|12|`,
                  },
                ],
                nextCursor: null,
              })
            }
            onToggleTodo={(request) => {
              toggled = request;
              return Promise.resolve();
            }}
            onOpenEntity={(value) => {
              opened = value;
            }}
          />
          <MarkdownLiveEditor
            value={`本文\n${copied}\n`}
            readOnly
            onChange={() => {}}
            onOpenReference={(value) => {
              opened = value;
            }}
          />
        </Stack>
      </EntityQueryContext.Provider>,
    );
    await waitFor(
      () =>
        parent.querySelector(".markdown-entity-link")?.textContent ===
        "無題のEntry",
    );
    equal(
      parent.querySelector(".todo-list-view table td")?.textContent,
      "件数",
    );
    equal(
      parent
        .querySelector(".todo-list-view")
        ?.textContent?.includes("[[entry:"),
      false,
    );
    equal(
      queries.some((query) => query.ids?.[0] === id),
      true,
    );
    parent.querySelector<HTMLButtonElement>(".markdown-entity-link")!.click();
    equal(opened, id);
    parent
      .querySelector<HTMLInputElement>(
        '.todo-list-view input[type="checkbox"]',
      )!
      .click();
    await waitFor(() => toggled !== undefined);
    equal(toggled, {
      entryId: "todo-source",
      markerFrom: 2,
      expectedFileHash: "sha256:fixture",
      checked: true,
    });
    await waitFor(
      () =>
        parent.querySelector(".pkm-direct-reference")?.textContent ===
        "無題のEntry",
    );
    parent.querySelector<HTMLButtonElement>(".pkm-direct-reference")!.click();
    equal(opened, id);
    return { checks };
  } finally {
    root.unmount();
    for (const key of Object.keys(localStorage))
      if (key.startsWith("pkm:ux-browser:")) localStorage.removeItem(key);
  }
};
