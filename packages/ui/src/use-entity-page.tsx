import { Alert, Button, Stack, Text } from "@mantine/core";
import { useContext, useEffect, useRef, useState } from "react";
import type {
  EntityPage,
  EntityPageQuery,
  PkmEntitySummary,
} from "@pkm/contracts";
import { EntityQueryContext } from "./entity-query-context.js";

export const useEntityPage = (query: EntityPageQuery, enabled = true) => {
  const source = useContext(EntityQueryContext)!;
  const key = JSON.stringify(query);
  const generation = useRef(0);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{
    key: string;
    items: readonly PkmEntitySummary[];
    cursor: string | null;
    loading: boolean;
    refreshing: boolean;
    error: string | null;
  }>(() => {
    const cached = enabled ? source.getCachedPage?.(query) : undefined;
    return cached
      ? {
          key,
          items: cached.items,
          cursor: cached.nextCursor,
          loading: false,
          refreshing: false,
          error: null,
        }
      : {
          key: "",
          items: [],
          cursor: null,
          loading: true,
          refreshing: false,
          error: null,
        };
  });
  const firstPage = useRef<{
    key: string;
    page: EntityPage;
    reload: number;
  } | null>(null);
  const moreController = useRef<AbortController | null>(null);
  const fetchRef = useRef(source.query);
  fetchRef.current = source.query;
  useEffect(
    () => () => {
      moreController.current?.abort();
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    if (firstPage.current?.key !== key) firstPage.current = null;
    const cached =
      enabled && source.ready !== false
        ? source.getCachedPage?.(JSON.parse(key) as EntityPageQuery)
        : undefined;
    if (
      cached &&
      firstPage.current?.key === key &&
      firstPage.current.page === cached &&
      firstPage.current.reload === reload
    )
      return;
    moreController.current?.abort();
    moreController.current = null;
    loadingNext.current = false;
    const request = ++generation.current;
    if (!enabled || source.ready === false) return;
    const controller = new AbortController();

    if (cached) {
      firstPage.current = { key, page: cached, reload };
      setState({
        key,
        items: cached.items,
        cursor: cached.nextCursor,
        loading: false,
        refreshing: false,
        error: null,
      });
    } else
      setState((current) =>
        current.key === key
          ? {
              ...current,
              loading: firstPage.current?.key !== key,
              refreshing: firstPage.current?.key === key,
              error: null,
            }
          : {
              key,
              items: [],
              cursor: null,
              loading: true,
              refreshing: false,
              error: null,
            },
      );
    void fetchRef
      .current(JSON.parse(key) as EntityPageQuery, controller.signal)
      .then((page) => {
        if (request === generation.current && !controller.signal.aborted) {
          firstPage.current = { key, page, reload };
          setState({
            key,
            items: page.items,
            cursor: page.nextCursor,
            loading: false,
            refreshing: false,
            error: null,
          });
        }
      })
      .catch((reason: unknown) => {
        if (
          request === generation.current &&
          !controller.signal.aborted &&
          !(reason instanceof Error && reason.name === "AbortError")
        )
          setState((current) => ({
            ...(current.key === key
              ? current
              : { key, items: [], cursor: null }),
            cursor: null,
            loading: false,
            refreshing: false,
            error: reason instanceof Error ? reason.message : String(reason),
          }));
      });
    return () => {
      controller.abort();
    };
  }, [key, source, enabled, reload]);
  const current =
    state.key === key
      ? state
      : {
          key,
          items: [],
          cursor: null,
          loading: true,
          refreshing: false,
          error: null,
        };
  const loadingNext = useRef(false);
  const loadMore = async () => {
    if (
      !current.cursor ||
      current.loading ||
      current.refreshing ||
      loadingNext.current
    )
      return;
    const request = generation.current;
    loadingNext.current = true;
    const controller = new AbortController();
    moreController.current = controller;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const page = await source.query(
        { ...query, cursor: current.cursor },
        controller.signal,
      );
      if (request === generation.current && !controller.signal.aborted)
        setState((s) => ({
          ...s,
          items: [
            ...new Map(
              [...s.items, ...page.items].map((e) => [e.id, e]),
            ).values(),
          ],
          cursor: page.nextCursor,
          loading: false,
        }));
    } catch (reason) {
      if (request === generation.current && !controller.signal.aborted)
        setState((s) => ({
          ...s,
          loading: false,
          error: reason instanceof Error ? reason.message : String(reason),
        }));
    } finally {
      if (moreController.current === controller) {
        moreController.current = null;
        loadingNext.current = false;
      }
    }
  };
  return { ...current, loadMore, retry: () => setReload((v) => v + 1) };
};
export const EntityPageFooter = ({
  page,
}: {
  page: ReturnType<typeof useEntityPage>;
}) => (
  <Stack gap="xs">
    {page.error && (
      <Alert color="red">
        {page.error}
        <Button
          ml="sm"
          size="xs"
          onClick={page.cursor ? () => void page.loadMore() : page.retry}
        >
          再試行
        </Button>
      </Alert>
    )}
    {page.loading && <Text c="dimmed">読み込み中…</Text>}
    {page.cursor && (
      <Button
        variant="default"
        loading={page.loading}
        onClick={() => void page.loadMore()}
      >
        さらに表示
      </Button>
    )}
  </Stack>
);
