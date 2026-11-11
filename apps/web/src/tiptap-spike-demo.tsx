import { TextSelection, PluginKey } from "@tiptap/pm/state";
import UniqueID from "@tiptap/extension-unique-id";
import {
  EditorContent,
  Extension,
  mergeAttributes,
  Node,
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type Editor,
  type JSONContent,
  type NodeViewProps,
  type Range,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  collectMentions,
  joinDocument,
  splitDocument,
  type DocNode,
} from "./tiptap-spike-model.js";

type ObjectType = "task" | "decision" | "project";
interface ObjectInfo {
  readonly type: ObjectType;
  readonly title: string;
}

const TYPE_LABEL: Record<ObjectType, string> = {
  task: "Task",
  decision: "Decision",
  project: "Project",
};

/* ---------- registry: 文書外のObjectと、文書内ObjectのTitleを引く ---------- */

const SEED: readonly (readonly [string, ObjectInfo])[] = [
  ["proj-ctx", { type: "project", title: "Contextory" }],
  ["proj-blog", { type: "project", title: "技術ブログ" }],
];
let registry: ReadonlyMap<string, ObjectInfo> = new Map(SEED);
const listeners = new Set<() => void>();
const setRegistry = (next: ReadonlyMap<string, ObjectInfo>): void => {
  registry = next;
  for (const listener of listeners) listener();
};
const useRegistry = (): ReadonlyMap<string, ObjectInfo> =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => registry,
  );

let idCounter = 0;
const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${idCounter++}`;

/** 文書内のobjectBlockのTitleをregistryへ反映し、参照チップを追従させる。 */
const syncRegistry = (editor: Editor): void => {
  const next = new Map(registry);
  let changed = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "objectBlock") return;
    const id = String(node.attrs.objectId);
    const info: ObjectInfo = {
      type: node.attrs.type as ObjectType,
      title: node.firstChild?.textContent ?? "",
    };
    const current = next.get(id);
    if (current?.title !== info.title || current.type !== info.type) {
      next.set(id, info);
      changed = true;
    }
  });
  if (changed) setRegistry(next);
};

/* ---------- nodes ---------- */

const RefChip = ({ node }: NodeViewProps): React.JSX.Element => {
  const info = useRegistry().get(String(node.attrs.objectId));
  return (
    <NodeViewWrapper as="span" className="tt-chip" data-type={info?.type}>
      {info?.title || "無題"}
    </NodeViewWrapper>
  );
};

const ObjectRef = Node.create({
  name: "objectRef",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ objectId: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-object-ref]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-object-ref": "" }),
  ],
  addNodeView: () => ReactNodeViewRenderer(RefChip, { as: "span" }),
});

const ObjectTitle = Node.create({
  name: "objectTitle",
  content: "inline*",
  defining: true,
  parseHTML: () => [{ tag: "div[data-object-title]" }],
  renderHTML: () => ["div", { "data-object-title": "" }, 0],
});

const ObjectBlockView = ({
  node,
  editor,
  getPos,
  updateAttributes,
}: NodeViewProps): React.JSX.Element => {
  const type = node.attrs.type as ObjectType;
  const collapsed = Boolean(node.attrs.collapsed);
  const hasBody = node.childCount > 1;
  return (
    <NodeViewWrapper
      className="tt-object"
      data-type={type}
      data-collapsed={collapsed}
      data-done={Boolean(node.attrs.done)}
    >
      <span className="tt-object-lead" contentEditable={false}>
        {type === "task" ? (
          <input
            type="checkbox"
            aria-label="完了にする"
            checked={Boolean(node.attrs.done)}
            onChange={() => updateAttributes({ done: !node.attrs.done })}
          />
        ) : (
          <span className="tt-badge">{TYPE_LABEL[type]}</span>
        )}
      </span>
      <NodeViewContent className="tt-object-content" />
      <button
        className="tt-object-toggle"
        type="button"
        contentEditable={false}
        data-has-body={hasBody}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "本文を展開" : "本文を畳む"}
        onClick={() => {
          const pos = getPos();
          if (pos === undefined) return;
          if (!collapsed || hasBody) {
            updateAttributes({ collapsed: !collapsed });
            return;
          }
          // 本文がまだ無ければ、最初の段落を作ってそこへ入る。
          const end = pos + node.nodeSize - 1;
          editor
            .chain()
            .command(({ tr }) => {
              tr.setNodeAttribute(pos, "collapsed", false);
              tr.insert(end, editor.schema.nodes.paragraph!.create());
              tr.setSelection(TextSelection.create(tr.doc, end + 1));
              return true;
            })
            .focus()
            .run();
        }}
      >
        {collapsed ? (hasBody ? "本文 ▸" : "▸") : "▾"}
      </button>
    </NodeViewWrapper>
  );
};

const ObjectBlock = Node.create({
  name: "objectBlock",
  group: "block",
  content: "objectTitle block*",
  defining: true,
  addAttributes: () => ({
    objectId: { default: "" },
    type: { default: "task" },
    done: { default: false },
    collapsed: { default: true },
  }),
  parseHTML: () => [{ tag: "div[data-object-block]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-object-block": "" }),
    0,
  ],
  addNodeView: () => ReactNodeViewRenderer(ObjectBlockView),
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        const depth = $from.depth - 1;
        if (depth < 0 || $from.node(depth).type.name !== "objectBlock")
          return false;
        const inTitle = $from.parent.type.name === "objectTitle";
        const emptyLast =
          empty &&
          $from.parent.type.name === "paragraph" &&
          $from.parent.content.size === 0 &&
          $from.index(depth) === $from.node(depth).childCount - 1;
        if (!inTitle && !emptyLast) return false;
        // TitleでのEnter、または本文末尾の空行でのEnterで、Objectの外へ出る。
        return editor
          .chain()
          .command(({ tr, state }) => {
            const after = $from.after(depth);
            if (emptyLast) tr.delete($from.before(), $from.after());
            const pos = tr.mapping.map(after);
            tr.insert(pos, state.schema.nodes.paragraph!.create());
            tr.setSelection(TextSelection.create(tr.doc, pos + 1));
            return true;
          })
          .scrollIntoView()
          .run();
      },
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (
          !empty ||
          $from.parentOffset > 0 ||
          $from.parent.type.name !== "objectTitle"
        )
          return false;
        // Titleの先頭でBackspaceすると、Objectを解除して本文に戻す。
        return editor
          .chain()
          .command(({ tr, state }) => {
            const depth = $from.depth - 1;
            const object = $from.node(depth);
            const start = $from.before(depth);
            const body: (typeof object)[] = [];
            object.forEach((child, _offset, index) => {
              if (index > 0) body.push(child);
            });
            tr.replaceWith(start, start + object.nodeSize, [
              state.schema.nodes.paragraph!.create(null, $from.parent.content),
              ...body,
            ]);
            tr.setSelection(TextSelection.create(tr.doc, start + 1));
            return true;
          })
          .run();
      },
    };
  },
});

/* ---------- @ / # menus ---------- */

interface MenuItem {
  readonly key: string;
  readonly badge: string;
  readonly label: string;
  readonly run: (editor: Editor, range: Range) => void;
}

interface MenuState {
  readonly title: string;
  readonly items: readonly MenuItem[];
  readonly x: number;
  readonly y: number;
  readonly pick: (item: MenuItem) => void;
}

/** Suggestion pluginとReactのメニューをつなぐ。エディタ生成前に参照が必要なので外に置く。 */
const menuBridge: {
  show: (menu: MenuState | null) => void;
  key: (event: KeyboardEvent) => boolean;
} = { show: () => undefined, key: () => false };

const insertRef = (editor: Editor, range: Range, objectId: string): void => {
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: "objectRef", attrs: { objectId } },
      { type: "text", text: " " },
    ])
    .run();
};

const atItems = (query: string): readonly MenuItem[] => {
  const q = query.toLowerCase();
  const found = [...registry]
    .filter(([, info]) => info.title.toLowerCase().includes(q))
    .slice(0, 6)
    .map<MenuItem>(([id, info]) => ({
      key: id,
      badge: TYPE_LABEL[info.type],
      label: info.title || "無題",
      run: (editor, range) => insertRef(editor, range, id),
    }));
  const created = query
    ? (["task", "project", "decision"] as const).map<MenuItem>((type) => ({
        key: `new-${type}`,
        badge: "＋",
        label: `新規${TYPE_LABEL[type]}「${query}」`,
        run: (editor, range) => {
          const id = newId(type);
          setRegistry(new Map(registry).set(id, { type, title: query }));
          insertRef(editor, range, id);
        },
      }))
    : [];
  return [...found, ...created];
};

const convertBlock = (editor: Editor, range: Range, type: ObjectType): void => {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .command(({ tr, state }) => {
      const $pos = tr.selection.$from;
      const block = $pos.parent;
      const depth = $pos.depth;
      const { objectBlock, objectTitle, paragraph } = state.schema.nodes;
      if (block.type !== paragraph || depth < 1) return false;
      const index = $pos.index(depth - 1);
      // リスト項目の先頭段落など、Objectを置けない場所では変換しない。
      if (!$pos.node(depth - 1).canReplaceWith(index, index + 1, objectBlock!))
        return false;
      const object = objectBlock!.create({ objectId: newId(type), type }, [
        objectTitle!.create(null, block.content),
      ]);
      const start = $pos.before(depth);
      tr.replaceWith(start, start + block.nodeSize, [
        object,
        paragraph.create(),
      ]);
      tr.setSelection(
        TextSelection.create(tr.doc, start + object.nodeSize + 1),
      );
      return true;
    })
    .run();
};

const hashItems = (query: string): readonly MenuItem[] =>
  (["task", "decision"] as const)
    .filter((type) => type.startsWith(query.toLowerCase()))
    .map((type) => ({
      key: type,
      badge: "#",
      label: `${TYPE_LABEL[type]}にする`,
      run: (editor, range) => convertBlock(editor, range, type),
    }));

const suggestionRender =
  (title: string) =>
  (): {
    onStart: (props: SuggestionProps<MenuItem>) => void;
    onUpdate: (props: SuggestionProps<MenuItem>) => void;
    onKeyDown: (props: SuggestionKeyDownProps) => boolean;
    onExit: () => void;
  } => {
    const show = (props: SuggestionProps<MenuItem>): void => {
      const rect = props.clientRect?.();
      menuBridge.show({
        title,
        items: props.items,
        x: rect?.left ?? 0,
        y: (rect?.bottom ?? 0) + 6,
        pick: (item) => props.command(item),
      });
    };
    return {
      onStart: show,
      onUpdate: show,
      onKeyDown: ({ event }) => menuBridge.key(event),
      onExit: () => menuBridge.show(null),
    };
  };

const ObjectMenus = Extension.create({
  name: "objectMenus",
  priority: 1000, // メニュー表示中のEnterを、ObjectBlockのEnterより先に受ける。
  addProseMirrorPlugins() {
    const common = {
      editor: this.editor,
      command: ({
        editor,
        range,
        props,
      }: {
        editor: Editor;
        range: Range;
        props: MenuItem;
      }) => props.run(editor, range),
    };
    return [
      Suggestion<MenuItem, MenuItem>({
        ...common,
        char: "@",
        pluginKey: new PluginKey("atMenu"),
        items: ({ query }) => [...atItems(query)],
        render: suggestionRender("参照・作成"),
      }),
      Suggestion<MenuItem, MenuItem>({
        ...common,
        char: "#",
        pluginKey: new PluginKey("hashMenu"),
        items: ({ query }) => [...hashItems(query)],
        render: suggestionRender("このBlockをObjectにする"),
      }),
    ];
  },
});

/* ---------- demo ---------- */

const text = (value: string): DocNode => ({ type: "text", text: value });
const INITIAL: DocNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [text("方針")] },
    {
      type: "paragraph",
      content: [
        text("自由な文書の中で "),
        { type: "objectRef", attrs: { objectId: "proj-ctx" } },
        text(" のObjectを参照・作成する。"),
      ],
    },
    {
      type: "objectBlock",
      attrs: { objectId: "task-input", type: "task", collapsed: false },
      content: [
        { type: "objectTitle", content: [text("入力体験を再設計する")] },
        {
          type: "paragraph",
          content: [text("編集時は一つの文書木として扱い、保存時に分ける。")],
        },
        {
          type: "objectBlock",
          attrs: { objectId: "task-at", type: "task" },
          content: [
            { type: "objectTitle", content: [text("@メニューを試す")] },
          ],
        },
      ],
    },
    { type: "paragraph" },
  ],
};

export const TiptapSpikeDemo = (): React.JSX.Element => {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [active, setActive] = useState(0);
  const [doc, setDoc] = useState<DocNode>(INITIAL);
  const menuRef = useRef({ menu, active });
  menuRef.current = { menu, active };

  useEffect(() => {
    menuBridge.show = (next) => {
      setMenu(next);
      if (!next || next.items.length !== menuRef.current.menu?.items.length)
        setActive(0);
    };
    menuBridge.key = (event) => {
      const current = menuRef.current.menu;
      if (!current?.items.length || event.isComposing) return false;
      const count = current.items.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActive((index) => (index + delta + count) % count);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = current.items[Math.min(menuRef.current.active, count - 1)];
        if (item) current.pick(item);
        return true;
      }
      return false;
    };
    return () => {
      menuBridge.show = () => undefined;
      menuBridge.key = () => false;
    };
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      UniqueID.configure({
        types: ["paragraph", "heading", "listItem", "objectBlock"],
      }),
      ObjectRef,
      ObjectTitle,
      ObjectBlock,
      ObjectMenus,
    ],
    content: INITIAL as JSONContent,
    onCreate: ({ editor: created }) => {
      syncRegistry(created);
      setDoc(created.getJSON() as DocNode);
    },
    onUpdate: ({ editor: updated }) => {
      syncRegistry(updated);
      setDoc(updated.getJSON() as DocNode);
    },
  });

  const split = splitDocument(doc);
  // 属性の並び順は保存で変わりうるので、キーを整列して比べる。
  const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, v: unknown) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
          )
        : v,
    );
  const roundTrip = canonical(joinDocument(split)) === canonical(doc);
  const titles = useRegistry();
  const index = Math.min(active, Math.max((menu?.items.length ?? 1) - 1, 0));

  return (
    <div className="tt-demo">
      <header className="tt-topbar">
        <strong>Contextory</strong>
        <span>Tiptap spike（Phase 0）</span>
        <a href="?demo=object-document">Document demo</a>
      </header>
      <div className="tt-shell">
        <main className="tt-editor">
          <EditorContent editor={editor} />
        </main>
        <aside className="tt-inspector">
          <section>
            <h2>保存時の分解</h2>
            <p data-ok={roundTrip}>
              Object {Object.keys(split.objects).length}件 · 復元
              {roundTrip ? "一致" : "不一致"}
            </p>
            <pre>{JSON.stringify(split.host, null, 1)}</pre>
          </section>
          <section>
            <h2>言及が届く単位</h2>
            <ul>
              {collectMentions(doc).map((mention, i) => (
                <li key={i}>
                  <b>
                    {titles.get(mention.targetId)?.title ?? mention.targetId}
                  </b>
                  {" ← "}
                  {mention.unit.kind}
                  <code>{mention.unit.id.slice(0, 8)}</code>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
      {menu ? (
        <div
          className="tt-menu"
          role="listbox"
          aria-label={menu.title}
          style={{
            left: Math.min(menu.x, window.innerWidth - 320),
            top: Math.min(menu.y, window.innerHeight - 240),
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <p>{menu.title}</p>
          {menu.items.length ? (
            menu.items.map((item, i) => (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={i === index}
                onMouseEnter={() => setActive(i)}
                onClick={() => menu.pick(item)}
              >
                <span>{item.badge}</span>
                {item.label}
              </button>
            ))
          ) : (
            <p>候補がありません</p>
          )}
        </div>
      ) : null}
    </div>
  );
};
