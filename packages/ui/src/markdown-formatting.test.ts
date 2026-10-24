import { describe, expect, it } from "vitest";
import { syntaxTree } from "@codemirror/language";
import { redo, undo } from "@codemirror/commands";
import { EditorState, type Transaction } from "@codemirror/state";
import { createMarkdownBodyEditorState } from "./markdown-live-editor.js";
import {
  pendingInlineFormatting,
  finishInlineComposition,
  toggleInlineFormat,
  deleteInlineFormatBoundary,
  type InlineFormat,
} from "./markdown-formatting.js";

const editor = (doc: string, anchor = 0, head = doc.length) => {
  let state = createMarkdownBodyEditorState(doc).update({
    selection: { anchor, head },
  }).state;
  return {
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      state = transaction.state;
    },
    toggle(format: InlineFormat) {
      expect(toggleInlineFormat(format)(this)).toBe(true);
    },
    type(text: string, event = "input.type") {
      this.dispatch(
        state.update(state.replaceSelection(text), { userEvent: event }),
      );
    },
  };
};

describe("Markdown formatting shortcuts", () => {
  it.each([
    ["bold", "**本文**", "StrongEmphasis"],
    ["italic", "*本文*", "Emphasis"],
    ["strike", "~~本文~~", "Strikethrough"],
  ] as const)(
    "toggles %s on selected text and supports undo/redo",
    (format, formatted, node) => {
      const target = editor("本文");
      target.toggle(format);
      expect(target.state.doc.toString()).toBe(formatted);
      expect(
        target.state.sliceDoc(
          target.state.selection.main.from,
          target.state.selection.main.to,
        ),
      ).toBe("本文");
      let parsed = false;
      syntaxTree(target.state).iterate({
        enter: (value) => {
          if (value.name === node) parsed = true;
        },
      });
      expect(parsed).toBe(true);
      expect(undo(target)).toBe(true);
      expect(target.state.doc.toString()).toBe("本文");
      expect(redo(target)).toBe(true);
      target.toggle(format);
      expect(target.state.doc.toString()).toBe("本文");
    },
  );

  it.each(["bold", "italic", "strike"] as const)(
    "enables %s before typing without inserting empty markup",
    (format) => {
      const target = editor("", 0, 0);
      target.toggle(format);
      expect(target.state.doc.toString()).toBe("");
      expect(target.state.field(pendingInlineFormatting)?.formats).toEqual([
        format,
      ]);
      target.type("本文");
      const delimiter =
        format === "bold" ? "**" : format === "italic" ? "*" : "~~";
      expect(target.state.doc.toString()).toBe(`${delimiter}本文${delimiter}`);
      target.type("続き");
      expect(target.state.doc.toString()).toBe(
        `${delimiter}本文続き${delimiter}`,
      );
      target.toggle(format);
      target.type("通常");
      expect(target.state.doc.toString()).toBe(
        `${delimiter}本文続き${delimiter}通常`,
      );
    },
  );

  it("cancels pending formatting when toggled again or the cursor moves", () => {
    const target = editor("text", 0, 0);
    target.toggle("bold");
    target.toggle("bold");
    target.type("plain");
    expect(target.state.doc.toString()).toBe("plaintext");
    target.toggle("italic");
    target.dispatch(
      target.state.update({ selection: { anchor: target.state.doc.length } }),
    );
    target.type("!");
    expect(target.state.doc.toString()).toBe("plaintext!");
  });

  it("keeps leading spaces outside formatting and styles pasted text", () => {
    const target = editor("", 0, 0);
    target.toggle("bold");
    target.type(" ");
    target.type(" paste ", "input.paste");
    expect(target.state.doc.toString()).toBe("  **paste** ");
  });

  it("combines formatting and removes one style without losing the other", () => {
    const target = editor("word");
    target.toggle("bold");
    target.toggle("italic");
    expect(target.state.doc.toString()).toBe("***word***");
    target.toggle("bold");
    expect(target.state.doc.toString()).toBe("*word*");
    target.toggle("italic");
    expect(target.state.doc.toString()).toBe("word");
    const pending = editor("", 0, 0);
    pending.toggle("bold");
    pending.toggle("italic");
    pending.type("word");
    expect(pending.state.doc.toString()).toBe("***word***");
  });

  it("preserves backwards selections", () => {
    const target = editor("word", 4, 0);
    target.toggle("bold");
    expect(target.state.selection.main.anchor).toBe(6);
    expect(target.state.selection.main.head).toBe(2);
    target.toggle("bold");
    expect(target.state.selection.main.anchor).toBe(4);
    expect(target.state.selection.main.head).toBe(0);
  });

  it("toggles legacy underscore formatting and selected delimiters", () => {
    for (const [source, format, from, to] of [
      ["__word__", "bold", 2, 6],
      ["_word_", "italic", 1, 5],
      ["~~word~~", "strike", 0, 8],
    ] as const) {
      const target = editor(source, from, to);
      target.toggle(format);
      expect(target.state.doc.toString()).toBe("word");
    }
  });

  it("keeps whitespace outside delimiters on repeated toggles", () => {
    const target = editor(" word ");
    target.toggle("bold");
    expect(target.state.doc.toString()).toBe(" **word** ");
    target.toggle("bold");
    expect(target.state.doc.toString()).toBe(" word ");
  });

  it("removes formatting only from the selected part", () => {
    const target = editor("**one two three**", 6, 9);
    target.toggle("bold");
    expect(target.state.doc.toString()).toBe("**one** two **three**");
    expect(
      target.state.sliceDoc(
        target.state.selection.main.from,
        target.state.selection.main.to,
      ),
    ).toBe("two");
  });

  it("keeps list, task, heading and quote prefixes outside formatting", () => {
    for (const [source, expected] of [
      ["- one\n- [ ] two", "- **one**\n- [ ] **two**"],
      ["# heading\n\n> quote", "# **heading**\n\n> **quote**"],
    ]) {
      const target = editor(source!);
      target.toggle("bold");
      expect(target.state.doc.toString()).toBe(expected);
      target.toggle("bold");
      expect(target.state.doc.toString()).toBe(source);
    }
  });

  it("resumes formatting at the end of an existing run", () => {
    const target = editor("**word**", 8, 8);
    target.toggle("bold");
    target.type("next");
    expect(target.state.doc.toString()).toBe("**wordnext**");
    target.toggle("bold");
    target.toggle("bold");
    target.type("!");
    expect(target.state.doc.toString()).toBe("**wordnext!**");
  });

  it("applies a format to mixed content without nesting the same delimiters", () => {
    const inline = editor("one **two** three");
    inline.toggle("bold");
    expect(inline.state.doc.toString()).toBe("**one two three**");
    const lines = editor("**one**\ntwo");
    lines.toggle("bold");
    expect(lines.state.doc.toString()).toBe("**one**\n**two**");
  });

  it("formats Japanese text only after composition finishes", () => {
    const target = editor("", 0, 0);
    target.toggle("bold");
    target.type("に", "input.type.compose");
    expect(target.state.doc.toString()).toBe("に");
    target.dispatch(target.state.update({ selection: { anchor: 0, head: 1 } }));
    target.type("日本語", "input.type.compose");
    expect(target.state.doc.toString()).toBe("日本語");
    expect(finishInlineComposition(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("**日本語**");
    expect(target.state.selection.main.empty).toBe(true);
    expect(target.state.selection.main.head).toBe(5);
    target.type("続き");
    expect(target.state.doc.toString()).toBe("**日本語続き**");
    expect(undo(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("");
  });

  it("keeps a format pending after a cancelled or whitespace-only composition", () => {
    for (const text of ["", " "]) {
      const target = editor("", 0, 0);
      target.toggle("bold");
      target.type(text, "input.type.compose");
      expect(finishInlineComposition(target)).toBe(true);
      expect(target.state.doc.toString()).toBe(text);
      target.type("本文");
      expect(target.state.doc.toString()).toBe(text + "**本文**");
    }
  });

  it("cancels deferred formatting when the user moves away", () => {
    const target = editor("前後", 1, 1);
    target.toggle("italic");
    target.type("日本語", "input.type.compose");
    target.dispatch(
      target.state.update({
        selection: { anchor: 0 },
        userEvent: "select.pointer",
      }),
    );
    expect(finishInlineComposition(target)).toBe(false);
    expect(target.state.doc.toString()).toBe("前日本語後");
  });

  it("leaves a caret after typing while preserving deliberate selection", () => {
    const target = editor("前後", 1, 1);
    target.dispatch(
      target.state.update({
        changes: { from: 1, insert: "日本語" },
        selection: { anchor: 1, head: 4 },
        userEvent: "input.type",
      }),
    );
    expect(target.state.selection.main.empty).toBe(true);
    expect(target.state.selection.main.head).toBe(4);
    target.dispatch(
      target.state.update({
        selection: { anchor: 1, head: 4 },
        userEvent: "select.pointer",
      }),
    );
    expect(target.state.selection.main.empty).toBe(false);
    target.dispatch(
      target.state.update({
        changes: { from: 5, insert: "追記" },
        userEvent: "input.type",
      }),
    );
    expect(target.state.selection.main.empty).toBe(false);
  });

  it("ignores code and read-only documents", () => {
    const target = editor("`code`", 1, 5);
    target.toggle("bold");
    expect(target.state.doc.toString()).toBe("`code`");
    const state = EditorState.create({
      doc: "text",
      extensions: [EditorState.readOnly.of(true)],
    });
    expect(
      toggleInlineFormat("bold")({
        state,
        dispatch() {
          throw new Error("Read-only change");
        },
      }),
    ).toBe(true);
  });

  it("deletes hidden formatting boundaries together instead of leaving orphan markers", () => {
    for (const [source, head, forward] of [
      ["**word**", 2, false],
      ["*word*", 5, true],
      ["~~word~~", 2, false],
    ] as const) {
      const target = editor(source, head, head);
      expect(deleteInlineFormatBoundary(forward)(target)).toBe(true);
      expect(target.state.doc.toString()).toBe("word");
    }
  });

  it("keeps an empty formatted run as pending input after deleting its last character", () => {
    const target = editor("**字**", 3, 3);
    expect(deleteInlineFormatBoundary()(target)).toBe(true);
    expect(target.state.doc.toString()).toBe("");
    target.type("次");
    expect(target.state.doc.toString()).toBe("**次**");
  });
});
