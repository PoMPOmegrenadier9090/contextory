import {
  addContext,
  collectTimeline,
  inheritedContexts,
  inlineText,
  newId,
  ObjectEditor,
  openDocument,
  patchObject,
  saveDocument,
  titleText,
  TYPE_LABEL,
  type DocNode,
  type EditorHost,
  type HostId,
  type ObjectRecord,
  type ObjectSummary,
  type ObjectType,
  type TimelineEntry,
  type Workspace,
} from "@pkm/editor";
import { useState } from "react";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const startOfToday = (): number => new Date().setHours(0, 0, 0, 0);

const text = (value: string): DocNode => ({ type: "text", text: value });
const ref = (objectId: string): DocNode => ({
  type: "objectRef",
  attrs: { objectId },
});
const paragraph = (time: number, ...content: DocNode[]): DocNode => ({
  type: "paragraph",
  attrs: { id: newId(time) },
  ...(content.length ? { content } : {}),
});
const embed = (objectId: string, collapsed = true): DocNode => ({
  type: "objectEmbed",
  attrs: { id: newId(), objectId, collapsed },
});

const seedWorkspace = (): Workspace => {
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
  const objects = [
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
          text("編集時は一つの文書木として扱い、保存時にObject単位へ分ける。"),
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
  ];
  return {
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
    daily: [
      paragraph(now - 120 * MINUTE, text("朝。今日は入力まわりを進める。")),
      embed("memo-tana"),
      paragraph(
        now - 30 * MINUTE,
        ref("task-input"),
        text(
          " の続きを考える。@で触れた段落は、所属を変えずに参照先のTimelineへ出る。",
        ),
      ),
      paragraph(now),
    ],
  };
};

const formatTime = (time: number): string =>
  new Intl.DateTimeFormat(
    "ja-JP",
    time >= startOfToday()
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "numeric", day: "numeric" },
  ).format(time);

/** 文書を開いた時点の内容でエディタを作る。pageが変わるたびにkeyで作り直す。 */
const PageEditor = ({
  workspace,
  page,
  host,
  onChange,
}: {
  readonly workspace: Workspace;
  readonly page: HostId;
  readonly host: EditorHost;
  readonly onChange: (doc: DocNode) => void;
}): React.JSX.Element => {
  const [initialDoc] = useState(() => openDocument(workspace, page));
  return (
    <section className="od-document">
      <ObjectEditor
        initialDoc={initialDoc}
        host={host}
        onChange={onChange}
        ariaLabel={page === null ? "Daily本文" : "本文"}
      />
    </section>
  );
};

type TimelineFilter = "all" | "task" | "memo" | "decision" | "mention";
const FILTERS: readonly (readonly [TimelineFilter, string])[] = [
  ["all", "すべて"],
  ["task", "Task"],
  ["memo", "Memo"],
  ["decision", "Decision"],
  ["mention", "言及"],
];

export const ObjectDocumentDemo = (): React.JSX.Element => {
  const [workspace, setWorkspace] = useState<Workspace>(seedWorkspace);
  const [page, setPage] = useState<HostId>("proj-ctx");
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const { objects } = workspace;
  const current = page === null ? undefined : objects[page];

  const summary = (object: ObjectRecord): ObjectSummary => ({
    id: object.id,
    type: object.type,
    title: titleText(object, objects),
  });
  const open = (id: HostId): void => {
    if (id !== null && !objects[id]) return;
    setPage(id);
    window.scrollTo({ top: 0 });
  };

  const host: EditorHost = {
    lookup: (id) => (objects[id] ? summary(objects[id]) : undefined),
    search: (query) => {
      const q = query.toLowerCase();
      return Object.values(objects)
        .filter((o) => o.id !== page && (o.type !== "memo" || q))
        .map(summary)
        .filter((o) => o.title.toLowerCase().includes(q))
        .slice(-6)
        .reverse();
    },
    create: (type, title, parentId) => {
      const id = newId();
      setWorkspace((ws) => ({
        ...ws,
        objects: {
          ...ws.objects,
          [id]: {
            id,
            type,
            title: [text(title)],
            body: [],
            done: false,
            contexts: inheritedContexts(ws.objects, parentId ?? page),
            createdAt: Date.now(),
          },
        },
      }));
      return id;
    },
    open,
    contexts: (id, parentId) => {
      const implied = inheritedContexts(objects, parentId ?? page);
      return (objects[id]?.contexts ?? [])
        .filter((context) => !implied.includes(context) && objects[context])
        .map((context) => summary(objects[context]!));
    },
  };

  const viaNote = (via: readonly string[]): string =>
    via.length
      ? `via ${via.map((id) => titleText(objects[id], objects)).join(" › ")}`
      : "";
  const hostLabel = (id: HostId): string =>
    id === null ? "Daily" : titleText(objects[id], objects);

  const objectRow = (object: ObjectRecord, note: string): React.JSX.Element => (
    <li className="od-row" data-type={object.type} key={object.id}>
      <span className="od-type">{TYPE_LABEL[object.type]}</span>
      <button type="button" onClick={() => open(object.id)}>
        <strong>{titleText(object, objects)}</strong>
        {note ? <small>{note}</small> : null}
      </button>
      {object.type === "task" ? (
        <span className="od-row-status" data-done={object.done}>
          {object.done ? "完了" : "未完了"}
        </span>
      ) : null}
      <time>{formatTime(object.createdAt)}</time>
    </li>
  );

  const timelineRow = (entry: TimelineEntry): React.JSX.Element =>
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
        key={`${entry.hostId}-${String(entry.unit.node.attrs?.id)}`}
      >
        <span className="od-type">
          {entry.unit.kind === "section" ? "見出し" : "言及"}
        </span>
        <button type="button" onClick={() => open(entry.hostId)}>
          <strong>{inlineText([entry.unit.node], objects)}</strong>
          <small>
            {[hostLabel(entry.hostId), viaNote(entry.via)]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </button>
        <time>{formatTime(entry.time)}</time>
      </li>
    );

  const timeline = current
    ? collectTimeline(workspace, current.id, Date.now()).filter((entry) =>
        filter === "all"
          ? true
          : filter === "mention"
            ? entry.kind === "unit" || entry.mentioned
            : entry.kind === "object" && entry.object.type === filter,
      )
    : [];
  const today = Object.values(objects)
    .filter((object) => object.createdAt >= startOfToday())
    .sort((a, b) => b.createdAt - a.createdAt);
  const contextCandidates = current
    ? Object.values(objects).filter(
        (o) =>
          o.type !== "memo" &&
          addContext(workspace, current.id, o.id) !== workspace,
      )
    : [];

  const areas = Object.values(objects).filter((o) => o.type === "area");
  const projects = Object.values(objects).filter((o) => o.type === "project");
  const navButton = (
    object: ObjectRecord,
    className: string,
  ): React.JSX.Element => (
    <button
      key={object.id}
      type="button"
      className={className}
      aria-current={page === object.id ? "page" : undefined}
      onClick={() => open(object.id)}
    >
      {titleText(object, objects)}
    </button>
  );

  return (
    <div className="od-demo">
      <header className="od-topbar">
        <div>
          <span className="od-product">Contextory</span>
          <span className="od-label">Document-first demo</span>
        </div>
        <div className="od-topbar-actions">
          <a href="?demo=object-model">View demo</a>
          <button
            type="button"
            onClick={() => {
              setWorkspace(seedWorkspace());
              setPage(null);
            }}
          >
            リセット
          </button>
        </div>
      </header>
      <div className="od-shell">
        <nav className="od-nav" aria-label="ページ">
          <button
            type="button"
            aria-current={page === null ? "page" : undefined}
            onClick={() => open(null)}
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
              (p) => !p.contexts.some((id) => objects[id]?.type === "area"),
            )
            .map((project) => navButton(project, "od-nav-project"))}
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
          <p className="od-nav-note">Prototype · 変更は保存されません</p>
        </nav>
        <main className="od-main">
          {current ? (
            <header className="od-page-header" data-type={current.type}>
              <span className="od-type">{TYPE_LABEL[current.type]}</span>
              <input
                className="od-page-title"
                aria-label="Title"
                value={inlineText(current.title, objects)}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setWorkspace((ws) =>
                    patchObject(ws, current.id, {
                      title: value ? [text(value)] : [],
                    }),
                  );
                }}
              />
              <div className="od-page-meta">
                {current.type === "task" ? (
                  <label className="od-status">
                    <input
                      type="checkbox"
                      checked={current.done}
                      onChange={() =>
                        setWorkspace((ws) =>
                          patchObject(ws, current.id, { done: !current.done }),
                        )
                      }
                    />
                    完了
                  </label>
                ) : null}
                <span className="od-contexts">
                  {current.contexts.map((id) => (
                    <span
                      className="od-context-chip"
                      key={id}
                      data-type={objects[id]?.type}
                    >
                      <button type="button" onClick={() => open(id)}>
                        <small>{TYPE_LABEL[objects[id]?.type ?? "memo"]}</small>
                        {titleText(objects[id], objects)}
                      </button>
                      <button
                        type="button"
                        aria-label={`${titleText(objects[id], objects)}のContextを外す`}
                        onClick={() =>
                          setWorkspace((ws) =>
                            patchObject(ws, current.id, {
                              contexts: current.contexts.filter(
                                (context) => context !== id,
                              ),
                            }),
                          )
                        }
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <select
                    className="od-add-context"
                    aria-label="Contextを追加"
                    value=""
                    onChange={(event) => {
                      const target = event.currentTarget.value;
                      setWorkspace((ws) => addContext(ws, current.id, target));
                    }}
                  >
                    <option value="">＋ Context</option>
                    {contextCandidates.map((o) => (
                      <option key={o.id} value={o.id}>
                        {TYPE_LABEL[o.type]} · {titleText(o, objects)}
                      </option>
                    ))}
                  </select>
                </span>
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

          <PageEditor
            key={page ?? "daily"}
            workspace={workspace}
            page={page}
            host={host}
            onChange={(doc) =>
              setWorkspace((ws) => saveDocument(ws, page, doc, Date.now()))
            }
          />

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
              {timeline.length ? (
                <ul className="od-rows">{timeline.map(timelineRow)}</ul>
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
              {today.length ? (
                <ul className="od-rows">
                  {today.map((object) =>
                    objectRow(
                      object,
                      object.contexts.length
                        ? object.contexts
                            .map((id) => titleText(objects[id], objects))
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
        </main>
      </div>
    </div>
  );
};
