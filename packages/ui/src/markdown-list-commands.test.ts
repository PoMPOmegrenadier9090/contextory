import { describe, expect, it } from "vitest";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { undo, redo } from "@codemirror/commands";
import { type StateCommand, type Transaction } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  createMarkdownBodyEditorState,
  MarkdownPresentation,
} from "./markdown-live-editor.js";
import {
  indentMarkdownList,
  outdentMarkdownList,
  orderedListShortcut,
  setMarkdownChecklist,
} from "./markdown-list-commands.js";
import { orderedListMarkers } from "./markdown-ordered-lists.js";
import { keymap } from "@codemirror/view";
import { acceptCompletion } from "@codemirror/autocomplete";
import { writeAfterTable } from "./markdown-table-preview.js";
import { enterCodeBlock } from "./markdown-code-editor.js";
import { insertMarkdownMathNewline } from "./markdown-math-editor.js";
import {
  continueMarkdownList,
  deleteMarkdownListBackward,
  breakMarkdownListLine,
  markdownListShortcut,
  normalizeMarkdownListInput,
  repeatedMarkdownListMarker,
} from "./markdown-list-commands.js";

const editor = (source: string, anchor = source.length, head = anchor) => {
  let state = createMarkdownBodyEditorState(source).update({
    selection: { anchor, head },
  }).state;
  return {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
    run(command: StateCommand) {
      expect(command(this)).toBe(true);
    },
    select(text: string) {
      state = state.update({
        selection: { anchor: state.doc.toString().indexOf(text) + text.length },
      }).state;
    },
  };
};

describe("Current-line checklist conversion", () => {
  it("converts the caret's line, retaining its text and position", () => {
    const target = editor("前文\n現在の行\n後文", 5);
    target.run(setMarkdownChecklist(true));
    expect(target.state.doc.toString()).toBe("前文\n- [ ] 現在の行\n後文");
    expect(target.state.selection.main.head).toBe(11);
    target.run(undo);
    expect(target.state.doc.toString()).toBe("前文\n現在の行\n後文");
  });
  it("preserves ordered markers and nesting, and removes only the current checklist", () => {
    const target = editor("- parent\n  1. child\n  2. next", 16);
    target.run(setMarkdownChecklist(true));
    expect(target.state.doc.toString()).toBe(
      "- parent\n  1. [ ] child\n  2. next",
    );
    target.run(setMarkdownChecklist(false));
    expect(target.state.doc.toString()).toBe("- parent\n  child\n  2. next");
  });
  it("handles an empty line and leaves an existing completed item unchanged", () => {
    const empty = editor("");
    empty.run(setMarkdownChecklist(true));
    expect(empty.state.selection.main.head).toBe(6);
    empty.run(setMarkdownChecklist(false));
    expect(empty.state.doc.toString()).toBe("");
    const done = editor("- [x] done");
    done.run(setMarkdownChecklist(true));
    expect(done.state.doc.toString()).toBe("- [x] done");
  });
  it("does not rewrite fenced code or table source", () => {
    for (const source of ["```\ncode\n```", "| A |\n| --- |\n| a |"]) {
      const target = editor(source, 8);
      expect(setMarkdownChecklist(true)(target)).toBe(false);
      expect(target.state.doc.toString()).toBe(source);
    }
  });
});

describe("Markdown list indentation", () => {
  it("nests a numbered list under a preceding bullet item", () => {
    const target = editor("- parent\n\n1. child");
    target.run(indentMarkdownList);
    expect(target.state.doc.toString()).toBe("- parent\n\n  1. child");
    expect(
      syntaxTree(target.state)
        .topNode.getChild("BulletList")
        ?.getChild("ListItem")
        ?.getChild("OrderedList"),
    ).toBeTruthy();
    target.run(outdentMarkdownList);
    expect(target.state.doc.toString()).toBe("- parent\n\n1. child");
  });
  it("starts nested numbering at one and resumes the parent sequence", () => {
    const target = editor("1. parent");
    target.run(insertNewlineContinueMarkup);
    target.run(indentMarkdownList);
    expect(target.state.doc.toString()).toBe("1. parent\n   1. ");
    target.dispatch(
      target.state.update({
        changes: { from: target.state.doc.length, insert: "child" },
        selection: { anchor: target.state.doc.length + 5 },
      }),
    );
    target.run(insertNewlineContinueMarkup);
    expect(target.state.doc.toString()).toBe("1. parent\n   1. child\n   2. ");
    target.run(outdentMarkdownList);
    expect(target.state.doc.toString()).toBe("1. parent\n   1. child\n2. ");
    target.dispatch(
      target.state.update({
        changes: { from: target.state.doc.length, insert: "next" },
        selection: { anchor: target.state.doc.length + 4 },
      }),
    );
    target.run(insertNewlineContinueMarkup);
    expect(target.state.doc.toString()).toBe(
      "1. parent\n   1. child\n2. next\n3. ",
    );
  });

  it("renumbers both lists when moving an existing item and supports undo", () => {
    const source = "1. first\n2. second\n3. third";
    const target = editor(source, source.indexOf("second") + 3);
    target.run(indentMarkdownList);
    expect(target.state.doc.toString()).toBe(
      "1. first\n   1. second\n2. third",
    );
    expect(
      target.state.doc.sliceString(
        target.state.selection.main.head - 3,
        target.state.selection.main.head,
      ),
    ).toBe("sec");
    target.run(undo);
    expect(target.state.doc.toString()).toBe(source);
    target.run(redo);
    target.run(outdentMarkdownList);
    expect(target.state.doc.toString()).toBe(source);
  });

  it("moves descendants with their parent and handles multiple selected siblings", () => {
    const source = "1. first\n2. second\n   1. child\n3. third\n4. fourth";
    const target = editor(
      source,
      source.indexOf("2. second"),
      source.indexOf("4. fourth"),
    );
    target.run(indentMarkdownList);
    expect(target.state.doc.toString()).toBe(
      "1. first\n   1. second\n      1. child\n   2. third\n2. fourth",
    );
    target.run(outdentMarkdownList);
    expect(target.state.doc.toString()).toBe(source);
  });

  it("uses the actual parent marker width for double-digit numbers", () => {
    const target = editor("10. first\n11. second");
    target.run(indentMarkdownList);
    expect(target.state.doc.toString()).toBe("10. first\n    1. second");
    target.run(outdentMarkdownList);
    expect(target.state.doc.toString()).toBe("10. first\n11. second");
  });

  it("keeps bullet and task items working and ignores code and normal text", () => {
    for (const [source, nested] of [
      ["- parent\n- child", "- parent\n  - child"],
      ["- [ ] parent\n- [x] child", "- [ ] parent\n  - [x] child"],
    ]) {
      const target = editor(source!);
      target.run(indentMarkdownList);
      expect(target.state.doc.toString()).toBe(nested);
      target.run(outdentMarkdownList);
      expect(target.state.doc.toString()).toBe(source);
    }
    for (const source of ["plain text", "```md\n1. code\n```", "    1. code"]) {
      const target = editor(
        source,
        source.indexOf("code") < 0 ? source.length : source.indexOf("code"),
      );
      expect(indentMarkdownList(target)).toBe(false);
      expect(target.state.doc.toString()).toBe(source);
    }
  });

  it("starts each deeper level at one and resets the remaining nested siblings", () => {
    const target = editor("1. parent\n   1. first\n   2. second\n   3. third");
    target.select("second");
    target.run(indentMarkdownList);
    expect(target.state.doc.toString()).toBe(
      "1. parent\n   1. first\n      1. second\n   2. third",
    );
    target.run(outdentMarkdownList);
    target.select("first");
    target.run(outdentMarkdownList);
    expect(target.state.doc.toString()).toBe(
      "1. parent\n2. first\n   1. second\n   2. third",
    );
  });
});

describe("Markdown block editing", () => {
  it("keeps existing content when switching a task item to a numbered item", () => {
    const target = editor("- [ ] 1.本文", 8);
    const change = repeatedMarkdownListMarker(target.state, 8, 8, " ");
    expect(change).not.toBeNull();
    target.dispatch(target.state.update({ changes: change! }));
    expect(target.state.doc.toString()).toBe("1. 本文");
  });

  it.each(["- ", "* ", "+ ", "1. ", "- [ ] ", "1. [x] ", "- parent\n  - "])(
    "replaces an item's type with the newly typed marker: %j",
    (prefix) => {
      for (const marker of ["-", "*", "+", "1.", "[]", "[ ]"]) {
        const target = editor(prefix + marker);
        const pos = target.state.doc.length;
        const change = repeatedMarkdownListMarker(target.state, pos, pos, " ");
        expect(change).not.toBeNull();
        target.dispatch(target.state.update({ changes: change! }));
        const leading = prefix.startsWith("- parent") ? "- parent\n  " : "";
        expect(target.state.doc.toString()).toBe(
          leading.replace("\n", marker === "1." ? "\n\n" : "\n") +
            (marker.startsWith("[") ? "- [ ]" : marker) +
            " ",
        );
        target.run(undo);
        expect(target.state.doc.toString()).toBe(prefix + marker);
      }
    },
  );

  it.each([
    "text -",
    "- text -",
    "```md\n- -",
    "    - -",
    "- \\-",
    "- [ ] \\-",
  ])("preserves literal and code markers: %j", (source) => {
    const target = editor(source);
    expect(
      repeatedMarkdownListMarker(
        target.state,
        source.length,
        source.length,
        " ",
      ),
    ).toBeNull();
  });

  it("indents an item selected from its continuation, including child blocks", () => {
    const source =
      "- first\n- second\n  continuation\n\n  ```\n  code\n  ```\n- next";
    const target = editor(
      source,
      source.indexOf("continuation"),
      source.indexOf("- next"),
    );
    target.run(indentMarkdownList);
    expect(target.state.doc.toString()).toBe(
      "- first\n  - second\n    continuation\n\n    ```\n    code\n    ```\n- next",
    );
    target.run(outdentMarkdownList);
    expect(target.state.doc.toString()).toBe(source);
  });

  it.each(["-", "*", "+", "1.", "- parent\n  -"])(
    "waits for a separator before normalizing a bare list marker: %j",
    (source) => {
      const target = editor(source);
      const pos = source.length;
      for (const text of ["-", " ", "text"])
        expect(
          normalizeMarkdownListInput(target.state, pos, pos, text),
        ).toBeNull();
      const presentation = new MarkdownPresentation({
        state: target.state,
        hasFocus: true,
      });
      for (
        let cursor = presentation.decorations.iter();
        cursor.value;
        cursor.next()
      )
        expect(cursor.from).toBeLessThan(target.state.doc.lineAt(pos).from);
    },
  );

  it.each(["- ", "1. ", "- [ ] "])(
    "keeps typed separator spaces from creating code blocks: %j",
    (source) => {
      const target = editor(source);
      for (let i = 0; i < 8; i++) {
        const pos = target.state.selection.main.head;
        const change = normalizeMarkdownListInput(target.state, pos, pos, " ");
        expect(change).not.toBeNull();
        target.dispatch(
          target.state.update({
            changes: change!,
            selection: { anchor: change!.from + change!.insert.length },
          }),
        );
      }
      expect(target.state.doc.toString()).toBe(source);
      const pos = target.state.doc.length;
      target.dispatch(
        target.state.update({
          changes: { from: pos, insert: "本文" },
          selection: { anchor: pos + 2 },
        }),
      );
      target.run(continueMarkdownList);
      expect(target.state.doc.toString()).toContain("本文\n");
    },
  );

  it("lets multiline selections fall through without overlapping numbering edits", () => {
    const target = editor("1. first\n2. second\n3. third", 5, 19);
    expect(continueMarkdownList(target)).toBe(false);
    expect(target.state.doc.toString()).toBe("1. first\n2. second\n3. third");
  });
  it("runs the application list commands before generic Markdown bindings", () => {
    const bindings = createMarkdownBodyEditorState("").facet(keymap).flat();
    expect(
      bindings
        .filter(
          (binding) =>
            binding.key === "Enter" && binding.run !== acceptCompletion,
        )
        .slice(0, 4)
        .map((binding) => binding.run),
    ).toEqual([
      enterCodeBlock,
      insertMarkdownMathNewline,
      writeAfterTable,
      continueMarkdownList,
    ]);
    expect(
      bindings.some(
        (binding) =>
          binding.key === "Backspace" &&
          binding.run === deleteMarkdownListBackward,
      ),
    ).toBe(true);
  });

  it.each([
    "- ",
    "-   ",
    "-\t",
    "1. ",
    "1.    ",
    "1.\t",
    "- [ ] ",
    "+  [x]  ",
    "1. [x]  ",
  ])("exits a whitespace-only item with one Enter: %j", (prefix) => {
    const target = editor(prefix);
    target.run(continueMarkdownList);
    expect(target.state.doc.toString()).toBe("");
    expect(target.state.selection.main.head).toBe(0);
    target.run(undo);
    expect(target.state.doc.toString()).toBe(prefix);
  });

  it.each([
    ["- first\n-   ", "- first\n"],
    ["1. first\n2.  ", "1. first\n"],
    ["- parent\n  -   ", "- parent\n- "],
    ["1. parent\n\n   -   ", "1. parent\n\n2. "],
    ["- parent\n\n  1. ", "- parent\n\n- "],
    ["1. parent\n   1. \n2. next", "1. parent\n2. \n3. next"],
  ])(
    "exits one level without creating a loose list: %j",
    (source, expected) => {
      const target = editor(
        source,
        source.indexOf("\n2. next") >= 0
          ? source.indexOf("\n2. next")
          : source.length,
      );
      target.run(continueMarkdownList);
      expect(target.state.doc.toString()).toBe(expected);
    },
  );

  it.each([
    ["-   text", "-   text\n- "],
    ["+\ttext", "+\ttext\n+ "],
    ["1.    text", "1.    text\n2. "],
    ["1.\ttext", "1.\ttext\n2. "],
    ["-   [x]  text", "-   [x]  text\n- [ ] "],
    ["1) [x] text", "1) [x] text\n2) [ ] "],
    ["> - text", "> - text\n> - "],
    ["- first\n  + child", "- first\n  + child\n  + "],
  ])(
    "continues valid spacing and clears the new checkbox: %j",
    (source, expected) => {
      const target = editor(source);
      target.run(continueMarkdownList);
      expect(target.state.doc.toString()).toBe(expected);
      expect(target.state.selection.main.head).toBe(expected.length);
    },
  );

  it("splits text and replaces a selection without losing the remaining content", () => {
    const target = editor("- hello world", 7);
    target.run(continueMarkdownList);
    expect(target.state.doc.toString()).toBe("- hello\n-  world");
    const selection = editor("- hello world", 4, 8);
    selection.run(continueMarkdownList);
    expect(selection.state.doc.toString()).toBe("- he\n- world");
  });

  it("renumbers from the displayed number when the source uses repeated ones", () => {
    const target = editor("1. first\n1. second\n1. third", 18);
    target.run(continueMarkdownList);
    expect(target.state.doc.toString()).toBe(
      "1. first\n1. second\n3. \n4. third",
    );
  });

  it.each(["-   text", "1.\ttext", "- [x]  text"])(
    "removes the root marker with one Backspace at the content boundary: %j",
    (source) => {
      const target = editor(source, source.indexOf("text"));
      target.run(deleteMarkdownListBackward);
      expect(target.state.doc.toString()).toBe("text");
      expect(target.state.selection.main.head).toBe(0);
      target.run(undo);
      expect(target.state.doc.toString()).toBe(source);
    },
  );

  it("outdents a nested item with Backspace and keeps its children attached", () => {
    const source = "1. parent\n   1. child\n      - descendant\n2. next";
    const target = editor(source, source.indexOf("child"));
    target.run(deleteMarkdownListBackward);
    expect(target.state.doc.toString()).toBe(
      "1. parent\n2. child\n   - descendant\n3. next",
    );
    expect(target.state.selection.main.head).toBe(
      target.state.doc.toString().indexOf("child"),
    );
  });

  it("inserts an indented continuation with Shift-Enter", () => {
    const target = editor("12. text");
    target.run(breakMarkdownListLine);
    expect(target.state.doc.toString()).toBe("12. text\n    ");
    target.run(continueMarkdownList);
    expect(target.state.doc.toString()).toBe("12. text\n    \n13. ");
  });
  it.each([
    ["1.    text", "1.    text\n      "],
    ["-\ttext", "-\ttext\n    "],
  ])(
    "keeps the source content column for continuation lines: %j",
    (source, expected) => {
      const target = editor(source);
      target.run(breakMarkdownListLine);
      expect(target.state.doc.toString()).toBe(expected);
    },
  );

  it.each([
    ["paragraph\n-", "paragraph\n\n"],
    ["1. parent\n   -", "1. parent\n\n2. "],
    ["- parent\n  1.", "- parent\n\n- "],
  ])(
    "activates empty markers that cannot interrupt a paragraph: %j",
    (source, expected) => {
      const target = editor(source);
      const change = markdownListShortcut(
        target.state,
        source.length,
        source.length,
        " ",
      );
      expect(change).not.toBeNull();
      target.dispatch(
        target.state.update({
          changes: change!,
          selection: { anchor: source.length + 2 },
        }),
      );
      target.run(continueMarkdownList);
      expect(target.state.doc.toString()).toBe(expected);
    },
  );

  it("leaves code and ordinary text to the default commands", () => {
    for (const source of [
      "text",
      "```md\n- code\n```",
      "    - code",
      "-     code",
    ]) {
      const target = editor(
        source,
        source.includes("code") ? source.indexOf("code") + 4 : source.length,
      );
      expect(continueMarkdownList(target)).toBe(false);
      expect(breakMarkdownListLine(target)).toBe(false);
      expect(deleteMarkdownListBackward(target)).toBe(false);
      expect(target.state.doc.toString()).toBe(source);
    }
  });
});

describe("Markdown ordered list input and presentation", () => {
  it.each(["paragraph\n1.", "- parent\n  - child\n1.", "paragraph\n2)"])(
    "recognizes an empty number marker immediately after %s",
    (source) => {
      const initial = createMarkdownBodyEditorState(source);
      const change = orderedListShortcut(
        initial,
        source.length,
        source.length,
        " ",
      );
      expect(change).not.toBeNull();
      const state = initial.update({ changes: change! }).state;
      expect([...orderedListMarkers(state).values()]).toHaveLength(1);
      expect(state.doc.toString()).toBe(
        source.replace(/\n([^\n]+)$/, "\n\n$1 "),
      );
    },
  );

  it("keeps existing lists and code untouched by the input shortcut", () => {
    for (const source of [
      "1.",
      "1. parent\n2.",
      "```md\n1.",
      "    1.",
      "text 1.",
      "<pre>\n1.",
    ]) {
      const state = createMarkdownBodyEditorState(source);
      expect(
        orderedListShortcut(state, source.length, source.length, " "),
      ).toBeNull();
    }
  });

  it("shows calculated numbers while editing content and aligns root markers with bullets", () => {
    const source = "1. parent\n   1. child\n1. next\n\n- bullet";
    const state = createMarkdownBodyEditorState(source).update({
      selection: { anchor: source.indexOf("next") + 4 },
    }).state;
    const presentation = new MarkdownPresentation({ state, hasFocus: true });
    const lines: { from: number; style: string }[] = [];
    const numbers: number[] = [];
    const hidden: string[] = [];
    for (
      let cursor = presentation.decorations.iter();
      cursor.value;
      cursor.next()
    ) {
      const spec = cursor.value.spec as {
        attributes?: { style?: string };
        widget?: { number?: number };
      };
      if (spec.attributes?.style)
        lines.push({ from: cursor.from, style: spec.attributes.style });
      if (typeof spec.widget?.number === "number")
        numbers.push(spec.widget.number);
      if (!spec.widget && cursor.from < cursor.to)
        hidden.push(state.doc.sliceString(cursor.from, cursor.to));
    }
    expect(numbers).toEqual([1, 1, 2]);
    expect(lines.map(({ style }) => style)).toEqual([
      "padding-left: 16px",
      "padding-left: 32px",
      "padding-left: 16px",
      "padding-left: 16px",
    ]);
    expect(hidden).toContain("   ");
    // Selecting a marker keeps the visual prefix stable.
    const selected = state.update({ selection: { anchor: 1 } }).state;
    const shown = new MarkdownPresentation({ state: selected, hasFocus: true });
    const firstSpec = shown.decorations.iter().value?.spec as
      | {
          attributes?: { style?: string };
        }
      | undefined;
    expect(firstSpec?.attributes?.style).toBe("padding-left: 16px");
    const cursor = shown.atomicRanges.iter();
    expect(cursor.from).toBe(0);
    expect(cursor.to).toBe(3);
  });
});
