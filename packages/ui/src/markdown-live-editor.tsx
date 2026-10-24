import {
  markdownCodeField,
  moveIntoMarkdownCode,
  moveToCodeBoundary,
  completeCodeFence,
  enterCodeBlock,
} from "./markdown-code-editor.js";
import { markdownImageField } from "./markdown-image-editor.js";
import {
  tableBoundaryTransaction,
  tableBoundaryRepair,
  tableBoundaryComposition,
} from "./markdown-table-editing.js";
import {
  markdownTablePreviewField,
  protectTableBoundary,
  writeAfterTable,
} from "./markdown-table-preview.js";
import { markdownMobileToolbar } from "./markdown-mobile-toolbar.js";
import { openMarkdownActionMenu } from "./markdown-action-menu.js";
import { ImageClipboardContext } from "./image-clipboard.js";
import type { AssetUploadSource } from "./image-upload.js";
import type { AssetUploader } from "./asset-links.js";
import { orderedListMarkers } from "./markdown-ordered-lists.js";
import {
  indentMarkdownList,
  outdentMarkdownList,
  markdownListShortcut,
  continueMarkdownList,
  breakMarkdownListLine,
  deleteMarkdownListBackward,
  normalizeMarkdownListInput,
  repeatedMarkdownListMarker,
  setMarkdownChecklist,
} from "./markdown-list-commands.js";
import { markdownListLine } from "./markdown-list-context.js";
import {
  markdownMathField,
  moveIntoMarkdownMath,
  insertMarkdownMathNewline,
} from "./markdown-math-editor.js";
import {
  toggleInlineFormat,
  pendingInlineFormatting,
  inlineFormattingInput,
  inlineComposition,
  deleteInlineFormatBoundary,
} from "./markdown-formatting.js";
import {
  readClipboardMarkdown,
  clipboardMarkdownChanges,
} from "./clipboard-markdown.js";
import {
  moveToListContent,
  moveByWord,
  deleteWordBackward,
  wordRangeAt,
  moveToMarkdownDocumentBoundary,
} from "./markdown-navigation.js";
import { EntityQueryContext } from "./entity-query-context.js";
import {
  MarkdownSearchPanel,
  markdownSearchTheme,
  openMarkdownSearchPanel,
} from "./markdown-search-panel.js";
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  indentLess,
} from "@codemirror/commands";
import {
  markdown,
  insertNewlineContinueMarkupCommand,
  deleteMarkupBackward,
  pasteURLAsLink,
} from "@codemirror/lang-markdown";
import { indentUnit, syntaxTree } from "@codemirror/language";
import {
  closeSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
} from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  Transaction,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  placeholder as editorPlaceholder,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { EntityId, EntityType } from "@pkm/contracts";
import { useReferenceLabels } from "./use-reference-labels.js";
import { parseReferenceCompletionQuery } from "./reference-completion.js";
import { extractDirectReferences, type DirectReference } from "@pkm/core";
import { Autolink, Strikethrough, Table, TaskList } from "@lezer/markdown";
import { ActionIcon, Button, Group, Text } from "@mantine/core";
import {
  collapseOnSelectionFacet,
  editorTheme,
  markdownStylePlugin,
  mouseSelectingField,
  setMouseSelecting,
} from "codemirror-live-markdown";
import { useContext, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  assetPathFromMarkdownUrl,
  assetUrl,
  markdownForAsset,
  referencedAssets,
  type PkmAsset,
} from "./asset-links.js";

import {
  buildDirectReferenceCompletionOptions,
  MAX_REFERENCE_COMPLETIONS,
  type DirectReferenceCompletionOption,
} from "./reference-completion.js";
export {
  buildDirectReferenceCompletionOptions,
  MAX_REFERENCE_COMPLETIONS,
} from "./reference-completion.js";
export type {
  DirectReferenceCompletionOption,
  ReferenceCompletionEntity,
} from "./reference-completion.js";

type ReferenceOptionsSource = (
  query: string,
  type?: EntityType,
) =>
  | readonly DirectReferenceCompletionOption[]
  | Promise<readonly DirectReferenceCompletionOption[]>;

export interface MarkdownBodyEditorOptions {
  readonly parent: HTMLElement;
  readonly document: string;
  readonly readOnly?: boolean;
  readonly placeholder?: string | undefined;
  readonly assetBaseUrl?: string;
  readonly showImagePreview?: boolean;
  readonly onCopyImage?: (image: HTMLImageElement) => Promise<void>;
  readonly onChange?: (document: string) => void;
  readonly onOpenReference?: (entityId: EntityId) => void;
  readonly onOpenAsset?: (path: string, fileName?: string) => void;
  readonly getReferenceOptions?: ReferenceOptionsSource;
  readonly getReferenceLabel?: (entityId: string) => string | undefined;
}

export interface MarkdownBodyEditorHandle {
  readonly view: EditorView;
  setChecklist(enabled: boolean): boolean;
  updateDocument(document: string): void;
  setReadOnly(readOnly: boolean): void;
  refreshReferenceLabels(): void;
  destroy(): void;
}

class DirectReferenceWidget extends WidgetType {
  constructor(
    readonly reference: DirectReference,
    readonly onOpenReference?: (entityId: EntityId) => void,
    readonly label = reference.label ?? "未解決の参照",
  ) {
    super();
  }

  override eq(other: DirectReferenceWidget): boolean {
    return (
      other.reference.targetId === this.reference.targetId &&
      other.label === this.label
    );
  }

  override toDOM(): HTMLElement {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "pkm-direct-reference";
    element.textContent = this.label;
    element.dataset.openEntity = this.reference.targetId;
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onOpenReference?.(this.reference.targetId);
    });
    return element;
  }
}

const isSelectionInsideReference = (
  state: EditorState,
  reference: DirectReference,
): boolean =>
  state.selection.ranges.some(
    ({ from, to }) =>
      from <= reference.endOffset && to >= reference.startOffset,
  );

const buildReferenceDecorations = (
  state: EditorState,
  references: readonly DirectReference[],
  onOpenReference?: (entityId: EntityId) => void,
  getReferenceLabel?: (entityId: string) => string | undefined,
): DecorationSet =>
  Decoration.set(
    references.map((reference) => {
      if (isSelectionInsideReference(state, reference)) {
        return Decoration.mark({ class: "pkm-direct-reference-source" }).range(
          reference.startOffset,
          reference.endOffset,
        );
      }
      return Decoration.replace({
        widget: new DirectReferenceWidget(
          reference,
          onOpenReference,
          reference.label ??
            getReferenceLabel?.(reference.targetId) ??
            "未解決の参照",
        ),
      }).range(reference.startOffset, reference.endOffset);
    }),
  );

const referenceLabelsChanged = StateEffect.define<void>();
const directReferencePlugin = (
  onOpenReference?: (entityId: EntityId) => void,
  getReferenceLabel?: (entityId: string) => string | undefined,
): Extension =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      references: readonly DirectReference[];

      constructor(view: EditorView) {
        this.references = extractDirectReferences(view.state.doc.toString());
        this.decorations = buildReferenceDecorations(
          view.state,
          this.references,
          onOpenReference,
          getReferenceLabel,
        );
      }

      update(update: ViewUpdate): void {
        if (update.docChanged)
          this.references = extractDirectReferences(
            update.state.doc.toString(),
          );
        if (
          update.docChanged ||
          update.selectionSet ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) =>
              effect.is(referenceLabelsChanged),
            ),
          )
        ) {
          this.decorations = buildReferenceDecorations(
            update.state,
            this.references,
            onOpenReference,
            getReferenceLabel,
          );
        }
      }
    },
    { decorations: (value) => value.decorations },
  );

const completionForEntity = (
  entity: DirectReferenceCompletionOption,
): Completion => {
  const displayName = (entity.label ?? entity.displayName)
    ?.replace(/[\]|\n]/g, " ")
    .trim();
  return {
    label: displayName || "無題のEntry",
    detail: entity.hierarchy ?? entity.type,
    apply:
      displayName === undefined || displayName.length === 0
        ? `${entity.type}:${entity.id}]]`
        : `${entity.type}:${entity.id}|${displayName}]]`,
    type: entity.type,
  };
};

export const createDirectReferenceCompletionSource =
  (getReferenceOptions: ReferenceOptionsSource): CompletionSource =>
  (
    context: CompletionContext,
  ): CompletionResult | null | Promise<CompletionResult | null> => {
    const match = context.matchBefore(/\[\[[^\]\n]*/);
    if (match === null) return null;
    const { query, type } = parseReferenceCompletionQuery(
      match.text.slice(2).trim().toLocaleLowerCase("ja"),
    );
    const build = (
      entities: readonly DirectReferenceCompletionOption[],
    ): CompletionResult => {
      const options: Completion[] = [];
      for (const entity of entities) {
        if (type !== undefined && entity.type !== type) continue;
        const searchable =
          `${entity.label ?? entity.displayName ?? ""} ${entity.type} ${entity.id} ${entity.hierarchy ?? ""}`
            .toLocaleLowerCase("ja")
            .includes(query);
        if (query.length === 0 || searchable) {
          options.push(completionForEntity(entity));
          if (options.length >= MAX_REFERENCE_COMPLETIONS) break;
        }
      }
      return {
        from: match.from + 2,
        filter: false,
        options,
      };
    };
    const candidates = getReferenceOptions(query, type);
    return candidates instanceof Promise
      ? candidates.then(build).catch(() => null)
      : build(candidates);
  };

const externalDocumentUpdate = Annotation.define<boolean>();

class TaskCheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly from: number,
    private readonly to: number,
    private readonly readOnly: boolean,
  ) {
    super();
  }

  override eq(other: TaskCheckboxWidget): boolean {
    return (
      this.checked === other.checked &&
      this.from === other.from &&
      this.to === other.to &&
      this.readOnly === other.readOnly
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "pkm-task-checkbox";
    checkbox.checked = this.checked;
    checkbox.disabled = this.readOnly;
    checkbox.setAttribute(
      "aria-label",
      this.checked
        ? "チェックリストを未完了に戻す"
        : "チェックリストを完了にする",
    );
    checkbox.addEventListener("change", () => {
      if (view.state.readOnly) return;
      view.dispatch({
        changes: {
          from: this.from,
          to: this.to,
          insert: checkbox.checked ? "[x]" : "[ ]",
        },
      });
      view.focus();
    });
    return checkbox;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const taskCheckboxPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.transactions.some((transaction) => transaction.reconfigured)
      ) {
        this.decorations = this.build(update.view);
      }
    }

    private build(view: EditorView): DecorationSet {
      const decorations: Range<Decoration>[] = [];
      const { state } = view;
      for (const range of view.visibleRanges) {
        syntaxTree(state).iterate({
          from: range.from,
          to: range.to,
          enter: (node) => {
            if (node.name !== "TaskMarker") return;
            const marker = state.doc.sliceString(node.from, node.to);
            decorations.push(
              Decoration.replace({
                widget: new TaskCheckboxWidget(
                  marker.toLowerCase() === "[x]",
                  node.from,
                  node.to,
                  state.readOnly,
                ),
              }).range(node.from, node.to),
            );
          },
        });
      }
      return Decoration.set(decorations, true);
    }
  },
  { decorations: (value) => value.decorations },
);

export const todoShortcut = (
  state: EditorState,
  from: number,
  to: number,
  text: string,
) => {
  if (text !== " " || from !== to || state.readOnly) return null;
  const line = state.doc.lineAt(from);
  const prefix = state.doc.sliceString(line.from, from);
  const match = /^([ \t]*)(?:([-*+]|\d{1,9}[.)])[ \t]+)?\[\]$/.exec(prefix);
  if (match === null) return null;
  let node = syntaxTree(state).resolveInner(from, -1);
  while (true) {
    if (
      ["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock"].includes(node.name)
    )
      return null;
    if (node.parent === null) break;
    node = node.parent;
  }
  return { from: line.from, to, insert: `${match[1]}${match[2] ?? "-"} [ ] ` };
};

class MarkdownLinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly url: string,
    readonly assetPath: string | null,
    readonly onOpenAsset?: (path: string, fileName?: string) => void,
  ) {
    super();
  }
  override eq(other: MarkdownLinkWidget): boolean {
    return (
      this.label === other.label &&
      this.url === other.url &&
      this.assetPath === other.assetPath &&
      this.onOpenAsset === other.onOpenAsset
    );
  }
  toDOM(): HTMLElement {
    const link = document.createElement("a");
    link.className = "pkm-editor-link";
    link.textContent = this.label;
    link.href = this.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = this.url;
    if (this.assetPath !== null && this.onOpenAsset !== undefined) {
      const path = this.assetPath;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.onOpenAsset?.(path, this.label);
      });
    }
    return link;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

const listItemHandle = (element: HTMLElement, view: EditorView): void => {
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", "本文先頭に移動");
  element.tabIndex = 0;
  const select = (extend: boolean) => {
    // Widgets are reused after edits, so resolve their current source position.
    const context = markdownListLine(view.state, view.posAtDOM(element) + 1);
    if (!context) return;
    view.dispatch({
      selection: {
        anchor: extend ? view.state.selection.main.anchor : context.contentFrom,
        head: context.contentFrom,
      },
      userEvent: "select.pointer",
    });
    view.focus();
  };
  element.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    select(event.shiftKey);
  });
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    select(event.shiftKey);
  });
};

class MarkdownMarkWidget extends WidgetType {
  constructor(readonly rule: boolean) {
    super();
  }
  override eq(other: MarkdownMarkWidget): boolean {
    return this.rule === other.rule;
  }
  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = this.rule ? "pkm-editor-rule" : "pkm-editor-bullet";
    if (this.rule) element.setAttribute("role", "separator");
    else {
      element.textContent = "•";
      listItemHandle(element, view);
    }
    return element;
  }
}

class OrderedListWidget extends WidgetType {
  constructor(readonly number: number) {
    super();
  }
  override eq(other: OrderedListWidget): boolean {
    return this.number === other.number;
  }
  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = "pkm-editor-ordered-number";
    element.textContent = `${this.number}.`;
    listItemHandle(element, view);
    return element;
  }
}

// List markers are presented by markdownPresentation instead of being hidden
// by the upstream inline formatting plugin.
const inlineFormatting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate): void {
      if (update.state.field(mouseSelectingField, false)) return;
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged ||
        update.startState.field(mouseSelectingField, false) !==
          update.state.field(mouseSelectingField, false)
      )
        this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const ranges: Range<Decoration>[] = [];
      syntaxTree(view.state).iterate({
        enter: (node) => {
          if (["FencedCode", "CodeBlock"].includes(node.name)) return false;
          if (
            ![
              "EmphasisMark",
              "StrikethroughMark",
              "CodeMark",
              "HeaderMark",
              "QuoteMark",
            ].includes(node.name)
          )
            return;
          const block = ["HeaderMark", "QuoteMark"].includes(node.name);
          const line = view.state.doc.lineAt(node.from);
          const touched =
            view.hasFocus &&
            view.state.selection.ranges.some((range) =>
              block
                ? range.from <= line.to && range.to >= line.from
                : range.from <= node.to && range.to >= node.from,
            );
          const kind = block ? "block" : "inline";
          if (["EmphasisMark", "StrikethroughMark"].includes(node.name)) {
            ranges.push(
              Decoration.replace({ pkmInlineDelimiter: true }).range(
                node.from,
                node.to,
              ),
            );
            return;
          }
          ranges.push(
            Decoration.mark({
              class: `cm-formatting-${kind}${touched ? ` cm-formatting-${kind}-visible` : ""}`,
            }).range(node.from, node.to),
          );
        },
      });
      return Decoration.set(ranges, true);
    }
  },
  {
    decorations: (value) => value.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) =>
          view.plugin(plugin)?.decorations.update({
            filter: (_from, _to, value) =>
              (value.spec as { pkmInlineDelimiter?: boolean })
                .pkmInlineDelimiter === true,
          }) ?? Decoration.none,
      ),
  },
);

export class MarkdownPresentation {
  decorations: DecorationSet;
  atomicRanges: DecorationSet = Decoration.none;
  constructor(
    view: Pick<EditorView, "state" | "hasFocus">,
    readonly assetBaseUrl = "/api/",
    readonly onOpenAsset?: (path: string, fileName?: string) => void,
  ) {
    this.decorations = this.build(view);
  }
  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.focusChanged
    )
      this.decorations = this.build(update.view);
  }
  build(view: Pick<EditorView, "state" | "hasFocus">): DecorationSet {
    const decorations: Range<Decoration>[] = [];
    const atomicRanges: Range<Decoration>[] = [];
    const state = view.state;
    const orderedMarkers = orderedListMarkers(state);
    const touched = (from: number, to: number) =>
      view.hasFocus &&
      state.selection.ranges.some(
        (range) => range.from <= to && range.to >= from,
      );
    syntaxTree(state).iterate({
      enter: (node) => {
        if (
          ["FencedCode", "CodeBlock", "InlineCode", "Table", "Image"].includes(
            node.name,
          )
        )
          return false;
        if (node.name === "SetextHeading1" || node.name === "SetextHeading2") {
          decorations.push(
            Decoration.mark({
              class: `cm-header-${node.name.endsWith("1") ? 1 : 2}`,
            }).range(node.from, node.to),
          );
          decorations.push(
            Decoration.line({ class: "cm-heading-line" }).range(
              state.doc.lineAt(node.from).from,
            ),
          );
        }
        if (node.name === "Link" || node.name === "URL") {
          const source = state.doc.sliceString(node.from, node.to);
          const urlNode =
            node.name === "Link" ? node.node.getChild("URL") : node.node;
          if (urlNode === null) return false;
          const sourceUrl = state.doc
            .sliceString(urlNode.from, urlNode.to)
            .replace(/^<|>$/g, "");
          const assetPath = assetPathFromMarkdownUrl(sourceUrl);
          if (assetPath === null && !/^(https?:\/\/|mailto:)/i.test(sourceUrl))
            return false;
          const url = assetUrl(sourceUrl, this.assetBaseUrl);
          const endLabel = source.lastIndexOf("](");
          const label =
            node.name === "Link" && endLabel > 0
              ? source.slice(1, endLabel).replace(/\\([\\[\]])/g, "$1")
              : source;
          if (
            endLabel > 0 &&
            !source.includes("\n") &&
            !touched(node.from, node.to)
          ) {
            decorations.push(
              Decoration.replace({
                widget: new MarkdownLinkWidget(
                  label,
                  url,
                  assetPath,
                  this.onOpenAsset,
                ),
              }).range(node.from, node.to),
            );
          } else {
            decorations.push(
              Decoration.mark({
                class: "pkm-editor-link-source",
                attributes: {
                  "data-url": url,
                  ...(assetPath === null
                    ? {}
                    : {
                        "data-asset-path": assetPath,
                        "data-file-name": label,
                      }),
                },
              }).range(node.from, node.to),
            );
          }
          return false;
        }
        if (node.name === "HorizontalRule" && !touched(node.from, node.to)) {
          decorations.push(
            Decoration.replace({
              widget: new MarkdownMarkWidget(true),
            }).range(node.from, node.to),
          );
        }
        if (node.name === "ListMark") {
          const line = state.doc.lineAt(node.from);
          const context = markdownListLine(state, node.to);
          if (!context) return;
          // The checkbox and hidden list marker form one editable prefix.
          atomicRanges.push(
            Decoration.mark({}).range(
              /^[ \t]*$/.test(state.doc.sliceString(line.from, node.from))
                ? line.from
                : node.from,
              context.contentFrom,
            ),
          );
          let depth = 0;
          for (
            let parent = node.node.parent;
            parent !== null;
            parent = parent.parent
          )
            if (parent.name === "ListItem") depth += 1;
          decorations.push(
            Decoration.line({
              attributes: {
                style: `padding-left: ${16 + Math.max(0, depth - 1) * 16}px`,
              },
            }).range(line.from),
          );
          // Source indentation establishes Markdown nesting; the line padding
          // presents that nesting without counting the whitespace a second time.
          if (
            node.from > line.from &&
            /^[ \t]*$/.test(state.doc.sliceString(line.from, node.from))
          )
            decorations.push(
              Decoration.replace({}).range(line.from, node.from),
            );
          const prefixTo = context.task?.from ?? context.contentFrom;
          const ordered = orderedMarkers.get(node.from);
          if (ordered) {
            decorations.push(
              Decoration.replace({
                widget: new OrderedListWidget(ordered.number),
              }).range(node.from, prefixTo),
            );
            return;
          }
          const source = state.doc.sliceString(node.from, node.to);
          if (/^[-*+]$/.test(source) && context.task === null)
            decorations.push(
              Decoration.replace({
                widget: new MarkdownMarkWidget(false),
              }).range(node.from, prefixTo),
            );
          if (context.task !== null)
            decorations.push(Decoration.replace({}).range(node.from, prefixTo));
        }
      },
    });
    this.atomicRanges = Decoration.set(atomicRanges, true);
    return Decoration.set(decorations, true);
  }
}

const markdownPresentation = (
  assetBaseUrl = "/api/",
  onOpenAsset?: (path: string, fileName?: string) => void,
) =>
  ViewPlugin.define(
    (view) => new MarkdownPresentation(view, assetBaseUrl, onOpenAsset),
    {
      decorations: (value) => value.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(plugin)?.atomicRanges ?? Decoration.none,
        ),
    },
  );

const editorExtensions = (
  readOnly: Compartment,
  initialReadOnly: boolean,
  placeholder?: string,
  assetBaseUrl?: string,
  showImagePreview = true,
  onChange?: (document: string) => void,
  onOpenReference?: (entityId: EntityId) => void,
  getReferenceOptions: ReferenceOptionsSource = () => [],
  onOpenAsset?: (path: string, fileName?: string) => void,
  onCopyImage?: (image: HTMLImageElement) => Promise<void>,
  getReferenceLabel?: (entityId: string) => string | undefined,
  isComposing: () => boolean = () => false,
): readonly Extension[] => [
  markdown({
    extensions: [Table, TaskList, Autolink, Strikethrough],
    addKeymap: false,
    pasteURLAsLink: false,
  }),
  indentUnit.of("  "),
  ...(placeholder === undefined ? [] : [editorPlaceholder(placeholder)]),
  history({
    joinToEvent: (transaction, adjacent) =>
      adjacent || transaction.annotation(tableBoundaryRepair) === true,
  }),
  tableBoundaryComposition,
  EditorState.transactionFilter.of((transaction) =>
    transaction.annotation(externalDocumentUpdate) === true ||
    transaction.annotation(tableBoundaryRepair) === true ||
    isComposing()
      ? transaction
      : tableBoundaryTransaction(transaction),
  ),
  pendingInlineFormatting,
  inlineFormattingInput,
  inlineComposition,
  EditorState.transactionFilter.of((transaction) =>
    transaction.selection !== undefined &&
    transaction.newSelection.ranges.length === 1 &&
    transaction.docChanged &&
    transaction.isUserEvent("input.type") &&
    !transaction.isUserEvent("input.type.compose") &&
    !transaction.newSelection.main.empty
      ? [
          transaction,
          {
            sequential: true,
            selection: { anchor: transaction.newSelection.main.to },
          },
        ]
      : transaction,
  ),
  search({ top: true, createPanel: (view) => new MarkdownSearchPanel(view) }),
  markdownSearchTheme,
  keymap.of([
    { key: "Mod-b", run: toggleInlineFormat("bold"), preventDefault: true },
    { key: "Mod-i", run: toggleInlineFormat("italic"), preventDefault: true },
    {
      key: "Mod-Shift-x",
      run: toggleInlineFormat("strike"),
      preventDefault: true,
    },
    {
      key: "Mod-f",
      run: openMarkdownSearchPanel,
      scope: "editor search-panel",
    },
    ...searchKeymap,
    {
      key: "Meta-ArrowUp",
      run: (view) =>
        moveToCodeBoundary(false)(view) ||
        moveToMarkdownDocumentBoundary(false)(view),
      shift: (view) =>
        moveToCodeBoundary(false, true)(view) ||
        moveToMarkdownDocumentBoundary(false, true)(view),
    },
    {
      key: "Meta-ArrowDown",
      run: (view) =>
        moveToCodeBoundary(true)(view) ||
        moveToMarkdownDocumentBoundary(true)(view),
      shift: (view) =>
        moveToCodeBoundary(true, true)(view) ||
        moveToMarkdownDocumentBoundary(true, true)(view),
    },
    {
      key: "Meta-ArrowLeft",
      run: (view) => moveToListContent(view),
      shift: (view) => moveToListContent(view, true),
    },
    {
      key: "Home",
      run: (view) => moveToListContent(view),
      shift: (view) => moveToListContent(view, true),
    },
    {
      key: "Alt-ArrowRight",
      run: (view) => moveByWord(view, true),
      shift: (view) => moveByWord(view, true, true),
    },
    {
      key: "Alt-ArrowLeft",
      run: (view) => moveByWord(view, false),
      shift: (view) => moveByWord(view, false, true),
    },
    { mac: "Alt-Backspace", run: deleteWordBackward },
    {
      key: "Escape",
      run: (view) => {
        view.contentDOM.blur();
        return true;
      },
    },
    ...(
      [
        ["ArrowLeft", false, false],
        ["ArrowRight", true, false],
        ["ArrowUp", false, true],
        ["ArrowDown", true, true],
      ] as const
    ).map(([key, forward, vertical]) => ({
      key,
      run: (view: EditorView) =>
        moveIntoMarkdownCode(view, forward, vertical) ||
        moveIntoMarkdownMath(view, forward, vertical),
      shift: (view: EditorView) =>
        moveIntoMarkdownCode(view, forward, vertical, true) ||
        moveIntoMarkdownMath(view, forward, vertical, true),
    })),
    { key: "Enter", run: enterCodeBlock },
    { key: "Enter", run: insertMarkdownMathNewline },
    { key: "Shift-Enter", run: insertMarkdownMathNewline },
    { key: "Enter", run: writeAfterTable },
    { key: "Enter", run: continueMarkdownList },
    {
      key: "Enter",
      run: (view) =>
        !view.state.readOnly &&
        insertNewlineContinueMarkupCommand({ nonTightLists: false })(view),
    },
    { key: "Shift-Enter", run: breakMarkdownListLine },
    { key: "Backspace", run: protectTableBoundary() },
    { key: "Delete", run: protectTableBoundary(true) },
    { key: "Backspace", run: deleteMarkdownListBackward },
    { key: "Backspace", run: deleteInlineFormatBoundary() },
    { key: "Delete", run: deleteInlineFormatBoundary(true) },
    {
      key: "Backspace",
      run: (view) => !view.state.readOnly && deleteMarkupBackward(view),
    },
    { key: "Tab", run: indentMarkdownList },
    { key: "Shift-Tab", run: outdentMarkdownList },
    indentWithTab,
    { key: "Shift-Tab", run: indentLess },
    ...defaultKeymap,
    ...historyKeymap,
  ]),
  EditorView.inputHandler.of((view, from, to, text) => {
    if (view.compositionStarted) return false;
    if (completeCodeFence(view, from, to, text)) return true;
    const change =
      repeatedMarkdownListMarker(view.state, from, to, text) ??
      todoShortcut(view.state, from, to, text) ??
      markdownListShortcut(view.state, from, to, text) ??
      normalizeMarkdownListInput(view.state, from, to, text);
    if (change === null) return false;
    if (view.state.doc.sliceString(change.from, change.to) === change.insert)
      return true;
    view.dispatch({
      changes: change,
      selection: { anchor: change.from + change.insert.length },
      userEvent: "input.type",
    });
    return true;
  }),
  autocompletion({
    override: [createDirectReferenceCompletionSource(getReferenceOptions)],
  }),
  readOnly.of(EditorState.readOnly.of(initialReadOnly)),
  collapseOnSelectionFacet.of(true),
  mouseSelectingField,
  inlineFormatting,
  markdownStylePlugin,
  editorTheme,
  markdownCodeField,
  markdownTablePreviewField,
  markdownMathField,
  ...(showImagePreview ? [markdownImageField(assetBaseUrl, onCopyImage)] : []),
  taskCheckboxPlugin,
  markdownPresentation(assetBaseUrl, onOpenAsset),
  EditorView.domEventHandlers({
    dblclick: (event, view) => {
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position === null) return false;
      const line = view.state.doc.lineAt(position);
      const word = wordRangeAt(line.text, position - line.from);
      if (word === null) return false;
      view.dispatch({
        selection: { anchor: line.from + word.from, head: line.from + word.to },
        userEvent: "select.pointer",
      });
      return true;
    },
    paste: (event, view) => {
      if (
        view.state.readOnly ||
        !event.clipboardData ||
        event.clipboardData.files.length > 0
      )
        return false;
      const node = syntaxTree(view.state).resolveInner(
        view.state.selection.main.head,
        -1,
      );
      for (let current = node; current !== null;) {
        if (
          ["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock"].includes(
            current.name,
          )
        )
          return false;
        if (current.parent === null) break;
        current = current.parent;
      }
      const html = event.clipboardData.getData("text/html");
      const markdown = readClipboardMarkdown(
        html,
        event.clipboardData.getData("text/plain"),
      );
      if (markdown === null) return false;
      view.dispatch(clipboardMarkdownChanges(view.state, markdown), {
        userEvent: "input.paste",
        scrollIntoView: true,
      });
      event.preventDefault();
      return true;
    },
    click: (event) => {
      if (!event.metaKey && !event.ctrlKey) return false;
      const link =
        event.target instanceof Element
          ? event.target.closest(".pkm-editor-link-source")
          : null;
      const url = link?.getAttribute("data-url");
      if (!url) return false;
      const assetPath = link?.getAttribute("data-asset-path");
      if (assetPath && onOpenAsset !== undefined)
        onOpenAsset(
          assetPath,
          link?.getAttribute("data-file-name") ?? undefined,
        );
      else window.open(url, "_blank", "noopener,noreferrer");
      return true;
    },
  }),
  pasteURLAsLink,
  directReferencePlugin(onOpenReference, getReferenceLabel),
  EditorView.baseTheme({
    "&": { minWidth: "0", maxWidth: "100%" },
    ".cm-scroller": { minWidth: "0", maxWidth: "100%" },
    ".cm-content": { minWidth: "0", width: "100%", flex: "1 1 0%" },
    "@media (max-width: 47.99em)": {
      ".cm-scroller .cm-content": {
        paddingBottom:
          "calc(64px + env(safe-area-inset-bottom) + var(--pkm-keyboard-inset, 0px))",
      },
    },
    ".cm-panels": {
      backgroundColor: "var(--mantine-color-body)",
      color: "var(--mantine-color-text)",
    },
    ".cm-search": { padding: "8px", fontFamily: "inherit" },
    ".cm-search .cm-textfield": {
      backgroundColor: "var(--mantine-color-body)",
      color: "var(--mantine-color-text)",
      border: "1px solid var(--mantine-color-default-border)",
      borderRadius: "var(--mantine-radius-sm)",
    },
    ".cm-search .cm-button": {
      background: "var(--mantine-color-default)",
      color: "var(--mantine-color-text)",
      border: "1px solid var(--mantine-color-default-border)",
      borderRadius: "var(--mantine-radius-sm)",
    },
    ".cm-codeblock-widget": { minWidth: "0", width: "100%", maxWidth: "100%" },
    ".cm-codeblock-widget pre": {
      maxWidth: "100%",
      overflowX: "visible",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    },
    ".cm-codeblock-source": {
      overflowX: "visible",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    },
    ".pkm-editor-link, .pkm-editor-link-source": {
      color: "var(--mantine-color-blue-6)",
      textDecoration: "underline",
      cursor: "pointer",
    },
    ".pkm-editor-rule": {
      display: "inline-block",
      width: "100%",
      borderTop: "1px solid var(--mantine-color-default-border)",
      verticalAlign: "middle",
    },
    ".pkm-editor-bullet": {
      display: "inline-block",
      fontSize: "1.4em",
      lineHeight: "1",
      verticalAlign: "-0.04em",
      opacity: "1",
      width: "1.5ch",
      cursor: "pointer",
    },
    ".pkm-editor-ordered-number": {
      display: "inline-block",
      minWidth: "2ch",
      paddingRight: "0.5em",
      boxSizing: "border-box",
      textAlign: "left",
      color: "var(--mantine-color-text)",
      fontVariantNumeric: "tabular-nums",
      cursor: "pointer",
    },
    ".cm-completionIcon-area, .cm-completionIcon-project, .cm-completionIcon-task, .cm-completionIcon-entry, .cm-completionIcon-topic, .cm-completionIcon-resource":
      {
        width: "0.7em",
        height: "0.7em",
        marginRight: "0.7em",
        paddingRight: "0",
        borderRadius: "999px",
        opacity: "0.9",
      },
    ".cm-completionIcon-area": {
      backgroundColor: "var(--mantine-color-orange-5)",
    },
    ".cm-completionIcon-project": {
      backgroundColor: "var(--mantine-color-violet-5)",
    },
    ".cm-completionIcon-task": {
      backgroundColor: "var(--mantine-color-teal-5)",
    },
    ".cm-completionIcon-entry": {
      backgroundColor: "var(--mantine-color-blue-5)",
    },
    ".cm-completionIcon-topic": {
      backgroundColor: "var(--mantine-color-grape-5)",
    },
    ".cm-completionIcon-resource": {
      backgroundColor: "var(--mantine-color-cyan-5)",
    },
  }),
  EditorView.lineWrapping,
  EditorView.updateListener.of((update) => {
    if (
      update.docChanged &&
      !update.transactions.some(
        (transaction) =>
          transaction.annotation(externalDocumentUpdate) === true,
      )
    ) {
      onChange?.(update.state.doc.toString());
    }
  }),
];

export const createMarkdownBodyEditorState = (document: string): EditorState =>
  EditorState.create({
    doc: document,
    extensions: editorExtensions(new Compartment(), false),
  });

export const createMarkdownBodyEditor = ({
  parent,
  document: initialDocument,
  readOnly: initialReadOnly = false,
  placeholder,
  assetBaseUrl,
  showImagePreview = true,
  onCopyImage,
  onChange,
  onOpenReference,
  onOpenAsset,
  getReferenceOptions = () => [],
  getReferenceLabel,
}: MarkdownBodyEditorOptions): MarkdownBodyEditorHandle => {
  const readOnly = new Compartment();
  const toolbar = new Compartment();
  const mobile = window.matchMedia("(max-width: 47.99em)");
  const toolbarExtensions = (isReadOnly: boolean) =>
    mobile.matches && !isReadOnly ? markdownMobileToolbar : [];
  const view: EditorView = new EditorView({
    parent,
    state: EditorState.create({
      doc: initialDocument,
      extensions: [
        toolbar.of(toolbarExtensions(initialReadOnly)),
        ...editorExtensions(
          readOnly,
          initialReadOnly,
          placeholder,
          assetBaseUrl,
          showImagePreview,
          onChange,
          onOpenReference,
          getReferenceOptions,
          onOpenAsset,
          onCopyImage,
          getReferenceLabel,
          () => view.compositionStarted,
        ),
      ],
    }),
  });

  const updateToolbar = (): void => {
    view.dispatch({
      effects: toolbar.reconfigure(toolbarExtensions(view.state.readOnly)),
    });
  };
  mobile.addEventListener("change", updateToolbar);

  const onMouseDown = (): void => {
    view.dispatch({ effects: setMouseSelecting.of(true) });
  };
  const onEditorMouseDown = (event: MouseEvent): void => {
    if (
      event.target instanceof Element &&
      event.target.closest(".pkm-image-widget")
    )
      return;
    if (
      focusCodeBlock(view, event) ||
      focusBlankEditorSpace(view, event.target, event.clientY)
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const onMouseUp = (): void => {
    requestAnimationFrame(() => {
      view.dispatch({ effects: setMouseSelecting.of(false) });
    });
  };
  const onContextMenu = (event: MouseEvent): void => {
    if (view.state.readOnly) return;
    event.preventDefault();
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".pkm-table-preview")) {
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const selection = view.state.selection.main;
      if (
        position !== null &&
        (position < selection.from || position > selection.to)
      )
        view.dispatch({ selection: { anchor: position } });
    }
    openMarkdownActionMenu(view, event.clientX, event.clientY, target);
  };

  view.contentDOM.addEventListener("mousedown", onMouseDown);
  view.dom.addEventListener("mousedown", onEditorMouseDown, true);
  view.dom.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("mouseup", onMouseUp);

  return {
    view,
    setChecklist(enabled) {
      const changed = setMarkdownChecklist(enabled)(view);
      if (changed) view.focus();
      return changed;
    },
    refreshReferenceLabels() {
      view.dispatch({ effects: referenceLabelsChanged.of() });
    },
    updateDocument(document) {
      if (document === view.state.doc.toString()) return;
      const anchor = Math.min(
        view.state.selection.main.anchor,
        document.length,
      );
      const head = Math.min(view.state.selection.main.head, document.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: document },
        selection: { anchor, head },
        annotations: [
          externalDocumentUpdate.of(true),
          Transaction.addToHistory.of(false),
        ],
      });
    },
    setReadOnly(value) {
      view.dispatch({
        effects: [
          readOnly.reconfigure(EditorState.readOnly.of(value)),
          toolbar.reconfigure(toolbarExtensions(value)),
        ],
      });
    },
    destroy() {
      mobile.removeEventListener("change", updateToolbar);
      view.contentDOM.removeEventListener("mousedown", onMouseDown);
      view.dom.removeEventListener("mousedown", onEditorMouseDown, true);
      view.dom.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mouseup", onMouseUp);
      view.destroy();
    },
  };
};

// Use browser caret hit testing to resolve wrapped lines and highlighted spans
// to their original source offsets.
const focusCodeBlock = (view: EditorView, event: MouseEvent): boolean => {
  if (view.state.readOnly || !(event.target instanceof Element)) return false;
  const lineElement = event.target.closest<HTMLElement>(".cm-codeblock-line");
  const widget = lineElement?.closest<HTMLElement>(".cm-codeblock-widget");
  const lineIndex = Number(lineElement?.dataset.lineIndex);
  if (!lineElement || !widget || !Number.isInteger(lineIndex) || lineIndex < 0)
    return false;
  const ownerDocument = view.dom.ownerDocument;
  if (typeof ownerDocument.caretPositionFromPoint !== "function") return false;
  const caret = ownerDocument.caretPositionFromPoint(
    event.clientX,
    event.clientY,
  );
  if (!caret || !lineElement.contains(caret.offsetNode)) return false;
  const lineStarts: unknown = JSON.parse(widget.dataset.lineStarts ?? "[]");
  const lineStart: unknown = Array.isArray(lineStarts)
    ? lineStarts[lineIndex]
    : undefined;
  if (typeof lineStart !== "number") return false;
  const range = ownerDocument.createRange();
  range.selectNodeContents(lineElement);
  range.setEnd(caret.offsetNode, caret.offset);
  const sourceLine = view.state.doc.lineAt(lineStart);
  view.dispatch({
    selection: {
      anchor: Math.min(lineStart + range.toString().length, sourceLine.to),
    },
    scrollIntoView: true,
  });
  view.focus();
  return true;
};

const focusBlankEditorSpace = (
  view: EditorView,
  target: EventTarget | null,
  y: number,
): boolean => {
  if (
    target instanceof Element &&
    target.closest(
      ".cm-line, .cm-panel, .pkm-code-header, .pkm-table-preview, button, a, input, select",
    )
  )
    return false;
  const bottom = view.coordsAtPos(view.state.doc.length)?.bottom;
  if (bottom === undefined || y < bottom) return false;
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  view.focus();
  return true;
};

export interface MarkdownLiveEditorProps {
  readonly onReady?: (editor: MarkdownBodyEditorHandle | null) => void;
  readonly value: string;
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly assetBaseUrl?: string | undefined;
  readonly className?: string;
  readonly focusAtEndToken?: number | undefined;
  readonly searchShortcutEnabled?: boolean;
  readonly referenceOptions?: readonly DirectReferenceCompletionOption[];
  readonly onChange: (document: string) => void;
  readonly onOpenReference?: (entityId: EntityId) => void;
  readonly onUploadAsset?: AssetUploader | undefined;
  readonly onAssetUploaded?: ((asset: PkmAsset) => void) | undefined;
  readonly onOpenAsset?:
    ((path: string, fileName?: string) => void) | undefined;
  readonly compactAttachmentButton?: boolean;
  readonly hideAttachmentControls?: boolean;
  readonly hideReferencedAssetList?: boolean;
  readonly showImagePreview?: boolean;
}

const EMPTY_REFERENCE_OPTIONS: readonly DirectReferenceCompletionOption[] = [];

export const MarkdownLiveEditor = ({
  onReady,
  value,
  readOnly = false,
  disabled = false,
  ariaLabel = "Markdown Live Previewエディタ",
  placeholder,
  assetBaseUrl = "/api/",
  className,
  focusAtEndToken,
  searchShortcutEnabled = false,
  referenceOptions = EMPTY_REFERENCE_OPTIONS,
  onChange,
  onOpenReference,
  onUploadAsset,
  onAssetUploaded,
  onOpenAsset,
  compactAttachmentButton = false,
  hideAttachmentControls = false,
  hideReferencedAssetList = false,
  showImagePreview = true,
}: MarkdownLiveEditorProps): React.JSX.Element => {
  const editingDisabled = readOnly || disabled;
  const copyImage = useContext(ImageClipboardContext);
  const querySource = useContext(EntityQueryContext);
  const querySourceRef = useRef(querySource);
  const references = useMemo(() => extractDirectReferences(value), [value]);
  const referenceLabels = useReferenceLabels(references, referenceOptions);
  const referenceLabelsRef = useRef(referenceLabels);
  referenceLabelsRef.current = referenceLabels;
  querySourceRef.current = querySource;
  const mount = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<MarkdownBodyEditorHandle | null>(null);
  const onChangeRef = useRef(onChange);
  const onOpenReferenceRef = useRef(onOpenReference);
  const onOpenAssetRef = useRef(onOpenAsset);
  const referenceOptionsRef = useRef(referenceOptions);
  const onUploadAssetRef = useRef(onUploadAsset);
  const onAssetUploadedRef = useRef(onAssetUploaded);
  const readOnlyRef = useRef(editingDisabled);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  onChangeRef.current = onChange;
  onOpenReferenceRef.current = onOpenReference;
  onOpenAssetRef.current = onOpenAsset;
  referenceOptionsRef.current = referenceOptions;
  onUploadAssetRef.current = onUploadAsset;
  onAssetUploadedRef.current = onAssetUploaded;
  readOnlyRef.current = editingDisabled;

  const uploadFilesRef = useRef<
    (files: readonly File[], source?: AssetUploadSource) => Promise<void>
  >(() => Promise.resolve());
  uploadFilesRef.current = async (files, source = "file") => {
    const upload = onUploadAssetRef.current;
    const handle = editor.current;
    if (readOnlyRef.current || upload === undefined || handle === null) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of files) {
        const asset = await upload(file, source);
        if (editor.current !== handle) {
          throw new Error(
            "添付中に編集対象が切り替わりました。保存したファイルはVaultに残っています。",
          );
        }
        if (onAssetUploadedRef.current !== undefined) {
          onAssetUploadedRef.current(asset);
          continue;
        }
        const view = handle.view;
        const { from, to } = view.state.selection.main;
        const before =
          from > 0 ? view.state.doc.sliceString(from - 1, from) : "";
        const after =
          to < view.state.doc.length
            ? view.state.doc.sliceString(to, to + 1)
            : "";
        const insertion = `${before && before !== "\n" ? "\n" : ""}${markdownForAsset(asset)}${after && after !== "\n" ? "\n" : ""}`;
        view.dispatch({
          changes: { from, to, insert: insertion },
          selection: { anchor: from + insertion.length },
        });
      }
      editor.current?.view.focus();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  useLayoutEffect(() => {
    if (mount.current === null) return;
    const handle = createMarkdownBodyEditor({
      parent: mount.current,
      document: value,
      readOnly: editingDisabled,
      placeholder,
      assetBaseUrl,
      showImagePreview,
      onCopyImage: copyImage,
      onChange: (document) => onChangeRef.current(document),
      onOpenReference: (entityId) => onOpenReferenceRef.current?.(entityId),
      onOpenAsset: (path, fileName) => {
        if (onOpenAssetRef.current !== undefined)
          onOpenAssetRef.current(path, fileName);
        else
          window.open(
            assetUrl(path, assetBaseUrl),
            "_blank",
            "noopener,noreferrer",
          );
      },
      getReferenceLabel: (entityId) => referenceLabelsRef.current.get(entityId),
      getReferenceOptions: (query, type) =>
        querySourceRef.current
          ? querySourceRef.current
              .query({
                q: query,
                ...(type ? { type } : {}),
                nameOnly: true,
                limit: MAX_REFERENCE_COMPLETIONS,
              })
              .then((page) => buildDirectReferenceCompletionOptions(page.items))
          : referenceOptionsRef.current,
    });
    editor.current = handle;
    onReady?.(handle);
    const onPaste = (event: ClipboardEvent): void => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (
        files.length === 0 ||
        readOnlyRef.current ||
        onUploadAssetRef.current === undefined
      )
        return;
      event.preventDefault();
      void uploadFilesRef.current(files, "paste");
    };
    const onDragOver = (event: DragEvent): void => {
      if (
        readOnlyRef.current ||
        onUploadAssetRef.current === undefined ||
        !event.dataTransfer?.types.includes("Files")
      )
        return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (event: DragEvent): void => {
      const files = [...(event.dataTransfer?.files ?? [])];
      if (
        files.length === 0 ||
        readOnlyRef.current ||
        onUploadAssetRef.current === undefined
      )
        return;
      event.preventDefault();
      const position = handle.view.posAtCoords({
        x: event.clientX,
        y: event.clientY,
      });
      if (position !== null)
        handle.view.dispatch({ selection: { anchor: position } });
      void uploadFilesRef.current(files);
    };
    handle.view.dom.addEventListener("paste", onPaste, true);
    handle.view.dom.addEventListener("dragover", onDragOver, true);
    handle.view.dom.addEventListener("drop", onDrop, true);
    return () => {
      handle.view.dom.removeEventListener("paste", onPaste, true);
      handle.view.dom.removeEventListener("dragover", onDragOver, true);
      handle.view.dom.removeEventListener("drop", onDrop, true);
      editor.current = null;
      onReady?.(null);
      handle.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    editor.current?.updateDocument(value);
  }, [value]);

  useLayoutEffect(() => {
    editor.current?.refreshReferenceLabels();
  }, [referenceLabels]);

  useLayoutEffect(() => {
    if (focusAtEndToken === undefined || editor.current === null) return;
    const view = editor.current.view;
    const end = view.state.doc.length;
    view.dispatch({ selection: { anchor: end } });
    view.focus();
  }, [focusAtEndToken]);

  useLayoutEffect(() => {
    editor.current?.setReadOnly(editingDisabled);
  }, [editingDisabled]);

  useLayoutEffect(() => {
    if (!searchShortcutEnabled) {
      if (editor.current !== null) closeSearchPanel(editor.current.view);
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !event.defaultPrevented &&
        !event.isComposing &&
        event.key === "Escape" &&
        editor.current !== null &&
        searchPanelOpen(editor.current.view.state) &&
        !(
          event.target instanceof Element &&
          event.target.closest('[role="dialog"]')
        )
      ) {
        event.preventDefault();
        closeSearchPanel(editor.current.view);
        return;
      }
      if (
        event.defaultPrevented ||
        event.isComposing ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "f" ||
        editor.current === null ||
        (event.target instanceof Element &&
          event.target.closest('[role="dialog"]'))
      )
        return;
      event.preventDefault();
      openMarkdownSearchPanel(editor.current.view);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchShortcutEnabled]);

  const attachmentControls =
    onUploadAsset !== undefined && !readOnly && !hideAttachmentControls ? (
      <Group
        gap="xs"
        p={compactAttachmentButton ? 4 : "xs"}
        justify={compactAttachmentButton ? "flex-end" : undefined}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          disabled={editingDisabled || uploading}
          hidden
          aria-label="添付ファイルを選択"
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            void uploadFilesRef.current(files);
          }}
        />
        {compactAttachmentButton ? (
          <ActionIcon
            type="button"
            aria-label="ファイルを添付"
            title="ファイルを添付（貼り付け・ドロップにも対応）"
            size="sm"
            variant="subtle"
            color="gray"
            disabled={editingDisabled}
            loading={uploading}
            onClick={() => fileInput.current?.click()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m21.4 11.6-8.6 8.6a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7L9.9 17.4a2 2 0 0 1-2.8-2.8l8.5-8.5" />
            </svg>
          </ActionIcon>
        ) : (
          <>
            <Button
              size="xs"
              variant="light"
              disabled={editingDisabled}
              loading={uploading}
              onClick={() => fileInput.current?.click()}
            >
              ファイルを添付
            </Button>
            <Text size="xs" c="dimmed">
              貼り付け・ドロップも可能（最大10 MiB）
            </Text>
          </>
        )}
      </Group>
    ) : null;

  return (
    <div
      className={className}
      aria-label={ariaLabel}
      onMouseDown={(event) => {
        if (
          editor.current !== null &&
          focusBlankEditorSpace(
            editor.current.view,
            event.target,
            event.clientY,
          )
        )
          event.preventDefault();
      }}
    >
      {!compactAttachmentButton && attachmentControls}
      {uploadError !== null && (
        <Text c="red" size="xs" px="xs">
          {uploadError}
        </Text>
      )}
      {!hideReferencedAssetList &&
        onOpenAsset !== undefined &&
        referencedAssets(value).length > 0 && (
          <Group gap="xs" px="xs" pb="xs">
            <Text size="xs" c="dimmed">
              添付
            </Text>
            {referencedAssets(value).map((asset) => (
              <Button
                key={asset.path}
                size="xs"
                variant="subtle"
                onClick={() => onOpenAsset(asset.path, asset.label)}
              >
                {asset.label || asset.path.split("/").at(-1)}
              </Button>
            ))}
          </Group>
        )}
      <div ref={mount} className="markdown-editor-mount" />
      {compactAttachmentButton && attachmentControls}
    </div>
  );
};
