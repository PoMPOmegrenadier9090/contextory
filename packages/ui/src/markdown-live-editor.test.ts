import { syntaxTree } from "@codemirror/language";
import { describe, expect, it, vi } from "vitest";
import type { EditorView, WidgetType } from "@codemirror/view";

import {
  createMarkdownBodyEditorState,
  MarkdownPresentation,
  todoShortcut,
} from "./markdown-live-editor.js";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { indentMore, indentLess } from "@codemirror/commands";
import type { Transaction } from "@codemirror/state";

describe("Markdown Live Editor attachment links", () => {
  const path = "assets/files/e1f9a674-05cc-4bef-bdbd-c59433c7a6c2.pdf";
  const label = "2026価値コストエンジニアリング①.pdf";
  const source = `[${label}](../${path})\n\n本文`;
  const linkWidget = (value: MarkdownPresentation): WidgetType | undefined =>
    (
      value.decorations.iter().value?.spec as
        { widget?: WidgetType } | undefined
    )?.widget;
  const presentation = (
    body: string,
    baseUrl = "/api/",
    anchor = body.length,
    onOpenAsset?: (path: string) => void,
  ) => {
    const state = createMarkdownBodyEditorState(body).update({
      selection: { anchor },
    }).state;
    return new MarkdownPresentation(
      { state, hasFocus: true },
      baseUrl,
      onOpenAsset,
    );
  };

  it("shows only the filename and resolves attachments for web and desktop", () => {
    for (const baseUrl of ["/api/", "pkm-asset://vault/"]) {
      const decorations = presentation(source, baseUrl).decorations;
      const cursor = decorations.iter();
      expect(cursor.from).toBe(0);
      expect(cursor.to).toBe(source.indexOf("\n"));
      expect(linkWidget(presentation(source, baseUrl))).toMatchObject({
        label,
        url: `${baseUrl}${path}`,
        assetPath: path,
      });
    }
  });

  it("keeps the source editable with the resolved target when selected", () => {
    const decorations = presentation(
      source,
      "pkm-asset://vault/",
      2,
    ).decorations;
    expect(decorations.iter().value?.spec).toMatchObject({
      class: "pkm-editor-link-source",
      attributes: {
        "data-url": `pkm-asset://vault/${path}`,
        "data-asset-path": path,
      },
    });
  });

  it("opens attachments through the supplied asset handler", () => {
    const onOpenAsset = vi.fn();
    const widget = linkWidget(
      presentation(source, "pkm-asset://vault/", source.length, onOpenAsset),
    )!;
    const addEventListener =
      vi.fn<
        (
          type: string,
          listener: (
            event: Pick<MouseEvent, "preventDefault" | "stopPropagation">,
          ) => void,
        ) => void
      >();
    const element = { addEventListener };
    vi.stubGlobal("document", { createElement: () => element });
    try {
      widget.toDOM({} as EditorView);
      expect(element).toMatchObject({
        textContent: label,
        href: `pkm-asset://vault/${path}`,
      });
      const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
      addEventListener.mock.calls[0]![1](event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(onOpenAsset).toHaveBeenCalledExactlyOnceWith(path, label);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps code, images and unsupported paths out of attachment link rendering", () => {
    for (const body of [
      `\`${source.split("\n")[0]}\``,
      `\`\`\`md\n${source}\n\`\`\``,
      `![画像](../${path.replace("files/", "images/").replace(".pdf", ".png")})`,
      "[invalid](../assets/../vault.yaml)",
      "[unsafe](javascript:alert)",
    ]) {
      expect(presentation(body).decorations.size).toBe(0);
    }
    expect(
      linkWidget(presentation("[Web](https://example.com)\n\n本文")),
    ).toMatchObject({ label: "Web", url: "https://example.com" });
  });
});

describe("Markdown Live Editor task list parsing", () => {
  it.each(["- [ ] 本文", "1. [x] 本文", "- 親\n  - [ ] 本文"])(
    "treats the entire checkbox prefix as one atomic range: %j",
    (source) => {
      const state = createMarkdownBodyEditorState(source);
      const presentation = new MarkdownPresentation({ state, hasFocus: true });
      const contentFrom = source.indexOf("本文");
      const line = state.doc.lineAt(contentFrom);
      const cursor = presentation.atomicRanges.iter(line.from);
      expect(cursor.from).toBe(line.from);
      expect(cursor.to).toBe(contentFrom);
    },
  );

  it("recognizes unchecked and checked task markers", () => {
    const state = createMarkdownBodyEditorState("- [ ] 未完了\n- [x] 完了\n");
    const markers: string[] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.name === "TaskMarker") {
          markers.push(state.doc.sliceString(node.from, node.to));
        }
      },
    });

    expect(markers).toEqual(["[ ]", "[x]"]);
  });
});

describe("Markdown input helpers", () => {
  it("expands [] plus space, retaining list indentation", () => {
    for (const [source, expected] of [
      ["[]", "- [ ] "],
      ["  []", "  - [ ] "],
      ["- []", "- [ ] "],
      ["+   []", "+ [ ] "],
      ["1.\t[]", "1. [ ] "],
    ]) {
      const state = createMarkdownBodyEditorState(source!);
      expect(
        todoShortcut(state, source!.length, source!.length, " ")?.insert,
      ).toBe(expected);
    }
    const code = "```md\n[]\n```";
    expect(
      todoShortcut(createMarkdownBodyEditorState(code), 8, 8, " "),
    ).toBeNull();
    expect(
      todoShortcut(createMarkdownBodyEditorState("text []"), 7, 7, " "),
    ).toBeNull();
  });
  it("continues bullets and uses two-space indentation", () => {
    let state = createMarkdownBodyEditorState("- first");
    state = state.update({ selection: { anchor: state.doc.length } }).state;
    const target = {
      get state() {
        return state;
      },
      dispatch: (transaction: Transaction) => {
        state = transaction.state;
      },
    };
    expect(insertNewlineContinueMarkup(target)).toBe(true);
    expect(state.doc.toString()).toBe("- first\n- ");
    expect(indentMore(target)).toBe(true);
    expect(state.doc.toString()).toBe("- first\n  - ");
    expect(indentLess(target)).toBe(true);
    expect(state.doc.toString()).toBe("- first\n- ");
  });
  it("parses bare URLs, Markdown links and horizontal rules", () => {
    const state = createMarkdownBodyEditorState(
      'https://example.com\n\n---\n\n[(15) Leo builds on X: "Only 2%" / X](https://x.com/LeoBuilds_/status/2106159384787345556)',
    );
    const names: string[] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        names.push(node.name);
      },
    });
    expect(names).toContain("HorizontalRule");
    expect(names).toContain("Link");
    expect(names.filter((name) => name === "URL")).toHaveLength(2);
  });
});
