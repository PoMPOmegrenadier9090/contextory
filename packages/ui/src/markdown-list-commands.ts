import {
  countColumn,
  EditorSelection,
  type StateCommand,
  type ChangeSpec,
  type EditorState,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { markdownListLine } from "./markdown-list-context.js";
import { orderedListMarkers } from "./markdown-ordered-lists.js";

type ListLine = NonNullable<ReturnType<typeof markdownListLine>>;

export const setMarkdownChecklist =
  (enabled: boolean): StateCommand =>
  ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const position = state.selection.main.head;
    for (let node = syntaxTree(state).resolveInner(position, -1); ;) {
      if (["FencedCode", "CodeBlock", "HTMLBlock", "Table"].includes(node.name))
        return false;
      if (!node.parent) break;
      node = node.parent;
    }
    const line = state.doc.lineAt(position);
    const context = markdownListLine(state, line.to);
    if (enabled === Boolean(context?.task)) return true;
    const from =
      context?.mark.from ??
      line.from + (line.text.match(/^[ \t]*/)?.[0].length ?? 0);
    const to = context?.contentFrom ?? from;
    const insert = enabled ? `${context?.marker ?? "-"} [ ] ` : "";
    const changes = state.changes({ from, to, insert });
    const mapPosition = (position: number) =>
      position < from
        ? position
        : Math.max(from + insert.length, changes.mapPos(position, 1));
    dispatch(
      state.update({
        changes,
        selection: EditorSelection.create(
          state.selection.ranges.map((range) =>
            EditorSelection.range(
              mapPosition(range.anchor),
              mapPosition(range.head),
            ),
          ),
          state.selection.mainIndex,
        ),
        scrollIntoView: true,
        userEvent: "input.checklist",
      }),
    );
    return true;
  };

const nextPrefix = (state: EditorState, context: ListLine): string => {
  const number = orderedListMarkers(state).get(context.mark.from)?.number;
  const marker =
    number === undefined
      ? context.marker
      : `${number + 1}${context.marker.at(-1)}`;
  return `${context.leading}${marker} ${context.task ? "[ ] " : ""}`;
};

const renumberFollowing = (
  state: EditorState,
  context: ListLine,
): ChangeSpec[] => {
  if (context.item.parent?.name !== "OrderedList") return [];
  const markers = orderedListMarkers(state);
  const changes: ChangeSpec[] = [];
  for (let item = context.item.nextSibling; item; item = item.nextSibling) {
    const mark = item.getChild("ListMark");
    const number = mark && markers.get(mark.from)?.number;
    if (mark && number != null)
      changes.push({
        from: mark.from,
        to: mark.to - 1,
        insert: String(number + 1),
      });
  }
  return changes;
};

// Enter behaves like a block editor: empty items exit one level immediately,
// and new items always have one separator regardless of the source spacing.
export const continueMarkdownList: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const contexts = state.selection.ranges.map((range) =>
    markdownListLine(state, range.from, true),
  );
  if (contexts.some((context) => context === null)) return false;
  if (
    state.selection.ranges.some(
      (range, index) => range.to > contexts[index]!.line.to,
    )
  )
    return false;
  const changes = state.changeByRange((range) => {
    const context = markdownListLine(state, range.from, true)!;
    const { line, contentFrom } = context;
    if (range.from < contentFrom) return { range };
    if (
      range.empty &&
      state.doc.lineAt(context.mark.from).number === line.number &&
      !state.doc.sliceString(contentFrom, line.to).trim()
    ) {
      const parent = context.item.parent?.parent;
      const parentMark =
        parent?.name === "ListItem" ? parent.getChild("ListMark") : null;
      const outer = parentMark && markdownListLine(state, parentMark.to);
      const insert = outer
        ? nextPrefix(state, outer)
        : context.leading.replace(/[ \t]+$/, "");
      return {
        changes: [
          { from: line.from, to: line.to, insert },
          ...(outer ? renumberFollowing(state, outer) : []),
        ],
        range: EditorSelection.cursor(line.from + insert.length),
      };
    }
    let from = range.from;
    while (
      from > contentFrom &&
      /[ \t]/.test(state.doc.sliceString(from - 1, from))
    )
      from--;
    const insert = state.lineBreak + nextPrefix(state, context);
    return {
      changes: [
        { from, to: range.to, insert },
        ...renumberFollowing(state, context),
      ],
      range: EditorSelection.cursor(from + insert.length),
    };
  });
  // Let the standard command handle an explicit cursor inside source markup.
  if (
    state.selection.ranges.some(
      (range, index) => range.from < contexts[index]!.contentFrom,
    )
  )
    return false;
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

export const breakMarkdownListLine: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  if (
    state.selection.ranges.some((range) => {
      const context = markdownListLine(state, range.from, true);
      return !context || range.from < context.contentFrom;
    })
  )
    return false;
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const context = markdownListLine(state, range.from, true)!;
        const insert = state.lineBreak + context.continuationPrefix;
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.cursor(range.from + insert.length),
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    ),
  );
  return true;
};

export const deleteMarkdownListBackward: StateCommand = (target) => {
  const { state, dispatch } = target;
  if (
    state.readOnly ||
    state.selection.ranges.some((range) => {
      const context = markdownListLine(state, range.head);
      return !range.empty || !context || range.head !== context.contentFrom;
    })
  )
    return false;
  const contexts = state.selection.ranges.map((range) =>
    markdownListLine(state, range.head)!,
  );
  if (
    contexts.every(
      (context) => context.item.parent?.parent?.name === "ListItem",
    )
  )
    return outdentMarkdownList(target);
  if (
    contexts.some((context) => context.item.parent?.parent?.name === "ListItem")
  )
    return false;
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const context = markdownListLine(state, range.head)!;
        const insert = context.leading.replace(/[ \t]+$/, "");
        return {
          changes: { from: context.line.from, to: context.contentFrom, insert },
          range: EditorSelection.cursor(context.line.from + insert.length),
        };
      }),
      { scrollIntoView: true, userEvent: "delete" },
    ),
  );
  return true;
};

// A Markdown child list must reach its parent's content column. Two spaces
// alone leave numbered items at the same level (or turn them into plain text).
export const changeListIndent =
  (outdent: boolean): StateCommand =>
  ({ state, dispatch }) => {
    if (state.readOnly) return false;
    const tree = syntaxTree(state);
    type Node = typeof tree.topNode;
    const items = new Map<number, Node>();
    for (const range of state.selection.ranges) {
      const last = state.doc.lineAt(range.to);
      const end =
        range.to > range.from && range.to === last.from
          ? last.number - 1
          : last.number;
      for (
        let number = state.doc.lineAt(range.from).number;
        number <= end;
        number++
      ) {
        const line = state.doc.line(number);
        let ancestor = tree.resolveInner(line.to, -1);
        while (ancestor.parent && !items.has(ancestor.from))
          ancestor = ancestor.parent;
        if (ancestor.name === "ListItem" && items.has(ancestor.from)) continue;
        if (!line.text.trim() && items.size > 0) continue;
        const continuation = markdownListLine(state, line.to, true);
        if (continuation) {
          items.set(continuation.item.from, continuation.item);
          continue;
        }
        const prefix = /^[ \t]*(?:\d{1,9}[.)]|[-*+])(?:[ \t]+|$)/.exec(
          line.text,
        );
        if (!prefix) return false;
        let node: Node | null = tree.resolveInner(
          line.from + prefix[0].trimEnd().length,
          -1,
        );
        while (node && node.name !== "ListItem") node = node.parent;
        const mark = node?.getChild("ListMark");
        if (!node || !mark || state.doc.lineAt(mark.from).number !== number)
          return false;
        items.set(node.from, node);
      }
    }
    const roots = [...items.values()]
      .filter((item) => {
        for (let parent = item.parent; parent; parent = parent.parent)
          if (items.has(parent.from) && parent.name === "ListItem")
            return false;
        return true;
      })
      .sort((a, b) => a.from - b.from);
    const first = roots[0];
    const list = first?.parent;
    if (
      !first ||
      !list ||
      roots.some((item) => item.parent?.from !== list.from)
    )
      return false;
    for (let index = 1; index < roots.length; index++)
      if (roots[index - 1]?.nextSibling?.from !== roots[index]?.from)
        return false;

    const mark = first.getChild("ListMark")!;
    const line = state.doc.lineAt(mark.from);
    const leading = state.doc.sliceString(line.from, mark.from);
    if (!/^[ \t]*$/.test(leading)) return false;
    const currentIndent = countColumn(leading, state.tabSize);
    const previousList = list.prevSibling;
    const previousItem =
      previousList && ["OrderedList", "BulletList"].includes(previousList.name)
        ? previousList.getChildren("ListItem").at(-1)
        : null;
    const parent = outdent ? list.parent : (first.prevSibling ?? previousItem);
    if (!parent || parent.name !== "ListItem") return true;
    const parentMark = parent.getChild("ListMark")!;
    const parentLine = state.doc.lineAt(parentMark.from);
    const parentLeading = state.doc.sliceString(
      parentLine.from,
      parentMark.from,
    );
    if (!/^[ \t]*$/.test(parentLeading)) return false;
    const spacing =
      state.doc
        .sliceString(parentMark.to, parentLine.to)
        .match(/^[ \t]+/)?.[0] ?? " ";
    const targetIndent = outdent
      ? countColumn(parentLeading, state.tabSize)
      : countColumn(
          parentLeading +
            state.doc.sliceString(parentMark.from, parentMark.to) +
            (spacing.length > 4 ? " " : spacing),
          state.tabSize,
        );
    const delta = targetIndent - currentIndent;
    const changes: ChangeSpec[] = [];
    for (const item of roots) {
      const start = state.doc.lineAt(item.from).number;
      const end = state.doc.lineAt(item.to).number;
      for (let number = start; number <= end; number++) {
        const itemLine = state.doc.line(number);
        const whitespace = /^[ \t]*/.exec(itemLine.text)![0];
        if (!itemLine.text.trim()) continue;
        changes.push({
          from: itemLine.from,
          to: itemLine.from + whitespace.length,
          insert: " ".repeat(
            Math.max(0, countColumn(whitespace, state.tabSize) + delta),
          ),
        });
      }
    }
    // A fresh nested sequence starts at 1, which also lets it interrupt the
    // preceding item's paragraph under CommonMark's rules.
    if (!outdent && list.name === "OrderedList")
      changes.push({ from: mark.from, to: mark.to - 1, insert: "1" });

    const moved = state.changes(changes);
    const intermediate = state.update({
      changes: moved,
      selection: state.selection.map(moved),
    }).state;
    let outer = list;
    for (let ancestor = list.parent; ancestor; ancestor = ancestor.parent)
      if (["OrderedList", "BulletList"].includes(ancestor.name))
        outer = ancestor;
    const from = moved.mapPos(outer.from, -1);
    const to = moved.mapPos(outer.to, 1);
    const numbering: ChangeSpec[] = [];
    syntaxTree(intermediate).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "OrderedList") return;
        const siblings = node.node.getChildren("ListItem");
        const firstMark = siblings[0]?.getChild("ListMark");
        if (!firstMark) return;
        const start =
          node.node.parent?.name === "ListItem"
            ? 1
            : Number.parseInt(
                intermediate.doc.sliceString(firstMark.from, firstMark.to),
                10,
              );
        siblings.forEach((item, index) => {
          const itemMark = item.getChild("ListMark");
          if (!itemMark) return;
          const number = String(start + index);
          if (
            intermediate.doc.sliceString(itemMark.from, itemMark.to - 1) !==
            number
          )
            numbering.push({
              from: itemMark.from,
              to: itemMark.to - 1,
              insert: number,
            });
        });
      },
    });
    const renumbered = intermediate.changes(numbering);
    dispatch(
      state.update({
        changes: moved.compose(renumbered),
        selection: intermediate.selection.map(renumbered),
        scrollIntoView: true,
        userEvent: "input.indent",
      }),
    );
    return true;
  };

export const indentMarkdownList = changeListIndent(false);
export const outdentMarkdownList = changeListIndent(true);

// An empty visual list item has one structural separator. Typing additional
// spaces there must not accidentally turn its eventual content into a code
// block (CommonMark switches interpretation after four spaces).
export const normalizeMarkdownListInput = (
  state: EditorState,
  from: number,
  to: number,
  text: string,
) => {
  if (state.readOnly || from !== to || text.includes("\n")) return null;
  const context = markdownListLine(state, from);
  if (
    !context ||
    from !== context.contentFrom ||
    state.doc.sliceString(from, context.line.to).trim()
  )
    return null;
  const task = context.task
    ? state.doc.sliceString(context.task.from, context.task.to) + " "
    : "";
  const prefix = `${context.leading}${context.marker} ${task}`;
  if (
    !/^[ \t]+$/.test(text) &&
    state.doc.sliceString(context.line.from, from) === prefix
  )
    return null;
  return {
    from: context.line.from,
    to: from,
    insert: prefix + (/^[ \t]+$/.test(text) ? "" : text),
  };
};

// A new marker at the content boundary replaces the item's current type.
// Escaped markers remain available as literal text.
export const repeatedMarkdownListMarker = (
  state: EditorState,
  from: number,
  to: number,
  text: string,
) => {
  if (state.readOnly || from !== to || text.includes("\n")) return null;
  const line = state.doc.lineAt(from);
  const source = state.doc.sliceString(line.from, from) + text;
  const repeated =
    /^([ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)([-*+]|\d{1,9}[.)]|\[(?:[ xX])?\])[ \t]+$/.exec(
      source,
    );
  const context = markdownListLine(
    state,
    line.from + (repeated?.[1]?.length ?? 0),
  );
  if (!repeated || !context) return null;
  const marker = repeated[2]!;
  const replacement =
    marker === "[]" ? "- [ ]" : marker.startsWith("[") ? `- ${marker}` : marker;
  let insert = `${context.leading}${replacement} `;
  const proposed = state.update({
    changes: { from: line.from, to: from, insert },
  }).state;
  if (!markdownListLine(proposed, line.from + insert.length))
    insert = "\n" + insert;
  return {
    from: line.from,
    to: from,
    insert,
  };
};

// Empty items cannot interrupt a paragraph. Separate a newly typed marker so
// it becomes a list immediately, including when changing the list's type.
export const markdownListShortcut = (
  state: EditorState,
  from: number,
  to: number,
  text: string,
): { from: number; to: number; insert: string } | null => {
  if (state.readOnly || !/^[ \t]$/.test(text) || from !== to) return null;
  const line = state.doc.lineAt(from);
  if (
    !/^[ \t]*(?:\d{1,9}[.)]|[-*+])$/.test(
      state.doc.sliceString(line.from, from),
    )
  )
    return null;
  for (
    let node = syntaxTree(state).resolveInner(from, -1);
    ;
    node = node.parent!
  ) {
    if (
      ["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock"].includes(node.name)
    )
      return null;
    if (!node.parent) break;
  }
  const proposed = state.update({ changes: { from, insert: text } }).state;
  let recognized = false;
  syntaxTree(proposed).iterate({
    from: line.from,
    to: from,
    enter: (node) => {
      if (
        node.name === "ListMark" &&
        proposed.doc.lineAt(node.from).from === line.from
      )
        recognized = true;
    },
  });
  if (recognized) return null;
  return {
    from: line.from,
    to: from,
    insert: `\n${state.doc.sliceString(line.from, from)}${text}`,
  };
};

export const orderedListShortcut = (
  state: EditorState,
  from: number,
  to: number,
  text: string,
) =>
  /^[ \t]*\d{1,9}[.)]$/.test(
    state.doc.sliceString(state.doc.lineAt(from).from, from),
  )
    ? markdownListShortcut(state, from, to, text)
    : null;
