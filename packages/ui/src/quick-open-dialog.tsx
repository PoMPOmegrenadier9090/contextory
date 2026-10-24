import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { PkmEntitySummary, PkmQuickOpenResult } from "@pkm/contracts";

import { entityUiTitle } from "./entity-label.js";
import { EntityIcon } from "./entity-icon.js";
import {
  nextQuickOpenIndex,
  QUICK_OPEN_LIMIT,
  quickOpenSuggestions,
} from "./quick-open-state.js";

export interface QuickOpenDialogProps {
  readonly opened: boolean;
  readonly onClose: () => void;
  readonly onOpenEntity: (entityId: string) => Promise<boolean | void>;
  readonly onOpenInNewTab?:
    ((entityId: string) => Promise<boolean | void>) | undefined;
  readonly search: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<readonly PkmQuickOpenResult[]>;
  readonly entities: readonly PkmEntitySummary[];
  readonly pinnedIds: ReadonlySet<string>;
  readonly recentIds: readonly string[];
}

export const QuickOpenDialog = ({
  opened,
  onClose,
  onOpenEntity,
  onOpenInNewTab,
  search,
  entities,
  pinnedIds,
  recentIds,
}: QuickOpenDialogProps) => {
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [results, setResults] = useState<readonly PkmQuickOpenResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const scrollSelectionIntoView = useRef(true);
  const session = useRef(0);
  const normalizedQuery = query.trim();
  const suggestions = useMemo(
    () => quickOpenSuggestions(entities, recentIds, pinnedIds),
    [entities, recentIds, pinnedIds],
  );
  const visible = normalizedQuery === "" ? suggestions : results;
  const byId = useMemo(
    () => new Map(entities.map((entity) => [entity.id, entity])),
    [entities],
  );

  useEffect(() => {
    session.current += 1;
    if (opened) {
      setQuery("");
      setSelectedIndex(0);
      setOpening(false);
      setError(null);
    }
  }, [opened]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    scrollSelectionIntoView.current = true;
    setSelectedIndex(0);
    setError(null);
    setResults([]);
    if (!opened || normalizedQuery === "" || composing) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void search(normalizedQuery, controller.signal)
        .then((found) => {
          if (active) setResults(found.slice(0, QUICK_OPEN_LIMIT));
        })
        .catch((reason: unknown) => {
          if (active) setError(String(reason));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 150);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [opened, normalizedQuery, search, composing]);

  const selected =
    visible[Math.min(selectedIndex, Math.max(0, visible.length - 1))];
  useEffect(() => {
    if (!scrollSelectionIntoView.current) return;
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);

  const openEntity = async (id: string, newTab = false): Promise<void> => {
    if (opening || loading) return;
    const currentSession = session.current;
    setOpening(true);
    setError(null);
    try {
      const result = await (newTab && onOpenInNewTab
        ? onOpenInNewTab(id)
        : onOpenEntity(id));
      if (result !== false && currentSession === session.current) onClose();
    } catch (reason) {
      if (currentSession === session.current) setError(String(reason));
    } finally {
      if (currentSession === session.current) setOpening(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Quick Open"
      size="lg"
      closeOnEscape={false}
    >
      <Stack
        gap="sm"
        onKeyDown={(event) => {
          if (
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return;
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            scrollSelectionIntoView.current = true;
            setSelectedIndex((index) =>
              nextQuickOpenIndex(
                index,
                event.key === "ArrowDown" ? 1 : -1,
                visible.length,
              ),
            );
          } else if (event.key === "Enter" && selected !== undefined) {
            event.preventDefault();
            void openEntity(selected.id, event.metaKey || event.ctrlKey);
          }
        }}
      >
        <TextInput
          data-autofocus
          aria-label="Vault内を検索"
          placeholder="タイトル・本文を検索…"
          value={query}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onChange={(event) => setQuery(event.currentTarget.value)}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={opened}
          aria-controls={listId}
          aria-activedescendant={
            selected === undefined || loading
              ? undefined
              : `${listId}-${selected.id}`
          }
          rightSection={loading || opening ? <Loader size="xs" /> : null}
        />
        {error !== null && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <Text size="xs" c="dimmed" aria-live="polite">
          {loading
            ? "検索中…"
            : normalizedQuery === ""
              ? "最近開いた項目・ピン留め"
              : `${visible.length}件の候補`}
        </Text>
        <div className="quick-open-results">
          <Stack
            gap={4}
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label="開く項目"
            aria-busy={loading}
          >
            {!loading && visible.length === 0 && (
              <Text size="sm" c="dimmed">
                {normalizedQuery === ""
                  ? "タイトルや本文を入力して検索できます。"
                  : "一致する項目がありません。"}
              </Text>
            )}
            {visible.map((result, index) => {
              const entity = byId.get(result.id);
              const title =
                entity === undefined
                  ? (result.displayName ?? result.id)
                  : entityUiTitle(entity);
              return (
                <UnstyledButton
                  key={result.id}
                  id={`${listId}-${result.id}`}
                  role="option"
                  aria-selected={selected?.id === result.id}
                  tabIndex={-1}
                  disabled={opening || loading}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    scrollSelectionIntoView.current = false;
                    setSelectedIndex(index);
                  }}
                  onClick={(event) =>
                    void openEntity(result.id, event.metaKey || event.ctrlKey)
                  }
                  p="sm"
                  style={{
                    borderRadius: "var(--mantine-radius-sm)",
                    backgroundColor:
                      selected?.id === result.id
                        ? "var(--mantine-primary-color-light)"
                        : undefined,
                  }}
                >
                  <Group gap="xs" wrap="nowrap">
                    <EntityIcon type={result.type} />
                    <Text size="sm" fw={500} truncate>
                      {title}
                    </Text>
                    {pinnedIds.has(result.id) && (
                      <Text size="xs" aria-label="ピン留め">
                        ★
                      </Text>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" truncate>
                    {result.breadcrumb}
                  </Text>
                  {result.snippet !== "" && (
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {result.snippet}
                    </Text>
                  )}
                </UnstyledButton>
              );
            })}
          </Stack>
        </div>
        {onOpenInNewTab && (
          <Button
            variant="default"
            disabled={!selected || opening || loading}
            onClick={() => selected && void openEntity(selected.id, true)}
          >
            新規タブで開く
          </Button>
        )}
        <Text size="xs" c="dimmed">
          ↑↓ 選択 · Enter 開く {onOpenInNewTab && "· ⌘/Ctrl+Enter 新規タブ "}·
          Esc 閉じる
        </Text>
      </Stack>
    </Modal>
  );
};
