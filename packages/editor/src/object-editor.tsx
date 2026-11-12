import UniqueID from "@tiptap/extension-unique-id";
import { GapCursor } from "@tiptap/pm/gapcursor";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
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
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  CONTEXT_FIELD,
  newId,
  normalizeObjectType,
  type DocNode,
  type ObjectType,
  type TypeDefinition,
} from "@pkm/core";

/** エディタが表示に使うObjectの情報。 */
export interface EditorObject {
  readonly id: string;
  readonly type: ObjectType;
  readonly title: string;
}

/** エディタが外側（Objectの保存先）へ頼む操作。 */
export interface EditorHost {
  readonly lookup: (id: string) => EditorObject | undefined;
  readonly search: (query: string) => Promise<readonly EditorObject[]>;
  /** 文書に置かないObjectを作る。parentIdは入力位置を包むObject。 */
  readonly create: (
    type: ObjectType,
    title: string,
    parentId: string | null,
  ) => string;
  readonly open: (id: string) => void;
  /** 種別の定義。組み込みの種別も含む。 */
  readonly types: () => readonly TypeDefinition[];
  /** 開いている文書がObjectの本文なら、そのObject。 */
  readonly page: { readonly id: string; readonly type: ObjectType } | null;
  /** 置かれた場所から自明でないContext。 */
  readonly contexts: (
    id: string,
    parentId: string | null,
  ) => readonly EditorObject[];
}

const TYPE_LABEL: Record<string, string> = {
  area: "Area",
  project: "Project",
  task: "Task",
  decision: "Decision",
  memo: "Memo",
};
/** 表示用の種別名。ユーザーが作った種別は名前をそのまま使う。 */
export const typeLabel = (type: ObjectType): string => TYPE_LABEL[type] ?? type;

const HostContext = createContext<EditorHost | null>(null);
const useHost = (): EditorHost => {
  const host = useContext(HostContext);
  if (!host) throw new Error("EditorHost is missing");
  return host;
};

/** posを包む最も内側のobjectBlockのID。 */
const enclosingObjectId = (editor: Editor, pos: number): string | null => {
  const $pos = editor.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "objectBlock") return String(node.attrs.objectId);
  }
  return null;
};

const typeOf = (
  host: EditorHost,
  type: ObjectType,
): TypeDefinition | undefined =>
  host.types().find((definition) => definition.name === type);

/** nodeの直下にあるContextの行が指すObject。 */
const contextRefs = (node: PMNode): string[] => {
  const ids: string[] = [];
  node.forEach((child) => {
    if (
      child.type.name === "objectField" &&
      child.attrs.fieldId === CONTEXT_FIELD.id
    )
      child.forEach((inline) => {
        if (inline.type.name === "objectRef")
          ids.push(String(inline.attrs.objectId));
      });
  });
  return ids;
};

/** $posに作るObjectが継ぐContext。Memoの中ではMemoのContextを継ぐ。 */
const inheritedAt = ($pos: ResolvedPos, host: EditorHost): string[] => {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "objectBlock")
      return node.attrs.type === "memo"
        ? contextRefs(node)
        : [String(node.attrs.objectId)];
  }
  if (!host.page) return [];
  return host.page.type === "memo" ? contextRefs($pos.doc) : [host.page.id];
};

/* ---------- nodes ---------- */

const RefChip = ({ node }: NodeViewProps): React.JSX.Element => {
  const host = useHost();
  const id = String(node.attrs.objectId);
  const info = host.lookup(id);
  return (
    <NodeViewWrapper
      as="span"
      className="pe-chip"
      data-type={info?.type ?? "missing"}
      data-color={info ? typeOf(host, info.type)?.color : undefined}
      onClick={() => host.open(id)}
    >
      {info ? info.title : "削除されたObject"}
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

/** 文書の先頭にも、開いているObject自身のFieldを並べられるようにする。 */
const Document = Node.create({
  name: "doc",
  topNode: true,
  content: "objectField* block+",
});

/** 次の行へ進む。最後のFieldなら本文の段落を作る。 */
const leaveField = (editor: Editor): boolean => {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name !== "objectField") return false;
  const after = $from.after();
  const isLast = $from.indexAfter($from.depth - 1) >= $from.node(-1).childCount;
  return editor
    .chain()
    .command(({ tr, state }) => {
      if (isLast) tr.insert(after, state.schema.nodes.paragraph!.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1)));
      return true;
    })
    .scrollIntoView()
    .run();
};

/** Fieldの1行。値はインライン内容で、@がそのまま使える。 */
const ObjectField = Node.create({
  name: "objectField",
  content: "inline*",
  defining: true,
  isolating: true, // BackspaceやDeleteで、隣の行とつながらないようにする。
  addAttributes: () => ({
    fieldId: { default: "", rendered: false },
    name: { default: "", rendered: false },
  }),
  parseHTML: () => [{ tag: "div[data-object-field]" }],
  renderHTML: ({ node }) => [
    "div",
    { "data-object-field": "", "data-label": String(node.attrs.name) },
    0,
  ],
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => leaveField(editor),
      Tab: ({ editor }) => leaveField(editor),
    };
  },
});

const ObjectBlockView = ({
  node,
  editor,
  getPos,
  updateAttributes,
}: NodeViewProps): React.JSX.Element => {
  const host = useHost();
  const id = String(node.attrs.objectId);
  const type = node.attrs.type as ObjectType;
  const collapsed = Boolean(node.attrs.collapsed);
  let hasBody = false;
  node.forEach((child) => {
    if (!["objectTitle", "objectField"].includes(child.type.name))
      hasBody = true;
  });
  const pos = getPos();
  const contexts = host.contexts(
    id,
    pos === undefined ? null : enclosingObjectId(editor, pos),
  );
  const definition = typeOf(host, type);
  const checkbox = definition?.checkbox ?? type === "task";
  const toggle = (): void => {
    const at = getPos();
    if (at === undefined) return;
    if (!collapsed || hasBody) {
      updateAttributes({ collapsed: !collapsed });
      return;
    }
    // 本文がまだ無ければ、最初の段落を作ってそこへ入る。
    const end = at + node.nodeSize - 1;
    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeAttribute(at, "collapsed", false);
        tr.insert(end, editor.schema.nodes.paragraph!.create());
        tr.setSelection(TextSelection.create(tr.doc, end + 1));
        return true;
      })
      .focus()
      .run();
  };
  return (
    <NodeViewWrapper
      className="pe-object"
      data-type={type}
      data-color={definition?.color ?? undefined}
      data-collapsed={collapsed}
      data-done={checkbox && Boolean(node.attrs.done)}
      // 種別はTitleの行末にタグとして出す。
      style={{ "--pe-tag": JSON.stringify(`#${typeLabel(type)}`) }}
    >
      {/* Tanaと同じく、行頭に開閉と「開く」を置いて、マウスの移動を減らす。 */}
      <span className="pe-object-lead" contentEditable={false}>
        <button
          type="button"
          className="pe-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展開" : "畳む"}
          onClick={toggle}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
        <button
          type="button"
          className="pe-bullet"
          data-has-body={hasBody}
          aria-label="開く"
          onClick={() => host.open(id)}
        />
        {checkbox ? (
          <input
            type="checkbox"
            aria-label="完了にする"
            checked={Boolean(node.attrs.done)}
            onChange={() => updateAttributes({ done: !node.attrs.done })}
          />
        ) : null}
      </span>
      <NodeViewContent className="pe-object-content" />
      <span className="pe-object-side" contentEditable={false}>
        {contexts.map((context) => (
          <button
            key={context.id}
            type="button"
            className="pe-context"
            data-type={context.type}
            data-color={typeOf(host, context.type)?.color ?? undefined}
            onClick={() => host.open(context.id)}
          >
            {context.title}
          </button>
        ))}
      </span>
    </NodeViewWrapper>
  );
};

const ObjectBlock = Node.create({
  name: "objectBlock",
  group: "block",
  content: "objectTitle objectField* block*",
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
              if (index > 0 && child.type.name !== "objectField")
                body.push(child);
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

/**
 * 畳んだObjectの見えていない行と、Fieldの行のすき間へ、カーソルが入らないようにする。
 * すき間で入力すると、Fieldの間に段落が割り込んでObjectが分かれてしまう。
 */
const CollapsedGuard = Extension.create({
  name: "collapsedGuard",
  addProseMirrorPlugins: () => [
    new Plugin({
      appendTransaction(_transactions, oldState, newState) {
        const { $head, head } = newState.selection;
        const forward = head >= oldState.selection.head;
        if (
          newState.selection instanceof GapCursor &&
          [$head.nodeBefore, $head.nodeAfter].some(
            (node) => node?.type.name === "objectField",
          )
        )
          return newState.tr.setSelection(
            TextSelection.near($head, forward ? 1 : -1),
          );
        for (let depth = 1; depth <= $head.depth; depth++) {
          const node = $head.node(depth);
          if (
            node.type.name !== "objectBlock" ||
            !node.attrs.collapsed ||
            $head.index(depth) === 0
          )
            continue;
          const start = $head.before(depth);
          const end = start + node.nodeSize;
          const title = TextSelection.create(
            newState.doc,
            start + node.firstChild!.nodeSize,
          );
          // 進んできた向きへ抜ける。後ろに行ける場所が無ければTitleへ戻す。
          const after = TextSelection.near(newState.doc.resolve(end), 1);
          return newState.tr.setSelection(
            forward && after.head >= end ? after : title,
          );
        }
        return null;
      },
    }),
  ],
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

/** Suggestion pluginとReactのメニューをつなぐ、エディタごとの窓口。 */
interface MenuBridge {
  show: (menu: MenuState | null) => void;
  key: (event: KeyboardEvent) => boolean;
}

const CREATABLE: readonly ObjectType[] = ["task", "project", "decision"];
/** #のメニューに出す組み込みの種別の並び。 */
const CONVERTIBLE: readonly ObjectType[] = [
  "task",
  "decision",
  "memo",
  "project",
  "area",
];

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

const atItems = async (
  host: EditorHost,
  query: string,
): Promise<MenuItem[]> => [
  ...(await host.search(query)).map<MenuItem>((info) => ({
    key: info.id,
    badge: typeLabel(info.type),
    label: info.title,
    run: (editor, range) => insertRef(editor, range, info.id),
  })),
  ...(query
    ? CREATABLE.map<MenuItem>((type) => ({
        key: `new-${type}`,
        badge: "＋",
        label: `新規${typeLabel(type)}「${query}」`,
        run: (editor, range) =>
          insertRef(
            editor,
            range,
            host.create(type, query, enclosingObjectId(editor, range.from)),
          ),
      }))
    : []),
];

const convertBlock = (
  editor: Editor,
  range: Range,
  type: ObjectType,
  host: EditorHost,
): void => {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .command(({ tr, state }) => {
      const $pos = tr.selection.$from;
      const block = $pos.parent;
      const depth = $pos.depth;
      const { objectBlock, objectTitle, objectField, objectRef, paragraph } =
        state.schema.nodes;
      if (block.type !== paragraph || depth < 1) return false;
      const index = $pos.index(depth - 1);
      // リスト項目の先頭段落など、Objectを置けない場所では変換しない。
      if (!$pos.node(depth - 1).canReplaceWith(index, index + 1, objectBlock!))
        return false;
      // Fieldの行は作成時に並べる。Contextには置かれた場所から継ぐ値を入れる。
      const fields = (typeOf(host, type)?.fields ?? [CONTEXT_FIELD]).map(
        (field) =>
          objectField!.create(
            { fieldId: field.id, name: field.name },
            field.kind === "context"
              ? inheritedAt($pos, host).flatMap((objectId) => [
                  objectRef!.create({ objectId }),
                  state.schema.text(" "),
                ])
              : null,
          ),
      );
      const object = objectBlock!.create({ objectId: newId(), type }, [
        objectTitle!.create(null, block.content),
        ...fields,
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

/** Tanaと同じく、種別を問わずその場で作る。無い種別は名前を打てば作れる。 */
const hashItems = (host: EditorHost, query: string): MenuItem[] => {
  const lower = query.toLowerCase();
  const types = [
    ...CONVERTIBLE,
    ...host
      .types()
      .filter((type) => !type.builtin)
      .map((type) => type.name),
  ];
  const created = normalizeObjectType(query);
  return [
    ...types
      .filter((type) => type.toLowerCase().startsWith(lower))
      .map<MenuItem>((type) => ({
        key: type,
        badge: "#",
        label: `${typeLabel(type)}にする`,
        run: (editor, range) => convertBlock(editor, range, type, host),
      })),
    ...(created && !types.some((type) => type.toLowerCase() === lower)
      ? [
          {
            key: "new-type",
            badge: "＋",
            label: `新しい種別「#${created}」にする`,
            run: (editor: Editor, range: Range) =>
              convertBlock(editor, range, created, host),
          },
        ]
      : []),
  ];
};

const createMenus = (
  bridge: MenuBridge,
  host: RefObject<EditorHost>,
): Extension =>
  Extension.create({
    name: "objectMenus",
    priority: 1000, // メニュー表示中のEnterを、ObjectBlockのEnterより先に受ける。
    addProseMirrorPlugins() {
      const render = (title: string) => () => {
        const show = (props: SuggestionProps<MenuItem>): void => {
          const rect = props.clientRect?.();
          bridge.show({
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
          onKeyDown: ({ event }: SuggestionKeyDownProps) => bridge.key(event),
          onExit: () => bridge.show(null),
        };
      };
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
          items: ({ query }) => atItems(host.current, query),
          render: render("参照・作成"),
        }),
        Suggestion<MenuItem, MenuItem>({
          ...common,
          char: "#",
          pluginKey: new PluginKey("hashMenu"),
          items: ({ query }) => hashItems(host.current, query),
          render: render("このBlockをObjectにする"),
        }),
      ];
    },
  });

/* ---------- component ---------- */

export const ObjectEditor = ({
  initialDoc,
  host,
  onChange,
  ariaLabel,
}: {
  /** 開いた時点の文書。以後の内容はエディタが持つので、文書を切り替える時はkeyで作り直す。 */
  readonly initialDoc: DocNode;
  readonly host: EditorHost;
  readonly onChange: (doc: DocNode) => void;
  readonly ariaLabel: string;
}): React.JSX.Element => {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [active, setActive] = useState(0);
  const latest = useRef({ host, onChange });
  latest.current = { host, onChange };
  const hostRef = useRef(host);
  hostRef.current = host;
  // キー入力は描画を待たずに届くので、メニューの最新状態はrefにも持つ。
  const shown = useRef<{ menu: MenuState | null; active: number }>({
    menu: null,
    active: 0,
  });

  const [bridge] = useState<MenuBridge>(() => {
    const select = (index: number): void => {
      shown.current.active = index;
      setActive(index);
    };
    return {
      show: (next) => {
        if (next?.items.length !== shown.current.menu?.items.length) select(0);
        shown.current.menu = next;
        setMenu(next);
      },
      key: (event) => {
        const { menu: current, active: index } = shown.current;
        if (!current?.items.length || event.isComposing) return false;
        const count = current.items.length;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          select(
            (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count,
          );
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = current.items[Math.min(index, count - 1)];
          if (item) current.pick(item);
          return true;
        }
        return false;
      },
    };
  });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ document: false }),
      Document,
      UniqueID.configure({
        types: ["paragraph", "heading", "listItem", "objectBlock"],
        generateID: () => newId(),
      }),
      ObjectRef,
      ObjectTitle,
      ObjectField,
      ObjectBlock,
      CollapsedGuard,
      createMenus(bridge, hostRef),
    ],
    content: initialDoc as JSONContent,
    editorProps: { attributes: { "aria-label": ariaLabel } },
    onUpdate: ({ editor: updated }) =>
      latest.current.onChange(updated.getJSON() as DocNode),
  });

  // 画面外でメニューが残らないよう、エディタを離れたら閉じる。
  useEffect(() => () => setMenu(null), []);

  const index = Math.min(active, Math.max((menu?.items.length ?? 1) - 1, 0));
  return (
    <HostContext.Provider value={host}>
      <EditorContent className="pe-editor" editor={editor} />
      {menu ? (
        <div
          className="pe-menu"
          role="listbox"
          aria-label={menu.title}
          style={{
            left: Math.min(menu.x, window.innerWidth - 320),
            top: Math.min(menu.y, window.innerHeight - 260),
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
                onMouseEnter={() => {
                  shown.current.active = i;
                  setActive(i);
                }}
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
    </HostContext.Provider>
  );
};
