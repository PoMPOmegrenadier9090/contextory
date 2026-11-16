import { ListItem } from "@tiptap/extension-list";
import UniqueID from "@tiptap/extension-unique-id";
import { GapCursor } from "@tiptap/pm/gapcursor";
import {
  Fragment,
  type Node as PMNode,
  type ResolvedPos,
} from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
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
  useLayoutEffect,
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

import {
  BlockRangeSelection,
  BlockSelection,
  extendBlockDrag,
  selectBlock,
} from "./block-selection.js";
import { conversionAt } from "./object-conversion.js";
import { DatePanel, formatDate, Chooser, Popover } from "./view-controls.js";

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
  /** 種別のページを開く。 */
  readonly openType: (type: ObjectType) => void;
  /** 選択のFieldに、新しい選択肢を足す。 */
  readonly addOption: (fieldId: string, option: string) => void;
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
/** 埋め込んだObjectの「⋯」から、そのObjectのメニューを開く。 */
const BlockMenuContext = createContext<
  (pos: number, x: number, y: number, objectAt: number) => void
>(() => undefined);
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
  content: "field* block+",
});

const isField = (node: PMNode): boolean => node.type.spec.group === "field";

/** 次に文字を打てる行へ進む。後ろに無ければ本文の段落を作る。 */
const leaveField = (editor: Editor): boolean => {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name !== "objectField") return false;
  const container = $from.node(-1);
  let pos = $from.after();
  let target: number | null = null;
  for (let i = $from.indexAfter(-1); i < container.childCount; i++) {
    const child = container.child(i);
    if (child.type.name !== "objectFieldControl") {
      target = pos;
      break;
    }
    pos += child.nodeSize;
  }
  const end = pos;
  return editor
    .chain()
    .command(({ tr, state }) => {
      if (target === null)
        tr.insert(end, state.schema.nodes.paragraph!.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve((target ?? end) + 1)));
      return true;
    })
    .scrollIntoView()
    .run();
};

/** 日付や選択肢を選ぶFieldの行。文字は打てず、小さな窓から選ぶ。 */
const FieldControlView = ({
  node,
  updateAttributes,
}: NodeViewProps): React.JSX.Element => {
  const host = useHost();
  const value = String(node.attrs.value);
  const name = String(node.attrs.name);
  const fieldId = String(node.attrs.fieldId);
  // 選択肢は、作成時に写したものより今の種別の定義を使う。
  const defined = host
    .types()
    .flatMap((type) => type.fields)
    .find((field) => field.id === fieldId)?.options;
  const options = defined ?? (node.attrs.options as readonly string[]);
  const set = (next: string): void => {
    if (next !== value) updateAttributes({ value: next });
  };
  const empty = <span className="pe-field-empty">空</span>;
  return (
    <NodeViewWrapper
      data-object-field=""
      data-label={name}
      contentEditable={false}
    >
      {node.attrs.kind === "date" ? (
        <Popover
          className="pe-field-pop"
          ariaLabel={name}
          label={value ? formatDate(value) : empty}
        >
          {(close) => (
            <DatePanel
              value={value}
              onPick={(date) => {
                close();
                set(date);
              }}
            />
          )}
        </Popover>
      ) : (
        <Popover
          className="pe-field-pop"
          ariaLabel={name}
          label={value ? <span className="od-pill">{value}</span> : empty}
        >
          {(close) => (
            <>
              <Chooser
                placeholder="選ぶか、新しい値を入力"
                load={(query) =>
                  options
                    .filter((option) => option.includes(query.trim()))
                    .map((option) => ({ key: option, label: option }))
                }
                onPick={(choice) => {
                  close();
                  set(choice.key);
                }}
                // 候補に無い値は、種別の選択肢にも足す。
                onCreate={(created) => {
                  close();
                  set(created);
                  host.addOption(fieldId, created);
                }}
              />
              {value ? (
                <div className="od-menu">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      set("");
                    }}
                  >
                    値を消す
                  </button>
                </div>
              ) : null}
            </>
          )}
        </Popover>
      )}
    </NodeViewWrapper>
  );
};

const ObjectFieldControl = Node.create({
  name: "objectFieldControl",
  group: "field",
  atom: true,
  selectable: false, // 選択した状態で文字を打つと、行ごと置き換わってしまう。
  addAttributes: () => ({
    fieldId: { default: "" },
    name: { default: "" },
    kind: { default: "select" },
    options: { default: [] },
    value: { default: "" },
  }),
  parseHTML: () => [{ tag: "div[data-object-field-control]" }],
  renderHTML: () => ["div", { "data-object-field-control": "" }],
  addNodeView: () => ReactNodeViewRenderer(FieldControlView),
});

/** Fieldの1行。値はインライン内容で、@がそのまま使える。 */
const ObjectField = Node.create({
  name: "objectField",
  group: "field",
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

/** 畳んだ行末に出す値の数。超えた分は「+n」にまとめる。 */
const SIDE_VALUES = 3;

const rangeAt = (selection: EditorState["selection"], pos: number): boolean =>
  selection instanceof BlockRangeSelection &&
  pos >= selection.from &&
  pos < selection.to;

const ObjectBlockView = ({
  node,
  editor,
  getPos,
  selected,
  updateAttributes,
}: NodeViewProps): React.JSX.Element => {
  const host = useHost();
  const openMenu = useContext(BlockMenuContext);
  const id = String(node.attrs.objectId);
  const type = node.attrs.type as ObjectType;
  const collapsed = Boolean(node.attrs.collapsed);
  let hasBody = false;
  const pos = getPos();
  const implied =
    pos === undefined ? [] : inheritedAt(editor.state.doc.resolve(pos), host);
  /** 畳んでいる間、行末に出す値。Fieldの並び順のまま、値のあるものだけ。 */
  const values: React.JSX.Element[] = [];
  node.forEach((child, _offset, index) => {
    if (child.type.name === "objectTitle") return;
    if (!isField(child)) {
      hasBody = true;
      return;
    }
    const name = String(child.attrs.name);
    if (child.attrs.fieldId === CONTEXT_FIELD.id) {
      // 置かれた場所から自明なContextは出さない。
      for (const contextId of contextRefs(node)) {
        const context = host.lookup(contextId);
        if (context && !implied.includes(contextId))
          values.push(
            <button
              key={contextId}
              type="button"
              className="pe-context"
              data-type={context.type}
              data-color={typeOf(host, context.type)?.color ?? undefined}
              onClick={() => host.open(contextId)}
            >
              {context.title}
            </button>,
          );
      }
      return;
    }
    let text = String(child.attrs.value ?? "");
    child.forEach((inline) => {
      text +=
        inline.type.name === "objectRef"
          ? `@${host.lookup(String(inline.attrs.objectId))?.title ?? "…"}`
          : (inline.text ?? "");
    });
    if (text.trim())
      values.push(
        <span key={index} className="pe-value">
          <small>{name}</small>
          {text.trim()}
        </span>,
      );
  });
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
      data-selected={selected}
    >
      {/* 行頭は種別のアイコンか、チェックボックス。幅はどの種別も同じにする。 */}
      <span className="pe-object-lead" contentEditable={false}>
        <button
          type="button"
          className="pe-grip"
          aria-label="ブロックを選択"
          aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown"
          title="ブロックを選択（ドラッグまたは Shift＋↑↓ で範囲を広げる）"
          onPointerDown={(event) => {
            const at = getPos();
            if (at === undefined || event.button !== 0 || !event.isPrimary)
              return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            selectBlock(editor.view, at, event.shiftKey);
            if (event.pointerType !== "touch") editor.view.focus();
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              extendBlockDrag(editor.view, event.clientX, event.clientY);
          }}
          onClick={(event) => {
            const at = getPos();
            if (event.detail !== 0 || at === undefined) return;
            selectBlock(editor.view, at, event.shiftKey);
            editor.view.focus();
          }}
        >
          <span aria-hidden="true">⠿</span>
        </button>
        {/* 開閉は左の余白に置き、行の幅を取らない。 */}
        <button
          type="button"
          className="pe-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展開" : "畳む"}
          aria-keyshortcuts="Meta+ArrowDown Meta+ArrowUp"
          onClick={toggle}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
        {checkbox ? (
          <input
            type="checkbox"
            aria-label="完了にする"
            checked={Boolean(node.attrs.done)}
            onChange={() => updateAttributes({ done: !node.attrs.done })}
          />
        ) : (
          <button
            type="button"
            className="pe-icon"
            data-has-body={collapsed && hasBody}
            aria-label={`${typeLabel(type)}を開く`}
            title="開く"
            onClick={() => host.open(id)}
          />
        )}
      </span>
      <NodeViewContent className="pe-object-content" />
      <span className="pe-object-side" contentEditable={false}>
        {collapsed ? values.slice(0, SIDE_VALUES) : null}
        {collapsed && values.length > SIDE_VALUES ? (
          <span className="pe-value">+{values.length - SIDE_VALUES}</span>
        ) : null}
        {checkbox ? (
          <button
            type="button"
            className="pe-open"
            aria-label={`${typeLabel(type)}を開く`}
            title="開く"
            onClick={() => host.open(id)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4h6v6M12 4l-7 7" />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          className="pe-more"
          aria-label={`${typeLabel(type)}のメニュー`}
          title="選択してメニューを開く"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            const at = getPos();
            if (at === undefined) return;
            if (!rangeAt(editor.state.selection, at))
              editor.chain().focus().setNodeSelection(at).run();
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(at + 1, rect.right - 220, rect.bottom + 4, at);
          }}
        >
          ⋯
        </button>
      </span>
    </NodeViewWrapper>
  );
};

/** Objectを解除して、Titleを段落に、本文をその後ろに戻す。Field行は捨てる。 */
const unwrapObject = (
  tr: Transaction,
  state: EditorState,
  start: number,
): void => {
  const object = tr.doc.nodeAt(start);
  if (!object) return;
  const body: PMNode[] = [];
  object.forEach((child, _offset, index) => {
    if (index > 0 && !isField(child)) body.push(child);
  });
  tr.replaceWith(start, start + object.nodeSize, [
    state.schema.nodes.paragraph!.create(null, object.firstChild!.content),
    ...body,
  ]);
  tr.setSelection(TextSelection.create(tr.doc, start + 1));
};

const ObjectBlock = Node.create({
  name: "objectBlock",
  group: "block",
  content: "objectTitle field* block*",
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
    /** カーソルを包むobjectBlockの深さ。内側から順に。 */
    const objectDepths = ($from: ResolvedPos): number[] => {
      const depths: number[] = [];
      for (let depth = $from.depth; depth > 0; depth--)
        if ($from.node(depth).type.name === "objectBlock") depths.push(depth);
      return depths;
    };
    return {
      // Escで、カーソルを包むObjectをブロックごと選ぶ。選べば⌫で消せ、⌘Xで切り取れる。
      Escape: ({ editor }) => {
        const { selection } = editor.state;
        if (selection instanceof NodeSelection) return false;
        const [depth] = objectDepths(selection.$from);
        if (depth === undefined) return false;
        return editor.commands.setNodeSelection(selection.$from.before(depth));
      },
      // Tanaと同じく、Cmd+↓で開き、Cmd+↑で畳む。Objectの外では既定の動きのまま。
      "Mod-ArrowDown": ({ editor }) => {
        const { $from } = editor.state.selection;
        const [depth] = objectDepths($from);
        if (depth === undefined) return false;
        const object = $from.node(depth);
        if (!object.attrs.collapsed) return true;
        const at = $from.before(depth);
        return editor.commands.command(({ tr, state }) => {
          tr.setNodeAttribute(at, "collapsed", false);
          // 中身が無ければ、開いた時に書ける行を足す。
          if (object.childCount === 1)
            tr.insert(
              at + object.nodeSize - 1,
              state.schema.nodes.paragraph!.create(),
            );
          return true;
        });
      },
      "Mod-ArrowUp": ({ editor }) => {
        const { $from } = editor.state.selection;
        const depth = objectDepths($from).find(
          (candidate) => !$from.node(candidate).attrs.collapsed,
        );
        if (depth === undefined) return objectDepths($from).length > 0;
        const object = $from.node(depth);
        const at = $from.before(depth);
        return editor.commands.command(({ tr }) => {
          tr.setNodeAttribute(at, "collapsed", true);
          // 隠れる行にカーソルを残さず、Titleの末尾へ移す。
          tr.setSelection(
            TextSelection.create(tr.doc, at + object.firstChild!.nodeSize),
          );
          return true;
        });
      },
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
        // リスト項目のObjectなら、次の項目を作る。
        const inItem =
          depth > 0 &&
          $from.node(depth - 1).type.name === "listItem" &&
          $from.index(depth - 1) === 0;
        return editor
          .chain()
          .command(({ tr, state }) => {
            const { paragraph, listItem } = state.schema.nodes;
            const after = inItem ? $from.after(depth - 1) : $from.after(depth);
            if (emptyLast) tr.delete($from.before(), $from.after());
            const pos = tr.mapping.map(after);
            tr.insert(
              pos,
              inItem
                ? listItem!.create(null, paragraph!.create())
                : paragraph!.create(),
            );
            tr.setSelection(
              TextSelection.create(tr.doc, pos + (inItem ? 2 : 1)),
            );
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
            unwrapObject(tr, state, $from.before($from.depth - 1));
            return true;
          })
          .run();
      },
    };
  },
});

/** 種別のタグをTitleの行末に置く。押すと種別のページを開く。 */
const createTags = (host: RefObject<EditorHost>): Extension =>
  Extension.create({
    name: "objectTags",
    addProseMirrorPlugins: () => [
      new Plugin({
        props: {
          decorations: (state) => {
            const tags: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "objectBlock") return;
              const type = String(node.attrs.type);
              tags.push(
                Decoration.widget(
                  pos + node.firstChild!.nodeSize,
                  () => {
                    const tag = document.createElement("button");
                    tag.type = "button";
                    tag.className = "pe-tag";
                    tag.contentEditable = "false";
                    tag.textContent = `#${typeLabel(type)}`;
                    tag.onmousedown = (event) => event.preventDefault();
                    tag.onclick = () => host.current.openType(type);
                    return tag;
                  },
                  { side: 1, key: `tag-${type}`, ignoreSelection: true },
                ),
              );
            });
            return DecorationSet.create(state.doc, tags);
          },
        },
      }),
    ],
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
            (node) => node && isField(node),
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

/** 複数の行を選んで#を打った時に、本文にする範囲を覚えておく。 */
const selectionBody = new PluginKey<{ title: number; end: number } | null>(
  "selectionBody",
);

const SelectionBody = Extension.create({
  name: "selectionBody",
  addProseMirrorPlugins: () => [
    new Plugin<{ title: number; end: number } | null>({
      key: selectionBody,
      state: {
        init: () => null,
        apply(tr, value) {
          const next = tr.getMeta(selectionBody) as
            { title: number; end: number } | undefined;
          if (next) return next;
          if (!value) return null;
          const title = tr.mapping.map(value.title);
          const { $from } = tr.selection;
          // 最初の行から離れたら、選んだ範囲は使わない。
          if ($from.depth < 1 || $from.before() !== title) return null;
          return { title, end: tr.mapping.map(value.end, -1) };
        },
      },
      props: {
        handleTextInput(view, from, to, text) {
          if (text !== "#" || from === to) return false;
          const { doc } = view.state;
          const $from = doc.resolve(from);
          const $to = doc.resolve(to);
          const range = $from.blockRange($to);
          if (
            $from.sameParent($to) ||
            !$from.parent.isTextblock ||
            !range ||
            range.depth !== $from.depth - 1
          )
            return false;
          // 最初の行の末尾に#を打ち、残りの行はObjectの本文にする。
          view.dispatch(
            view.state.tr
              .setSelection(TextSelection.create(doc, $from.end()))
              .insertText("#")
              .setMeta(selectionBody, {
                title: $from.before(),
                end: range.end,
              }),
          );
          return true;
        },
      },
    }),
  ],
});

/** 種別のField行。Contextには置かれた場所から継ぐ値を入れる。 */
const fieldRows = (
  state: EditorState,
  host: EditorHost,
  type: ObjectType,
  $pos: ResolvedPos,
): PMNode[] => {
  const { objectField, objectFieldControl, objectRef } = state.schema.nodes;
  const definition = typeOf(host, type);
  return (
    definition
      ? [...definition.fields, ...definition.inherited]
      : [CONTEXT_FIELD]
  ).map((field) =>
    field.kind === "date" || field.kind === "select"
      ? objectFieldControl!.create({
          fieldId: field.id,
          name: field.name,
          kind: field.kind,
          options: field.options ?? [],
        })
      : objectField!.create(
          { fieldId: field.id, name: field.name },
          field.kind === "context"
            ? inheritedAt($pos, host).flatMap((objectId) => [
                objectRef!.create({ objectId }),
                state.schema.text(" "),
              ])
            : null,
        ),
  );
};

/** 埋め込んだObjectの種別を変える。同じIDのFieldの値は残し、無いFieldの行は捨てる。 */
const changeType = (
  editor: Editor,
  at: number,
  type: ObjectType,
  host: EditorHost,
): void => {
  editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const object = tr.doc.nodeAt(at);
      if (!object || object.type.name !== "objectBlock") return false;
      const old = new Map<string, PMNode>();
      const start = at + 1 + object.firstChild!.nodeSize;
      let end = start;
      object.forEach((child, _offset, index) => {
        if (index === 0 || !isField(child)) return;
        old.set(String(child.attrs.fieldId), child);
        end += child.nodeSize;
      });
      const rows = fieldRows(state, host, type, tr.doc.resolve(at)).map(
        (row) => old.get(String(row.attrs.fieldId)) ?? row,
      );
      tr.replaceWith(start, end, rows);
      tr.setNodeAttribute(at, "type", type);
      return true;
    })
    .run();
};

/** posのブロックの後ろに、新しいObjectを足してTitleへ入る。 */
const embedObject = (
  editor: Editor,
  pos: number,
  objectAt: number | null,
  type: ObjectType,
  host: EditorHost,
): void => {
  const { doc } = editor.state;
  const $pos = doc.resolve(pos);
  const after =
    objectAt !== null
      ? objectAt + doc.nodeAt(objectAt)!.nodeSize
      : $pos.depth > 0
        ? $pos.after($pos.depth)
        : pos;
  editor
    .chain()
    .insertContentAt(after, { type: "paragraph" })
    .setTextSelection(after + 1)
    .run();
  convertBlock(editor, { from: after + 1, to: after + 1 }, type, host);
};

const convertBlock = (
  editor: Editor,
  range: Range,
  type: ObjectType,
  host: EditorHost,
): void => {
  const pending = selectionBody.getState(editor.state);
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .command(({ tr, state }) => {
      const $pos = tr.selection.$from;
      const { objectBlock, objectTitle, paragraph } = state.schema.nodes;
      const target = conversionAt(
        $pos,
        pending && $pos.depth > 0 && pending.title === $pos.before()
          ? tr.mapping.map(pending.end, -1)
          : null,
      );
      if (!target) return false;
      const fields = fieldRows(state, host, type, $pos);
      // Titleが決まっていれば、すぐ本文を書けるように開く。空ならTitleに入る。
      const titled = target.title.size > 0;
      const body =
        titled && !target.body.length
          ? [paragraph!.create()]
          : [...target.body];
      const object = objectBlock!.create(
        { objectId: newId(), type, collapsed: !titled && !body.length },
        [objectTitle!.create(null, target.title), ...fields, ...body],
      );
      const $receiver = tr.doc.resolve(target.from);
      const at = $receiver.index();
      if (
        !$receiver.parent.canReplace(
          at,
          at + target.body.length + 1,
          Fragment.from(object),
        )
      )
        return false;
      tr.replaceWith(target.from, target.to, object);
      // 新しく足した空の本文の行へ、無ければTitleの末尾へ入る。
      const cursor =
        titled && !target.body.length
          ? target.from + object.nodeSize - 2
          : target.from + 1 + target.title.size + 1;
      tr.setSelection(TextSelection.create(tr.doc, cursor));
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
          // Tanaと同じく、文に続けて打った#でも作れるようにする。
          allowedPrefixes: null,
          pluginKey: new PluginKey("hashMenu"),
          items: ({ query }) => hashItems(host.current, query),
          render: render("このBlockをObjectにする"),
        }),
      ];
    },
  });

/* ---------- block menu ---------- */

interface BlockItem {
  readonly key: string;
  readonly label: string;
  readonly run?: () => void;
  /** 選ぶと、この一覧に切り替える。 */
  readonly items?: readonly BlockItem[];
  readonly danger?: boolean;
}

interface BlockMenu {
  readonly x: number;
  readonly y: number;
  /** trueなら、yを下端にして上へ開く（キーボードの上の帯から開いたとき）。 */
  readonly above?: boolean;
  readonly items: readonly BlockItem[];
}

/** 右クリックや「⋯」で出すメニュー。選んでいる文字、Object、場所に合わせて並べる。 */
const blockItems = (
  editor: Editor,
  host: EditorHost,
  pos: number,
  objectAt: number | null,
): BlockItem[] => {
  const { selection } = editor.state;
  if (rangeAt(selection, objectAt ?? pos)) {
    const run = (action: () => boolean): boolean => {
      if (!selection.eq(editor.state.selection)) return false;
      editor.view.focus();
      return action();
    };
    return [
      {
        key: "cut",
        label: "切り取る",
        run: () => run(() => document.execCommand("cut")),
      },
      {
        key: "copy",
        label: "コピー",
        run: () => run(() => document.execCommand("copy")),
      },
      {
        key: "delete",
        label: "選択したブロックを削除（ゴミ箱へ）",
        danger: true,
        run: () => run(() => editor.commands.deleteSelection()),
      },
    ];
  }
  const types = [
    ...CONVERTIBLE,
    ...host
      .types()
      .filter((type) => !type.builtin)
      .map((type) => type.name),
  ];
  const choose = (pick: (type: ObjectType) => void): BlockItem[] =>
    types.map((type) => ({
      key: type,
      label: `#${typeLabel(type)}`,
      run: () => pick(type),
    }));
  const items: BlockItem[] = [];
  const text =
    !selection.empty &&
    selection instanceof TextSelection &&
    pos >= selection.from &&
    pos <= selection.to;
  if (text)
    items.push(
      {
        key: "bold",
        label: "太字",
        run: () => editor.chain().focus().toggleBold().run(),
      },
      {
        key: "italic",
        label: "斜体",
        run: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        key: "strike",
        label: "取り消し線",
        run: () => editor.chain().focus().toggleStrike().run(),
      },
      {
        key: "code",
        label: "コード",
        run: () => editor.chain().focus().toggleCode().run(),
      },
    );
  const object = objectAt === null ? null : editor.state.doc.nodeAt(objectAt);
  if (objectAt !== null && object) {
    const id = String(object.attrs.objectId);
    const select = (): boolean =>
      editor.chain().focus().setNodeSelection(objectAt).run();
    items.push(
      { key: "open", label: "開く", run: () => host.open(id) },
      {
        key: "cut",
        label: "切り取る",
        run: () => select() && document.execCommand("cut"),
      },
      {
        key: "copy",
        label: "コピー",
        run: () => select() && document.execCommand("copy"),
      },
      {
        key: "type",
        label: "種別を変える",
        items: choose((type) => changeType(editor, objectAt, type, host)),
      },
      {
        key: "unwrap",
        label: "Objectを解除",
        run: () =>
          editor
            .chain()
            .focus()
            .command(({ tr, state }) => {
              unwrapObject(tr, state, objectAt);
              return true;
            })
            .run(),
      },
      {
        key: "delete",
        label: "削除（ゴミ箱へ）",
        danger: true,
        run: () => select() && editor.commands.deleteSelection(),
      },
    );
  }
  items.push({
    key: "embed",
    label: "新しいObjectを埋め込む",
    items: choose((type) => embedObject(editor, pos, objectAt, type, host)),
  });
  return items;
};

/* ---------- input bar ---------- */

/** タッチの端末だけで、キーボードのすぐ上に書式のボタンを浮かべる。 */
const InputBar = ({
  editor,
  hidden,
  onMore,
}: {
  readonly editor: Editor | null;
  /** @や#の候補が出ている間は、候補を隠さないよう引っ込める。 */
  readonly hidden: boolean;
  readonly onMore: (x: number, y: number) => void;
}): React.JSX.Element | null => {
  const [place, setPlace] = useState<{
    readonly top: number;
    /** 帯の中央の位置 */
    readonly center: number;
    readonly width: number;
  } | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      !editor ||
      !window.matchMedia("(hover: none) and (pointer: coarse)").matches
    )
      return;
    const viewport = window.visualViewport;
    let frame = 0;
    let scrolling: ReturnType<typeof setTimeout> | undefined;
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (
          scrolling !== undefined ||
          editor.isDestroyed ||
          !editor.view.hasFocus() ||
          editor.state.selection instanceof BlockRangeSelection
        )
          return setPlace(null);
        const width = viewport?.width ?? window.innerWidth;
        const bottom =
          (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
        setPlace({
          top: bottom - (bar.current?.offsetHeight ?? 46) - 8,
          center: (viewport?.offsetLeft ?? 0) + width / 2,
          width: width - 24,
        });
      });
    };
    // スクロールしている間は隠し、止まってから出し直す。
    const scroll = (): void => {
      clearTimeout(scrolling);
      setPlace(null);
      scrolling = setTimeout(() => {
        scrolling = undefined;
        update();
      }, 200);
    };
    editor.on("selectionUpdate", update);
    // エディタの外へ移ったときも閉じられるよう、ページのフォーカスを見る。
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", scroll);
    window.addEventListener("scroll", scroll, true);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(scrolling);
      window.removeEventListener("scroll", scroll, true);
      editor.off("selectionUpdate", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", scroll);
    };
  }, [editor]);
  if (!editor || !place || hidden) return null;
  const buttons: readonly [string, string, () => void, string?][] = [
    ["太字", "B", () => editor.chain().focus().toggleBold().run(), "bold"],
    ["斜体", "I", () => editor.chain().focus().toggleItalic().run(), "italic"],
    [
      "取り消し線",
      "S",
      () => editor.chain().focus().toggleStrike().run(),
      "strike",
    ],
    [
      "インデントを減らす",
      "←",
      () => editor.chain().focus().liftListItem("listItem").run(),
    ],
    [
      "インデントを増やす",
      "→",
      () => editor.chain().focus().sinkListItem("listItem").run(),
    ],
    [
      "その他の操作",
      "＋",
      () => {
        const rect = bar.current?.getBoundingClientRect();
        onMore(rect?.left ?? 12, (rect?.top ?? 0) - 8);
      },
    ],
    ["キーボードを閉じる", "⌄", () => editor.commands.blur()],
  ];
  return (
    <div
      ref={bar}
      className="pe-input-bar"
      role="toolbar"
      aria-label="本文の書式"
      style={{
        top: place.top,
        left: place.center,
        maxWidth: place.width,
        transform: "translateX(-50%)",
      }}
    >
      {buttons.map(([label, text, run, mark]) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={mark ? editor.isActive(mark) : undefined}
          // キーボードとカーソルを残したまま押せるようにする。
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (editor.view.composing) return;
            run();
          }}
        >
          {text}
        </button>
      ))}
    </div>
  );
};

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
  const [blockMenu, setBlockMenu] = useState<BlockMenu | null>(null);
  const blockMenuRef = useRef<HTMLDivElement>(null);
  // 実際の大きさを測って、押した位置から画面の内側へ開く。下に入らなければ上へ開く。
  useLayoutEffect(() => {
    const element = blockMenuRef.current;
    if (!element || !blockMenu || blockMenu.above) return;
    const { width, height } = element.getBoundingClientRect();
    const left =
      blockMenu.x + width > window.innerWidth - 8
        ? blockMenu.x - width
        : blockMenu.x;
    const top =
      blockMenu.y + height > window.innerHeight - 8
        ? blockMenu.y - height
        : blockMenu.y;
    element.style.left = `${Math.max(8, left)}px`;
    element.style.top = `${Math.max(8, top)}px`;
  }, [blockMenu]);
  const editorRef = useRef<Editor | null>(null);
  const [openBlockMenu] = useState(
    () =>
      (
        pos: number,
        x: number,
        y: number,
        objectAt?: number,
        above = false,
      ): void => {
        const current = editorRef.current;
        if (!current) return;
        let at = objectAt ?? null;
        const $pos = current.state.doc.resolve(pos);
        for (let depth = $pos.depth; at === null && depth > 0; depth--)
          if ($pos.node(depth).type.name === "objectBlock")
            at = $pos.before(depth);
        setBlockMenu({
          x,
          y,
          above,
          items: blockItems(current, hostRef.current, pos, at),
        });
      },
  );
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
      StarterKit.configure({ document: false, listItem: false }),
      // リスト項目もObjectにできるよう、項目の先頭にObjectを置けるようにする。
      ListItem.extend({ content: "(paragraph | objectBlock) block*" }),
      Document,
      UniqueID.configure({
        types: ["paragraph", "heading", "listItem", "objectBlock"],
        generateID: () => newId(),
      }),
      ObjectRef,
      ObjectTitle,
      ObjectField,
      ObjectFieldControl,
      ObjectBlock,
      BlockSelection,
      CollapsedGuard,
      SelectionBody,
      createTags(hostRef),
      createMenus(bridge, hostRef),
    ],
    content: initialDoc as JSONContent,
    editorProps: {
      attributes: { "aria-label": ariaLabel },
      handleDOMEvents: {
        contextmenu: (view, event) => {
          const found = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          if (!found) return false;
          event.preventDefault();
          openBlockMenu(found.pos, event.clientX, event.clientY);
          return true;
        },
      },
    },
    onUpdate: ({ editor: updated }) =>
      latest.current.onChange(updated.getJSON() as DocNode),
  });

  editorRef.current = editor;

  // 画面外でメニューが残らないよう、エディタを離れたら閉じる。
  useEffect(() => () => setMenu(null), []);
  // メニューの外を押すか、Escで閉じる。
  useEffect(() => {
    if (!blockMenu) return;
    const close = (event: Event): void => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !(event.target as Element).closest?.(".pe-block-menu")
      )
        setBlockMenu(null);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [blockMenu]);

  const index = Math.min(active, Math.max((menu?.items.length ?? 1) - 1, 0));
  return (
    <HostContext.Provider value={host}>
      <BlockMenuContext.Provider value={openBlockMenu}>
        <EditorContent className="pe-editor" editor={editor} />
      </BlockMenuContext.Provider>
      <InputBar
        editor={editor}
        hidden={menu !== null}
        onMore={(x, y) => {
          if (editor)
            openBlockMenu(editor.state.selection.from, x, y, undefined, true);
        }}
      />
      {blockMenu ? (
        <div
          ref={blockMenuRef}
          className="pe-menu pe-block-menu"
          role="menu"
          style={{
            left: Math.max(8, Math.min(blockMenu.x, window.innerWidth - 228)),
            ...(blockMenu.above
              ? { bottom: window.innerHeight - blockMenu.y }
              : { top: blockMenu.y }),
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {blockMenu.items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              data-danger={item.danger}
              onClick={() => {
                if (item.items)
                  return setBlockMenu({ ...blockMenu, items: item.items });
                setBlockMenu(null);
                item.run?.();
              }}
            >
              {item.label}
              {item.items ? <span aria-hidden="true">›</span> : null}
            </button>
          ))}
        </div>
      ) : null}
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
