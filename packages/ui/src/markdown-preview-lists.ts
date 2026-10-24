import type { Root, RootContent } from "mdast";
import type { Plugin } from "unified";

// Lezer treats an indented, single hyphen as an empty nested list item.
// Match that interpretation instead of turning the preceding text into a heading.
export const remarkPreviewLists: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file.value);
  const visit = (parent: Root | RootContent) => {
    if (!("children" in parent)) return;
    for (const [index, child] of parent.children.entries()) {
      if (
        parent.type === "listItem" &&
        child.type === "heading" &&
        child.depth === 2
      ) {
        const end = child.position?.end.offset;
        const start = child.position?.start.offset;
        if (start !== undefined && end !== undefined) {
          const text = source.slice(start, end);
          const newline = text.lastIndexOf("\n");
          if (newline >= 0 && /^[ \t]+-[ \t]*$/.test(text.slice(newline + 1))) {
            parent.children.splice(
              index,
              1,
              { type: "paragraph", children: child.children },
              {
                type: "list",
                ordered: false,
                spread: false,
                children: [{ type: "listItem", spread: false, children: [] }],
              },
            );
          }
        }
      }
      visit(child);
    }
  };
  visit(tree);
};
