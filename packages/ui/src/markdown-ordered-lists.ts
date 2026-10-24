import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

// Markdown numbering uses the first item's number and counts direct siblings;
// nested lists start their own sequence. Never modify the stored source.
export const orderedListMarkers = (state: EditorState) => {
  const markers = new Map<number, { number: number; to: number }>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "OrderedList") return;
      const items = node.node.getChildren("ListItem");
      const first = items[0]?.getChild("ListMark");
      if (!first) return;
      const start = Number.parseInt(
        state.doc.sliceString(first.from, first.to),
        10,
      );
      items.forEach((item, index) => {
        const mark = item.getChild("ListMark");
        if (!mark) return;
        const line = state.doc.lineAt(mark.from);
        const whitespace =
          state.doc.sliceString(mark.to, line.to).match(/^[ \t]*/)?.[0]
            .length ?? 0;
        markers.set(mark.from, {
          number: start + index,
          to: mark.to + whitespace,
        });
      });
    },
  });
  return markers;
};
