import {
  WORKSPACE_SEARCH_LIMIT,
  type ObjectClient,
  type WorkspaceSearchResult,
} from "@pkm/core";
import { typeLabel } from "@pkm/editor";
import { useEffect, useId, useRef, useState } from "react";

export const ObjectSearch = ({
  client,
  open,
  openType,
}: {
  readonly client: ObjectClient;
  readonly open: (id: string) => void;
  readonly openType: (name: string) => void;
}): React.JSX.Element => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const [result, setResult] = useState<{
    readonly query: string;
    readonly hits: readonly WorkspaceSearchResult[] | null;
  } | null>(null);
  const term = query.trim();
  const current = result?.query === term ? result : null;
  const hits = current?.hits;
  const activeId = hits?.[selected] ? `${listId}-${selected}` : undefined;
  useEffect(() => {
    if (activeId)
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  useEffect(() => {
    if (!visible || !term) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void client.searchWorkspace(term).then(
        (hits) => {
          if (live) setResult({ query: term, hits });
        },
        () => {
          if (live) setResult({ query: term, hits: null });
        },
      );
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [client, term, visible]);
  const pick = (hit: WorkspaceSearchResult): void => {
    dialog.current?.close();
    if (hit.kind === "type") openType(hit.id);
    else open(hit.id);
  };
  return (
    <>
      <button
        type="button"
        className="od-search-trigger"
        onClick={() => {
          setQuery("");
          setSelected(0);
          setResult(null);
          setVisible(true);
          dialog.current?.showModal();
          dialog.current?.querySelector("input")?.focus();
        }}
      >
        検索
      </button>
      <dialog
        ref={dialog}
        className="od-search-dialog"
        aria-label="ワークスペースを検索"
        onClose={(event) => {
          if (!event.currentTarget.open) setVisible(false);
        }}
      >
        <header className="od-search-bar">
          <form
            className="od-search-query"
            onSubmit={(event) => {
              event.preventDefault();
              if (hits?.[selected]) pick(hits[selected]);
            }}
          >
            <input
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={Boolean(hits?.length)}
              aria-controls={hits?.length ? listId : undefined}
              aria-activedescendant={activeId}
              aria-label="ワークスペースを検索"
              placeholder="タイトル・種別・本文を検索"
              autoFocus
              value={query}
              onChange={(event) => {
                if (event.currentTarget.value.trim() !== term) {
                  setResult(null);
                  setSelected(0);
                }
                setQuery(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                )
                  return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (hits?.[selected]) pick(hits[selected]);
                } else if (
                  hits?.length &&
                  (event.key === "ArrowDown" || event.key === "ArrowUp")
                ) {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setSelected(
                    (index) => (index + step + hits.length) % hits.length,
                  );
                }
              }}
            />
          </form>
          <form method="dialog">
            <button
              className="od-search-close"
              type="submit"
              aria-label="検索を閉じる"
            >
              <span aria-hidden="true">Esc</span>
              <span aria-hidden="true">×</span>
            </button>
          </form>
        </header>
        {term ? (
          <p className="od-search-status" role="status">
            {!current
              ? "検索中…"
              : current.hits === null
                ? "検索できませんでした"
                : current.hits.length === 0
                  ? "一致する結果はありません"
                  : `${current.hits.length}件${current.hits.length === WORKSPACE_SEARCH_LIMIT ? "まで表示" : ""}`}
          </p>
        ) : null}
        {hits?.length ? (
          <ul
            className="od-search-results"
            role="listbox"
            aria-label="検索結果"
            id={listId}
          >
            {hits.map((hit, index) => (
              <li role="presentation" key={`${hit.kind}:${hit.id}`}>
                <button
                  type="button"
                  role="option"
                  tabIndex={-1}
                  id={`${listId}-${index}`}
                  aria-selected={index === selected}
                  onMouseMove={() => setSelected(index)}
                  onClick={() => pick(hit)}
                >
                  <span>
                    {hit.kind === "type" ? `#${typeLabel(hit.id)}` : hit.title}
                    {hit.kind !== "type" && hit.excerpt ? (
                      <span className="od-search-excerpt">{hit.excerpt}</span>
                    ) : null}
                  </span>
                  <small
                    data-type={hit.kind === "object" ? hit.type : undefined}
                  >
                    {hit.kind === "type"
                      ? "種別"
                      : hit.kind === "daily"
                        ? "Daily"
                        : typeLabel(hit.type ?? "")}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </dialog>
    </>
  );
};
