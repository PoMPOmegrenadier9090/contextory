import {
  isPageConflict,
  type DayMemo,
  type DocNode,
  type ObjectClient,
} from "@pkm/core";
import { ObjectEditor, type EditorHost } from "@pkm/editor";
import { useEffect, useRef, useState } from "react";

const SAVE_DELAY = 400;
const RETRY_DELAY = 3000;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Dailyの「この日のMemo」の一件。Memoのページとして読み書きするので、
 * 置いてある文書を開けば同じ内容が出る。
 */
export const DayMemoCard = ({
  client,
  memo,
  host,
  place,
  onTitle,
}: {
  readonly client: ObjectClient;
  readonly memo: DayMemo;
  readonly host: EditorHost;
  /** 置いてある文書の名前と、それを開く操作。どこにも置いていなければnull */
  readonly place: { readonly label: string; readonly open: () => void } | null;
  readonly onTitle: (title: string) => void;
}): React.JSX.Element => {
  const id = memo.object.id;
  const [loaded, setLoaded] = useState<{ key: number; doc: DocNode } | null>(
    null,
  );
  const [title, setTitle] = useState(
    memo.object.title === "無題" ? "" : memo.object.title,
  );
  const [error, setError] = useState<string | null>(null);
  /** 他で変わっていて保存を断られた本文 */
  const [conflict, setConflict] = useState<DocNode | null>(null);
  const revision = useRef("");
  const pending = useRef<DocNode | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const save = (doc: DocNode, base: string | null): void => {
    queue.current = queue.current.then(async () => {
      try {
        revision.current = (await client.savePage(id, doc, base)).revision;
        setError(null);
      } catch (cause) {
        if (isPageConflict(cause)) setConflict(doc);
        // 送れなかった本文は、新しい入力が無ければそのまま送り直す。
        else if (pending.current === null) {
          pending.current = doc;
          timer.current = window.setTimeout(flush, RETRY_DELAY);
        }
        setError(message(cause));
      }
    });
  };
  const flush = (): void => {
    window.clearTimeout(timer.current);
    const doc = pending.current;
    pending.current = null;
    if (doc) save(doc, revision.current);
  };
  const load = (): void => {
    window.clearTimeout(timer.current);
    pending.current = null;
    queue.current = queue.current.then(async () => {
      try {
        const page = await client.loadPage(id);
        revision.current = page.revision;
        setConflict(null);
        setError(null);
        setLoaded((last) => ({ key: (last?.key ?? 0) + 1, doc: page.doc }));
      } catch (cause) {
        setError(message(cause));
      }
    });
  };

  useEffect(() => {
    load();
    const onHide = (): void => {
      if (pending.current)
        void client.savePage(id, pending.current, revision.current, true);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
    // Memoごとに一度だけ読む。
  }, [id]);

  return (
    <article className="od-day-memo" aria-label={`Memo: ${title || "無題"}`}>
      <header>
        <button
          type="button"
          className="od-type"
          onClick={() => host.open(id)}
          title="Memoのページを開く"
        >
          Memo
        </button>
        <input
          className="od-day-memo-title"
          aria-label="MemoのTitle"
          value={title}
          placeholder="無題"
          onChange={(event) => {
            setTitle(event.currentTarget.value);
            onTitle(event.currentTarget.value);
          }}
        />
        {place ? (
          <button
            type="button"
            className="od-day-memo-place"
            onClick={place.open}
          >
            {place.label}
          </button>
        ) : null}
      </header>
      {conflict ? (
        <div className="od-conflict" role="alert">
          <p>このMemoは、別の画面で更新されています。</p>
          <div>
            <button
              type="button"
              onClick={() => {
                setConflict(null);
                save(pending.current ?? conflict, null);
                pending.current = null;
              }}
            >
              この画面の内容で上書き
            </button>
            <button type="button" onClick={load}>
              保存されている内容を開く（この画面の変更は消えます）
            </button>
          </div>
        </div>
      ) : error ? (
        <p className="od-day-memo-error" role="status">
          保存できませんでした: {error}
        </p>
      ) : null}
      {loaded ? (
        <ObjectEditor
          key={loaded.key}
          initialDoc={loaded.doc}
          host={{
            ...host,
            page: { id, type: memo.object.type },
            // 中で作ったObjectは、このMemoのContextを継ぐ。
            create: (type, value, parentId) =>
              host.create(type, value, parentId ?? id),
          }}
          ariaLabel="Memoの本文"
          onChange={(doc) => {
            pending.current = doc;
            window.clearTimeout(timer.current);
            if (!conflict) timer.current = window.setTimeout(flush, SAVE_DELAY);
          }}
        />
      ) : null}
    </article>
  );
};
