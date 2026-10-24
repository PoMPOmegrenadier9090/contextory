import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type {
  BacklinkPage,
  PkmEntitySummary,
  PkmRemoteClient,
} from "@pkm/contracts";
import { AppearanceProvider } from "@pkm/ui";
import "@mantine/core/styles.css";
import "../../../packages/ui/src/compact.css";
import "./web.css";
import { createHttpPkmClient } from "./api-client.js";
import { WebApp } from "./web-app.js";
import { PagedBacklinks } from "./remote-views.js";

export const runWebEntityRelationsBrowserChecks = async (
  parent: HTMLElement,
) => {
  const entity = (id: string, type: string): PkmEntitySummary => ({
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
    createdAt: "2026-10-20T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
    deletedAt: null,
    excludeFromAi: false,
    body: "",
  });
  const project = entity("prj_01997c2a-7b1c-7a01-8a10-000000000099", "project");
  const items = ["task", "entry", "resource"].map((type) =>
    entity(`related-${type}`, type),
  );
  const content = `---
id: ${project.id}
type: project
title: Project
status: in_progress
created_at: 2026-10-20T00:00:00Z
updated_at: 2026-10-20T00:00:00Z
deleted_at: null
---
`;
  const counts = {
    types: { area: 0, project: 1, task: 1, entry: 1, topic: 0, resource: 1 },
    deleted: 0,
  };
  const client: PkmRemoteClient = {
    ...createHttpPkmClient(() => {
      throw Error("Web relation fixture must not make network requests");
    }),
    linkPreview: () => Promise.resolve(null),
    bootstrap: () =>
      Promise.resolve({
        health: {
          status: "ok",
          vaultId: "web-relations-browser-fixture",
          sessionId: "fixture",
          revision: 0,
          accessMode: "read-write",
        },
        counts,
        conflictsCount: 0,
        page: { items: [], nextCursor: null },
      }),
    subscribeToChanges: () => () => {},
    queryOptions: () => Promise.resolve([]),
    entityCounts: () => Promise.resolve(counts),
    queryEntities: async (query) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        items: query?.ids
          ? [project].filter((item) => query.ids?.includes(item.id))
          : items.filter((item) => item.type === query?.type),
        nextCursor: null,
      };
    },
    loadEntity: () =>
      Promise.resolve({
        entity: project,
        content,
        fileHash: "sha256:fixture",
        draft: null,
        hasExternalChange: false,
      }),
    listUnresolvedReferences: () => Promise.resolve([]),
    queryBacklinks: () => Promise.resolve({ items: [], nextCursor: null }),
  };
  const originalUrl = window.location.href;
  const url = new URL(originalUrl);
  url.searchParams.set("entity", project.id);
  window.history.replaceState(null, "", url);
  const root = createRoot(parent);
  let checks = 0;
  try {
    for (let render = 0; render < 5; render++) {
      root.render(
        <StrictMode>
          <AppearanceProvider>
            <WebApp client={client} />
          </AppearanceProvider>
        </StrictMode>,
      );
      const started = Date.now();
      while (
        !items.every((item) => parent.textContent?.includes(item.displayName!))
      ) {
        if (Date.now() - started > 5000)
          throw Error(`Web relations did not load: ${parent.innerText}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Count the actual app DOM: isolated tables miss sibling key collisions.
      const tables = parent.querySelectorAll(".detail-table-paper");
      if (tables.length !== 4 || parent.textContent?.includes("読み込み中"))
        throw Error(`Web relations duplicated or stuck: ${parent.innerText}`);
      checks++;
    }
    const waitFor = async (check: () => boolean) => {
      const started = Date.now();
      while (!check()) {
        if (Date.now() - started > 5000)
          throw Error(
            `Web check timed out: ${document.body.innerText}; ${check.toString()}`,
          );
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    for (const count of [0, 1]) {
      const requests: ((page: BacklinkPage) => void)[] = [];
      const backlinksClient = {
        ...client,
        queryBacklinks: () =>
          new Promise<BacklinkPage>((resolve) => requests.push(resolve)),
      };
      const page: BacklinkPage = {
        items: count
          ? [
              {
                sourceId: "backlink-source",
                sourceType: "entry",
                sourceDisplayName: "Backlink source",
                kinds: ["body"],
                labels: [],
                count: 1,
              },
            ]
          : [],
        nextCursor: null,
      };
      const render = (revision: number) =>
        root.render(
          <AppearanceProvider>
            <PagedBacklinks
              key={count}
              client={backlinksClient}
              entityId={project.id}
              revision={revision}
              onOpenEntity={() => {}}
            />
          </AppearanceProvider>,
        );
      render(0);
      await waitFor(() => parent.innerText.trim() === "Backlinks");
      parent.querySelector("details")!.open = true;
      await waitFor(
        () =>
          requests.length === 1 &&
          parent.textContent?.includes("読み込み中") === true,
      );
      requests[0]!(page);
      await waitFor(() => !parent.textContent?.includes("読み込み中"));
      const height = parent.getBoundingClientRect().height;
      const text = parent.textContent;
      render(1);
      await waitFor(() => requests.length === 2);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      if (
        parent.textContent !== text ||
        parent.getBoundingClientRect().height !== height
      )
        throw Error("Background refresh changed the Backlinks layout");
      requests[1]!(page);
      await waitFor(() => !parent.textContent?.includes("読み込み中"));
      checks++;
    }
    for (const type of ["entry", "resource"] as const) {
      const savedEntity = entity(
        `${type === "entry" ? "ent" : "res"}_01997c2a-7b1c-7a01-8a10-000000000098`,
        type,
      );
      const source = `---\nid: ${savedEntity.id}\ntype: ${type}\ntitle: Attachment test\n${type === "resource" ? "resource_type: paper\n" : ""}created_at: 2026-10-20T00:00:00Z\nupdated_at: 2026-10-20T00:00:00Z\norigin: human\nexclude_from_ai: false\ndeleted_at: null\n---\nBody`;
      let finishSave!: () => void;
      let failSave!: () => void;
      let submitted = "";
      const saveClient: PkmRemoteClient = {
        ...client,
        queryEntities: (query) =>
          Promise.resolve({
            items: !query?.type || query.type === type ? [savedEntity] : [],
            nextCursor: null,
          }),
        loadEntity: () =>
          Promise.resolve({
            entity: savedEntity,
            content: source,
            fileHash: `sha256:${"a".repeat(64)}`,
            draft: null,
            hasExternalChange: false,
          }),
        saveEntity: (request) =>
          new Promise((resolve, reject) => {
            submitted = request.content;
            finishSave = () =>
              resolve({
                ok: true,
                entity: savedEntity,
                snapshot: {
                  path: savedEntity.path,
                  content: submitted,
                  hash: `sha256:${"b".repeat(64)}`,
                },
              });
            failSave = () => reject(Error("Attachment save failure"));
          }),
      };
      url.searchParams.set("entity", savedEntity.id);
      window.history.replaceState(null, "", url);
      root.render(
        <AppearanceProvider>
          <WebApp key={type} client={saveClient} />
        </AppearanceProvider>,
      );
      await waitFor(() => parent.querySelector('input[value="raw"]') !== null);
      if (type === "resource") {
        [
          ...parent.querySelectorAll<HTMLButtonElement>(
            ".mantine-Accordion-control",
          ),
        ]
          .find((button) => button.textContent === "プロパティ")!
          .click();
        await waitFor(
          () => parent.textContent?.includes("添付ファイル") === true,
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      parent.querySelector<HTMLInputElement>('input[value="raw"]')!.click();
      await waitFor(() => parent.querySelector("textarea") !== null);
      const raw = parent.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(raw, `${raw.value} edited`);
      raw.dispatchEvent(new Event("input", { bubbles: true }));
      parent.querySelector<HTMLInputElement>('input[value="live"]')!.click();
      await waitFor(() => parent.querySelector(".cm-content") !== null);
      const attachmentButtons = () =>
        [...parent.querySelectorAll<HTMLElement>("button, label")].filter(
          (button) => button.textContent === "ファイルを添付",
        );
      await waitFor(
        () => attachmentButtons().length === (type === "entry" ? 1 : 2),
      );
      for (const fail of [false, true]) {
        const buttons = attachmentButtons();
        const heights = buttons.map(
          (button) => button.getBoundingClientRect().height,
        );
        [...parent.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent === "保存")!
          .click();
        await waitFor(
          () =>
            submitted !== "" &&
            parent.querySelector<HTMLInputElement>('input[type="file"]')
              ?.disabled === true,
        );
        if (
          buttons.some(
            (button, i) =>
              !button.isConnected ||
              button.getBoundingClientRect().height !== heights[i] ||
              (!button.hasAttribute("disabled") &&
                button.dataset.disabled === undefined),
          )
        )
          throw Error("Saving removed or enabled an attachment control");
        if (
          !parent.querySelector<HTMLInputElement>('input[type="file"]')!
            .disabled
        )
          throw Error("File input remained enabled during save");
        if (fail) failSave();
        else finishSave();
        await waitFor(
          () =>
            parent.querySelector<HTMLInputElement>('input[type="file"]')
              ?.disabled === false,
        );
        if (
          buttons.some(
            (button) =>
              !button.isConnected ||
              button.hasAttribute("disabled") ||
              button.dataset.disabled !== undefined,
          )
        )
          throw Error("Attachment controls did not recover after save");
        checks++;
        submitted = "";
        if (!fail) {
          parent.querySelector<HTMLInputElement>('input[value="raw"]')!.click();
          await waitFor(() => parent.querySelector("textarea") !== null);
          const next = parent.querySelector("textarea")!;
          Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value",
          )!.set!.call(next, `${next.value} again`);
          next.dispatchEvent(new Event("input", { bubbles: true }));
          parent
            .querySelector<HTMLInputElement>('input[value="live"]')!
            .click();
          await waitFor(() => parent.querySelector(".cm-content") !== null);
        }
      }
    }
    return { checks };
  } finally {
    root.unmount();
    window.history.replaceState(null, "", originalUrl);
  }
};
