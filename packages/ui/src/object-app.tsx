import {
  CONTEXT_FIELD,
  fieldNode,
  inheritedContexts,
  isPageConflict,
  newId,
  TYPE_COLORS,
  type DocNode,
  type FieldDefinition,
  type ObjectClient,
  type ObjectOverview,
  type ObjectSummary,
  type ObjectTimelineEntry,
  type ObjectType,
  type ObjectTypePatch,
  type TypeDefinition,
} from "@pkm/core";
import { ObjectEditor, typeLabel, type EditorHost } from "@pkm/editor";
import { useEffect, useRef, useState } from "react";

import { DayMemoCard } from "./day-memo.js";
import {
  dailyDate,
  dailyHostId,
  dateRange,
  localDate,
  shiftDate,
} from "./object-date.js";

const isDaily = (hostId: string): boolean => dailyDate(hostId) !== null;
const startOfToday = (): number => dateRange(localDate()).from;

const formatTime = (time: number): string =>
  new Intl.DateTimeFormat(
    "ja-JP",
    time >= startOfToday()
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "numeric", day: "numeric" },
  ).format(time);

type TimelineFilter = "all" | "task" | "memo" | "decision" | "mention";
const FILTERS: readonly (readonly [TimelineFilter, string])[] = [
  ["all", "すべて"],
  ["task", "Task"],
  ["memo", "Memo"],
  ["decision", "Decision"],
  ["mention", "言及"],
];

const KIND_LABEL = {
  text: "テキスト",
  reference: "参照",
  date: "日付",
  select: "選択",
} as const;

/** 種別のページ。名前・色・Fieldを定義する。 */
const TypePage = ({
  definition,
  others,
  objects,
  onPatch,
  row,
}: {
  readonly definition: TypeDefinition;
  /** 継承元に選べる種別 */
  readonly others: readonly TypeDefinition[];
  readonly objects: readonly ObjectSummary[];
  readonly onPatch: (patch: ObjectTypePatch) => void;
  readonly row: (object: ObjectSummary) => React.JSX.Element;
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
  // 入力中は確定せず、フォーカスを外した時かEnterで保存する。
  const commitOnEnter = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing)
      event.currentTarget.blur();
  };
  return (
    <>
      <header
        className="od-page-header"
        data-type={definition.name}
        data-color={definition.color ?? undefined}
      >
        <span className="od-type">種別</span>
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
      <label className="od-status od-type-option">
        継承元
        <select
          value={definition.extends ?? ""}
          onChange={(event) =>
            onPatch({ extends: event.currentTarget.value || null })
          }
        >
          <option value="">なし</option>
          {others.map((other) => (
            <option key={other.name} value={other.name}>
              #{typeLabel(other.name)}
            </option>
          ))}
        </select>
      </label>
      <section className="od-panel">
        <header>
          <div>
            <h2>Field</h2>
            <p>上にあるものほど優先して見せる。外したFieldの値は消える</p>
          </div>
        </header>
        <ul className="od-fields">
          {fields.map((field, index) => (
            <li key={field.id}>
              {field.kind === "context" ? (
                <>
                  <strong>{field.name}</strong>
                  <small>すべての種別が持つ。推移的に集める</small>
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
                  <select
                    aria-label="Fieldの型"
                    value={field.kind}
                    onChange={(event) =>
                      setField(index, {
                        kind: event.currentTarget
                          .value as keyof typeof KIND_LABEL,
                      })
                    }
                  >
                    {Object.entries(KIND_LABEL).map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </select>
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
      <section className="od-panel">
        <header>
          <div>
            <h2>この種別のObject</h2>
          </div>
        </header>
        {objects.length ? (
          <ul className="od-rows">{objects.map(row)}</ul>
        ) : (
          <p className="od-empty">まだありません。</p>
        )}
      </section>
    </>
  );
};

/** 保存を少し待ってまとめる時間。 */
const SAVE_DELAY = 400;
const RETRY_DELAY = 3000;

export const ObjectApp = ({
  client,
  location = "サーバーのSQLiteへ保存",
}: {
  readonly client: ObjectClient;
  /** 保存先の説明。ナビゲーションの下に出す。 */
  readonly location?: string;
}): React.JSX.Element => {
  const [loaded, setLoaded] = useState<{
    readonly key: number;
    readonly hostId: string;
    readonly doc: DocNode;
  } | null>(null);
  const [objects, setObjects] = useState<
    Readonly<Record<string, ObjectSummary>>
  >({});
  const [timeline, setTimeline] = useState<readonly ObjectTimelineEntry[]>([]);
  const [overview, setOverview] = useState<ObjectOverview>({
    navigation: [],
    recent: [],
    memos: [],
  });
  const [types, setTypes] = useState<readonly TypeDefinition[]>([]);
  /** 開いている種別のページと、その種別のObject */
  const [typePage, setTypePage] = useState<{
    readonly name: string;
    readonly objects: readonly ObjectSummary[];
  } | null>(null);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  /** "saved"、"saving"、または失敗の理由 */
  const [status, setStatus] = useState("saved");
  // Titleは入力中に保存結果で巻き戻らないよう、画面側の値を正とする。
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createType, setCreateType] = useState<ObjectType>("project");
  /** Quick Captureの入力。contextは保存前に外せるContextの候補。 */
  const [capture, setCapture] = useState<{
    readonly text: string;
    readonly context: string | null;
  } | null>(null);

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
  const merge = (next: Readonly<Record<string, ObjectSummary>>): void =>
    setObjects((cache) => ({ ...cache, ...next }));

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    setStatus("saving");
    const run = queue.current.then(task);
    queue.current = run.then(
      () => setStatus("saved"),
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
    const [nextOverview, nextTypes, nextTimeline] = await Promise.all([
      client.overview(range.from, range.to),
      client.types(),
      isDaily(hostId) ? Promise.resolve([]) : client.timeline(hostId),
    ]);
    setOverview(nextOverview);
    setTypes(nextTypes);
    setTimeline(nextTimeline);
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
      setFilter("all");
      await refreshSide(hostId);
      window.scrollTo({ top: 0 });
    });
  };

  const openType = (name: string): void => {
    flush();
    void enqueue(async () => {
      const [nextTypes, found] = await Promise.all([
        client.types(),
        client.objectsOfType(name),
      ]);
      setTypes(nextTypes);
      // 文書は開き直した時に、新しい定義で組み立て直す。
      setLoaded(null);
      merge(Object.fromEntries(found.map((o) => [o.id, o])));
      setTypePage({ name, objects: found });
      window.scrollTo({ top: 0 });
    });
  };
  const patchType = (
    name: string,
    patch: Parameters<React.ComponentProps<typeof TypePage>["onPatch"]>[0],
  ): void => {
    void enqueue(async () => {
      await client.updateType(name, patch);
    });
    openType(patch.name ?? name);
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

  const host: EditorHost = {
    lookup: (id) => objects[id],
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
      mutate(() => client.createObject({ id, type, title, parentId: parent }), {
        id,
        type,
        title,
        done: false,
        contexts: inheritedContexts(parent ? objects[parent] : undefined),
        createdAt: Date.now(),
      });
      return id;
    },
    open,
    openType: (type) => openType(type),
  };

  const startCapture = (): void =>
    setCapture(
      (last) =>
        last ?? { text: "", context: current && !typePage ? current.id : null },
    );
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

  /** 1行目をTitle、残りを本文にしたMemoを、今日のDailyの末尾に足す。 */
  const saveCapture = (): void => {
    if (!capture?.text.trim()) return;
    const input = capture;
    const [first = "", ...rest] = input.text.split("\n");
    const memo: DocNode = {
      type: "objectBlock",
      attrs: {
        id: newId(),
        objectId: newId(),
        type: "memo",
        done: false,
        // 本文があれば開いて置き、Dailyでそのまま読めるようにする。
        collapsed: !rest.some((line) => line.trim()),
      },
      content: [
        first.trim()
          ? {
              type: "objectTitle",
              content: [{ type: "text", text: first.trim() }],
            }
          : { type: "objectTitle" },
        ...(input.context
          ? [
              fieldNode({
                ...CONTEXT_FIELD,
                value: [
                  { type: "objectRef", attrs: { objectId: input.context } },
                ],
              }),
            ]
          : []),
        ...rest
          .filter((line) => line.trim())
          .map((line) => ({
            type: "paragraph",
            attrs: { id: newId() },
            content: [{ type: "text", text: line }],
          })),
      ],
    };
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
          setCapture(input);
          throw error;
        }
      }
    });
  };

  const hasCheckbox = (type: ObjectType): boolean =>
    types.find((definition) => definition.name === type)?.checkbox ?? false;
  const colorOf = (type: ObjectType): string | undefined =>
    types.find((definition) => definition.name === type)?.color ?? undefined;
  const objectRow = (
    object: ObjectSummary,
    note: string,
  ): React.JSX.Element => (
    <li
      className="od-row"
      data-type={object.type}
      data-color={colorOf(object.type)}
      key={object.id}
    >
      <span className="od-type">{typeLabel(object.type)}</span>
      <button type="button" onClick={() => open(object.id)}>
        <strong>{object.title}</strong>
        {note ? <small>{note}</small> : null}
      </button>
      {hasCheckbox(object.type) ? (
        <span className="od-row-status" data-done={object.done}>
          {object.done ? "完了" : "未完了"}
        </span>
      ) : null}
      <time>{formatTime(object.createdAt)}</time>
    </li>
  );
  const viaNote = (via: readonly string[]): string =>
    via.length ? `via ${via.join(" › ")}` : "";
  const timelineRow = (entry: ObjectTimelineEntry): React.JSX.Element =>
    entry.kind === "object" ? (
      objectRow(
        entry.object,
        entry.mentioned
          ? [entry.field ? `${entry.field}で言及` : "言及", viaNote(entry.via)]
              .filter(Boolean)
              .join(" · ")
          : viaNote(entry.via) || "直接",
      )
    ) : (
      <li
        className="od-row"
        data-type="mention"
        key={`${entry.hostId}-${entry.unitId}`}
      >
        <span className="od-type">
          {entry.unitKind === "section" ? "見出し" : "言及"}
        </span>
        <button type="button" onClick={() => open(entry.hostId)}>
          <strong>{entry.text}</strong>
          <small>
            {[entry.hostTitle, viaNote(entry.via)].filter(Boolean).join(" · ")}
          </small>
        </button>
        <time>{formatTime(entry.time)}</time>
      </li>
    );
  const shownTimeline = timeline.filter((entry) =>
    filter === "all"
      ? true
      : filter === "mention"
        ? entry.kind === "unit" || entry.mentioned
        : entry.kind === "object" && entry.object.type === filter,
  );

  // この日のDailyに置いたMemoは本文で読めるので、欄には出さない。
  const dayMemos = overview.memos.filter((memo) => memo.hostId !== page);
  const placeLabel = (hostId: string, hostTitle: string): string => {
    const date = dailyDate(hostId);
    return date
      ? `${new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(new Date(`${date}T12:00:00`))}のDaily`
      : hostTitle;
  };
  const areas = overview.navigation.filter((o) => o.type === "area");
  const projects = overview.navigation.filter((o) => o.type === "project");
  const selectedDate = page === null ? null : dailyDate(page);
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
  const navButton = (
    object: ObjectSummary,
    className: string,
  ): React.JSX.Element => (
    <button
      key={object.id}
      type="button"
      className={className}
      aria-current={page === object.id ? "page" : undefined}
      onClick={() => open(object.id)}
    >
      {object.title}
    </button>
  );
  return (
    <div className="od-demo">
      <header className="od-topbar">
        <div>
          <span className="od-product">Contextory</span>
          <span
            className="od-save-status"
            role="status"
            data-error={status !== "saved" && status !== "saving"}
          >
            {status === "saved"
              ? "保存済み"
              : status === "saving"
                ? "保存中…"
                : `保存できませんでした: ${status}`}
          </span>
        </div>
        <div className="od-topbar-actions">
          <button
            type="button"
            title="Quick Capture（⌘⇧M）"
            onClick={startCapture}
          >
            ＋ Memo
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateType(
                types.some((definition) => definition.name === "project")
                  ? "project"
                  : (types[0]?.name ?? "project"),
              );
              setCreating(true);
            }}
          >
            ＋ Object
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
            onKeyDown={(event) => {
              if (event.key === "Escape") setCapture(null);
              if (
                event.key === "Enter" &&
                (event.metaKey || event.ctrlKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                saveCapture();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              saveCapture();
            }}
          >
            <h2 id="od-capture-title">Memoを今日のDailyに追加</h2>
            <textarea
              autoFocus
              aria-label="Memo"
              placeholder="1行目がTitle、2行目からが本文"
              rows={5}
              value={capture.text}
              onChange={(event) => {
                const text = event.currentTarget.value;
                setCapture((last) => last && { ...last, text });
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
            <div className="od-dialog-actions">
              <button type="button" onClick={() => setCapture(null)}>
                キャンセル
              </button>
              <button type="submit" disabled={!capture.text.trim()}>
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
            <label>
              種別
              <select
                value={createType}
                onChange={(event) => setCreateType(event.currentTarget.value)}
              >
                {types.map((definition) => (
                  <option key={definition.name} value={definition.name}>
                    #{typeLabel(definition.name)}
                  </option>
                ))}
              </select>
            </label>
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
      <div className="od-shell">
        <nav className="od-nav" aria-label="ページ">
          <button
            type="button"
            aria-current={page !== null && isDaily(page) ? "page" : undefined}
            onClick={() => open(dailyHostId())}
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
              onClick={() => openType(definition.name)}
            >
              #{typeLabel(definition.name)}
            </button>
          ))}
          <dl className="od-keys">
            <dt>@</dt>
            <dd>参照・新規作成</dd>
            <dt>#</dt>
            <dd>BlockをObject化</dd>
            <dt>Enter</dt>
            <dd>Titleや空行からObjectの外へ</dd>
            <dt>⌫</dt>
            <dd>Title先頭でObjectを解除</dd>
          </dl>
          <p className="od-nav-note">{location}</p>
        </nav>
        <main className="od-main">
          {typePage ? (
            <TypePage
              definition={
                types.find(
                  (definition) => definition.name === typePage.name,
                ) ?? {
                  name: typePage.name,
                  color: null,
                  builtin: false,
                  checkbox: false,
                  fields: [],
                  extends: null,
                  inherited: [],
                }
              }
              others={types.filter(
                (definition) => definition.name !== typePage.name,
              )}
              objects={typePage.objects}
              onPatch={(patch) => patchType(typePage.name, patch)}
              row={(object) => objectRow(object, "")}
            />
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
                  </div>
                </header>
              ) : (
                <header className="od-page-header">
                  <span className="od-type">Daily</span>
                  <div className="od-daily-nav">
                    <button
                      type="button"
                      aria-label="前の日"
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
                    <input
                      type="date"
                      aria-label="Dailyの日付"
                      value={selectedDate ?? localDate()}
                      onChange={(event) => {
                        const date = event.currentTarget.value;
                        if (date) open(dailyHostId(date));
                      }}
                    />
                    <button
                      type="button"
                      aria-label="次の日"
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
                    {new Intl.DateTimeFormat("ja-JP", {
                      month: "long",
                      day: "numeric",
                      weekday: "short",
                    }).format(
                      new Date(`${selectedDate ?? localDate()}T12:00:00`),
                    )}
                  </h1>
                  <p className="od-page-lead">
                    自由に書く。@で触れた段落・見出し・リスト項目は、参照先のTimelineに出る。
                  </p>
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
                <section className="od-panel">
                  <header>
                    <div>
                      <h2>Timeline</h2>
                      <p>
                        Contextで属する記録と、@で言及した記述。配下のObjectの分も集める
                      </p>
                    </div>
                    <div className="od-segmented" aria-label="Timeline filter">
                      {FILTERS.map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={filter === value}
                          onClick={() => setFilter(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </header>
                  {shownTimeline.length ? (
                    <ul className="od-rows">
                      {shownTimeline.map(timelineRow)}
                    </ul>
                  ) : (
                    <p className="od-empty">まだありません。</p>
                  )}
                </section>
              ) : (
                <section className="od-panel">
                  <header>
                    <div>
                      <h2>この日のMemo</h2>
                      <p>
                        ほかの文書でこの日に作ったMemo。ここで書いた内容は、置いてある文書にも出る
                      </p>
                    </div>
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
};
