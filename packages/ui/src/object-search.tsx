import type { ObjectClient, ObjectSummary } from "@pkm/core";
import { typeLabel } from "@pkm/editor";
import { useEffect, useRef, useState } from "react";

const LIMIT = 50;

export const ObjectSearch = ({
  client,
  open,
}: {
  readonly client: ObjectClient;
  readonly open: (id: string) => void;
}): React.JSX.Element => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{
    readonly query: string;
    readonly objects: readonly ObjectSummary[] | null;
  } | null>(null);
  const term = query.trim();
  const current = result?.query === term ? result : null;
  useEffect(() => {
    if (!visible || !term) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void client.searchObjects(term, null, LIMIT).then(
        (objects) => {
          if (live) setResult({ query: term, objects });
        },
        () => {
          if (live) setResult({ query: term, objects: null });
        },
      );
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [client, term, visible]);
  const pick = (id: string): void => {
    dialog.current?.close();
    open(id);
  };
  return (
    <>
      <button
        type="button"
        className="od-search-trigger"
        onClick={() => {
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
        aria-labelledby="od-search-title"
        onClose={() => {
          setVisible(false);
          setQuery("");
          setResult(null);
        }}
      >
        <header>
          <h2 id="od-search-title">Objectを検索</h2>
          <form method="dialog">
            <button type="submit" aria-label="検索を閉じる">
              ×
            </button>
          </form>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (current?.objects?.[0]) pick(current.objects[0].id);
          }}
        >
          <input
            type="search"
            aria-label="Objectのタイトル"
            placeholder="タイトルで検索"
            autoFocus
            value={query}
            onChange={(event) => {
              if (event.currentTarget.value.trim() !== term) setResult(null);
              setQuery(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing)
                return;
              event.preventDefault();
              if (current?.objects?.[0]) pick(current.objects[0].id);
            }}
          />
        </form>
        {term ? (
          <p role="status">
            {!current
              ? "検索中…"
              : current.objects === null
                ? "検索できませんでした"
                : current.objects.length === 0
                  ? "該当するObjectはありません"
                  : `${current.objects.length}件${current.objects.length === LIMIT ? "まで表示" : ""}`}
          </p>
        ) : null}
        {current?.objects?.length ? (
          <ul>
            {current.objects.map((object) => (
              <li key={object.id}>
                <button type="button" onClick={() => pick(object.id)}>
                  <span>{object.title}</span>
                  <small>{typeLabel(object.type)}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </dialog>
    </>
  );
};
