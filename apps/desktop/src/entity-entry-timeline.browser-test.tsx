import "@mantine/core/styles.css";
import "./renderer.css";
import "../../../packages/ui/src/compact.css";
import { MantineProvider as BaseMantineProvider, Stack } from "@mantine/core";
import { useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type {
  EntityPage,
  EntityPageQuery,
  PkmEntitySummary,
} from "@pkm/contracts";
import {
  EntityQueryContext,
  NotificationProvider,
  EntryTimelineGroups,
  EntryTimelineFeed,
  LinkPreviewContext,
  EntityEntryTimeline,
  EntityEntryViewControls,
  EntityRelatedEntries,
  useEntityEntryViewState,
  type QuickCaptureInput,
} from "@pkm/ui";
import { EntityEditor } from "./entity-editor.js";
import { DesktopEntityTabPanel } from "./desktop-entity-tab.js";
import { DesktopTabs } from "./desktop-tabs.js";
import { runEntityUxBrowserChecks } from "./entity-ux.browser-test.js";
import { runBackgroundRefreshBrowserChecks } from "../../../packages/ui/src/background-refresh.browser-test.js";

const MantineProvider = ({ children }: { readonly children: ReactNode }) => (
  <BaseMantineProvider>
    <NotificationProvider>{children}</NotificationProvider>
  </BaseMantineProvider>
);

export const runEntityEntryTimelineBrowserChecks = async (
  parent: HTMLElement,
  preview = false,
) => {
  let checks = 0;
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected)
      throw Error(
        `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    checks++;
  };
  const waitFor = async (check: () => boolean) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > 5000)
        throw Error(
          `Browser check timed out: ${parent.innerText?.slice(0, 1000)}; queries: ${JSON.stringify(queries.slice(-2))}\n${new Error().stack}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const entity = (id: string, type = "entry"): PkmEntitySummary => ({
    id,
    type,
    path: `${id}.md`,
    displayName: id,
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
    createdAt: "2026-10-11T15:01:00Z",
    updatedAt: "2026-10-11T15:01:00Z",
    deletedAt: null,
    excludeFromAi: false,
    body: "- [ ] 本文のTodo\n",
  });
  const area = entity("browser-area", "area");
  if (!preview) {
    checks += (await runBackgroundRefreshBrowserChecks(parent, entity)).checks;
    checks += (await runEntityUxBrowserChecks(parent, entity)).checks;
  }
  const direct = {
    ...entity("direct-entry"),
    body: "- [ ] 本文のTodo\n\nhttps://example.com/article\n",
    entryRelation: {
      kind: "direct" as const,
      path: [{ id: area.id, type: "area", displayName: "Area" }],
    },
  };
  const inherited = Array.from({ length: 60 }, (_, i) => ({
    ...entity(`task-entry-${i}`),
    bodyTruncated: true,
    entryRelation: {
      kind: "inherited" as const,
      path: [
        { id: area.id, type: "area", displayName: "Area" },
        { id: "task", type: "task", displayName: "調査" },
      ],
    },
  }));
  let opened = "";
  let captured: QuickCaptureInput | undefined;
  let revision = 0;
  let delayDirect = false;
  let release: (() => void) | undefined;
  let show: ((id: string, vault?: string) => void) | undefined;
  let refresh: (() => void) | undefined;
  let display: "common" | "desktop" = "common";
  const queries: EntityPageQuery[] = [];
  const query = async (q: EntityPageQuery): Promise<EntityPage> => {
    queries.push(q);
    if (delayDirect && q.entryRelationMode === "direct")
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    const rows =
      q.entryRelationMode === "scoped" ? [direct, ...inherited] : [direct];
    const offset = q.cursor ? Number(q.cursor) : 0;
    const items = rows.slice(offset, offset + 50).map((e) =>
      q.view === "timeline"
        ? {
            ...e,
            displayName: revision ? e.displayName + " updated" : e.displayName,
          }
        : { ...e, body: "" },
    );
    return {
      items,
      nextCursor: offset + 50 < rows.length ? String(offset + 50) : null,
    };
  };
  const previewRequests: string[] = [];
  const loadPreview = (url: string) => {
    previewRequests.push(url);
    if (url.endsWith("/unavailable"))
      return Promise.reject(Error("Unavailable"));
    return Promise.resolve({
      url,
      title: "リンク先の記事",
      description: "保存した記事の説明です。",
      siteName: "Example",
      faviconDataUrl: url.endsWith("/broken-icon")
        ? "data:image/png;base64,broken"
        : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAJklEQVR4nGOwafr2HxtGB7jUMYwaQAUDMFSSCIaDAQMfC6MG/AcAmblDHvfknU8AAAAASUVORK5CYII=",
    });
  };
  const Harness = () => {
    const [id, setId] = useState(area.id);
    const [vault, setVault] = useState("browser-vault");
    const [version, setVersion] = useState(0);
    const state = useEntityEntryViewState(
      vault,
      id,
      id === area.id ? "area" : "task",
    );
    show = (next, nextVault = vault) => {
      setId(next);
      setVault(nextVault);
    };
    refresh = () => setVersion((n) => n + 1);
    const source = useMemo(
      () => ({
        vaultId: vault,
        query,
        options: () => Promise.resolve([]),
        revision: version,
        calendarRevision: version,
      }),
      [vault, version],
    );
    return (
      <MantineProvider>
        <EntityQueryContext.Provider value={source}>
          {display === "desktop" ? (
            <EntityEditor
              document={{
                entity: {
                  ...entity("ent_01997c2a-7b1c-7a01-8a10-000000000099"),
                  body: "draft body",
                },
                content:
                  "---\nid: ent_01997c2a-7b1c-7a01-8a10-000000000099\ntype: entry\ntitle: Draft\ncreated_at: 2026-10-12T00:00:00Z\nupdated_at: 2026-10-12T00:00:00Z\norigin: human\nexclude_from_ai: false\ndeleted_at: null\n---\n\ndraft body",
                draft: {
                  entityId: "ent_01997c2a-7b1c-7a01-8a10-000000000099",
                  filePath: "draft.md",
                  baseHash: "sha256:abc",
                  updatedAt: "2026-10-12T00:00:00Z",
                  content:
                    "---\nid: ent_01997c2a-7b1c-7a01-8a10-000000000099\ntype: entry\ntitle: Draft\ncreated_at: 2026-10-12T00:00:00Z\nupdated_at: 2026-10-12T00:00:00Z\norigin: human\nexclude_from_ai: false\ndeleted_at: null\n---\n\nunsaved draft",
                },
                fileHash: "sha256:abc",
                hasExternalChange: false,
              }}
              readOnly
              onOpenReference={(next) => {
                opened = next;
              }}
              onUploadAsset={() => Promise.reject(Error("not used"))}
              onDeleteEntity={async () => {}}
              onSaved={async () => {}}
              onDirtyChange={() => {}}
              externalChangeDetected={false}
              backlinks={[]}
              entities={[]}
              pinnedIds={new Set()}
              onTogglePinned={() => {}}
              onResolveTopics={() => Promise.resolve([])}
              onUpdateEntity={async () => {}}
              onUpdateTopics={async () => {}}
              onConflictResolved={async () => {}}
              saveBeforeLeaveRef={{ current: null }}
            />
          ) : (
            <Stack>
              <EntityEntryViewControls
                entityType={id === area.id ? "area" : "task"}
                mode={state.mode}
                relationMode={state.relationMode}
                onModeChange={state.setMode}
                onRelationModeChange={state.setRelationMode}
              />
              {state.mode === "timeline" && (
                <EntityEntryTimeline
                  entity={{ ...area, id }}
                  relationMode={state.relationMode}
                  contextEntities={[area]}
                  onCapture={(input) => {
                    captured = input;
                    return Promise.resolve();
                  }}
                  onOpenEntity={(next) => {
                    opened = next;
                  }}
                />
              )}
              <div hidden={state.mode !== "detail"}>
                <EntityRelatedEntries
                  entity={{ ...area, id }}
                  relationMode={state.relationMode}
                  enabled={state.mode === "detail"}
                  allEntities={[]}
                  onOpenEntity={(next) => {
                    opened = next;
                  }}
                />
              </div>
            </Stack>
          )}
        </EntityQueryContext.Provider>
      </MantineProvider>
    );
  };
  const root = createRoot(parent);
  const select = (group: string, label: string) => {
    const control = parent.querySelector(`[aria-label="${group}"]`);
    const target = [...(control?.querySelectorAll("label") ?? [])].find(
      (e) => e.textContent === label,
    );
    if (!target) throw Error(`Missing control ${group}: ${label}`);
    (target as HTMLElement).click();
  };
  const cards = () => parent.querySelectorAll(".timeline-entry-card").length;
  const checkLinkEntries = async () => {
    const entries = [
      {
        ...entity("url-only"),
        body: "  https://example.com/only\n",
        displayName: null,
      },
      direct,
      {
        ...entity("truncated-url"),
        body: "https://example.com/truncated",
        bodyTruncated: true,
      },
      {
        ...entity("unavailable-link"),
        body: "https://example.com/unavailable",
      },
      { ...entity("broken-icon"), body: "https://example.com/broken-icon" },
    ];
    const groups = [{ day: "2026-10-12", entries }];
    root.render(
      <MantineProvider>
        <LinkPreviewContext.Provider value={loadPreview}>
          <Stack>
            <EntryTimelineGroups
              groups={groups}
              onOpenEntity={(id) => {
                opened = id;
              }}
            />
            <EntryTimelineFeed
              groups={groups}
              onOpenEntity={(id) => {
                opened = id;
              }}
            />
          </Stack>
        </LinkPreviewContext.Provider>
      </MantineProvider>,
    );
    await waitFor(
      () => parent.querySelectorAll(".timeline-link-entry").length === 6,
    );
    equal(parent.querySelectorAll(".timeline-entry-body").length, 4);
    for (const card of parent.querySelectorAll<HTMLElement>(
      ".timeline-link-entry",
    )) {
      const link = card.querySelector<HTMLAnchorElement>(".link-preview-card")!;
      link.scrollIntoView({ block: "center" });
      await waitFor(() => previewRequests.includes(link.href));
      equal(card.querySelector(".timeline-entry-heading"), null);
      equal(card.querySelector(".timeline-entry-body"), null);
      equal(link.scrollWidth <= link.clientWidth, true);
      if (link.href.endsWith("/unavailable"))
        equal(link.textContent?.includes(link.href), true);
      else if (link.href.endsWith("/broken-icon")) {
        await waitFor(
          () =>
            card.querySelector("svg") !== null &&
            card.textContent?.includes("リンク先の記事") === true,
        );
        equal(card.querySelector("img"), null);
      } else {
        await waitFor(() => (card.querySelector("img")?.naturalWidth ?? 0) > 0);
        equal(card.querySelector("svg"), null);
      }
      const open = card.querySelector<HTMLButtonElement>(
        '[aria-label="Entryを開く"]',
      )!;
      open.click();
      equal(opened, open.dataset.openEntity);
    }
    const first = parent.querySelector<HTMLElement>(".timeline-link-entry")!;
    first.scrollIntoView({ block: "start" });
    return;
  };
  try {
    root.render(
      <LinkPreviewContext.Provider value={loadPreview}>
        <Harness />
      </LinkPreviewContext.Provider>,
    );
    await waitFor(() => parent.textContent?.includes("direct-entry") === true);
    equal(queries.at(-1)?.entryRelationMode, "direct");
    select("Entity表示モード", "Timeline");
    await waitFor(() => cards() === 1);
    equal(queries.at(-1)?.view, "timeline");
    const timelineLink = parent.querySelector<HTMLAnchorElement>(
      ".timeline-entry-card .link-preview-card",
    )!;
    timelineLink.scrollIntoView({ block: "center" });
    await waitFor(
      () => timelineLink.textContent?.includes("リンク先の記事") === true,
    );
    equal(timelineLink.href, "https://example.com/article");
    equal(timelineLink.target, "_blank");
    equal(timelineLink.textContent?.includes("保存した記事の説明です。"), true);
    equal(timelineLink.textContent?.includes("example.com"), true);
    equal(previewRequests.includes("https://example.com/article"), true);
    await waitFor(
      () =>
        parent.querySelector(
          ".entity-entry-timeline .quick-capture-body-editor .cm-content",
        ) !== null,
    );
    const captureEditor = parent.querySelector<HTMLElement>(
      ".entity-entry-timeline .quick-capture-body-editor .cm-content",
    )!;
    const contextButton = parent.querySelector<HTMLButtonElement>(
      '.entity-entry-timeline button[aria-label="Contextを切り替え"]',
    )!;
    equal(contextButton.textContent?.includes("browser-area"), true);
    captureEditor.focus();
    document.execCommand("insertText", false, "https://example.com/capture");
    await waitFor(
      () =>
        captureEditor.textContent?.includes("https://example.com/capture") ===
        true,
    );
    await waitFor(
      () =>
        captureEditor
          .closest("form")!
          .querySelector('button[type="submit"]:not(:disabled)') !== null,
    );
    const captureLink = captureEditor
      .closest("form")!
      .querySelector<HTMLAnchorElement>(".link-preview-card")!;
    captureLink.scrollIntoView({ block: "center" });
    await waitFor(
      () => captureLink.textContent?.includes("リンク先の記事") === true,
    );
    equal(captureLink.href, "https://example.com/capture");
    captureEditor.closest("form")!.requestSubmit();
    await waitFor(() => captured !== undefined);
    equal(captured!.contextId, area.id);
    equal(captured!.body.trim(), "https://example.com/capture");
    await waitFor(
      () =>
        parent
          .querySelector(
            ".entity-entry-timeline .quick-capture-body-editor .cm-content",
          )
          ?.textContent?.includes("https://example.com/capture") === false &&
        !contextButton.disabled,
    );
    const nextCaptureEditor = parent.querySelector<HTMLElement>(
      ".entity-entry-timeline .quick-capture-body-editor .cm-content",
    )!;
    equal(contextButton.textContent?.includes("browser-area"), true);
    contextButton.click();
    await waitFor(() => contextButton.getAttribute("aria-pressed") === "false");
    equal(contextButton.textContent?.includes("browser-area"), true);
    equal(parent.querySelector('[aria-label="Contextを検索"]'), null);
    nextCaptureEditor.focus();
    document.execCommand(
      "insertText",
      false,
      "Contextなしの記録 https://example.com/unavailable",
    );
    await waitFor(
      () =>
        nextCaptureEditor
          .closest("form")!
          .querySelector('button[type="submit"]:not(:disabled)') !== null,
    );
    const unavailable = nextCaptureEditor
      .closest("form")!
      .querySelector<HTMLAnchorElement>(".link-preview-card")!;
    unavailable.scrollIntoView({ block: "center" });
    await waitFor(() =>
      previewRequests.includes("https://example.com/unavailable"),
    );
    equal(unavailable.textContent?.includes("example.com"), true);
    nextCaptureEditor.closest("form")!.requestSubmit();
    await waitFor(
      () =>
        captured?.body.trim() ===
        "Contextなしの記録 https://example.com/unavailable",
    );
    equal(captured!.contextId, null);
    equal(
      parent
        .querySelector(".timeline-entry-body")
        ?.textContent?.includes("本文のTodo"),
      true,
    );
    equal(
      parent
        .querySelector(".timeline-day-group")
        ?.textContent?.includes("2026年10月12日"),
      true,
    );
    select("Entryの関連範囲", "配下も含む");
    await waitFor(() => cards() === 50);
    equal(parent.textContent?.includes("Area › 調査 を経由"), true);
    equal(
      parent.querySelectorAll(
        '.timeline-entry-card input[type="checkbox"]:not(:disabled)',
      ).length,
      0,
    );
    const more = [...parent.querySelectorAll("button")].find(
      (e) => e.textContent === "さらに表示",
    );
    more!.click();
    await waitFor(() => cards() === 61);
    (
      parent.querySelector(
        '[data-open-entity="direct-entry"]',
      ) as HTMLButtonElement
    ).click();
    equal(opened, "direct-entry");
    delayDirect = true;
    select("Entryの関連範囲", "直接のみ");
    await waitFor(() => release !== undefined);
    select("Entryの関連範囲", "配下も含む");
    await waitFor(() => cards() === 50);
    release!();
    await new Promise((resolve) => setTimeout(resolve, 80));
    equal(cards(), 50);
    delayDirect = false;
    revision++;
    refresh!();
    await waitFor(
      () =>
        parent
          .querySelector(".timeline-entry-title")
          ?.textContent?.includes("updated") === true,
    );
    select("Entity表示モード", "詳細");
    await waitFor(
      () =>
        queries.at(-1)?.view === undefined &&
        queries.at(-1)?.entryRelationMode === "scoped",
    );
    show!("other-task");
    await waitFor(
      () => parent.querySelector('[aria-label="Entryの関連範囲"]') === null,
    );
    await waitFor(() => queries.at(-1)?.entryRelationMode === "direct");
    show!(area.id);
    await waitFor(
      () =>
        parent.querySelector(
          '[aria-label="Entryの関連範囲"] input[value="scoped"]:checked',
        ) !== null,
    );
    select("Entity表示モード", "Timeline");
    await waitFor(() => cards() === 50);
    show!(area.id, "different-vault");
    await waitFor(
      () =>
        parent.querySelector(
          '[aria-label="Entity表示モード"] input[value="detail"]:checked',
        ) !== null,
    );
    equal(
      parent.querySelector(
        '[aria-label="Entryの関連範囲"] input[value="direct"]:checked',
      ) !== null,
      true,
    );
    show!(area.id, "browser-vault");
    await waitFor(() => cards() === 50);
    if (preview) {
      select("Entryの関連範囲", "直接のみ");
      await waitFor(() => cards() === 1);
      const link = parent.querySelector<HTMLAnchorElement>(
        ".timeline-entry-card .link-preview-card",
      )!;
      link.scrollIntoView({ block: "center" });
      await waitFor(
        () => link.textContent?.includes("リンク先の記事") === true,
      );
      equal(link.scrollWidth <= link.clientWidth, true);
      await checkLinkEntries();
      return { checks };
    }
    // Seed a legacy in-memory Timeline selection for this Entry before opening
    // the actual editor. Entry pages must ignore it and expose their draft.
    show!("ent_01997c2a-7b1c-7a01-8a10-000000000099");
    await waitFor(
      () =>
        parent.querySelector(
          '[aria-label="Entity表示モード"] input[value="detail"]:checked',
        ) !== null,
    );
    select("Entity表示モード", "Timeline");
    await waitFor(() => cards() === 1);
    display = "desktop";
    refresh!();
    await waitFor(
      () =>
        parent.querySelector('[aria-label="Frontmatter編集モード"]') !== null,
    );
    select("Frontmatter編集モード", "Raw Markdown");
    await waitFor(
      () =>
        parent.querySelector('[aria-label="Entry Raw Markdownエディタ"]') !==
        null,
    );
    const editor = parent.querySelector(
      '[aria-label="Entry Raw Markdownエディタ"]',
    );
    equal(
      (editor as HTMLTextAreaElement).value.includes("unsaved draft"),
      true,
    );
    equal(parent.querySelector('[aria-label="Entity表示モード"]'), null);
    equal(parent.querySelector('[aria-label="Entryの関連範囲"]'), null);
    equal(cards(), 0);
    equal((editor as HTMLElement).closest("[hidden]"), null);
    const body =
      "[[task:tsk_01997c2a-7b1c-7a01-8a10-000000000004|リンク]]\n\n- [ ] 親\n  - [ ] 子\n";
    let savedBody: string | undefined;
    root.render(
      <MantineProvider>
        <EntryTimelineGroups
          groups={[
            {
              day: "2026-10-12",
              entries: [{ ...entity("interactive-entry"), body }],
            },
          ]}
          onOpenEntity={() => {}}
          onUpdateEntryBody={(_id, expected, next) => {
            equal(expected, body);
            savedBody = next;
            return Promise.resolve();
          }}
        />
      </MantineProvider>,
    );
    await waitFor(
      () =>
        parent.querySelectorAll('input[type="checkbox"]:not(:disabled)')
          .length === 2,
    );
    (
      parent.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement
    ).click();
    await waitFor(() => savedBody !== undefined);
    equal(savedBody, body.replace("- [ ] 子", "- [x] 子"));
    const originalApi = Object.getOwnPropertyDescriptor(window, "pkm");
    const tabId = "ent_01997c2a-7b1c-7a01-8a10-000000000098";
    const documentFor = (body: string) => ({
      entity: { ...entity(tabId), body },
      content: `---\nid: ${tabId}\ntype: entry\ntitle: Test\ncreated_at: 2026-10-12T00:00:00Z\nupdated_at: 2026-10-12T00:00:00Z\norigin: human\nexclude_from_ai: false\n---\n${body}`,
      fileHash: `sha256:${body}` as const,
      draft: null,
      hasExternalChange: false,
    });
    const tab = { id: tabId, document: documentFor("Initial"), backlinks: [] };
    const tabs = new DesktopTabs(
      () => Promise.resolve(tab),
      () => {},
    );
    let loads = 0;
    let backlinkLoads = 0;
    let tabStatus = "saved";
    let releaseDocument:
      ((document: ReturnType<typeof documentFor>) => void) | undefined;
    Object.defineProperty(window, "pkm", {
      configurable: true,
      value: {
        saveDraft: () => Promise.resolve(),
        saveEntity: () => Promise.reject(Error("通知テスト: 保存失敗")),
        loadEntity: () => {
          loads++;
          return new Promise<ReturnType<typeof documentFor>>((resolve) => {
            releaseDocument = resolve;
          });
        },
        getBacklinks: () => {
          backlinkLoads++;
          return Promise.resolve([]);
        },
      },
    });
    const renderTab = (
      active: boolean,
      document: number,
      backlinks: number,
      readOnly = true,
    ) =>
      root.render(
        <MantineProvider>
          <DesktopEntityTabPanel
            tab={tab}
            tabs={tabs}
            active={active}
            labelledBy={undefined}
            revision={document + backlinks}
            change={{ document, backlinks, fileHash: "sha256:Changed" }}
            readOnly={readOnly}
            entities={[]}
            pinnedIds={new Set()}
            onDocumentChanged={() => {}}
            onRefresh={async () => {}}
            onStatus={(_id, status) => {
              tabStatus = status;
            }}
            onOpenReference={() => {}}
            onUploadAsset={() => Promise.reject(Error("Unused"))}
            onDeleteEntity={async () => {}}
            onResolveTopics={() => Promise.resolve([])}
            onTogglePinned={() => {}}
            onUpdateEntity={async () => {}}
            onUpdateTopics={async () => {}}
          />
        </MantineProvider>,
      );
    try {
      renderTab(false, 1, 0);
      await new Promise((resolve) => setTimeout(resolve, 40));
      equal(loads, 0);
      renderTab(true, 1, 0);
      await waitFor(() => loads === 1);
      renderTab(true, 1, 1);
      await waitFor(() => backlinkLoads === 1);
      releaseDocument!(documentFor("Changed"));
      await waitFor(
        () =>
          parent
            .querySelector(".cm-content")
            ?.textContent?.includes("Changed") === true,
      );
      equal(loads, 1);
      renderTab(true, 1, 1, false);
      select("Frontmatter編集モード", "Raw Markdown");
      await waitFor(() => parent.querySelector("textarea") !== null);
      const raw = parent.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(raw, `${raw.value}\nEdited`);
      raw.dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(
        () =>
          tabStatus === "warning" &&
          document.body.innerText.includes("通知テスト: 保存失敗"),
      );
      equal(parent.textContent?.includes("通知テスト: 保存失敗"), false);
      document
        .querySelector<HTMLButtonElement>(
          '[aria-label="通知を閉じる: 通知テスト: 保存失敗"]',
        )!
        .click();
      await waitFor(
        () => !document.body.innerText.includes("通知テスト: 保存失敗"),
      );
      equal(tabStatus, "warning");
    } finally {
      root.render(<></>);
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (originalApi) Object.defineProperty(window, "pkm", originalApi);
      else Reflect.deleteProperty(window, "pkm");
    }
    await checkLinkEntries();
    return { checks };
  } finally {
    if (!preview) root.unmount();
  }
};
