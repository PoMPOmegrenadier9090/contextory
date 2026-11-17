import {
  DAILY_UNDATED_ID,
  inheritedContexts,
  isPageConflict,
  newId,
  TYPE_COLORS,
  type DocNode,
  type FieldDefinition,
  type ObjectClient,
  type ObjectOverview,
  type ObjectSummary,
  type ObjectType,
  type ObjectTypePatch,
  type TypeDefinition,
} from "@pkm/core";
import {
  CheckItem,
  DatePanel,
  formatDate,
  ObjectEditor,
  Popover,
  typeLabel,
  type EditorHost,
} from "@pkm/editor";
import { useEffect, useMemo, useRef, useState } from "react";

import { captureMemo, emptyBody, type CaptureInput } from "./capture.js";
import { DayMemoCard } from "./day-memo.js";
import { ObjectSearch } from "./object-search.js";
import {
  dailyDate,
  dailyHostId,
  dateRange,
  localDate,
  shiftDate,
} from "./object-date.js";
import {
  commitOnEnter,
  EmbeddedView,
  EmbeddedViewContext,
  KIND_LABEL,
  store,
  stored,
  ViewTabs,
} from "./views.js";

const isDaily = (hostId: string): boolean =>
  hostId === DAILY_UNDATED_ID || dailyDate(hostId) !== null;
/** 狭い画面では、メニューを本文の上に重ねて出す。 */
const narrow = (): boolean => window.matchMedia("(max-width: 760px)").matches;

/** 種別の設定。名前・色・Fieldを定義する。 */
const TypeSettings = ({
  definition,
  others,
  onPatch,
  onBack,
  onDelete,
}: {
  readonly definition: TypeDefinition;
  /** 継承元に選べる種別 */
  readonly others: readonly TypeDefinition[];
  readonly onPatch: (patch: ObjectTypePatch) => void;
  readonly onBack: () => void;
  readonly onDelete: () => void;
}): React.JSX.Element => {
  const { fields } = definition;
  const setField = (index: number, patch: Partial<FieldDefinition>): void =>
    onPatch({
      fields: fields.map((field, i) =>
        i === index ? { ...field, ...patch } : field,
      ),
    });
  const move = (index: number, to: number): void => {
    const next = [...fields];
    next.splice(to, 0, ...next.splice(index, 1));
    onPatch({ fields: next });
  };
  return (
    <>
      <header
        className="od-page-header"
        data-type={definition.name}
        data-color={definition.color ?? undefined}
      >
        <button type="button" className="od-type" onClick={onBack}>
          ← Viewへ戻る
        </button>
        <input
          key={definition.name}
          className="od-page-title"
          aria-label="種別の名前"
          defaultValue={typeLabel(definition.name)}
          disabled={definition.builtin}
          onKeyDown={commitOnEnter}
          onBlur={(event) => {
            const name = event.currentTarget.value.trim();
            if (name && name !== definition.name) onPatch({ name });
          }}
        />
        <div className="od-page-meta od-colors" aria-label="色">
          <button
            type="button"
            aria-pressed={definition.color === null}
            onClick={() => onPatch({ color: null })}
          >
            既定
          </button>
          {TYPE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="od-swatch"
              data-color={color}
              aria-label={color}
              aria-pressed={definition.color === color}
              onClick={() => onPatch({ color })}
            />
          ))}
        </div>
      </header>
      <label className="od-status od-type-option">
        <input
          type="checkbox"
          checked={definition.checkbox}
          onChange={() => onPatch({ checkbox: !definition.checkbox })}
        />
        行頭に完了のチェックボックスを出す
      </label>
      <div className="od-status od-type-option">
        継承元
        <Popover
          ariaLabel="継承元"
          label={
            definition.extends ? `#${typeLabel(definition.extends)}` : "なし"
          }
        >
          {(close) =>
            [null, ...others.map((other) => other.name)].map((name) => (
              <CheckItem
                key={name ?? ""}
                checked={definition.extends === name}
                onChange={() => {
                  onPatch({ extends: name });
                  close();
                }}
              >
                {name ? `#${typeLabel(name)}` : "なし"}
              </CheckItem>
            ))
          }
        </Popover>
      </div>
      <section className="od-panel">
        <header>
          <h2>Field</h2>
        </header>
        <ul className="od-fields">
          {fields.map((field, index) => (
            <li key={field.id}>
              {field.kind === "context" ? (
                <>
                  <strong>{field.name}</strong>
                </>
              ) : (
                <>
                  <input
                    key={field.name}
                    aria-label="Fieldの名前"
                    defaultValue={field.name}
                    onKeyDown={commitOnEnter}
                    onBlur={(event) => {
                      const name = event.currentTarget.value.trim();
                      if (name && name !== field.name)
                        setField(index, { name });
                    }}
                  />
                  <Popover ariaLabel="Fieldの型" label={KIND_LABEL[field.kind]}>
                    {(close) =>
                      Object.entries(KIND_LABEL).map(([kind, label]) => (
                        <CheckItem
                          key={kind}
                          checked={field.kind === kind}
                          onChange={() => {
                            setField(index, {
                              kind: kind as keyof typeof KIND_LABEL,
                            });
                            close();
                          }}
                        >
                          {label}
                        </CheckItem>
                      ))
                    }
                  </Popover>
                  {field.kind === "select" ? (
                    <input
                      key={(field.options ?? []).join()}
                      className="od-field-options"
                      aria-label="選択肢"
                      placeholder="選択肢（カンマ区切り）"
                      defaultValue={(field.options ?? []).join(", ")}
                      onKeyDown={commitOnEnter}
                      onBlur={(event) =>
                        setField(index, {
                          options: event.currentTarget.value
                            .split(/[,、]/)
                            .map((option) => option.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  ) : null}
                </>
              )}
              <span className="od-field-actions">
                <button
                  type="button"
                  aria-label="上へ"
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="下へ"
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </button>
                {field.kind === "context" ? null : (
                  <button
                    type="button"
                    aria-label={`${field.name}を削除`}
                    onClick={() =>
                      onPatch({ fields: fields.filter((_, i) => i !== index) })
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            </li>
          ))}
          {definition.inherited.map((field) => (
            <li key={field.id}>
              <strong>{field.name}</strong>
              <small>継承元から引き継ぐ</small>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="od-add-field"
          onClick={() =>
            onPatch({
              fields: [
                ...fields,
                { id: newId(), name: "新しいField", kind: "text" },
              ],
            })
          }
        >
          ＋ Fieldを追加
        </button>
      </section>
      {definition.builtin ? null : (
        <section className="od-panel">
          <header>
            <h2>種別を削除</h2>
          </header>
          <button type="button" className="od-danger" onClick={onDelete}>
            #{typeLabel(definition.name)}を削除
          </button>
        </section>
      )}
    </>
  );
};

/** 保存を少し待ってまとめる時間。 */
const SAVE_DELAY = 400;
const RETRY_DELAY = 3000;

/** カーソルが本文の1行目にあるか。空の行では文字の位置が無いので、行の要素で測る。 */
const caretOnFirstLine = (root: Element, caret: Range): boolean => {
  const first = root.firstElementChild?.getBoundingClientRect();
  const rect =
    caret.getClientRects()[0] ??
    (caret.startContainer instanceof Element
      ? caret.startContainer
      : caret.startContainer.parentElement
    )?.getBoundingClientRect();
  if (!first || !rect) return true;
  const line = parseFloat(getComputedStyle(root).lineHeight) || 24;
  return rect.top < first.top + line;
};

export const ObjectApp = ({
  client,
  location = "サーバーのSQLiteへ保存",
  downloads = true,
}: {
  readonly client: ObjectClient;
  /** 保存先の説明。ナビゲーションの下に出す。 */
  readonly location?: string;
  /** バックアップと書き出しのリンクを出すか。Desktopではメニューから行う。 */
  readonly downloads?: boolean;
}): React.JSX.Element => {
  const [loaded, setLoaded] = useState<{
    readonly key: number;
    readonly hostId: string;
    readonly doc: DocNode;
  } | null>(null);
  const [objects, setObjects] = useState<
    Readonly<Record<string, ObjectSummary>>
  >({});
  const [overview, setOverview] = useState<ObjectOverview>({
    navigation: [],
    recent: [],
    memos: [],
  });
  const [types, setAllTypes] = useState<readonly TypeDefinition[]>([]);
  const setTypes: typeof setAllTypes = (next) =>
    setAllTypes((last) => {
      const value = typeof next === "function" ? next(last) : next;
      return JSON.stringify(value) === JSON.stringify(last) ? last : value;
    });
  /** 開いている種別のページ。settingsなら、Viewではなく種別の設定を出す。 */
  const [typePage, setTypePage] = useState<{
    readonly name: string;
    readonly settings: boolean;
  } | null>(null);
  /** 左のメニュー。広い画面での開閉は端末ごとに覚える。 */
  const [menuOpen, setMenuOpen] = useState(
    () => !narrow() && stored("nav", true),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 端末をまたいで共有する画面の状態。読めなくても、既定の表示で続ける。 */
  const [shared, setShared] = useState<Readonly<Record<string, unknown>>>({});
  useEffect(() => {
    client.uiState().then(
      (state) => {
        setShared((local) => ({ ...state, ...local }));
        // 以前はブラウザーに残していた。まだDBに無いものだけ移し、ブラウザーからは消す。
        try {
          for (const key of Object.keys(localStorage)) {
            const name = key.slice("contextory.".length);
            if (!/^contextory\.(view|fold):/.test(key)) continue;
            if (!(name in state))
              share(name, JSON.parse(localStorage.getItem(key)!) as unknown);
            localStorage.removeItem(key);
          }
        } catch {
          // 読めなければ、既定の表示で続ける。
        }
      },
      (error: unknown) => console.warn("UI state could not be read", error),
    );
    // 起動時に一度だけ読む。
  }, [client]);
  const share = (key: string, value: unknown): void => {
    setShared((last) => ({ ...last, [key]: value }));
    // 保存の列には並べない。失っても困らない値なので、失敗しても止めない。
    client
      .setUiState(key, value)
      .catch((error: unknown) =>
        console.warn("UI state could not be saved", error),
      );
  };
  /** 開いているゴミ箱の中身。nullならゴミ箱を開いていない。 */
  const [trashList, setTrashList] = useState<readonly ObjectSummary[] | null>(
    null,
  );
  /** 書き込みが済むたびに増やす。Viewを読み直す合図。 */
  const [tick, setTick] = useState(0);
  /** "saved"、"saving"、または失敗の理由 */
  const [status, setStatus] = useState("saved");
  // Titleは入力中に保存結果で巻き戻らないよう、画面側の値を正とする。
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createType, setCreateType] = useState<ObjectType>("project");
  /** Quick Captureの入力。本文のエディタはkeyで作り直す。 */
  const [capture, setCapture] = useState<
    (CaptureInput & { readonly key: number }) | null
  >(null);
  /** Quick Captureで書いている最新の本文。入力のたびに画面を描き直さない。 */
  const capturedBody = useRef<DocNode>(emptyBody());
  const [bodyWritten, setBodyWritten] = useState(false);
  const captureBodyRef = useRef<HTMLDivElement>(null);

  // 書き込みは一本の列に並べ、作成→本文保存の順序を保つ。
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef<{ hostId: string; doc: DocNode } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const loads = useRef(0);
  const started = useRef(false);
  /** 最後に読み書きした文書の版。保存時に、他で変わっていないかを確かめる。 */
  const revision = useRef<{ hostId: string; value: string } | null>(null);
  /** 他で変わっていて保存を断られた文書。ユーザーが上書きか読み直しを選ぶ。 */
  const [conflict, setConflict] = useState<{
    readonly hostId: string;
    readonly doc: DocNode;
  } | null>(null);
  // 版を知らない文書は、空の版で送って必ず確かめさせる。
  const baseFor = (hostId: string): string =>
    revision.current?.hostId === hostId ? revision.current.value : "";

  const page = loaded?.hostId ?? null;
  const current = page === null ? undefined : objects[page];
  // 中身が同じなら前の値を残し、エディタを描き直させない。
  const merge = (next: Readonly<Record<string, ObjectSummary>>): void =>
    setObjects((cache) =>
      Object.entries(next).every(
        ([id, object]) => JSON.stringify(cache[id]) === JSON.stringify(object),
      )
        ? cache
        : { ...cache, ...next },
    );
  /** ゴミ箱へ移したObjectを、参照チップで削除済みに見せる。 */
  const forget = (id: string): void =>
    setObjects((cache) =>
      Object.fromEntries(Object.entries(cache).filter(([key]) => key !== id)),
    );

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    setStatus("saving");
    const run = queue.current.then(task);
    queue.current = run.then(
      () => {
        setStatus("saved");
        setTick((last) => last + 1);
      },
      (error: unknown) =>
        setStatus(
          isPageConflict(error)
            ? "別の画面で更新されています"
            : error instanceof Error
              ? error.message
              : String(error),
        ),
    );
    return queue.current;
  };

  const refreshSide = async (hostId: string): Promise<void> => {
    const range = dateRange(dailyDate(hostId) ?? localDate());
    const [nextOverview, nextTypes] = await Promise.all([
      client.overview(range.from, range.to),
      client.types(),
    ]);
    setOverview(nextOverview);
    setTypes(nextTypes);
    merge(
      Object.fromEntries(
        [...nextOverview.navigation, ...nextOverview.recent].map((o) => [
          o.id,
          o,
        ]),
      ),
    );
  };

  const flush = (): void => {
    window.clearTimeout(timer.current);
    const save = pending.current;
    if (!save) return;
    pending.current = null;
    void enqueue(async () => {
      const result = await client
        .savePage(save.hostId, save.doc, baseFor(save.hostId))
        .catch((error: unknown) => {
          if (isPageConflict(error)) {
            setConflict(save);
            throw error;
          }
          // 送れなかった文書は、新しい入力が無ければそのまま送り直す。
          if (pending.current === null) {
            pending.current = save;
            timer.current = window.setTimeout(flush, RETRY_DELAY);
          }
          throw error;
        });
      revision.current = { hostId: save.hostId, value: result.revision };
      merge(result.objects);
      await refreshSide(save.hostId);
    });
  };

  /** 保存を断られた文書を、他での変更を確かめずに保存する。 */
  const overwrite = (): void => {
    if (!conflict) return;
    window.clearTimeout(timer.current);
    // 断られた後も入力していれば、その新しい方を送る。
    const latest =
      pending.current?.hostId === conflict.hostId ? pending.current : conflict;
    pending.current = null;
    setConflict(null);
    void enqueue(async () => {
      const result = await client.savePage(latest.hostId, latest.doc, null);
      revision.current = { hostId: latest.hostId, value: result.revision };
      merge(result.objects);
      await refreshSide(latest.hostId);
    });
  };

  /** この画面の変更を捨てて、保存されている内容を開き直す。 */
  const reloadConflict = (): void => {
    if (!conflict) return;
    window.clearTimeout(timer.current);
    pending.current = null;
    open(conflict.hostId);
  };

  const open = (hostId: string): void => {
    flush();
    void enqueue(async () => {
      const result = await client.loadPage(hostId);
      revision.current = { hostId, value: result.revision };
      setConflict(null);
      merge(result.objects);
      const own = result.objects[hostId]?.title ?? "";
      setTitle(own === "無題" ? "" : own);
      setLoaded({ key: ++loads.current, hostId, doc: result.doc });
      setTypePage(null);
      setTrashList(null);
      await refreshSide(hostId);
      window.scrollTo({ top: 0 });
    });
  };

  const openType = (name: string): void => {
    flush();
    void enqueue(async () => {
      setTypes(await client.types());
      // 文書は開き直した時に、新しい定義で組み立て直す。
      setLoaded(null);
      setTrashList(null);
      setTypePage({ name, settings: false });
      window.scrollTo({ top: 0 });
    });
  };

  const openTrash = (): void => {
    flush();
    void enqueue(async () => {
      setTrashList(await client.trash());
      setLoaded(null);
      setTypePage(null);
      window.scrollTo({ top: 0 });
    });
  };
  /** ゴミ箱での操作。済んだら一覧を読み直す。 */
  const actOnTrash = (task: () => Promise<unknown>): void => {
    void enqueue(async () => {
      await task();
      setTrashList(await client.trash());
    });
  };

  /** 開いている文書を、保存されている内容で開き直す。表での変更を本文に映す。 */
  const pageRef = useRef<string | null>(null);
  pageRef.current = page;
  const reload = async (): Promise<void> => {
    const hostId = pageRef.current;
    if (hostId === null) return setTypes(await client.types());
    const result = await client.loadPage(hostId);
    revision.current = { hostId, value: result.revision };
    merge(result.objects);
    setLoaded({ key: ++loads.current, hostId, doc: result.doc });
    await refreshSide(hostId);
  };
  /** Viewからの書き込み。本文に置いたObjectも変わるので、済んだら文書を開き直す。 */
  const act = (task: () => Promise<unknown>): void => {
    flush();
    void enqueue(async () => {
      await task();
      await reload();
    });
  };
  /** 確かめてからゴミ箱へ移す。開いているObjectなら、今日のDailyへ移る。 */
  const trashObject = (object: ObjectSummary): void => {
    if (
      !window.confirm(
        `「${object.title}」をゴミ箱へ移しますか？\n置かれている文書の本文からも外れます。ゴミ箱から戻せます。`,
      )
    )
      return;
    const leaving = pageRef.current === object.id;
    flush();
    void enqueue(async () => {
      await client.trashObject(object.id);
      forget(object.id);
      if (!leaving) await reload();
    });
    if (leaving) open(dailyHostId());
  };
  const deleteType = (name: string): void => {
    if (!window.confirm(`#${typeLabel(name)}を削除しますか？元に戻せません。`))
      return;
    flush();
    void enqueue(async () => {
      // 断られたときは設定に留まり、理由を保存の欄に出す。
      await client.deleteType(name);
      open(dailyHostId());
    });
  };
  const patchType = (name: string, patch: ObjectTypePatch): void => {
    // 設定の欄がすぐ変わるよう、返事を待たずに画面へ映す。
    setTypes((all) =>
      all.map((definition) =>
        definition.name === name
          ? { ...definition, ...patch, name }
          : definition,
      ),
    );
    flush();
    void enqueue(async () => {
      try {
        const next = await client.updateType(name, patch);
        setTypePage((last) =>
          last?.name === name ? { ...last, name: next.name } : last,
        );
      } finally {
        // Viewだけの変更なら、文書は開き直さない。
        if (Object.keys(patch).some((key) => key !== "views")) await reload();
        else setTypes(await client.types());
      }
    });
  };

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      open(dailyHostId());
    }
    // 閉じる直前の入力も、待たずに送る。
    const onHide = (): void => {
      const save = pending.current;
      if (save)
        void client.savePage(save.hostId, save.doc, baseFor(save.hostId), true);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
    // 初回だけ実行する。
  }, []);

  const mutate = (
    request: () => Promise<ObjectSummary>,
    optimistic?: ObjectSummary,
  ): void => {
    if (optimistic) merge({ [optimistic.id]: optimistic });
    void enqueue(async () => {
      const result = await request();
      merge({ [result.id]: result });
      if (page !== null) await refreshSide(page);
    });
  };

  // 保存の状態などで描き直すたびに作り直すと、埋め込んだObjectがすべて描き直される。
  // 表示に関わるObject・種別・開いているページが変わったときだけ作り直す。
  const host = useMemo<EditorHost>(
    () => ({
      lookup: (id) => objects[id],
      renderView: (viewId, anchorId) => (
        <EmbeddedView viewId={viewId} anchorId={anchorId} />
      ),
      types: () => types,
      page: current ? { id: current.id, type: current.type } : null,
      search: (query) =>
        client.searchObjects(query, page).then((found) => {
          merge(Object.fromEntries(found.map((o) => [o.id, o])));
          return found;
        }),
      create: (type, title, parentId) => {
        const id = newId();
        const parent = parentId ?? (page && !isDaily(page) ? page : null);
        mutate(
          () => client.createObject({ id, type, title, parentId: parent }),
          {
            id,
            type,
            title,
            done: false,
            contexts: inheritedContexts(parent ? objects[parent] : undefined),
            createdAt: Date.now(),
          },
        );
        return id;
      },
      open,
      openType: (type) => openType(type),
      // 継承したFieldは、定義している種別の選択肢に足す。
      addOption: (fieldId, option) => {
        const definer = types.find((definition) =>
          definition.fields.some((field) => field.id === fieldId),
        );
        if (definer)
          patchType(definer.name, {
            fields: definer.fields.map((field) =>
              field.id === fieldId
                ? { ...field, options: [...(field.options ?? []), option] }
                : field,
            ),
          });
      },
    }),
    [objects, types, page, current?.id, current?.type],
  );

  const showCapture = (input: CaptureInput): void => {
    capturedBody.current = input.body;
    setBodyWritten(
      captureMemo({ ...input, title: "", context: null }) !== null,
    );
    setCapture({ ...input, key: ++loads.current });
  };
  // Objectのページで開いたら、そのObjectをContextの候補にして始める。保存前に外せる。
  const startCapture = (): void => {
    if (!capture)
      showCapture({
        title: "",
        context: current && !typePage ? current.id : null,
        body: emptyBody(),
      });
  };
  const shortcut = useRef(startCapture);
  shortcut.current = startCapture;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "m"
      ) {
        event.preventDefault();
        shortcut.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** 書いたMemoを、今日のDailyの末尾に足す。 */
  const saveCapture = (): void => {
    if (!capture) return;
    const input: CaptureInput = { ...capture, body: capturedBody.current };
    const memo = captureMemo(input);
    if (!memo) return;
    const daily = dailyHostId();
    flush();
    setCapture(null);
    void enqueue(async () => {
      // 他の端末と同時に書いた時は、読み直して足し直す。
      for (let attempt = 0; ; attempt++) {
        try {
          const latest = await client.loadPage(daily);
          const result = await client.savePage(
            daily,
            { ...latest.doc, content: [...(latest.doc.content ?? []), memo] },
            latest.revision,
          );
          merge(result.objects);
          if (page === daily) {
            revision.current = { hostId: daily, value: result.revision };
            setLoaded({ key: ++loads.current, hostId: daily, doc: result.doc });
          }
          if (page !== null) await refreshSide(page);
          return;
        } catch (error) {
          if (isPageConflict(error) && attempt < 2) continue;
          // 書いた内容を失わないよう、入力欄に戻す。
          showCapture(input);
          throw error;
        }
      }
    });
  };

  const typeOf = (type: ObjectType): TypeDefinition | undefined =>
    types.find((definition) => definition.name === type);
  const hasCheckbox = (type: ObjectType): boolean =>
    typeOf(type)?.checkbox ?? false;
  const colorOf = (type: ObjectType): string | undefined =>
    typeOf(type)?.color ?? undefined;
  const viewProps = {
    client,
    types,
    lookup: (id: string) => objects[id],
    merge,
    tick,
    open,
    act,
    patchType,
    trash: trashObject,
    shared,
    share,
  };
  // この日のDailyに置いたMemoは本文で読めるので、欄には出さない。
  const dayMemos = overview.memos.filter((memo) => memo.hostId !== page);
  const placeLabel = (hostId: string, hostTitle: string): string => {
    const date = dailyDate(hostId);
    if (hostId === DAILY_UNDATED_ID) return "日付なしのDaily";
    return date
      ? `${new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(`${date}T12:00:00`))}のDaily`
      : hostTitle;
  };
  const areas = overview.navigation.filter((o) => o.type === "area");
  const projects = overview.navigation.filter((o) => o.type === "project");
  const selectedDate = page === null ? null : dailyDate(page);
  const undated = page === DAILY_UNDATED_ID;
  const createOutside = (): void => {
    const id = newId();
    const object: ObjectSummary = {
      id,
      type: createType,
      title: createTitle.trim() || "無題",
      done: false,
      contexts: [],
      createdAt: Date.now(),
    };
    mutate(
      () =>
        client.createObject({
          id,
          type: createType,
          title: createTitle.trim(),
          parentId: null,
        }),
      object,
    );
    setCreating(false);
    setCreateTitle("");
    open(id);
  };
  const toggleMenu = (): void =>
    setMenuOpen((last) => {
      if (!narrow()) store("nav", !last);
      return !last;
    });
  /** メニューから移る。狭い画面では、移ったらメニューを閉じる。 */
  const go = (task: () => void) => (): void => {
    if (narrow()) setMenuOpen(false);
    task();
  };
  const navButton = (
    object: ObjectSummary,
    className: string,
  ): React.JSX.Element => (
    <button
      key={object.id}
      type="button"
      className={className}
      aria-current={page === object.id ? "page" : undefined}
      onClick={go(() => open(object.id))}
    >
      {object.title}
    </button>
  );
  const content = (
    <div className="od-demo">
      <header className="od-topbar">
        <div>
          <button
            type="button"
            className="od-menu-toggle"
            aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"}
            aria-expanded={menuOpen}
            onClick={toggleMenu}
          >
            ☰
          </button>
          <ObjectSearch client={client} open={open} />
          <span
            className="od-save-status"
            role="status"
            data-saved={status === "saved"}
            data-error={status !== "saved" && status !== "saving"}
          >
            {status === "saved"
              ? "保存済み"
              : status === "saving"
                ? "保存中…"
                : `⚠ ${status}`}
          </span>
        </div>
        <div className="od-topbar-actions">
          <button
            type="button"
            title="Memoを書く（⌘⇧M）"
            aria-label="Memoを書く"
            onClick={startCapture}
          >
            ✎
          </button>
          <button
            type="button"
            title="Objectを作成"
            aria-label="Objectを作成"
            onClick={() => {
              setCreateType(
                types.some((definition) => definition.name === "project")
                  ? "project"
                  : (types[0]?.name ?? "project"),
              );
              setCreating(true);
            }}
          >
            ＋
          </button>
        </div>
      </header>
      {capture ? (
        <div className="od-dialog-backdrop">
          <form
            className="od-create-dialog od-capture"
            role="dialog"
            aria-modal="true"
            aria-labelledby="od-capture-title"
            // エディタより先に受ける。⌘Enterを改行にせず、Escapeはメニューが無い時だけ閉じる。
            onKeyDownCapture={(event) => {
              if (
                event.key === "Escape" &&
                !document.querySelector(".pe-menu")
              ) {
                event.stopPropagation();
                setCapture(null);
              }
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.stopPropagation();
                saveCapture();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              saveCapture();
            }}
          >
            <h2 id="od-capture-title">Memoを今日のDailyに追加</h2>
            <input
              autoFocus
              className="od-capture-title"
              aria-label="MemoのTitle"
              placeholder="ひとこと（空のままでもよい）"
              value={capture.title}
              onChange={(event) => {
                const title = event.currentTarget.value;
                setCapture((last) => last && { ...last, title });
              }}
              onKeyDown={(event) => {
                // Enterか↓、末尾での→で本文へ移る。
                const input = event.currentTarget;
                const atEnd =
                  input.selectionStart === input.value.length &&
                  input.selectionEnd === input.value.length;
                if (
                  (event.key === "Enter" ||
                    event.key === "ArrowDown" ||
                    (event.key === "ArrowRight" && atEnd)) &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  !event.metaKey &&
                  !event.ctrlKey
                ) {
                  event.preventDefault();
                  captureBodyRef.current
                    ?.querySelector<HTMLElement>(".tiptap")
                    ?.focus();
                }
              }}
            />
            {capture.context ? (
              <p className="od-capture-context">
                Context
                <span>
                  {objects[capture.context]?.title ?? "無題"}
                  <button
                    type="button"
                    aria-label="Contextを外す"
                    onClick={() =>
                      setCapture((last) => last && { ...last, context: null })
                    }
                  >
                    ×
                  </button>
                </span>
              </p>
            ) : null}
            <div
              className="od-capture-body"
              ref={captureBodyRef}
              // 本文の先頭で←、1行目で↑を押すと、ひとことの欄へ戻る。
              onKeyDownCapture={(event) => {
                if (
                  (event.key !== "ArrowLeft" && event.key !== "ArrowUp") ||
                  event.shiftKey ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.altKey ||
                  event.nativeEvent.isComposing ||
                  document.querySelector(".pe-menu")
                )
                  return;
                const root = event.currentTarget.querySelector(".tiptap");
                const selection = window.getSelection();
                if (!root || !selection?.rangeCount || !selection.isCollapsed)
                  return;
                const caret = selection.getRangeAt(0);
                const before = document.createRange();
                before.setStart(root, 0);
                before.setEnd(caret.startContainer, caret.startOffset);
                const back =
                  event.key === "ArrowLeft"
                    ? before.toString() === ""
                    : caretOnFirstLine(root, caret);
                if (!back) return;
                event.preventDefault();
                event.stopPropagation();
                const title =
                  document.querySelector<HTMLInputElement>(".od-capture-title");
                title?.focus();
                title?.setSelectionRange(
                  title.value.length,
                  title.value.length,
                );
              }}
            >
              <ObjectEditor
                key={capture.key}
                initialDoc={capture.body}
                host={host}
                ariaLabel="Memoの本文"
                onChange={(doc) => {
                  capturedBody.current = doc;
                  setBodyWritten(
                    captureMemo({ title: "", context: null, body: doc }) !==
                      null,
                  );
                }}
              />
            </div>
            <div className="od-dialog-actions">
              <button type="button" onClick={() => setCapture(null)}>
                キャンセル
              </button>
              <button
                type="submit"
                disabled={!capture.title.trim() && !bodyWritten}
              >
                追加（⌘Enter）
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {creating ? (
        <div className="od-dialog-backdrop">
          <form
            className="od-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="od-create-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") setCreating(false);
            }}
            onSubmit={(event) => {
              event.preventDefault();
              createOutside();
            }}
          >
            <h2 id="od-create-title">Objectを作成</h2>
            <div className="od-dialog-field">
              種別
              <Popover ariaLabel="種別" label={`#${typeLabel(createType)}`}>
                {(close) =>
                  types.map((definition) => (
                    <CheckItem
                      key={definition.name}
                      checked={createType === definition.name}
                      onChange={() => {
                        setCreateType(definition.name);
                        close();
                      }}
                    >
                      #{typeLabel(definition.name)}
                    </CheckItem>
                  ))
                }
              </Popover>
            </div>
            <label>
              Title
              <input
                autoFocus
                value={createTitle}
                onChange={(event) => setCreateTitle(event.currentTarget.value)}
              />
            </label>
            <div className="od-dialog-actions">
              <button type="button" onClick={() => setCreating(false)}>
                キャンセル
              </button>
              <button type="submit">作成</button>
            </div>
          </form>
        </div>
      ) : null}
      {settingsOpen ? (
        <div
          className="od-dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSettingsOpen(false);
          }}
        >
          <div
            className="od-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="od-settings-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") setSettingsOpen(false);
            }}
          >
            <h2 id="od-settings-title">設定</h2>
            <dl className="od-settings">
              <dt>保存先</dt>
              <dd>{location}</dd>
              <dt>データ</dt>
              <dd>
                {downloads ? (
                  <>
                    <a href="/api/next/backup" download>
                      バックアップを保存
                    </a>
                    <a href="/api/next/export/markdown" download>
                      Markdownで書き出す
                    </a>
                  </>
                ) : (
                  "メニューの「Contextory」から、バックアップとMarkdownを書き出せる"
                )}
              </dd>
            </dl>
            <div className="od-dialog-actions">
              <button
                type="button"
                autoFocus
                onClick={() => setSettingsOpen(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="od-shell" data-nav={menuOpen ? "open" : "closed"}>
        {menuOpen ? (
          <div
            className="od-nav-backdrop"
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
          />
        ) : null}
        <nav className="od-nav" aria-label="ページ" hidden={!menuOpen}>
          <button
            type="button"
            aria-current={page !== null && isDaily(page) ? "page" : undefined}
            onClick={go(() => open(dailyHostId()))}
          >
            Daily
          </button>
          {areas.map((area) => (
            <div key={area.id}>
              {navButton(area, "od-nav-area")}
              {projects
                .filter((p) => p.contexts.includes(area.id))
                .map((project) => navButton(project, "od-nav-project"))}
            </div>
          ))}
          {projects
            .filter(
              (p) => !p.contexts.some((id) => areas.some((a) => a.id === id)),
            )
            .map((project) => navButton(project, "od-nav-project"))}
          <p className="od-nav-heading">種別</p>
          {types.map((definition) => (
            <button
              key={definition.name}
              type="button"
              className="od-nav-project"
              aria-current={
                typePage?.name === definition.name ? "page" : undefined
              }
              onClick={go(() => openType(definition.name))}
            >
              #{typeLabel(definition.name)}
            </button>
          ))}
          <button
            type="button"
            className="od-nav-project"
            aria-current={trashList ? "page" : undefined}
            onClick={go(openTrash)}
          >
            ゴミ箱
          </button>
          <button
            type="button"
            className="od-nav-settings"
            onClick={go(() => setSettingsOpen(true))}
          >
            設定
          </button>
        </nav>
        <main className="od-main">
          {trashList ? (
            <>
              <header className="od-page-header">
                <span className="od-type">ゴミ箱</span>
                <h1>ゴミ箱</h1>
                <div className="od-page-meta od-type-actions">
                  <button
                    type="button"
                    disabled={!trashList.length}
                    onClick={() => {
                      if (
                        window.confirm(
                          `ゴミ箱の${trashList.length}件を完全に削除しますか？元に戻せません。`,
                        )
                      )
                        actOnTrash(() => client.emptyTrash());
                    }}
                  >
                    ゴミ箱を空にする
                  </button>
                </div>
              </header>
              {trashList.length ? (
                <ul className="od-rows">
                  {trashList.map((object) => (
                    <li key={object.id} className="od-row od-trash-row">
                      <span
                        className="od-type"
                        data-type={object.type}
                        data-color={colorOf(object.type)}
                      >
                        {typeLabel(object.type)}
                      </span>
                      <span className="od-trash-title">{object.title}</span>
                      <button
                        type="button"
                        onClick={() =>
                          actOnTrash(async () =>
                            merge({
                              [object.id]: await client.restoreObject(
                                object.id,
                              ),
                            }),
                          )
                        }
                      >
                        戻す
                      </button>
                      <button
                        type="button"
                        className="od-danger"
                        onClick={() => {
                          if (
                            window.confirm(
                              `「${object.title}」を完全に削除しますか？元に戻せません。`,
                            )
                          )
                            actOnTrash(() => client.purgeObject(object.id));
                        }}
                      >
                        完全に削除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="od-empty">ゴミ箱は空です。</p>
              )}
            </>
          ) : typePage && !typeOf(typePage.name) ? (
            <p className="od-empty">この種別はありません。</p>
          ) : typePage?.settings ? (
            <TypeSettings
              definition={typeOf(typePage.name)!}
              others={types.filter(
                (definition) => definition.name !== typePage.name,
              )}
              onPatch={(patch) => patchType(typePage.name, patch)}
              onBack={() => setTypePage({ ...typePage, settings: false })}
              onDelete={() => deleteType(typePage.name)}
            />
          ) : typePage ? (
            <>
              <header
                className="od-page-header"
                data-type={typePage.name}
                data-color={colorOf(typePage.name)}
              >
                <span className="od-type">種別</span>
                <h1>#{typeLabel(typePage.name)}</h1>
                <div className="od-page-meta od-type-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setCreateType(typePage.name);
                      setCreating(true);
                    }}
                  >
                    ＋ 作成
                  </button>
                  <button
                    type="button"
                    onClick={() => setTypePage({ ...typePage, settings: true })}
                  >
                    種別の設定
                  </button>
                </div>
              </header>
              <ViewTabs
                key={typePage.name}
                scope="type"
                owner={typeOf(typePage.name)!}
                anchorId={null}
                {...viewProps}
              />
            </>
          ) : (
            <>
              {current ? (
                <header
                  className="od-page-header"
                  data-type={current.type}
                  data-color={colorOf(current.type)}
                >
                  <button
                    type="button"
                    className="od-type"
                    onClick={() => openType(current.type)}
                  >
                    #{typeLabel(current.type)}
                  </button>
                  <input
                    className="od-page-title"
                    aria-label="Title"
                    value={title}
                    placeholder="無題"
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setTitle(value);
                      mutate(() =>
                        client.patchObject(current.id, { title: value }),
                      );
                    }}
                  />
                  <div className="od-page-meta">
                    {hasCheckbox(current.type) ? (
                      <label className="od-status">
                        <input
                          type="checkbox"
                          checked={current.done}
                          onChange={() =>
                            mutate(
                              () =>
                                client.patchObject(current.id, {
                                  done: !current.done,
                                }),
                              { ...current, done: !current.done },
                            )
                          }
                        />
                        完了
                      </label>
                    ) : null}
                    <button
                      type="button"
                      className="od-page-trash"
                      onClick={() => trashObject(current)}
                    >
                      ゴミ箱へ移す
                    </button>
                  </div>
                </header>
              ) : (
                <header className="od-page-header">
                  <span className="od-type">Daily</span>
                  <div className="od-daily-nav">
                    <button
                      type="button"
                      aria-label="前の日"
                      disabled={undated}
                      onClick={() =>
                        open(
                          dailyHostId(
                            shiftDate(selectedDate ?? localDate(), -1),
                          ),
                        )
                      }
                    >
                      ‹
                    </button>
                    <Popover
                      ariaLabel="Dailyの日付"
                      label={
                        undated
                          ? "日付なし"
                          : formatDate(selectedDate ?? localDate())
                      }
                    >
                      {(close) => (
                        <DatePanel
                          value={undated ? "" : (selectedDate ?? localDate())}
                          onPick={(date) => {
                            open(date ? dailyHostId(date) : DAILY_UNDATED_ID);
                            close();
                          }}
                        />
                      )}
                    </Popover>
                    <button
                      type="button"
                      aria-label="次の日"
                      disabled={undated}
                      onClick={() =>
                        open(
                          dailyHostId(
                            shiftDate(selectedDate ?? localDate(), 1),
                          ),
                        )
                      }
                    >
                      ›
                    </button>
                    {selectedDate === localDate() ? null : (
                      <button type="button" onClick={() => open(dailyHostId())}>
                        今日
                      </button>
                    )}
                  </div>
                  <h1>
                    {undated
                      ? "日付なし"
                      : new Intl.DateTimeFormat("ja-JP", {
                          month: "long",
                          day: "numeric",
                          weekday: "short",
                        }).format(
                          new Date(`${selectedDate ?? localDate()}T12:00:00`),
                        )}
                  </h1>
                </header>
              )}

              {conflict && conflict.hostId === loaded?.hostId ? (
                <div className="od-conflict" role="alert">
                  <p>
                    この文書は、別の端末や画面で更新されています。この画面の変更は、まだ保存していません。
                  </p>
                  <div>
                    <button type="button" onClick={overwrite}>
                      この画面の内容で上書き
                    </button>
                    <button type="button" onClick={reloadConflict}>
                      保存されている内容を開く（この画面の変更は消えます）
                    </button>
                  </div>
                </div>
              ) : null}

              {loaded ? (
                <section className="od-document">
                  <ObjectEditor
                    key={loaded.key}
                    initialDoc={loaded.doc}
                    host={host}
                    ariaLabel={isDaily(loaded.hostId) ? "Daily本文" : "本文"}
                    onChange={(doc) => {
                      pending.current = { hostId: loaded.hostId, doc };
                      window.clearTimeout(timer.current);
                      timer.current = window.setTimeout(flush, SAVE_DELAY);
                    }}
                  />
                </section>
              ) : (
                <p className="od-empty">読み込み中…</p>
              )}

              {current ? (
                typeOf(current.type) ? (
                  <ViewTabs
                    key={current.id}
                    scope="object"
                    owner={typeOf(current.type)!}
                    anchorId={current.id}
                    {...viewProps}
                  />
                ) : null
              ) : undated ? null : (
                <section className="od-panel">
                  <header>
                    <h2>この日のMemo</h2>
                  </header>
                  {dayMemos.length ? (
                    <div className="od-day-memos">
                      {dayMemos.map((memo) => (
                        <DayMemoCard
                          key={memo.object.id}
                          client={client}
                          memo={memo}
                          host={host}
                          place={
                            memo.hostId === null
                              ? null
                              : {
                                  label: placeLabel(
                                    memo.hostId,
                                    memo.hostTitle,
                                  ),
                                  open: () => open(memo.hostId!),
                                }
                          }
                          onTitle={(value) =>
                            mutate(() =>
                              client.patchObject(memo.object.id, {
                                title: value,
                              }),
                            )
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="od-empty">まだありません。</p>
                  )}
                </section>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
  return (
    <EmbeddedViewContext.Provider value={viewProps}>
      {content}
    </EmbeddedViewContext.Provider>
  );
};
