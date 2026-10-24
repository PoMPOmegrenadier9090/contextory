import { MantineProvider } from "@mantine/core";
import { createRoot } from "react-dom/client";
import type {
  EntityPage,
  EntityPageQuery,
  PkmEntitySummary,
} from "@pkm/contracts";
import { EntityQueryContext } from "./entity-query-context.js";
import {
  EntityRelatedEntries,
  EntityEntryTimeline,
} from "./entity-entry-view.js";
import { EntityActivityView } from "./entity-activity-view.js";
import { PagedCollection } from "./paged-collection.js";
import { TodoListView } from "./todo-list-view.js";

export const runBackgroundRefreshBrowserChecks = async (
  parent: HTMLElement,
  entity: (id: string, type?: string) => PkmEntitySummary,
) => {
  let checks = 0;
  const equal = (actual: unknown, expected: unknown) => {
    if (actual !== expected)
      throw Error(
        `Refresh check ${checks}: ${String(actual)} !== ${String(expected)}`,
      );
    checks++;
  };
  const waitFor = async (check: () => boolean) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > 5000)
        throw Error(`Refresh timed out: ${parent.innerText}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const frame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const fixture = { ...entity("refresh-entry"), body: "Fixture body" };
  const context = entity("refresh-target", "area");
  for (const view of [
    "relations",
    "timeline",
    "collection",
    "activity",
    "todos",
  ] as const) {
    for (const count of [0, 1]) {
      const requests: {
        query: EntityPageQuery;
        resolve: (page: EntityPage) => void;
        reject: (reason: Error) => void;
      }[] = [];
      const query = (query: EntityPageQuery) =>
        new Promise<EntityPage>((resolve, reject) => {
          requests.push({ query, resolve, reject });
        });
      const page = {
        items: count ? [fixture] : [],
        nextCursor: view === "relations" && count === 1 ? "next" : null,
      };
      const root = createRoot(parent);
      const render = (revision: number, id = context.id) => {
        const props = { onOpenEntity: () => {}, readOnly: true };
        root.render(
          <MantineProvider>
            <EntityQueryContext.Provider
              value={{
                query,
                options: () => Promise.resolve([]),
                revision,
                calendarRevision: revision,
              }}
            >
              {view === "relations" ? (
                <EntityRelatedEntries
                  {...props}
                  entity={{ ...context, id }}
                  relationMode="direct"
                  allEntities={[]}
                />
              ) : view === "timeline" ? (
                <EntityEntryTimeline
                  {...props}
                  entity={{ ...context, id }}
                  relationMode="direct"
                />
              ) : view === "collection" ? (
                <PagedCollection
                  {...props}
                  type="entry"
                  entities={[]}
                  baseQuery={{ relatedTo: id }}
                />
              ) : view === "activity" ? (
                <EntityActivityView
                  {...props}
                  entity={{ ...fixture, id }}
                  entities={[]}
                  mode="timeline"
                  resolution="direct"
                  revision={revision}
                />
              ) : (
                <TodoListView
                  {...props}
                  entities={[]}
                  revision={revision}
                  onChanged={async () => {}}
                  onToggleTodo={async () => {}}
                  loadTodos={() =>
                    query({ type: "entry" }).then((result) => ({
                      items: result.items.map((item) => ({
                        entryId: item.id,
                        entryTitle: item.displayName,
                        createdAt: item.createdAt,
                        markerFrom: 0,
                        markerTo: 3,
                        fileHash: "sha256:fixture" as const,
                        checked: false,
                        depth: 0,
                        text: item.body,
                      })),
                      nextCursor: null,
                    }))
                  }
                />
              )}
            </EntityQueryContext.Provider>
          </MantineProvider>,
        );
      };
      const loading = () => parent.textContent?.includes("読み込み中") === true;
      try {
        render(0);
        await waitFor(() => requests.length === 1 && loading());
        requests[0]!.resolve(page);
        await waitFor(() => !loading());
        await frame();
        const height = parent.getBoundingClientRect().height;
        const text = parent.textContent;
        render(1);
        await waitFor(() => requests.length === 2);
        await frame();
        equal(loading(), false);
        equal(parent.textContent, text);
        equal(parent.getBoundingClientRect().height, height);
        requests[1]!.resolve(page);
        await frame();
        await frame();
        if (view === "relations" && count === 1) {
          render(2);
          await waitFor(() => requests.length === 3);
          requests[2]!.reject(Error("Refresh failed"));
          await waitFor(
            () => parent.textContent?.includes("Refresh failed") === true,
          );
          equal(parent.textContent?.includes(fixture.displayName!), true);
          const retry = [...parent.querySelectorAll("button")].find((button) =>
            button.textContent?.includes("再試行"),
          );
          retry!.click();
          await waitFor(() => requests.length === 4);
          equal(loading(), false);
          requests[3]!.resolve({ ...page, nextCursor: "next" });
          await waitFor(
            () => parent.textContent?.includes("さらに表示") === true,
          );
          const more = [...parent.querySelectorAll("button")].find((button) =>
            button.textContent?.includes("さらに表示"),
          )!;
          render(3);
          await waitFor(() => requests.length === 5);
          more.click();
          await frame();
          equal(requests.length, 5);
          requests[4]!.resolve({ ...page, nextCursor: "next" });
          await frame();
          await frame();
          more.click();
          await waitFor(() => requests.length === 6 && loading());
          equal(requests[5]!.query.cursor, "next");
          requests[5]!.resolve({
            items: [entity("second-entry")],
            nextCursor: null,
          });
          await waitFor(
            () =>
              !loading() &&
              parent.textContent?.includes("second-entry") === true,
          );
        }
        if (view !== "todos") {
          const next = requests.length;
          render(4, "different-target");
          await waitFor(() => requests.length > next && loading());
          requests[next]!.resolve(page);
          await waitFor(() => !loading());
        }
      } finally {
        root.unmount();
      }
    }
  }
  return { checks };
};
