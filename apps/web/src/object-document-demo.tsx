import {
  inheritedContexts,
  newId,
  TYPE_COLORS,
  type DocNode,
  type FieldDefinition,
  type ObjectPage,
  type ObjectRecord,
  type ObjectSummary,
  type ObjectTimelineEntry,
  type ObjectType,
  type TypeDefinition,
} from "@pkm/core";
import { ObjectEditor, typeLabel, type EditorHost } from "@pkm/editor";
import { useEffect, useRef, useState } from "react";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const startOfToday = (): number => new Date().setHours(0, 0, 0, 0);
const dailyId = (): string => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `daily:${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
const isDaily = (hostId: string): boolean => hostId.startsWith("daily:");

interface Overview {
  readonly navigation: readonly ObjectSummary[];
  readonly recent: readonly ObjectSummary[];
}

const api = async <T,>(
  method: string,
  path: string,
  body?: unknown,
  keepalive = false,
): Promise<T> => {
  const response = await fetch(`/api/next${path}`, {
    method,
    keepalive,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(detail?.message ?? `HTTP ${response.status}`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
};
const encode = encodeURIComponent;

/* ---------- 試作データ ---------- */

const text = (value: string): DocNode => ({ type: "text", text: value });
const paragraph = (time: number, ...content: DocNode[]): DocNode => ({
  type: "paragraph",
  attrs: { id: newId(time) },
  ...(content.length ? { content } : {}),
});
const embed = (objectId: string, collapsed = true): DocNode => ({
  type: "objectEmbed",
  attrs: { id: newId(), objectId, collapsed },
});

const seedWorkspace = (): {
  objects: ObjectRecord[];
  documents: Record<string, DocNode[]>;
} => {
  const now = Date.now();
  const object = (
    id: string,
    type: ObjectType,
    title: string,
    contexts: readonly string[],
    age: number,
    body: readonly DocNode[] = [],
  ): ObjectRecord => ({
    id,
    type,
    title: [text(title)],
    body,
    done: false,
    contexts,
    createdAt: now - age,
  });
  return {
    objects: [
      object("area-dev", "area", "個人開発", [], 90 * DAY, [
        paragraph(now - 90 * DAY, text("趣味で作っているソフトウェア全般。")),
      ]),
      object("proj-ctx", "project", "Contextory", ["area-dev"], 60 * DAY, [
        {
          type: "heading",
          attrs: { id: newId(now - 60 * DAY), level: 2 },
          content: [text("方針")],
        },
        paragraph(
          now - 60 * DAY,
          text(
            "自由な文書の中から、Objectをその場で参照・作成・紐づけできるようにする。",
          ),
        ),
        embed("task-input", false),
        paragraph(now),
      ]),
      object("proj-blog", "project", "技術ブログ", ["area-dev"], 40 * DAY, [
        paragraph(now - 40 * DAY, text("月1本を目安に書く。")),
      ]),
      object(
        "task-input",
        "task",
        "入力体験を再設計する",
        ["proj-ctx"],
        3 * DAY,
        [
          paragraph(
            now - 3 * DAY,
            text(
              "編集時は一つの文書木として扱い、保存時にObject単位へ分ける。",
            ),
          ),
          embed("task-at"),
        ],
      ),
      object("task-at", "task", "@メニューを試作する", ["task-input"], 2 * DAY),
      object(
        "dec-embed",
        "decision",
        "Objectは独立本文＋埋め込みで扱う",
        ["task-input"],
        26 * 60 * MINUTE,
        [
          paragraph(
            now - 26 * 60 * MINUTE,
            text("境界が編集で動かないことを優先する。"),
          ),
        ],
      ),
      object(
        "memo-tana",
        "memo",
        "Tanaは@で参照と作成が一体になっているのが良い。",
        ["proj-ctx"],
        95 * MINUTE,
      ),
    ],
    documents: {
      [dailyId()]: [
        paragraph(now - 120 * MINUTE, text("朝。今日は入力まわりを進める。")),
        embed("memo-tana"),
        paragraph(
          now - 30 * MINUTE,
          { type: "objectRef", attrs: { objectId: "task-input" } },
          text(
            " の続きを考える。@で触れた段落は、所属を変えずに参照先のTimelineへ出る。",
          ),
        ),
        paragraph(now),
      ],
    },
  };
};

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

const KIND_LABEL = { text: "テキスト", reference: "参照" } as const;

/** 種別のページ。名前・色・Fieldをここで定義する。 */
const TypePage = ({
  definition,
  objects,
  onPatch,
  row,
}: {
  readonly definition: TypeDefinition;
  readonly objects: readonly ObjectSummary[];
  readonly onPatch: (patch: {
    name?: string;
    color?: string | null;
    checkbox?: boolean;
    fields?: readonly FieldDefinition[];
  }) => void;
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
                        kind: event.currentTarget.value as "text" | "reference",
                      })
                    }
                  >
                    {Object.entries(KIND_LABEL).map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </select>
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

export const ObjectDocumentDemo = (): React.JSX.Element => {
  const [loaded, setLoaded] = useState<{
    readonly key: number;
    readonly hostId: string;
    readonly doc: DocNode;
  } | null>(null);
  const [objects, setObjects] = useState<
    Readonly<Record<string, ObjectSummary>>
  >({});
  const [timeline, setTimeline] = useState<readonly ObjectTimelineEntry[]>([]);
  const [overview, setOverview] = useState<Overview>({
    navigation: [],
    recent: [],
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

  // 書き込みは一本の列に並べ、作成→本文保存の順序を保つ。
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef<{ hostId: string; doc: DocNode } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const loads = useRef(0);

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
        setStatus(error instanceof Error ? error.message : String(error)),
    );
    return queue.current;
  };

  const refreshSide = async (hostId: string): Promise<void> => {
    const [nextOverview, nextTypes, nextTimeline] = await Promise.all([
      api<Overview>("GET", `/overview?since=${startOfToday()}`),
      api<TypeDefinition[]>("GET", "/types"),
      isDaily(hostId)
        ? Promise.resolve([])
        : api<ObjectTimelineEntry[]>(
            "GET",
            `/objects/${encode(hostId)}/timeline`,
          ),
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
      const result = await api<ObjectPage>(
        "PUT",
        `/pages/${encode(save.hostId)}`,
        { doc: save.doc },
      );
      merge(result.objects);
      await refreshSide(save.hostId);
    });
  };

  const open = (hostId: string): void => {
    flush();
    void enqueue(async () => {
      const result = await api<ObjectPage>("GET", `/pages/${encode(hostId)}`);
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
        api<TypeDefinition[]>("GET", "/types"),
        api<ObjectSummary[]>("GET", `/objects?type=${encode(name)}`),
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
      await api("PATCH", `/types/${encode(name)}`, patch);
    });
    openType(patch.name ?? name);
  };

  const reset = (hostId: string): void => {
    pending.current = null;
    void enqueue(async () => {
      await api("PUT", "/workspace", seedWorkspace());
      setObjects({});
    });
    open(hostId);
  };

  useEffect(() => {
    void api<Overview>("GET", "/overview").then(
      (initial) =>
        initial.navigation.length ? open(dailyId()) : reset("proj-ctx"),
      (error: unknown) => setStatus(String(error)),
    );
    // 閉じる直前の入力も、待たずに送る。
    const onHide = (): void => {
      const save = pending.current;
      if (save)
        void api(
          "PUT",
          `/pages/${encode(save.hostId)}`,
          { doc: save.doc },
          true,
        );
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
      api<ObjectSummary[]>(
        "GET",
        `/objects?query=${encode(query)}${page ? `&exclude=${encode(page)}` : ""}`,
      ).then((found) => {
        merge(Object.fromEntries(found.map((o) => [o.id, o])));
        return found;
      }),
    create: (type, title, parentId) => {
      const id = newId();
      const parent = parentId ?? (page && !isDaily(page) ? page : null);
      mutate(
        () => api("POST", "/objects", { id, type, title, parentId: parent }),
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
    contexts: (id, parentId) => {
      const implied = inheritedContexts(objects[parentId ?? page ?? ""]);
      return (objects[id]?.contexts ?? [])
        .filter((context) => !implied.includes(context))
        .flatMap((context) => objects[context] ?? []);
    },
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
          ? ["言及", viaNote(entry.via)].filter(Boolean).join(" · ")
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

  const areas = overview.navigation.filter((o) => o.type === "area");
  const projects = overview.navigation.filter((o) => o.type === "project");
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
          <span className="od-label">Document-first demo</span>
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
          <a href="?demo=object-model">View demo</a>
          <button type="button" onClick={() => reset(dailyId())}>
            リセット
          </button>
        </div>
      </header>
      <div className="od-shell">
        <nav className="od-nav" aria-label="ページ">
          <button
            type="button"
            aria-current={page !== null && isDaily(page) ? "page" : undefined}
            onClick={() => open(dailyId())}
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
          <p className="od-nav-note">Prototype · サーバーのSQLiteへ保存</p>
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
                }
              }
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
                        api("PATCH", `/objects/${encode(current.id)}`, {
                          title: value,
                        }),
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
                                api("PATCH", `/objects/${encode(current.id)}`, {
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
                  <h1>
                    {new Intl.DateTimeFormat("ja-JP", {
                      month: "long",
                      day: "numeric",
                      weekday: "short",
                    }).format(new Date())}
                  </h1>
                  <p className="od-page-lead">
                    自由に書く。@で触れた段落・見出し・リスト項目は、参照先のTimelineに出る。
                  </p>
                </header>
              )}

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
                      <h2>今日の記録</h2>
                      <p>今日作成したObject。本文は複製せず、元の場所が正本</p>
                    </div>
                  </header>
                  {overview.recent.length ? (
                    <ul className="od-rows">
                      {overview.recent.map((object) =>
                        objectRow(
                          object,
                          object.contexts.length
                            ? object.contexts
                                .map((id) => objects[id]?.title ?? "")
                                .join("、")
                            : "Contextなし",
                        ),
                      )}
                    </ul>
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
