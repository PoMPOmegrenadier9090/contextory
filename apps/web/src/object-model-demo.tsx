import { useRef, useState, type CSSProperties, type FormEvent } from "react";

type MemoFilter = "recent" | "pinned" | "all";
type TaskViewMode = "nested" | "flat";

export interface DemoMemo {
  readonly id: string;
  readonly body: string;
  readonly context: string;
  readonly createdAt: string;
  readonly pinned: boolean;
  readonly embedded: boolean;
}

export interface DemoTask {
  readonly id: string;
  readonly title: string;
  readonly status: "未着手" | "進行中" | "保留" | "完了";
  readonly due: string | null;
  readonly parentId: string | null;
  readonly body: string;
}

export interface VisibleDemoTask {
  readonly task: DemoTask;
  readonly depth: number;
  readonly path: string;
}

const INITIAL_MEMOS: readonly DemoMemo[] = [
  {
    id: "memo-boundary",
    body: "Project本文とDailyのMemoは、同じ画面で読めても保存上は分けたい。",
    context: "Contextory",
    createdAt: "今日 10:42",
    pinned: true,
    embedded: false,
  },
  {
    id: "memo-view",
    body: "Taskは文章から変換するより、ProjectのTasks Viewから追加する方が自然そう。",
    context: "Contextory › 入力体験を再設計する",
    createdAt: "今日 09:18",
    pinned: false,
    embedded: false,
  },
  {
    id: "memo-depth",
    body: "サブタスクは再帰的に持てるが、Project画面では一段ずつ展開したい。",
    context: "Contextory",
    createdAt: "昨日 22:07",
    pinned: false,
    embedded: false,
  },
  {
    id: "memo-decision",
    body: "DecisionはTaskの子ではなく、TaskやProjectへのRelationとして扱う。",
    context: "Contextory › ObjectとRelation",
    createdAt: "11月6日",
    pinned: false,
    embedded: false,
  },
];

const INITIAL_TASKS: readonly DemoTask[] = [
  {
    id: "task-input",
    title: "入力体験を再設計する",
    status: "進行中",
    due: "11月14日",
    parentId: null,
    body: "自由な文章と、Viewから操作する構造化Objectを無理なく共存させる。",
  },
  {
    id: "task-view",
    title: "Tasks Viewから追加できるようにする",
    status: "進行中",
    due: "11月10日",
    parentId: "task-input",
    body: "Viewが持つProject条件を、新しいTaskへ自動設定する。",
  },
  {
    id: "task-nesting",
    title: "サブタスクの表示を設計する",
    status: "未着手",
    due: null,
    parentId: "task-input",
    body: "保存上は任意階層を許し、画面では一段ずつ展開する。",
  },
  {
    id: "task-depth",
    title: "3階層目の開閉を確認する",
    status: "未着手",
    due: null,
    parentId: "task-nesting",
    body: "孫Taskを自動展開せず、親のトグルから表示する。",
  },
  {
    id: "task-sync",
    title: "サーバー同期方式を決める",
    status: "保留",
    due: null,
    parentId: null,
    body: "サーバー側のDBを正本とし、端末間でDBファイルを分散させない。",
  },
];

const DECISIONS = [
  {
    id: "decision-doc-memo",
    title: "概要ドキュメントとMemoを分ける",
    status: "暫定決定",
    related: "入力体験を再設計する",
  },
  {
    id: "decision-server-db",
    title: "サーバー側のDBを正本にする",
    status: "検討中",
    related: "サーバー同期方式を決める",
  },
] as const;

export const filterDemoMemos = (
  memos: readonly DemoMemo[],
  filter: MemoFilter,
): readonly DemoMemo[] => {
  if (filter === "pinned") return memos.filter((memo) => memo.pinned);
  if (filter === "recent") return memos.slice(0, 3);
  return memos;
};

export const getVisibleDemoTasks = (
  tasks: readonly DemoTask[],
  mode: TaskViewMode,
  expandedIds: ReadonlySet<string>,
): readonly VisibleDemoTask[] => {
  const taskIds = new Set(tasks.map((task) => task.id));
  const children = new Map<string | null, DemoTask[]>();

  for (const task of tasks) {
    const parentId =
      task.parentId && taskIds.has(task.parentId) ? task.parentId : null;
    const siblings = children.get(parentId) ?? [];
    siblings.push(task);
    children.set(parentId, siblings);
  }

  const visible: VisibleDemoTask[] = [];
  const visited = new Set<string>();
  const visit = (task: DemoTask, depth: number, ancestors: string[]): void => {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    const titles = [...ancestors, task.title];
    visible.push({ task, depth, path: titles.join(" › ") });

    if (mode === "nested" && !expandedIds.has(task.id)) return;
    for (const child of children.get(task.id) ?? []) {
      visit(child, depth + 1, titles);
    }
  };

  for (const root of children.get(null) ?? []) visit(root, 0, []);
  if (mode === "flat") {
    for (const task of tasks) {
      if (!visited.has(task.id)) visit(task, 0, []);
    }
  }
  return visible;
};

export const ObjectModelDemo = (): React.JSX.Element => {
  const [overview, setOverview] = useState(
    "Projectの背景や方針を自由にまとめる。実行項目は下のTasks Viewから追加し、DailyやQuick Captureの記録は本文へ自動挿入せず、関連Memoとして近くに表示する。",
  );
  const [tasks, setTasks] = useState<readonly DemoTask[]>(INITIAL_TASKS);
  const [taskMode, setTaskMode] = useState<TaskViewMode>("nested");
  const [expandedTaskIds, setExpandedTaskIds] = useState<ReadonlySet<string>>(
    new Set(["task-input"]),
  );
  const [taskForm, setTaskForm] = useState<{
    readonly parentId: string | null;
  } | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [memoFilter, setMemoFilter] = useState<MemoFilter>("recent");
  const [memos, setMemos] = useState<readonly DemoMemo[]>(INITIAL_MEMOS);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureBody, setCaptureBody] = useState("");
  const [captureContext, setCaptureContext] = useState("Contextory");
  const [announcement, setAnnouncement] = useState("");
  const nextTaskId = useRef(1);
  const nextMemoId = useRef(1);

  const visibleTasks = getVisibleDemoTasks(tasks, taskMode, expandedTaskIds);
  const visibleMemos = filterDemoMemos(memos, memoFilter);
  const embeddedMemos = memos.filter((memo) => memo.embedded);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);
  const taskFormParent = tasks.find((task) => task.id === taskForm?.parentId);
  const taskChildren = (taskId: string): readonly DemoTask[] =>
    tasks.filter((task) => task.parentId === taskId);

  const toggleTask = (taskId: string): void => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const openTaskForm = (parentId: string | null): void => {
    setTaskForm({ parentId });
    setNewTaskTitle("");
  };

  const addTask = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const title = newTaskTitle.trim();
    if (!title || !taskForm) return;
    const task: DemoTask = {
      id: `task-new-${nextTaskId.current++}`,
      title,
      status: "未着手",
      due: null,
      parentId: taskForm.parentId,
      body: "",
    };
    setTasks((current) => [...current, task]);
    if (task.parentId) {
      setExpandedTaskIds((current) => new Set(current).add(task.parentId!));
    }
    setTaskForm(null);
    setNewTaskTitle("");
    setAnnouncement(
      task.parentId
        ? `${taskFormParent?.title ?? "Task"}にSubtaskを追加しました`
        : "ContextoryにTaskを追加しました",
    );
  };

  const updateMemo = (
    memoId: string,
    update: (memo: DemoMemo) => DemoMemo,
  ): void => {
    setMemos((current) =>
      current.map((memo) => (memo.id === memoId ? update(memo) : memo)),
    );
  };

  const togglePin = (memoId: string): void => {
    updateMemo(memoId, (memo) => ({ ...memo, pinned: !memo.pinned }));
  };

  const toggleEmbed = (memoId: string): void => {
    const memo = memos.find((candidate) => candidate.id === memoId);
    if (!memo) return;
    updateMemo(memoId, (current) => ({
      ...current,
      embedded: !current.embedded,
    }));
    setAnnouncement(
      memo.embedded
        ? "Memoを概要ドキュメントから外しました"
        : "Memoを概要ドキュメントへ表示しました",
    );
  };

  const addMemo = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const body = captureBody.trim();
    if (!body) return;
    const memo: DemoMemo = {
      id: `memo-new-${nextMemoId.current++}`,
      body,
      context: captureContext,
      createdAt: "たった今",
      pinned: false,
      embedded: false,
    };
    setMemos((current) => [memo, ...current]);
    setMemoFilter("recent");
    setCaptureBody("");
    setCaptureOpen(false);
    setAnnouncement(`${captureContext}にMemoを追加しました`);
  };

  const resetDemo = (): void => {
    setOverview(
      "Projectの背景や方針を自由にまとめる。実行項目は下のTasks Viewから追加し、DailyやQuick Captureの記録は本文へ自動挿入せず、関連Memoとして近くに表示する。",
    );
    setTasks(INITIAL_TASKS);
    setTaskMode("nested");
    setExpandedTaskIds(new Set(["task-input"]));
    setTaskForm(null);
    setNewTaskTitle("");
    setSelectedTaskId(null);
    setMemoFilter("recent");
    setMemos(INITIAL_MEMOS);
    setCaptureOpen(false);
    setCaptureBody("");
    setCaptureContext("Contextory");
    setAnnouncement("デモを初期状態へ戻しました");
  };

  return (
    <div className="object-demo">
      <header className="object-demo-topbar">
        <div>
          <span className="object-demo-product">Contextory</span>
          <span className="object-demo-preview-label">View-first demo</span>
        </div>
        <div className="object-demo-topbar-actions">
          <button
            className="object-demo-button is-quiet"
            type="button"
            onClick={resetDemo}
          >
            リセット
          </button>
          <button
            className="object-demo-button is-primary"
            type="button"
            aria-expanded={captureOpen}
            onClick={() => setCaptureOpen((value) => !value)}
          >
            Quick Capture
          </button>
        </div>
      </header>

      {captureOpen ? (
        <form className="object-demo-capture" onSubmit={addMemo}>
          <label>
            <span>Memo</span>
            <textarea
              autoFocus
              value={captureBody}
              onChange={(event) => setCaptureBody(event.currentTarget.value)}
              placeholder="思いつきをそのまま書く…"
              rows={2}
            />
          </label>
          <label>
            <span>Context</span>
            <select
              value={captureContext}
              onChange={(event) => setCaptureContext(event.currentTarget.value)}
            >
              <option>Contextory</option>
              <option>Contextory › 入力体験を再設計する</option>
            </select>
          </label>
          <button
            className="object-demo-button is-primary"
            type="submit"
            disabled={!captureBody.trim()}
          >
            Memoを追加
          </button>
        </form>
      ) : null}

      <div className="object-demo-shell">
        <aside className="object-demo-navigation" aria-label="Demo navigation">
          <p className="object-demo-nav-label">Projects</p>
          <a
            className="object-demo-nav-item is-active"
            href="?demo=object-model"
          >
            <span className="object-demo-nav-dot" />
            Contextory
          </a>
          <p className="object-demo-nav-label">Workspace</p>
          <span className="object-demo-nav-item">Daily</span>
          <span className="object-demo-nav-item">All objects</span>
          <div className="object-demo-nav-note">
            <span>Prototype</span>変更は保存されません
          </div>
        </aside>

        <main className="object-demo-main">
          <div className="object-demo-project-heading">
            <div>
              <p className="object-demo-breadcrumb">Projects / Contextory</p>
              <h1>Contextory</h1>
              <p>自由な文書と、Viewから操作するObjectを同じProjectで扱う</p>
              <div className="object-demo-project-summary">
                <span>
                  <i />
                  進行中
                </span>
                <span>Owner · kpome</span>
                <span>更新 · 今日</span>
              </div>
            </div>
          </div>

          <div className="object-demo-workspace">
            <div className="object-demo-document-column">
              <section className="object-demo-panel object-demo-document">
                <header className="object-demo-section-header">
                  <div>
                    <span className="object-demo-eyebrow">
                      Project document
                    </span>
                    <h2>概要ドキュメント</h2>
                  </div>
                  <span className="object-demo-mode-label">直接編集</span>
                </header>
                <textarea
                  className="object-demo-overview-editor"
                  aria-label="概要ドキュメント本文"
                  value={overview}
                  onChange={(event) => setOverview(event.currentTarget.value)}
                  rows={4}
                />
                {embeddedMemos.length ? (
                  <section className="object-demo-embedded-section">
                    <span className="object-demo-eyebrow">Explicit embeds</span>
                    <h3>概要に表示したMemo</h3>
                    {embeddedMemos.map((memo) => (
                      <article
                        className="object-demo-embedded-memo"
                        key={memo.id}
                      >
                        <p>{memo.body}</p>
                        <footer>
                          <span>Memo · {memo.context}</span>
                          <button
                            type="button"
                            onClick={() => toggleEmbed(memo.id)}
                          >
                            概要から外す
                          </button>
                        </footer>
                      </article>
                    ))}
                  </section>
                ) : null}
              </section>

              <section className="object-demo-panel object-demo-tasks">
                <header className="object-demo-section-header">
                  <div>
                    <span className="object-demo-eyebrow">Tasks view</span>
                    <h2>Tasks</h2>
                    <p className="object-demo-view-description">
                      ProjectがContextoryのTask
                    </p>
                  </div>
                  <div className="object-demo-view-actions">
                    <div
                      className="object-demo-segmented"
                      aria-label="Task表示"
                    >
                      <button
                        type="button"
                        aria-pressed={taskMode === "nested"}
                        onClick={() => setTaskMode("nested")}
                      >
                        ネスト
                      </button>
                      <button
                        type="button"
                        aria-pressed={taskMode === "flat"}
                        onClick={() => setTaskMode("flat")}
                      >
                        一覧
                      </button>
                    </div>
                    <button
                      className="object-demo-button is-secondary"
                      type="button"
                      onClick={() => openTaskForm(null)}
                    >
                      ＋ Task
                    </button>
                  </div>
                </header>

                {taskForm ? (
                  <form className="object-demo-task-form" onSubmit={addTask}>
                    <div>
                      <span>{taskFormParent ? "Subtask" : "Task"}</span>
                      <small>
                        {taskFormParent
                          ? `親 · ${taskFormParent.title}`
                          : "Project · Contextory"}
                      </small>
                    </div>
                    <input
                      autoFocus
                      value={newTaskTitle}
                      onChange={(event) =>
                        setNewTaskTitle(event.currentTarget.value)
                      }
                      placeholder="Task名を入力…"
                      aria-label="新しいTask名"
                    />
                    <button
                      className="object-demo-button is-primary"
                      type="submit"
                      disabled={!newTaskTitle.trim()}
                    >
                      追加
                    </button>
                    <button
                      className="object-demo-button is-quiet"
                      type="button"
                      onClick={() => setTaskForm(null)}
                    >
                      キャンセル
                    </button>
                  </form>
                ) : null}

                <div className="object-demo-task-table">
                  <div className="object-demo-task-columns" aria-hidden="true">
                    <span>Task</span>
                    <span>Status</span>
                    <span>Due</span>
                    <span />
                  </div>
                  {visibleTasks.map(({ task, depth, path }) => {
                    const children = taskChildren(task.id);
                    const expanded = expandedTaskIds.has(task.id);
                    return (
                      <article
                        className="object-demo-task-row"
                        key={task.id}
                        style={{ "--task-depth": depth } as CSSProperties}
                      >
                        <div className="object-demo-task-title-cell">
                          {taskMode === "nested" ? (
                            children.length ? (
                              <button
                                className="object-demo-tree-toggle"
                                type="button"
                                aria-label={`${task.title}のSubtaskを${expanded ? "閉じる" : "開く"}`}
                                aria-expanded={expanded}
                                onClick={() => toggleTask(task.id)}
                              >
                                {expanded ? "▾" : "▸"}
                              </button>
                            ) : (
                              <span className="object-demo-tree-spacer" />
                            )
                          ) : (
                            <span className="object-demo-task-type">Task</span>
                          )}
                          <button
                            className="object-demo-task-link"
                            type="button"
                            onClick={() => setSelectedTaskId(task.id)}
                          >
                            <strong>{task.title}</strong>
                            {taskMode === "flat" && task.parentId ? (
                              <small>{path}</small>
                            ) : children.length ? (
                              <small>{children.length} Subtask</small>
                            ) : null}
                          </button>
                        </div>
                        <span
                          className="object-demo-task-status"
                          data-status={task.status}
                        >
                          {task.status}
                        </span>
                        <span className="object-demo-task-due">
                          {task.due ?? "—"}
                        </span>
                        <button
                          className="object-demo-subtask-button"
                          type="button"
                          aria-label={`${task.title}にSubtaskを追加`}
                          title="Subtaskを追加"
                          onClick={() => openTaskForm(task.id)}
                        >
                          ＋
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="object-demo-panel object-demo-decisions">
                <header className="object-demo-section-header">
                  <div>
                    <span className="object-demo-eyebrow">Decisions view</span>
                    <h2>Decisions</h2>
                    <p className="object-demo-view-description">
                      Task階層とは分けてRelationで紐づける
                    </p>
                  </div>
                </header>
                <div className="object-demo-decision-list">
                  {DECISIONS.map((decision) => (
                    <article key={decision.id}>
                      <span className="object-demo-decision-mark">D</span>
                      <div>
                        <strong>{decision.title}</strong>
                        <small>Related · {decision.related}</small>
                      </div>
                      <span>{decision.status}</span>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <aside className="object-demo-panel object-demo-memos">
              <header className="object-demo-section-header">
                <div>
                  <span className="object-demo-eyebrow">Context relation</span>
                  <h2>関連Memo</h2>
                </div>
                <button
                  className="object-demo-text-action"
                  type="button"
                  onClick={() => setCaptureOpen(true)}
                >
                  ＋ 追加
                </button>
              </header>
              <div
                className="object-demo-segmented object-demo-memo-filter"
                aria-label="Memo filter"
              >
                {(
                  [
                    ["recent", "最近"],
                    ["pinned", "Pin"],
                    ["all", "すべて"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={memoFilter === value}
                    onClick={() => setMemoFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="object-demo-memo-list">
                {visibleMemos.map((memo) => (
                  <article className="object-demo-memo-card" key={memo.id}>
                    <div className="object-demo-memo-meta">
                      <span>{memo.context}</span>
                      <time>{memo.createdAt}</time>
                    </div>
                    <p>{memo.body}</p>
                    <footer>
                      <button
                        type="button"
                        aria-pressed={memo.pinned}
                        onClick={() => togglePin(memo.id)}
                      >
                        {memo.pinned ? "Pin済み" : "Pin"}
                      </button>
                      <button
                        type="button"
                        aria-pressed={memo.embedded}
                        onClick={() => toggleEmbed(memo.id)}
                      >
                        {memo.embedded ? "概要に表示中" : "概要に表示"}
                      </button>
                    </footer>
                  </article>
                ))}
                {visibleMemos.length === 0 ? (
                  <p className="object-demo-empty">
                    PinされたMemoはありません。
                  </p>
                ) : null}
              </div>
            </aside>
          </div>
        </main>
      </div>

      {selectedTask ? (
        <>
          <button
            className="object-demo-peek-backdrop"
            type="button"
            aria-label="Task詳細を閉じる"
            onClick={() => setSelectedTaskId(null)}
          />
          <aside
            className="object-demo-task-peek"
            role="dialog"
            aria-modal="true"
            aria-labelledby="object-demo-task-peek-title"
          >
            <header>
              <span className="object-demo-task-type">Task</span>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => setSelectedTaskId(null)}
              >
                ×
              </button>
            </header>
            <h2 id="object-demo-task-peek-title">{selectedTask.title}</h2>
            <dl className="object-demo-property-list">
              <div>
                <dt>Status</dt>
                <dd>{selectedTask.status}</dd>
              </div>
              <div>
                <dt>Due</dt>
                <dd>{selectedTask.due ?? "未設定"}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>Contextory</dd>
              </div>
            </dl>
            <label className="object-demo-task-body">
              <span>本文</span>
              <textarea
                value={selectedTask.body}
                rows={6}
                placeholder="Taskの補足や作業メモを書く…"
                onChange={(event) => {
                  const body = event.currentTarget.value;
                  setTasks((current) =>
                    current.map((task) =>
                      task.id === selectedTask.id ? { ...task, body } : task,
                    ),
                  );
                }}
              />
            </label>
            <section className="object-demo-peek-subtasks">
              <div>
                <span>Subtasks</span>
                <button
                  type="button"
                  onClick={() => {
                    openTaskForm(selectedTask.id);
                    setSelectedTaskId(null);
                  }}
                >
                  ＋ 追加
                </button>
              </div>
              {taskChildren(selectedTask.id).length ? (
                taskChildren(selectedTask.id).map((task) => (
                  <button
                    type="button"
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <span>{task.title}</span>
                    <small>{task.status}</small>
                  </button>
                ))
              ) : (
                <p>Subtaskはありません。</p>
              )}
            </section>
          </aside>
        </>
      ) : null}

      <div className="object-demo-live" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
};
