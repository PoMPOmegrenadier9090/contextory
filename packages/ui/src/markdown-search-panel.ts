import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  selectMatches,
  setSearchQuery,
} from "@codemirror/search";
import {
  EditorView,
  runScopeHandlers,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";

export const openMarkdownSearchPanel = (view: EditorView): boolean => {
  openSearchPanel(view);
  const input = view.dom.querySelector<HTMLInputElement>(
    '.pkm-editor-search input[main-field="true"]',
  );
  input?.focus({ preventScroll: true });
  input?.select();
  return true;
};

// Keep the panel outside document flow: opening or focusing it must never move
// the page back to the start of the editor.
export class MarkdownSearchPanel implements Panel {
  readonly dom = document.createElement("div");
  readonly top = true;
  private readonly input = document.createElement("input");
  private readonly replacement = document.createElement("input");
  private readonly count = document.createElement("span");
  private readonly options = new Map<
    "caseSensitive" | "wholeWord" | "regexp",
    HTMLButtonElement
  >();
  private query: SearchQuery;
  private readonly observer: ResizeObserver;
  private frame: number | null = null;
  private matches: { from: number; to: number }[] = [];

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.dom.className = "cm-search pkm-editor-search";
    this.dom.setAttribute("role", "search");
    this.dom.setAttribute("aria-label", "本文内を検索");
    const row = document.createElement("div");
    row.className = "pkm-search-row";
    this.input.className = "cm-textfield";
    this.input.name = "search";
    this.input.placeholder = "本文内を検索";
    this.input.setAttribute("aria-label", "本文内を検索");
    this.input.setAttribute("main-field", "true");
    this.input.addEventListener("input", this.commit);
    this.input.addEventListener("change", this.commit);
    this.count.className = "pkm-search-count";
    this.count.setAttribute("role", "status");
    row.append(this.input, this.count);
    row.append(
      this.button("prev", "前の一致（Shift+Enter）", "↑", () =>
        findPrevious(view),
      ),
      this.button("next", "次の一致（Enter）", "↓", () => findNext(view)),
      this.button("close", "検索を閉じる（Esc）", "×", () =>
        closeSearchPanel(view),
      ),
    );
    const options = document.createElement("div");
    options.className = "pkm-search-row pkm-search-options";
    for (const [key, label, text] of [
      ["caseSensitive", "大文字・小文字を区別", "Aa"],
      ["wholeWord", "単語単位で検索", "ab"],
      ["regexp", "正規表現", ".*"],
    ] as const) {
      const button = this.button(key, label, text, () => {
        view.dispatch({
          effects: setSearchQuery.of(
            new SearchQuery({ ...this.querySpec(), [key]: !this.query[key] }),
          ),
        });
      });
      this.options.set(key, button);
      options.append(button);
    }
    options.append(
      this.button("select", "すべての一致を選択", "すべて選択", () =>
        selectMatches(view),
      ),
    );
    this.dom.append(row, options);

    if (!view.state.readOnly) {
      const disclosure = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "置換";
      const row = document.createElement("div");
      row.className = "pkm-search-row";
      this.replacement.className = "cm-textfield";
      this.replacement.name = "replace";
      this.replacement.placeholder = "置換後の文字列";
      this.replacement.setAttribute("aria-label", "置換後の文字列");
      this.replacement.addEventListener("input", this.commit);
      this.replacement.addEventListener("change", this.commit);
      row.append(
        this.replacement,
        this.button("replace", "次を置換", "置換", () => replaceNext(view)),
        this.button("replaceAll", "すべて置換", "すべて", () =>
          replaceAll(view),
        ),
      );
      disclosure.append(summary, row);
      this.dom.append(disclosure);
    }
    this.dom.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (runScopeHandlers(view, event, "search-panel")) {
        event.preventDefault();
      } else if (event.key === "Enter") {
        if (event.target === this.input) {
          event.preventDefault();
          (event.shiftKey ? findPrevious : findNext)(view);
        } else if (event.target === this.replacement) {
          event.preventDefault();
          replaceNext(view);
        }
      }
    });
    this.observer = new ResizeObserver(this.schedulePosition);
    this.syncQuery();
    this.updateMatches();
  }

  private button(
    name: string,
    label: string,
    text: string,
    action: () => unknown,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.name = name;
    button.className = "cm-button";
    button.textContent = text;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", action);
    return button;
  }

  private commit = (): void => {
    const query = new SearchQuery({
      ...this.querySpec(),
      search: this.input.value,
      replace: this.replacement.value,
    });
    this.view.dispatch({ effects: setSearchQuery.of(query) });
  };

  private querySpec() {
    const { test, ...spec } = this.query;
    return { ...spec, ...(test === undefined ? {} : { test }) };
  }

  private syncQuery(): void {
    this.input.value = this.query.search;
    this.replacement.value = this.query.replace;
    for (const [key, button] of this.options)
      button.setAttribute("aria-pressed", String(this.query[key]));
    this.input.setAttribute(
      "aria-invalid",
      String(!!this.query.search && !this.query.valid),
    );
  }

  private updateMatches(): void {
    this.matches = [];
    if (this.query.valid) {
      const cursor = this.query.getCursor(this.view.state);
      for (let match = cursor.next(); !match.done; match = cursor.next())
        this.matches.push(match.value);
    }
    this.updateCount();
  }

  private updateCount(): void {
    const selection = this.view.state.selection.main;
    const current = this.matches.findIndex(
      ({ from, to }) => from === selection.from && to === selection.to,
    );
    this.count.textContent = !this.query.search
      ? ""
      : !this.query.valid
        ? "無効な式"
        : this.matches.length === 0
          ? "一致なし"
          : `${current < 0 ? "–" : current + 1} / ${this.matches.length}`;
  }

  update(update: ViewUpdate): void {
    const query = getSearchQuery(update.state);
    const changed = !query.eq(this.query);
    this.query = query;
    this.syncQuery();
    if (changed || update.docChanged) this.updateMatches();
    else if (update.selectionSet) this.updateCount();
    this.schedulePosition();
  }

  // Align with the editor's visible right edge, including nested scrolling
  // panes. The app header stays accessible above the floating panel.
  private position = (): void => {
    const rect = this.view.dom.getBoundingClientRect();
    let left = Math.max(0, rect.left);
    let right = Math.min(window.innerWidth, rect.right);
    let top = 0;
    for (
      let ancestor = this.view.dom.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      const bounds = ancestor.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, bounds.left);
        right = Math.min(right, bounds.right);
      }
      if (
        /(auto|scroll)/.test(style.overflowY) &&
        ancestor.scrollHeight > ancestor.clientHeight &&
        ancestor.clientHeight < window.innerHeight
      )
        top = Math.max(top, bounds.top);
    }
    const header = document
      .querySelector(".app-header")
      ?.getBoundingClientRect();
    if (header && header.bottom > 0) top = Math.max(top, header.bottom);
    this.dom.style.top = `${top + 8}px`;
    this.dom.style.right = `${Math.max(8, window.innerWidth - right + 8)}px`;
    this.dom.style.width = `${Math.max(0, Math.min(420, right - left - 16))}px`;
    this.dom.style.visibility = this.view.dom.getClientRects().length
      ? "visible"
      : "hidden";
  };

  private schedulePosition = (): void => {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.position();
    });
  };

  mount(): void {
    this.position();
    this.input.focus({ preventScroll: true });
    this.input.select();
    window.addEventListener("scroll", this.schedulePosition, true);
    window.addEventListener("resize", this.schedulePosition);
    this.observer.observe(this.view.dom);
    if (this.view.dom.parentElement)
      this.observer.observe(this.view.dom.parentElement);
  }

  destroy(): void {
    window.removeEventListener("scroll", this.schedulePosition, true);
    window.removeEventListener("resize", this.schedulePosition);
    this.observer.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }
}

export const markdownSearchTheme = EditorView.theme({
  ".cm-panels-top:has(.pkm-editor-search)": { height: "0", border: "0" },
  ".cm-panel.pkm-editor-search": {
    position: "fixed",
    zIndex: "150",
    boxSizing: "border-box",
    padding: "8px",
    border: "1px solid var(--mantine-color-default-border, #c9cdd3)",
    borderRadius: "var(--mantine-radius-sm, 6px)",
    boxShadow: "var(--mantine-shadow-md, 0 4px 16px #0003)",
    background: "var(--mantine-color-body, white)",
    color: "var(--mantine-color-text, #18212f)",
    fontFamily: "inherit",
    fontSize: "calc(13px * var(--pkm-ui-font-scale, 1))",
  },
  ".pkm-editor-search .pkm-search-row": {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    minWidth: "0",
  },
  ".pkm-editor-search input.cm-textfield": {
    flex: "1",
    minWidth: "0",
    width: "0",
    padding: "5px 7px",
    margin: "0",
  },
  ".pkm-editor-search input:focus": {
    outline: "2px solid var(--mantine-primary-color-filled, #228be6)",
    outlineOffset: "-1px",
  },
  ".pkm-editor-search button.cm-button": {
    flexShrink: "0",
    padding: "4px 6px",
    margin: "0",
    cursor: "pointer",
    background: "transparent",
    border: "0",
    minHeight: "28px",
  },
  ".pkm-editor-search button:hover": {
    background: "var(--mantine-color-default-hover, #eef1f5)",
  },
  '.pkm-editor-search button[aria-pressed="true"]': {
    background: "var(--mantine-primary-color-light, #dbeeff)",
    color: "var(--mantine-primary-color-light-color, #1971c2)",
  },
  '.cm-panel.pkm-editor-search button[name="close"]': {
    position: "static",
    padding: "4px 6px",
    fontSize: "calc(18px * var(--pkm-ui-font-scale, 1))",
  },
  ".pkm-search-count": {
    whiteSpace: "nowrap",
    fontSize: "calc(11px * var(--pkm-ui-font-scale, 1))",
    color: "var(--mantine-color-dimmed, #687180)",
    fontVariantNumeric: "tabular-nums",
  },
  ".pkm-search-options": { marginTop: "6px" },
  ".pkm-editor-search summary": {
    cursor: "pointer",
    marginTop: "4px",
    color: "var(--mantine-color-dimmed, #687180)",
  },
  ".pkm-editor-search details .pkm-search-row": { marginTop: "6px" },
});
