import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  addContext,
  addObject,
  assignContext,
  collectMentions,
  collectTimeline,
  contextPath,
  convertBlockToObject,
  displayTitle,
  getBlocks,
  inheritedContext,
  newObject,
  refToken,
  removeContext,
  setBlocks,
  splitRefs,
  TYPE_LABEL,
  updateObject,
  type Block,
  type DemoState,
  type DocObject,
  type HostId,
  type ObjectType,
  type TextBlock,
  type TextKind,
} from "./object-document-model.js";

const MINUTE = 60_000;
const startOfToday = (): number => new Date().setHours(0, 0, 0, 0);

const seedState = (): DemoState => {
  const now = Date.now();
  const objects: DocObject[] = [
    {
      id: "area-dev",
      type: "area",
      title: "個人開発",
      status: null,
      contexts: [],
      derivedFrom: null,
      createdAt: now - 90 * 24 * 60 * MINUTE,
      body: [
        { id: "b-area", kind: "p", text: "趣味で作っているソフトウェア全般。" },
      ],
    },
    {
      id: "proj-ctx",
      type: "project",
      title: "Contextory",
      status: null,
      contexts: ["area-dev"],
      derivedFrom: null,
      createdAt: now - 60 * 24 * 60 * MINUTE,
      body: [
        { id: "b-ctx-h", kind: "h", text: "方針" },
        {
          id: "b-ctx-1",
          kind: "p",
          text: "自由な文書の中から、Objectをその場で参照・作成・紐づけできるようにする。",
        },
        {
          id: "embed-task-input",
          kind: "embed",
          objectId: "task-input",
          collapsed: false,
        },
        { id: "b-ctx-2", kind: "p", text: "" },
      ],
    },
    {
      id: "proj-blog",
      type: "project",
      title: "技術ブログ",
      status: null,
      contexts: ["area-dev"],
      derivedFrom: null,
      createdAt: now - 40 * 24 * 60 * MINUTE,
      body: [{ id: "b-blog", kind: "p", text: "月1本を目安に書く。" }],
    },
    {
      id: "task-input",
      type: "task",
      title: "入力体験を再設計する",
      status: "進行中",
      contexts: ["proj-ctx"],
      derivedFrom: null,
      createdAt: now - 3 * 24 * 60 * MINUTE,
      body: [
        {
          id: "b-input-1",
          kind: "p",
          text: "Objectは独立した本文を持ち、文書には埋め込みBlockとして置く方式を試す。",
        },
        {
          id: "embed-task-at",
          kind: "embed",
          objectId: "task-at",
          collapsed: true,
        },
        { id: "b-input-2", kind: "p", text: "" },
      ],
    },
    {
      id: "task-at",
      type: "task",
      title: "@メニューを試作する",
      status: "未着手",
      contexts: ["task-input"],
      derivedFrom: null,
      createdAt: now - 2 * 24 * 60 * MINUTE,
      body: [{ id: "b-at-1", kind: "p", text: "" }],
    },
    {
      id: "dec-embed",
      type: "decision",
      title: "Objectは独立本文＋埋め込みで扱う",
      status: null,
      contexts: ["task-input"],
      derivedFrom: null,
      createdAt: now - 26 * 60 * MINUTE,
      body: [
        {
          id: "b-dec-1",
          kind: "p",
          text: "境界が編集で動かないことを優先する。",
        },
      ],
    },
    {
      id: "memo-tana",
      type: "memo",
      title: "",
      status: null,
      contexts: ["proj-ctx"],
      derivedFrom: null,
      createdAt: now - 95 * MINUTE,
      body: [
        {
          id: "b-tana-1",
          kind: "p",
          text: "Tanaは@で参照と作成が一体になっているのが良い。",
        },
      ],
    },
  ];
  return {
    objects: Object.fromEntries(objects.map((o) => [o.id, o])),
    daily: [
      { id: "d-1", kind: "p", text: "朝。今日は入力まわりを進める。" },
      {
        id: "embed-memo-tana",
        kind: "embed",
        objectId: "memo-tana",
        collapsed: false,
      },
      {
        id: "d-2",
        kind: "p",
        text: `${refToken("task-input")} の続きを考える。ここは言及しているだけで、所属は変わらない。`,
      },
      {
        id: "d-3",
        kind: "p",
        text: "ブログのネタ：Supertagと自由文書をどう両立するか。",
      },
      { id: "d-4", kind: "p", text: "" },
    ],
  };
};

/* ---------- DOM <-> text ---------- */

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const toHtml = (text: string, objects: DemoState["objects"]): string =>
  splitRefs(text)
    .map((part) =>
      "ref" in part
        ? `<span class="od-chip" contenteditable="false" data-ref="${escapeHtml(part.ref)}" data-type="${objects[part.ref]?.type ?? "missing"}">${escapeHtml(displayTitle(objects[part.ref], objects))}</span>`
        : escapeHtml(part.text),
    )
    .join("");

const serialize = (node: Node): string => {
  let text = "";
  for (const child of node.childNodes) {
    if (child instanceof Text) text += child.data;
    else if (child instanceof HTMLElement && child.dataset.ref)
      text += refToken(child.dataset.ref);
    else if (child instanceof HTMLElement && child.tagName !== "BR")
      text += serialize(child);
  }
  return text.replace(/\u00a0/g, " ");
};

const placeCaret = (el: HTMLElement, at: "start" | "end"): void => {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(at === "start");
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const caretAtStart = (el: HTMLElement): boolean => {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode) return false;
  const range = document.createRange();
  range.setStart(el, 0);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString() === "";
};

/* ---------- store ---------- */

type PopupState =
  | {
      readonly kind: "at" | "hash";
      readonly hostId: HostId;
      readonly blockId: string;
      readonly node: Text;
      readonly start: number;
      readonly end: number;
      readonly query: string;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "context";
      /** nullならBlockをMemo化してContextを付ける */
      readonly objectId: string | null;
      readonly hostId: HostId;
      readonly blockId: string;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "block" | "chip";
      readonly hostId: HostId;
      readonly blockId: string;
      readonly refId: string;
      readonly x: number;
      readonly y: number;
    };

interface PopupItem {
  readonly key: string;
  readonly badge: string;
  readonly label: string;
  readonly hint?: string;
  readonly run: (withContext: boolean) => void;
}

interface Toast {
  readonly message: string;
  readonly undo?: () => void;
}

interface Store {
  readonly state: DemoState;
  readonly update: (fn: (state: DemoState) => DemoState) => void;
  readonly open: (id: HostId) => void;
  readonly focusLater: (blockId: string, at: "start" | "end") => void;
  readonly takeFocus: (blockId: string) => "start" | "end" | null;
  readonly popup: PopupState | null;
  readonly setPopup: (popup: PopupState | null) => void;
  readonly popupKey: (event: KeyboardEvent) => boolean;
  readonly newId: (prefix: string) => string;
  readonly notify: (toast: Toast) => void;
}

const StoreContext = createContext<Store | null>(null);
const useStore = (): Store => {
  const store = useContext(StoreContext);
  if (!store) throw new Error("Store is missing");
  return store;
};

/* ---------- editor ---------- */

const TextBlockView = ({
  hostId,
  block,
  isLast,
  onExit,
}: {
  readonly hostId: HostId;
  readonly block: TextBlock;
  readonly isLast: boolean;
  readonly onExit: (() => void) | null;
}): React.JSX.Element => {
  const store = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const { objects } = store.state;

  // 入力中はDOMを正とし、外部から本文が変わった時だけ描き直す。
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && serialize(el) !== block.text)
      el.innerHTML = toHtml(block.text, objects);
  }, [block.text]);

  useEffect(() => {
    for (const chip of ref.current?.querySelectorAll<HTMLElement>(
      "[data-ref]",
    ) ?? []) {
      const object = objects[chip.dataset.ref ?? ""];
      chip.textContent = displayTitle(object, objects);
      chip.dataset.type = object?.type ?? "missing";
    }
  }, [objects]);

  useEffect(() => {
    const at = store.takeFocus(block.id);
    if (at && ref.current) placeCaret(ref.current, at);
  });

  const setText = (text: string, kind: TextKind = block.kind): void =>
    store.update((state) =>
      setBlocks(state, hostId, (blocks) =>
        blocks.map((b) => (b.id === block.id ? { ...block, kind, text } : b)),
      ),
    );

  const detectTrigger = (): void => {
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const mine =
      store.popup && "node" in store.popup && store.popup.blockId === block.id;
    if (
      !selection?.isCollapsed ||
      !(node instanceof Text) ||
      !ref.current?.contains(node)
    ) {
      if (mine) store.setPopup(null);
      return;
    }
    const before = node.data
      .slice(0, selection.anchorOffset)
      .replace(/\u00a0/g, " ");
    const match = /(?:^|\s)([@#])([^\s@#]{0,40})$/.exec(before);
    if (!match) {
      if (mine) store.setPopup(null);
      return;
    }
    const query = match[2] ?? "";
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const fallback = ref.current.getBoundingClientRect();
    store.setPopup({
      kind: match[1] === "@" ? "at" : "hash",
      hostId,
      blockId: block.id,
      node,
      start: selection.anchorOffset - query.length - 1,
      end: selection.anchorOffset,
      query,
      x: rect.width || rect.left ? rect.left : fallback.left,
      y: (rect.bottom || fallback.bottom) + 6,
    });
  };

  const onInput = (): void => {
    const el = ref.current;
    if (!el) return;
    const text = serialize(el);
    const shortcut = block.kind === "p" ? /^(#{1,3}|[-*]) /.exec(text) : null;
    if (shortcut) {
      store.focusLater(block.id, "end");
      setText(
        text.slice(shortcut[0].length),
        shortcut[0].startsWith("#") ? "h" : "li",
      );
      store.setPopup(null);
      return;
    }
    setText(text);
    detectTrigger();
  };

  const removeSelf = (): void => {
    const blocks = getBlocks(store.state, hostId);
    const index = blocks.findIndex((b) => b.id === block.id);
    const previous = blocks
      .slice(0, index)
      .reverse()
      .find((b) => b.kind !== "embed");
    if (previous) store.focusLater(previous.id, "end");
    store.update((state) =>
      setBlocks(state, hostId, (bs) => bs.filter((b) => b.id !== block.id)),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (
      store.popup &&
      "node" in store.popup &&
      store.popup.blockId === block.id
    )
      if (store.popupKey(event)) return;
    const el = ref.current;
    if (!el) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const text = serialize(el);
      // 埋め込みObjectの末尾の空行でEnterすると、Objectの外へ出る。
      if (text === "" && onExit && isLast) {
        if (getBlocks(store.state, hostId).length > 1) removeSelf();
        onExit();
        return;
      }
      if (text === "" && block.kind === "li") {
        setText("", "p");
        return;
      }
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const tail = document.createRange();
      tail.setStart(range.startContainer, range.startOffset);
      tail.setEnd(el, el.childNodes.length);
      const holder = document.createElement("div");
      holder.append(tail.extractContents());
      const id = store.newId("b");
      const before = serialize(el);
      store.focusLater(id, "start");
      store.update((state) =>
        setBlocks(state, hostId, (blocks) =>
          blocks.flatMap<Block>((b) =>
            b.id === block.id
              ? [
                  { ...block, text: before },
                  {
                    id,
                    kind: block.kind === "li" ? "li" : "p",
                    text: serialize(holder),
                  },
                ]
              : [b],
          ),
        ),
      );
      return;
    }

    if (event.key === "Backspace" && caretAtStart(el)) {
      if (block.kind !== "p") {
        event.preventDefault();
        setText(serialize(el), "p");
      } else if (
        serialize(el) === "" &&
        getBlocks(store.state, hostId).length > 1
      ) {
        event.preventDefault();
        removeSelf();
      }
    }
  };

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const chip = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-ref]",
    );
    if (!chip?.dataset.ref) return;
    const rect = chip.getBoundingClientRect();
    store.setPopup({
      kind: "chip",
      hostId,
      blockId: block.id,
      refId: chip.dataset.ref,
      x: rect.left,
      y: rect.bottom + 6,
    });
  };

  return (
    <div className="od-block-row" data-kind={block.kind}>
      <button
        className="od-gutter"
        type="button"
        aria-label="Blockの操作"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          store.setPopup({
            kind: "block",
            hostId,
            blockId: block.id,
            refId: "",
            x: rect.left,
            y: rect.bottom + 4,
          });
        }}
      >
        ⋮⋮
      </button>
      <div
        ref={ref}
        className="od-text"
        data-kind={block.kind}
        data-block-id={block.id}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="false"
        aria-label={block.kind === "h" ? "見出し" : "本文"}
        data-placeholder="書く… @で参照・作成 / #でObject化"
        onInput={onInput}
        onKeyDown={onKeyDown}
        onClick={onClick}
        onBlur={() => {
          if (
            store.popup &&
            "node" in store.popup &&
            store.popup.blockId === block.id
          )
            store.setPopup(null);
        }}
      />
    </div>
  );
};

const ContextChips = ({
  object,
}: {
  readonly object: DocObject;
}): React.JSX.Element => {
  const store = useStore();
  const { objects } = store.state;
  return (
    <span className="od-contexts">
      {object.contexts.map((id) => (
        <span
          className="od-context-chip"
          key={id}
          data-type={objects[id]?.type}
        >
          <button type="button" onClick={() => store.open(id)}>
            <small>{TYPE_LABEL[objects[id]?.type ?? "memo"]}</small>
            {displayTitle(objects[id], objects)}
          </button>
          <button
            type="button"
            aria-label={`${displayTitle(objects[id], objects)}のContextを外す`}
            onClick={() =>
              store.update((state) => removeContext(state, object.id, id))
            }
          >
            ×
          </button>
        </span>
      ))}
      <button
        className="od-add-context"
        type="button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          store.setPopup({
            kind: "context",
            objectId: object.id,
            hostId: null,
            blockId: "",
            x: rect.left,
            y: rect.bottom + 4,
          });
        }}
      >
        ＋ Context
      </button>
      {object.derivedFrom ? (
        <button
          className="od-derived"
          type="button"
          onClick={() => store.open(object.derivedFrom)}
        >
          由来: {displayTitle(objects[object.derivedFrom], objects)}
        </button>
      ) : null}
    </span>
  );
};

const TaskStatusButton = ({
  object,
}: {
  readonly object: DocObject;
}): ReactNode => {
  const store = useStore();
  if (object.type !== "task" || !object.status) return null;
  const next = { 未着手: "進行中", 進行中: "完了", 完了: "未着手" } as const;
  return (
    <button
      className="od-status"
      type="button"
      data-status={object.status}
      title="クリックでStatusを進める"
      onClick={() =>
        store.update((state) =>
          updateObject(state, object.id, { status: next[object.status!] }),
        )
      }
    >
      {object.status}
    </button>
  );
};

const EmbedView = ({
  hostId,
  block,
  ancestors,
}: {
  readonly hostId: HostId;
  readonly block: Extract<Block, { kind: "embed" }>;
  readonly ancestors: ReadonlySet<string>;
}): React.JSX.Element => {
  const store = useStore();
  const object = store.state.objects[block.objectId];
  if (!object || ancestors.has(object.id))
    return (
      <div className="od-embed-missing">
        {object ? "循環する埋め込みは表示しません" : "削除されたObject"}
      </div>
    );

  const exit = (): void => {
    const id = store.newId("b");
    store.focusLater(id, "start");
    store.update((state) =>
      setBlocks(state, hostId, (blocks) =>
        blocks.flatMap<Block>((b) =>
          b.id === block.id ? [b, { id, kind: "p", text: "" }] : [b],
        ),
      ),
    );
  };

  return (
    <section
      className="od-object"
      data-type={object.type}
      data-collapsed={block.collapsed}
    >
      <header>
        <button
          className="od-collapse"
          type="button"
          aria-expanded={!block.collapsed}
          aria-label={block.collapsed ? "本文を展開" : "本文を畳む"}
          onClick={() =>
            store.update((state) =>
              setBlocks(state, hostId, (blocks) =>
                blocks.map((b) =>
                  b.id === block.id
                    ? { ...block, collapsed: !block.collapsed }
                    : b,
                ),
              ),
            )
          }
        >
          {block.collapsed ? "▸" : "▾"}
        </button>
        <span className="od-type">{TYPE_LABEL[object.type]}</span>
        {object.type === "memo" ? (
          <span className="od-memo-time">{formatTime(object.createdAt)}</span>
        ) : (
          <input
            className="od-title-input"
            aria-label={`${TYPE_LABEL[object.type]}のTitle`}
            value={object.title}
            placeholder="Title"
            onChange={(event) => {
              const title = event.currentTarget.value;
              store.update((state) =>
                updateObject(state, object.id, { title }),
              );
            }}
          />
        )}
        <TaskStatusButton object={object} />
        <ContextChips object={object} />
        <button
          className="od-open"
          type="button"
          onClick={() => store.open(object.id)}
        >
          開く ↗
        </button>
      </header>
      {block.collapsed ? null : (
        <BlockList
          hostId={object.id}
          blocks={object.body}
          ancestors={new Set([...ancestors, object.id])}
          onExit={exit}
        />
      )}
    </section>
  );
};

const BlockList = ({
  hostId,
  blocks,
  ancestors,
  onExit,
}: {
  readonly hostId: HostId;
  readonly blocks: readonly Block[];
  readonly ancestors: ReadonlySet<string>;
  readonly onExit: (() => void) | null;
}): React.JSX.Element => {
  const store = useStore();
  return (
    <div className="od-blocks">
      {blocks.map((block, index) =>
        block.kind === "embed" ? (
          <EmbedView
            key={block.id}
            hostId={hostId}
            block={block}
            ancestors={ancestors}
          />
        ) : (
          <TextBlockView
            key={block.id}
            hostId={hostId}
            block={block}
            isLast={index === blocks.length - 1}
            onExit={onExit}
          />
        ),
      )}
      {blocks.at(-1)?.kind !== "p" ? (
        <button
          className="od-append"
          type="button"
          onClick={() => {
            const id = store.newId("b");
            store.focusLater(id, "start");
            store.update((state) =>
              setBlocks(state, hostId, (bs) => [
                ...bs,
                { id, kind: "p", text: "" },
              ]),
            );
          }}
        >
          ＋ 段落を追加
        </button>
      ) : null}
    </div>
  );
};

/* ---------- pages ---------- */

const formatTime = (time: number): string =>
  new Intl.DateTimeFormat(
    "ja-JP",
    time >= startOfToday()
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "numeric", day: "numeric" },
  ).format(time);

const ObjectRow = ({
  object,
  note,
}: {
  readonly object: DocObject;
  readonly note?: string;
}): React.JSX.Element => {
  const store = useStore();
  return (
    <li className="od-row" data-type={object.type}>
      <span className="od-type">{TYPE_LABEL[object.type]}</span>
      <button type="button" onClick={() => store.open(object.id)}>
        <strong>{displayTitle(object, store.state.objects)}</strong>
        {note ? <small>{note}</small> : null}
      </button>
      {object.status ? (
        <span className="od-row-status" data-status={object.status}>
          {object.status}
        </span>
      ) : null}
      <time>{formatTime(object.createdAt)}</time>
    </li>
  );
};

type TimelineFilter = "all" | "task" | "memo" | "decision";

const ObjectPage = ({
  object,
}: {
  readonly object: DocObject;
}): React.JSX.Element => {
  const store = useStore();
  const { objects } = store.state;
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const timeline = collectTimeline(objects, object.id).filter(
    (entry) => filter === "all" || entry.object.type === filter,
  );
  const mentions = collectMentions(store.state, object.id);

  return (
    <>
      <header className="od-page-header" data-type={object.type}>
        <span className="od-type">{TYPE_LABEL[object.type]}</span>
        {object.type === "memo" ? (
          <h1>{displayTitle(object, objects)}</h1>
        ) : (
          <input
            className="od-page-title"
            aria-label="Title"
            value={object.title}
            onChange={(event) => {
              const title = event.currentTarget.value;
              store.update((state) =>
                updateObject(state, object.id, { title }),
              );
            }}
          />
        )}
        <div className="od-page-meta">
          <TaskStatusButton object={object} />
          <ContextChips object={object} />
        </div>
      </header>

      <section className="od-document" aria-label="本文">
        <BlockList
          hostId={object.id}
          blocks={object.body}
          ancestors={new Set([object.id])}
          onExit={null}
        />
      </section>

      <section className="od-panel">
        <header>
          <div>
            <h2>Timeline</h2>
            <p>Contextを辿って{displayTitle(object, objects)}に届く記録</p>
          </div>
          <div className="od-segmented" aria-label="Timeline filter">
            {(
              [
                ["all", "すべて"],
                ["task", "Task"],
                ["memo", "Memo"],
                ["decision", "Decision"],
              ] as const
            ).map(([value, label]) => (
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
          <ul className="od-rows">
            {timeline.map(({ object: entry, via }) => (
              <ObjectRow
                key={entry.id}
                object={entry}
                note={
                  via.length
                    ? `via ${via.map((id) => displayTitle(objects[id], objects)).join(" › ")}`
                    : "直接"
                }
              />
            ))}
          </ul>
        ) : (
          <p className="od-empty">まだありません。</p>
        )}
      </section>

      {mentions.length ? (
        <section className="od-panel">
          <header>
            <div>
              <h2>言及</h2>
              <p>
                本文で参照しているが、Contextとしては紐づいていない場所も含む
              </p>
            </div>
          </header>
          <ul className="od-rows">
            {mentions.map((id) =>
              id === null ? (
                <li className="od-row" key="daily">
                  <span className="od-type">Daily</span>
                  <button type="button" onClick={() => store.open(null)}>
                    <strong>今日のDaily</strong>
                  </button>
                </li>
              ) : objects[id] ? (
                <ObjectRow key={id} object={objects[id]} />
              ) : null,
            )}
          </ul>
        </section>
      ) : null}
    </>
  );
};

const DailyPage = (): React.JSX.Element => {
  const store = useStore();
  const { objects, daily } = store.state;
  const today = Object.values(objects)
    .filter((object) => object.createdAt >= startOfToday())
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <>
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
          自由に書く。紐づけたい段落だけ、⋮⋮メニューか @…⌘Enter
          でMemoにしてContextを付ける。
        </p>
      </header>
      <section className="od-document" aria-label="Daily本文">
        <BlockList
          hostId={null}
          blocks={daily}
          ancestors={new Set()}
          onExit={null}
        />
      </section>
      <section className="od-panel">
        <header>
          <div>
            <h2>今日の記録</h2>
            <p>今日作成したObject。本文はここへ複製せず、元の場所が正本</p>
          </div>
        </header>
        {today.length ? (
          <ul className="od-rows">
            {today.map((object) => (
              <ObjectRow
                key={object.id}
                object={object}
                note={
                  object.contexts.length
                    ? object.contexts
                        .map((id) => displayTitle(objects[id], objects))
                        .join("、")
                    : "Contextなし"
                }
              />
            ))}
          </ul>
        ) : (
          <p className="od-empty">まだありません。</p>
        )}
      </section>
    </>
  );
};

/* ---------- popup ---------- */

const CREATABLE: readonly ObjectType[] = ["task", "project", "decision"];
const CONVERTIBLE: readonly ObjectType[] = ["task", "decision", "memo"];
const HASH_ALIASES: Record<string, string> = {
  task: "task タスク",
  decision: "decision 決定",
  memo: "memo メモ",
};

const Popup = ({
  popup,
  items,
  active,
  setActive,
  query,
  setQuery,
}: {
  readonly popup: PopupState;
  readonly items: readonly PopupItem[];
  readonly active: number;
  readonly setActive: (index: number) => void;
  readonly query: string;
  readonly setQuery: (query: string) => void;
}): React.JSX.Element => {
  const store = useStore();
  const title = {
    at: "参照・作成",
    hash: "このBlockをObjectにする",
    context:
      popup.kind === "context" && popup.objectId === null
        ? "Memoにして紐づける"
        : "Contextを追加",
    block: "Block",
    chip: "参照",
  }[popup.kind];
  return (
    <div
      className="od-popup"
      role="listbox"
      aria-label={title}
      style={{
        left: Math.min(popup.x, window.innerWidth - 340),
        top: Math.min(popup.y, window.innerHeight - 260),
      }}
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      <p className="od-popup-title">{title}</p>
      {popup.kind === "context" ? (
        <input
          autoFocus
          className="od-popup-search"
          placeholder="Project・Taskを検索…"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (!event.nativeEvent.isComposing) store.popupKey(event);
          }}
        />
      ) : null}
      {items.length ? (
        items.map((item, index) => (
          <button
            key={item.key}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => setActive(index)}
            onClick={(event) => item.run(event.metaKey || event.ctrlKey)}
          >
            <span className="od-popup-badge">{item.badge}</span>
            <span>{item.label}</span>
            {item.hint ? <small>{item.hint}</small> : null}
          </button>
        ))
      ) : (
        <p className="od-popup-empty">候補がありません</p>
      )}
      {popup.kind === "at" ? (
        <p className="od-popup-help">Enter 参照 · ⌘Enter 参照＋Context付与</p>
      ) : null}
    </div>
  );
};

/* ---------- root ---------- */

export const ObjectDocumentDemo = (): React.JSX.Element => {
  const [state, setState] = useState<DemoState>(seedState);
  const [page, setPage] = useState<HostId>("proj-ctx");
  const [popup, setPopupState] = useState<PopupState | null>(null);
  const [active, setActive] = useState(0);
  const [contextQuery, setContextQuery] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const pendingFocus = useRef<{ blockId: string; at: "start" | "end" } | null>(
    null,
  );
  const counter = useRef(1);
  const itemsRef = useRef<readonly PopupItem[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!popup || popup.kind === "at" || popup.kind === "hash") return;
    const close = (event: globalThis.MouseEvent): void => {
      if (!(event.target as HTMLElement).closest(".od-popup"))
        setPopupState(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [popup]);

  const newId = (prefix: string): string =>
    `${prefix}-${Date.now()}-${counter.current++}`;
  const update = (fn: (s: DemoState) => DemoState): void => setState(fn);
  const setPopup = (next: PopupState | null): void => {
    setPopupState(next);
    setActive(0);
    if (next?.kind === "context") setContextQuery("");
  };

  const store: Store = {
    state,
    update,
    open: (id) => {
      setPopupState(null);
      setPage(id);
      window.scrollTo({ top: 0 });
    },
    focusLater: (blockId, at) => {
      pendingFocus.current = { blockId, at };
    },
    takeFocus: (blockId) => {
      if (pendingFocus.current?.blockId !== blockId) return null;
      const { at } = pendingFocus.current;
      pendingFocus.current = null;
      return at;
    },
    popup,
    setPopup,
    popupKey: (event) => {
      const items = itemsRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        setPopupState(null);
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActive(
          (current) =>
            (current + delta + items.length) % Math.max(items.length, 1),
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[active];
        if (!item) return false;
        event.preventDefault();
        item.run(event.metaKey || event.ctrlKey);
        return true;
      }
      return false;
    },
    newId,
    notify: setToast,
  };

  /** @や#の入力文字を本文から取り除き、必要なら参照チップを挿入して保存する。 */
  const replaceTrigger = (
    p: Extract<PopupState, { kind: "at" | "hash" }>,
    refId: string | null,
  ): void => {
    if (!p.node.isConnected) return;
    const el = p.node.parentElement?.closest<HTMLElement>("[data-block-id]");
    const range = document.createRange();
    range.setStart(p.node, Math.max(0, p.start));
    range.setEnd(p.node, Math.min(p.end, p.node.length));
    range.deleteContents();
    if (refId) {
      const holder = document.createElement("span");
      holder.innerHTML = toHtml(refToken(refId), stateRef.current.objects);
      const space = document.createTextNode("\u00a0");
      range.insertNode(space);
      range.insertNode(holder.firstChild!);
      range.setStartAfter(space);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    if (!el) return;
    const text = serialize(el);
    setState((s) =>
      setBlocks(s, p.hostId, (blocks) =>
        blocks.map((b) =>
          b.id === p.blockId && b.kind !== "embed" ? { ...b, text } : b,
        ),
      ),
    );
  };

  const contextLabel = (ids: readonly string[]): string =>
    ids.length
      ? ids
          .map((id) => displayTitle(state.objects[id], state.objects))
          .join("、")
      : "なし";

  const linkBlock = (
    hostId: HostId,
    blockId: string,
    targetId: string,
  ): void => {
    const memoId = newId("memo");
    setState((s) =>
      assignContext(s, hostId, blockId, targetId, memoId, Date.now()),
    );
    if (hostId === null) pendingFocus.current = { blockId, at: "end" };
    const target = displayTitle(state.objects[targetId], state.objects);
    store.notify(
      hostId === null
        ? {
            message: `段落をMemoにして ${target} に紐づけました`,
            undo: () => setState((s) => removeContext(s, memoId, targetId)),
          }
        : {
            message: `${displayTitle(state.objects[hostId], state.objects)} に Context「${target}」を追加しました`,
            undo: () => setState((s) => removeContext(s, hostId, targetId)),
          },
    );
  };

  const convert = (hostId: HostId, blockId: string, type: ObjectType): void => {
    const objectId = newId(type);
    const bodyBlockId = newId("b");
    const inherited = inheritedContext(state.objects, hostId);
    setState((s) => {
      const next = convertBlockToObject(
        s,
        hostId,
        blockId,
        type,
        objectId,
        bodyBlockId,
        Date.now(),
      );
      // 文書の末尾がObjectなら、続けて書ける段落を足す。
      return getBlocks(next, hostId).at(-1)?.kind === "embed"
        ? setBlocks(next, hostId, (bs) => [
            ...bs,
            { id: newId("b"), kind: "p", text: "" },
          ])
        : next;
    });
    pendingFocus.current = {
      blockId: type === "memo" ? blockId : bodyBlockId,
      at: "end",
    };
    store.notify({
      message: `${TYPE_LABEL[type]}にしました · Context: ${contextLabel(inherited.contexts)}${inherited.contexts.length ? "（作成位置から継承）" : ""}`,
      ...(inherited.contexts.length
        ? {
            undo: () =>
              setState((s) =>
                updateObject(s, objectId, { contexts: [], derivedFrom: null }),
              ),
          }
        : {}),
    });
  };

  const searchObjects = (
    query: string,
    exclude: HostId,
  ): readonly DocObject[] => {
    const q = query.toLowerCase();
    return Object.values(state.objects)
      .filter(
        (o) =>
          o.id !== exclude &&
          (o.type !== "memo" || q) &&
          displayTitle(o, state.objects).toLowerCase().includes(q),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 6);
  };

  const items: readonly PopupItem[] = (() => {
    if (!popup) return [];
    if (popup.kind === "at") {
      const found = searchObjects(popup.query, popup.hostId).map<PopupItem>(
        (o) => ({
          key: o.id,
          badge: TYPE_LABEL[o.type],
          label: displayTitle(o, state.objects),
          hint: o.contexts.length ? contextLabel(o.contexts) : "",
          run: (withContext) => {
            setPopupState(null);
            replaceTrigger(popup, o.id);
            if (withContext) linkBlock(popup.hostId, popup.blockId, o.id);
          },
        }),
      );
      const inherited = inheritedContext(state.objects, popup.hostId);
      const created = popup.query
        ? CREATABLE.map<PopupItem>((type) => ({
            key: `new-${type}`,
            badge: "＋",
            label: `新規${TYPE_LABEL[type]}「${popup.query}」`,
            hint: inherited.contexts.length
              ? `Context: ${contextLabel(inherited.contexts)}`
              : "Contextなし",
            run: () => {
              const id = newId(type);
              setState((s) =>
                addObject(
                  s,
                  newObject(id, type, popup.query, Date.now(), inherited, [
                    { id: newId("b"), kind: "p", text: "" },
                  ]),
                ),
              );
              setPopupState(null);
              replaceTrigger(popup, id);
              store.notify({
                message: `${TYPE_LABEL[type]}「${popup.query}」を作成 · Context: ${contextLabel(inherited.contexts)}${inherited.contexts.length ? "（継承）" : ""}`,
                ...(inherited.contexts.length
                  ? {
                      undo: () =>
                        setState((s) =>
                          updateObject(s, id, {
                            contexts: [],
                            derivedFrom: null,
                          }),
                        ),
                    }
                  : {}),
              });
            },
          }))
        : [];
      return [...found, ...created];
    }
    if (popup.kind === "hash") {
      const q = popup.query.toLowerCase();
      return CONVERTIBLE.filter((type) => HASH_ALIASES[type]!.includes(q)).map(
        (type) => ({
          key: type,
          badge: "#",
          label: `${TYPE_LABEL[type]}にする`,
          hint:
            type === "memo"
              ? "本文をそのままMemoへ"
              : `Context: ${contextLabel(inheritedContext(state.objects, popup.hostId).contexts)}`,
          run: () => {
            setPopupState(null);
            replaceTrigger(popup, null);
            convert(popup.hostId, popup.blockId, type);
          },
        }),
      );
    }
    if (popup.kind === "context") {
      const self = popup.objectId;
      return searchObjects(contextQuery, self)
        .filter(
          (o) =>
            o.type !== "memo" &&
            !(self && contextPath(state.objects, o.id, self)),
        )
        .map((o) => ({
          key: o.id,
          badge: TYPE_LABEL[o.type],
          label: displayTitle(o, state.objects),
          run: () => {
            setPopupState(null);
            if (self) setState((s) => addContext(s, self, o.id));
            else linkBlock(popup.hostId, popup.blockId, o.id);
          },
        }));
    }
    if (popup.kind === "block") {
      const host =
        popup.hostId === null ? undefined : state.objects[popup.hostId];
      const reopen = (objectId: string | null): void =>
        setPopup({ ...popup, kind: "context", objectId });
      return [
        ...CONVERTIBLE.map<PopupItem>((type) => ({
          key: type,
          badge: "#",
          label: `${TYPE_LABEL[type]}にする`,
          run: () => {
            setPopupState(null);
            convert(popup.hostId, popup.blockId, type);
          },
        })),
        {
          key: "context",
          badge: "↗",
          label: host
            ? `${displayTitle(host, state.objects)}にContextを追加…`
            : "Memoにして紐づける…",
          run: () => reopen(host ? host.id : null),
        },
      ];
    }
    if (popup.kind !== "chip") return [];
    const chip = popup;
    const target = state.objects[chip.refId];
    return [
      {
        key: "open",
        badge: "↗",
        label: "開く",
        hint: "参照先へ移動",
        run: () => store.open(chip.refId),
      },
      {
        key: "embed",
        badge: "▣",
        label: "この下に埋め込む",
        hint: "内容をその場で表示・編集",
        run: () => {
          setPopupState(null);
          setState((s) =>
            setBlocks(s, chip.hostId, (blocks) =>
              blocks.flatMap<Block>((b) =>
                b.id === chip.blockId
                  ? [
                      b,
                      {
                        id: newId("embed"),
                        kind: "embed",
                        objectId: chip.refId,
                        collapsed: false,
                      },
                    ]
                  : [b],
              ),
            ),
          );
        },
      },
      ...(target && target.type !== "memo"
        ? [
            {
              key: "context",
              badge: "⇢",
              label: "Contextとして紐づける",
              hint:
                chip.hostId === null
                  ? "段落をMemoにして所属させる"
                  : "このObjectを所属させる",
              run: () => {
                setPopupState(null);
                linkBlock(chip.hostId, chip.blockId, chip.refId);
              },
            },
          ]
        : []),
    ];
  })();
  itemsRef.current = items;

  const current = page === null ? undefined : state.objects[page];
  const areas = Object.values(state.objects).filter((o) => o.type === "area");
  const projects = Object.values(state.objects).filter(
    (o) => o.type === "project",
  );

  return (
    <StoreContext.Provider value={store}>
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
                setState(seedState());
                setPage("proj-ctx");
                setPopupState(null);
                setToast({ message: "初期状態へ戻しました" });
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
              onClick={() => store.open(null)}
            >
              Daily
            </button>
            {areas.map((area) => (
              <div key={area.id}>
                <button
                  type="button"
                  className="od-nav-area"
                  aria-current={page === area.id ? "page" : undefined}
                  onClick={() => store.open(area.id)}
                >
                  {area.title}
                </button>
                {projects
                  .filter((p) => p.contexts.includes(area.id))
                  .map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      className="od-nav-project"
                      aria-current={page === project.id ? "page" : undefined}
                      onClick={() => store.open(project.id)}
                    >
                      {project.title}
                    </button>
                  ))}
              </div>
            ))}
            {projects
              .filter(
                (p) =>
                  !p.contexts.some((id) => state.objects[id]?.type === "area"),
              )
              .map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="od-nav-project"
                  aria-current={page === project.id ? "page" : undefined}
                  onClick={() => store.open(project.id)}
                >
                  {project.title}
                </button>
              ))}
            <dl className="od-keys">
              <dt>@</dt>
              <dd>参照・新規作成</dd>
              <dt>⌘Enter</dt>
              <dd>参照＋Context付与</dd>
              <dt>#</dt>
              <dd>BlockをObject化</dd>
              <dt>空行Enter</dt>
              <dd>Objectの外へ出る</dd>
            </dl>
            <p className="od-nav-note">Prototype · 変更は保存されません</p>
          </nav>
          <main className="od-main">
            {current ? (
              <ObjectPage key={current.id} object={current} />
            ) : (
              <DailyPage />
            )}
          </main>
        </div>
        {popup ? (
          <Popup
            popup={popup}
            items={items}
            active={Math.min(active, Math.max(items.length - 1, 0))}
            setActive={setActive}
            query={contextQuery}
            setQuery={setContextQuery}
          />
        ) : null}
        <div className="od-toast" role="status" aria-live="polite">
          {toast ? (
            <>
              <span>{toast.message}</span>
              {toast.undo ? (
                <button
                  type="button"
                  onClick={() => {
                    toast.undo?.();
                    setToast({ message: "Contextを外しました" });
                  }}
                >
                  Contextを外す
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </StoreContext.Provider>
  );
};
