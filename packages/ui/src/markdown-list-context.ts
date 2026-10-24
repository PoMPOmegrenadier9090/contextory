import { syntaxTree } from "@codemirror/language";
import { countColumn, type EditorState, type Line } from "@codemirror/state";

type MarkdownNode = ReturnType<typeof syntaxTree>["topNode"];
export interface MarkdownListLine {
  readonly line: Line;
  readonly item: MarkdownNode;
  readonly mark: MarkdownNode;
  readonly task: MarkdownNode | null;
  readonly contentFrom: number;
  readonly leading: string;
  readonly marker: string;
  readonly continuationPrefix: string;
}

// Read structural whitespace from the parsed item, rather than requiring an
// exact spelling such as "- ". Tabs and additional spaces are valid Markdown.
export const markdownListLine = (
  state: EditorState,
  position: number,
  continuation = false,
): MarkdownListLine | null => {
  const line = state.doc.lineAt(position);
  let node = syntaxTree(state).resolveInner(position, -1);
  for (
    let ancestor: MarkdownNode | null = node;
    ancestor;
    ancestor = ancestor.parent
  ) {
    if (["FencedCode", "CodeBlock", "HTMLBlock"].includes(ancestor.name))
      return null;
  }
  while (node.name !== "ListItem" && node.parent) node = node.parent;
  if (
    continuation &&
    node.name !== "ListItem" &&
    !line.text.trim() &&
    line.number > 1
  ) {
    node = syntaxTree(state).resolveInner(
      state.doc.line(line.number - 1).to,
      -1,
    );
    while (node.name !== "ListItem" && node.parent) node = node.parent;
    const previousMark = node.getChild("ListMark");
    if (!previousMark) return null;
    const previousLine = state.doc.lineAt(previousMark.from);
    const required = countColumn(
      state.doc.sliceString(previousLine.from, previousMark.to) + " ",
      state.tabSize,
    );
    if (countColumn(line.text, state.tabSize) < required) return null;
  }
  const mark = node.name === "ListItem" ? node.getChild("ListMark") : null;
  if (
    !mark ||
    (!continuation && state.doc.lineAt(mark.from).number !== line.number)
  )
    return null;
  const markerLine = state.doc.lineAt(mark.from);
  // Wait for a separator before treating a bare marker as an editable list.
  if (!/^[ \t]/.test(state.doc.sliceString(mark.to, markerLine.to)))
    return null;
  const task = node.getChild("Task")?.getChild("TaskMarker") ?? null;
  const end = task?.to ?? mark.to;
  const spacing =
    state.doc.sliceString(end, line.to).match(/^[ \t]*/)?.[0] ?? "";
  const leading = state.doc.sliceString(markerLine.from, mark.from);
  const marker = state.doc.sliceString(mark.from, mark.to);
  const separator =
    state.doc.sliceString(mark.to, markerLine.to).match(/^[ \t]*/)?.[0] || " ";
  const markerColumn = countColumn(leading + marker, state.tabSize);
  const contentColumn = countColumn(
    leading + marker + separator,
    state.tabSize,
  );
  const indentColumn =
    contentColumn - markerColumn > 4 ? markerColumn + 1 : contentColumn;
  return {
    line,
    item: node,
    mark,
    task,
    contentFrom:
      markerLine.number === line.number
        ? end + spacing.length
        : line.from + (line.text.match(/^[ \t]*(?:>[ \t]*)*/)?.[0].length ?? 0),
    leading,
    marker,
    continuationPrefix:
      leading + " ".repeat(indentColumn - countColumn(leading, state.tabSize)),
  };
};
