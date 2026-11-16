import {
  CONTEXT_FIELD,
  newId,
  refIds,
  type DocNode,
  type FieldDefinition,
  type ObjectClient,
  type ObjectSummary,
  type ObjectTimelineEntry,
  type ObjectTypePatch,
  type TypeDefinition,
  type ViewDefinition,
  type ViewFilter,
  type ViewResult,
  type ViewRow,
} from "@pkm/core";
import {
  CheckItem,
  Chooser,
  DatePanel,
  formatDate,
  Popover,
  Segmented,
  typeLabel,
} from "@pkm/editor";
import { useEffect, useState } from "react";

import { dateRange, localDate } from "./object-date.js";

export const KIND_LABEL = {
  text: "テキスト",
  reference: "参照",
  date: "日付",
  select: "選択",
} as const;
const KINDS = Object.entries(KIND_LABEL) as [keyof typeof KIND_LABEL, string][];

const DATE_FILTERS = [
  ["today", "今日"],
  ["week", "今日から7日以内"],
  ["past", "今日より前"],
] as const;

const formatTime = (time: number): string =>
  new Intl.DateTimeFormat(
    "ja-JP",
    time >= dateRange(localDate()).from
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "numeric", day: "numeric" },
  ).format(time);

const refNodes = (ids: readonly string[]): DocNode[] =>
  ids.flatMap((objectId) => [
    { type: "objectRef", attrs: { objectId } },
    { type: "text", text: " " },
  ]);
const textNodes = (text: string): DocNode[] =>
  text ? [{ type: "text", text }] : [];
const isText = (node: DocNode): boolean => node.type === "text";
/** 入力中は確定せず、フォーカスを外した時かEnterで保存する。 */
export const commitOnEnter = (
  event: React.KeyboardEvent<HTMLInputElement>,
): void => {
  if (event.key === "Enter" && !event.nativeEvent.isComposing)
    event.currentTarget.blur();
};

/** 開いていたViewや畳んだ行は、端末ごとの表示の状態としてブラウザーに残す。 */
export const stored = <T,>(key: string, fallback: T): T => {
  try {
    const text = localStorage.getItem(`contextory.${key}`);
    return text === null ? fallback : (JSON.parse(text) as T);
  } catch {
    return fallback;
  }
};
export const store = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(`contextory.${key}`, JSON.stringify(value));
  } catch {
    // 残せなくても、表示はそのまま続ける。
  }
};

export interface ViewTabsProps {
  readonly client: ObjectClient;
  /** Viewを持つ種別 */
  readonly owner: TypeDefinition;
  readonly scope: ViewDefinition["scope"];
  /** 開いているObject。種別のページではnull。 */
  readonly anchorId: string | null;
  readonly types: readonly TypeDefinition[];
  readonly lookup: (id: string) => ObjectSummary | undefined;
  readonly merge: (objects: Readonly<Record<string, ObjectSummary>>) => void;
  /** 書き込みが済むたびに増える。Viewを読み直す合図。 */
  readonly tick: number;
  readonly open: (id: string) => void;
  /** Objectへの書き込みを保存の列に並べる。済んだら開いている文書も読み直す。 */
  readonly act: (task: () => Promise<unknown>) => void;
  readonly patchType: (name: string, patch: ObjectTypePatch) => void;
  /** 確かめてからゴミ箱へ移す。 */
  readonly trash: (object: ObjectSummary) => void;
}

/** 種別のページとObjectのページに並べる、Viewのタブと中身。 */
export const ViewTabs = ({
  client,
  owner,
  scope,
  anchorId,
  types,
  lookup,
  merge,
  tick,
  open,
  act,
  patchType,
  trash,
}: ViewTabsProps): React.JSX.Element => {
  const views = owner.views.filter((candidate) => candidate.scope === scope);
  /** 前回開いていたView。種別とページの範囲ごとに覚える。 */
  const selectedKey = `view:${owner.name}:${scope}`;
  const [selected, setSelected] = useState(() =>
    stored<string | null>(selectedKey, null),
  );
  const choose = (id: string): void => {
    setSelected(id);
    store(selectedKey, id);
  };
  /** 絞り込みの窓で開いているField */
  const [filtering, setFiltering] = useState<string | null>(null);
  /** 並べ替えの窓で、キーを選び直している段 */
  const [sorting, setSorting] = useState<number | null>(null);
  /** 階層で、配下を畳んでいる行。Viewごとに覚える。 */
  const [folds, setFolds] = useState<{
    readonly viewId: string;
    readonly ids: ReadonlySet<string>;
  } | null>(null);
  /** 追加行の入力と、候補の中で選んでいる位置 */
  const [newText, setNewText] = useState("");
  const [pick, setPick] = useState(0);
  const [loaded, setLoaded] = useState<{
    readonly viewId: string;
    readonly data: ViewResult;
  } | null>(null);
  const view = views.find((candidate) => candidate.id === selected) ?? views[0];
  const viewId = view?.id;
  const folded =
    folds && folds.viewId === viewId
      ? folds.ids
      : new Set(viewId ? stored<string[]>(`fold:${viewId}`, []) : []);

  useEffect(() => {
    if (!viewId) return;
    let live = true;
    void client.queryView(viewId, anchorId, localDate()).then(
      (data) => {
        if (!live) return;
        merge(data.objects);
        setLoaded({ viewId, data });
      },
      // 作ったばかりのViewは、保存が済んだ合図（tick）で読み直す。
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [viewId, anchorId, tick]);

  const saveViews = (next: readonly ViewDefinition[]): void =>
    patchType(owner.name, { views: next });
  const add = (base: Omit<ViewDefinition, "id">): void => {
    const id = newId();
    saveViews([...owner.views, { ...base, id }]);
    choose(id);
  };
  // 継承元のViewは、複製して自分のViewにする。
  const inheritable: ViewDefinition[] = [];
  for (
    let name = owner.extends, seen = new Set([owner.name]);
    name !== null && !seen.has(name);
  ) {
    seen.add(name);
    const ancestor = types.find((definition) => definition.name === name);
    inheritable.push(
      ...(ancestor?.views.filter((candidate) => candidate.scope === scope) ??
        []),
    );
    name = ancestor?.extends ?? null;
  }

  const tabs = (
    <div className="od-view-tabs">
      {views.map((candidate) => (
        <button
          key={candidate.id}
          type="button"
          aria-pressed={candidate.id === viewId}
          onClick={() => choose(candidate.id)}
        >
          {candidate.name}
        </button>
      ))}
      <Popover label="＋ View" ariaLabel="Viewを追加">
        {(close) => (
          <div className="od-menu">
            {(
              [
                ["table", "表"],
                ["timeline", "Timeline"],
              ] as const
            ).map(([layout, label]) => (
              <button
                key={layout}
                type="button"
                onClick={() => {
                  close();
                  add({
                    scope,
                    name: label,
                    layout,
                    type: null,
                    reach: layout === "table" ? "direct" : "all",
                    done: "all",
                    filters: [],
                    sort: "created",
                    desc: true,
                    thenBy: [],
                    hidden: [],
                    nested: false,
                    nestTypes: [],
                  });
                }}
              >
                {label}を追加
              </button>
            ))}
            {inheritable.length ? <h3>継承元から複製</h3> : null}
            {inheritable.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => {
                  close();
                  add(source);
                }}
              >
                {source.name}
              </button>
            ))}
          </div>
        )}
      </Popover>
    </div>
  );
  if (!view) return <section className="od-panel">{tabs}</section>;

  const update = (patch: Partial<ViewDefinition>): void =>
    saveViews(
      owner.views.map((candidate) =>
        candidate.id === view.id ? { ...candidate, ...patch } : candidate,
      ),
    );
  const typeOf = (name: string): TypeDefinition | undefined =>
    types.find((definition) => definition.name === name);
  const fieldsOf = (name: string): readonly FieldDefinition[] => {
    const definition = typeOf(name);
    return definition
      ? [...definition.fields, ...definition.inherited]
      : [CONTEXT_FIELD];
  };
  /** 絞り込む種別。種別のページではその種別、Objectのページでは選んだ種別。 */
  const target = typeOf(scope === "type" ? owner.name : (view.type ?? ""));
  const fields = target ? fieldsOf(target.name) : [CONTEXT_FIELD];
  const columns = fields.filter((field) => !view.hidden.includes(field.id));
  const data = loaded?.viewId === view.id ? loaded.data : null;
  const table = view.layout === "table";
  /** Fieldを、定義している種別で書き換える。継承したFieldは、継承元が変わる。 */
  const setField = (id: string, patch: Partial<FieldDefinition>): void => {
    const definer = types.find((definition) =>
      definition.fields.some((field) => field.id === id),
    );
    if (definer)
      patchType(definer.name, {
        fields: definer.fields.map((field) =>
          field.id === id ? { ...field, ...patch } : field,
        ),
      });
  };
  const write = (row: ViewRow, fieldId: string, value: DocNode[]): void =>
    act(() =>
      client.patchObject(row.object.id, { fields: { [fieldId]: value } }),
    );
  /** 参照をTitleに置き換えた文字。 */
  const textOf = (value: readonly DocNode[]): string =>
    value
      .map((node) =>
        isText(node)
          ? (node.text ?? "")
          : (lookup(String(node.attrs?.objectId))?.title ?? "…"),
      )
      .join("");

  /* ---------- 表示・並べ替え・絞り込み ---------- */

  /** 入れ子に出している種別 */
  const nestTypes = view.nestTypes.length
    ? view.nestTypes
    : target
      ? [target.name]
      : types.map((definition) => definition.name);
  const display = (
    <Popover label="表示" active={view.nested || view.hidden.length > 0}>
      {() => (
        <div className="od-menu">
          <h3>表示形式</h3>
          <Segmented
            label="表示形式"
            value={view.layout}
            options={[
              ["table", "表"],
              ["timeline", "Timeline"],
            ]}
            onChange={(layout) => update({ layout })}
          />
          {table ? (
            <>
              <h3>階層</h3>
              <CheckItem
                checked={view.nested}
                onChange={() => update({ nested: !view.nested })}
              >
                配下のObjectを行の下に出す
              </CheckItem>
              {view.nested ? (
                <div className="od-filter-values">
                  <p>
                    行の下に出す種別。
                    {scope === "object"
                      ? "行に出す種別は「絞り込み」で選ぶ"
                      : ""}
                  </p>
                  {types.map((definition) => (
                    <CheckItem
                      key={definition.name}
                      checked={nestTypes.includes(definition.name)}
                      onChange={() => {
                        const next = nestTypes.includes(definition.name)
                          ? nestTypes.filter((name) => name !== definition.name)
                          : [...nestTypes, definition.name];
                        // 一つも残らなければ、階層をやめる。
                        update(
                          next.length
                            ? { nestTypes: next }
                            : { nested: false, nestTypes: [] },
                        );
                      }}
                    >
                      #{typeLabel(definition.name)}
                    </CheckItem>
                  ))}
                </div>
              ) : null}
              <h3>列</h3>
              {fields.map((field) => (
                <CheckItem
                  key={field.id}
                  checked={!view.hidden.includes(field.id)}
                  onChange={() =>
                    update({
                      hidden: view.hidden.includes(field.id)
                        ? view.hidden.filter((id) => id !== field.id)
                        : [...view.hidden, field.id],
                    })
                  }
                >
                  {field.name}
                </CheckItem>
              ))}
            </>
          ) : null}
        </div>
      )}
    </Popover>
  );

  const sortKeys: readonly (readonly [string, string])[] = [
    ["created", "作成日"],
    ["updated", "更新日"],
    ["title", "Title"],
    ...fields
      .filter((field) => field.kind !== "context")
      .map((field) => [field.id, field.name] as const),
  ];
  const sortLabel = (by: string): string =>
    sortKeys.find(([key]) => key === by)?.[1] ?? "作成日";
  const levels = [{ by: view.sort, desc: view.desc }, ...view.thenBy];
  const setLevels = (next: readonly { by: string; desc: boolean }[]): void =>
    update({ sort: next[0]!.by, desc: next[0]!.desc, thenBy: next.slice(1) });
  const sort = (
    <Popover
      label={`並べ替え: ${sortLabel(view.sort)} ${view.desc ? "↓" : "↑"}${view.thenBy.length ? ` ほか${view.thenBy.length}` : ""}`}
      ariaLabel="並べ替え"
      active={view.thenBy.length > 0}
    >
      {() => (
        <div className="od-menu">
          {levels.map((level, i) => (
            <div key={level.by} className="od-sort-level">
              <div className="od-sort-row">
                <small>{i === 0 ? "まず" : "次に"}</small>
                <button
                  type="button"
                  aria-expanded={sorting === i}
                  onClick={() => setSorting(sorting === i ? null : i)}
                >
                  {sortLabel(level.by)}
                </button>
                <button
                  type="button"
                  aria-label={level.desc ? "降順" : "昇順"}
                  onClick={() =>
                    setLevels(
                      levels.map((other, j) =>
                        j === i ? { ...other, desc: !other.desc } : other,
                      ),
                    )
                  }
                >
                  {level.desc ? "降順 ↓" : "昇順 ↑"}
                </button>
                {levels.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`${sortLabel(level.by)}の並べ替えを外す`}
                    onClick={() => {
                      setSorting(null);
                      setLevels(levels.filter((_, j) => j !== i));
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
              {sorting === i ? (
                <div className="od-chips">
                  {sortKeys
                    .filter(
                      ([key]) =>
                        key === level.by ||
                        !levels.some((other) => other.by === key),
                    )
                    .map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={key === level.by}
                        onClick={() => {
                          setSorting(null);
                          setLevels(
                            levels.map((other, j) =>
                              j === i ? { ...other, by: key } : other,
                            ),
                          );
                        }}
                      >
                        {label}
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
          ))}
          {sortKeys.some(([key]) => !levels.some((l) => l.by === key)) ? (
            <button
              type="button"
              onClick={() => {
                const by = sortKeys.find(
                  ([key]) => !levels.some((l) => l.by === key),
                )![0];
                setLevels([...levels, { by, desc: false }]);
                setSorting(levels.length);
              }}
            >
              ＋ 並べ替えを足す
            </button>
          ) : null}
          {view.nested ? (
            <p>入れ子の行も、それぞれの親の下で同じ順に並べる</p>
          ) : null}
        </div>
      )}
    </Popover>
  );

  const filterOf = (fieldId: string): ViewFilter =>
    view.filters.find((candidate) => candidate.fieldId === fieldId) ?? {
      fieldId,
      presence: null,
      values: [],
    };
  const setFilter = (next: ViewFilter): void =>
    update({
      filters: [
        ...view.filters.filter(
          (candidate) => candidate.fieldId !== next.fieldId,
        ),
        ...(next.presence || next.values.length ? [next] : []),
      ],
    });
  const valueLabel = (field: FieldDefinition, value: string): string =>
    field.kind === "date"
      ? (DATE_FILTERS.find(([key]) => key === value)?.[1] ?? value)
      : value;
  const filterSummary = (field: FieldDefinition): string => {
    const current = filterOf(field.id);
    return [
      current.presence === "set"
        ? "値あり"
        : current.presence === "unset"
          ? "値なし"
          : "",
      ...current.values.map((value) => valueLabel(field, value)),
    ]
      .filter(Boolean)
      .join("、");
  };
  const filterCount =
    view.filters.length +
    (view.done === "all" ? 0 : 1) +
    (scope === "object" && view.type ? 1 : 0);
  const filter = (
    <Popover
      label={filterCount ? `絞り込み: ${filterCount}` : "絞り込み"}
      ariaLabel="絞り込み"
      active={filterCount > 0}
    >
      {() => (
        <div className="od-menu">
          {scope === "object" ? (
            <>
              <h3>行に出す種別</h3>
              <div className="od-chips">
                <button
                  type="button"
                  aria-pressed={view.type === null}
                  onClick={() => update({ type: null, filters: [] })}
                >
                  すべて
                </button>
                {types.map((definition) => (
                  <button
                    key={definition.name}
                    type="button"
                    aria-pressed={view.type === definition.name}
                    onClick={() =>
                      update({ type: definition.name, filters: [] })
                    }
                  >
                    #{typeLabel(definition.name)}
                  </button>
                ))}
              </div>
              <h3>範囲</h3>
              {table && view.nested ? (
                <p>階層では、直接の配下を行にして、その下へ辿る</p>
              ) : (
                <Segmented
                  label="範囲"
                  value={view.reach}
                  options={[
                    ["direct", "直接の配下"],
                    ["all", "配下のすべて"],
                  ]}
                  onChange={(reach) => update({ reach })}
                />
              )}
            </>
          ) : null}
          <h3>完了</h3>
          <Segmented
            label="完了"
            value={view.done}
            options={[
              ["all", "すべて"],
              ["open", "未完了"],
              ["done", "完了"],
            ]}
            onChange={(done) => update({ done })}
          />
          {fields.some((field) => field.kind !== "context") ? (
            <h3>Field</h3>
          ) : null}
          {fields
            .filter((field) => field.kind !== "context")
            .map((field) => {
              const current = filterOf(field.id);
              const choices: readonly string[] =
                field.kind === "date"
                  ? DATE_FILTERS.map(([key]) => key)
                  : field.kind === "select"
                    ? (field.options ?? [])
                    : [];
              return (
                <div key={field.id}>
                  <button
                    type="button"
                    className="od-filter-field"
                    aria-expanded={filtering === field.id}
                    onClick={() =>
                      setFiltering(filtering === field.id ? null : field.id)
                    }
                  >
                    {field.name}
                    <small>{filterSummary(field)}</small>
                  </button>
                  {filtering === field.id ? (
                    <div className="od-filter-values">
                      {(
                        [
                          ["set", "値あり"],
                          ["unset", "値なし"],
                        ] as const
                      ).map(([presence, label]) => (
                        <CheckItem
                          key={presence}
                          checked={current.presence === presence}
                          onChange={() =>
                            setFilter({
                              ...current,
                              presence:
                                current.presence === presence ? null : presence,
                            })
                          }
                        >
                          {label}
                        </CheckItem>
                      ))}
                      {choices.map((value) => (
                        <CheckItem
                          key={value}
                          checked={current.values.includes(value)}
                          onChange={() =>
                            setFilter({
                              ...current,
                              values: current.values.includes(value)
                                ? current.values.filter((v) => v !== value)
                                : [...current.values, value],
                            })
                          }
                        >
                          {valueLabel(field, value)}
                        </CheckItem>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
        </div>
      )}
    </Popover>
  );

  const more = (
    <Popover label="⋯" ariaLabel="Viewの名前と削除">
      {(close) => (
        <div className="od-menu">
          <h3>Viewの名前</h3>
          <input
            key={view.name}
            aria-label="Viewの名前"
            defaultValue={view.name}
            onKeyDown={commitOnEnter}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim();
              if (name && name !== view.name) update({ name });
            }}
          />
          <button
            type="button"
            onClick={() => {
              close();
              saveViews(owner.views.filter((v) => v.id !== view.id));
            }}
          >
            このViewを削除
          </button>
          {scope === "object" ? (
            <p>このViewは、#{typeLabel(owner.name)}のすべてのページに出る</p>
          ) : null}
        </div>
      )}
    </Popover>
  );

  /* ---------- 表のセル ---------- */

  const empty = <span className="od-cell-empty">—</span>;
  const refCell = (row: ViewRow, field: FieldDefinition): React.JSX.Element => {
    const value = row.values[field.id] ?? [];
    const ids = field.kind === "context" ? row.object.contexts : refIds(value);
    // 文字も書いてある参照は、ここで書き換えると文字が消えるので、ページで編集する。
    if (
      field.kind !== "context" &&
      value.some((node) => isText(node) && node.text?.trim())
    )
      return <span>{textOf(value)}</span>;
    return (
      <span className="od-cell-refs">
        {ids.map((id) => (
          <span key={id} className="od-chip">
            <button type="button" onClick={() => open(id)}>
              {lookup(id)?.title ?? "…"}
            </button>
            <button
              type="button"
              aria-label={`${lookup(id)?.title ?? ""}を外す`}
              onClick={() =>
                write(
                  row,
                  field.id,
                  refNodes(ids.filter((other) => other !== id)),
                )
              }
            >
              ×
            </button>
          </span>
        ))}
        <Popover
          className="od-cell-pop"
          label="＋"
          ariaLabel={`${row.object.title}の${field.name}を追加`}
        >
          {(close) => (
            <Chooser
              placeholder="Objectを探す"
              load={async (query) =>
                (await client.searchObjects(query, row.object.id)).map(
                  (object) => ({
                    key: object.id,
                    label: object.title,
                    note: `#${typeLabel(object.type)}`,
                  }),
                )
              }
              onPick={(choice) => {
                close();
                write(
                  row,
                  field.id,
                  refNodes([...new Set([...ids, choice.key])]),
                );
              }}
            />
          )}
        </Popover>
      </span>
    );
  };
  const cell = (row: ViewRow, field: FieldDefinition): React.JSX.Element => {
    if (field.kind === "context" || field.kind === "reference")
      return refCell(row, field);
    const value = row.values[field.id] ?? [];
    const text = textOf(value);
    const label = `${row.object.title}の${field.name}`;
    if (field.kind === "date")
      return (
        <Popover
          className="od-cell-pop"
          ariaLabel={label}
          label={text ? formatDate(text) : empty}
        >
          {(close) => (
            <DatePanel
              value={text}
              onPick={(date) => {
                close();
                if (date !== text) write(row, field.id, textNodes(date));
              }}
            />
          )}
        </Popover>
      );
    if (field.kind === "select") {
      const options = field.options ?? [];
      const pick = (next: string): void => {
        if (next !== text) write(row, field.id, textNodes(next));
      };
      return (
        <Popover
          className="od-cell-pop"
          ariaLabel={label}
          label={text ? <span className="od-pill">{text}</span> : empty}
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
                  pick(choice.key);
                }}
                // 候補に無い値は、選択肢にも足す。
                onCreate={(created) => {
                  close();
                  setField(field.id, { options: [...options, created] });
                  pick(created);
                }}
              />
              {text ? (
                <div className="od-menu">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      pick("");
                    }}
                  >
                    値を消す
                  </button>
                </div>
              ) : null}
            </>
          )}
        </Popover>
      );
    }
    // 参照が混ざる文は、ここで書き換えると参照が消えるので、ページで編集する。
    if (!value.every(isText)) return <span>{text}</span>;
    return (
      <input
        key={text}
        className="od-cell-input"
        aria-label={label}
        defaultValue={text}
        onKeyDown={commitOnEnter}
        onBlur={(event) => {
          if (event.currentTarget.value !== text)
            write(row, field.id, textNodes(event.currentTarget.value));
        }}
      />
    );
  };
  /** 追加行で「#」に続けて打っている間の、名前が前方一致する種別 */
  const word = /^#(\S*)$/.exec(newText)?.[1]?.toLowerCase();
  const suggestions =
    word === undefined
      ? []
      : types.filter((definition) =>
          [definition.name, typeLabel(definition.name)].some((candidate) =>
            candidate.toLowerCase().startsWith(word),
          ),
        );
  const complete = (definition: TypeDefinition): void => {
    setNewText(`#${typeLabel(definition.name)} `);
    setPick(0);
  };
  /** 畳んだ行の配下を除いた行。parentは、下に入れ子の行があるか。 */
  const rows: { row: ViewRow; parent: boolean }[] = [];
  let hideBelow: number | null = null;
  for (const [i, row] of (data?.rows ?? []).entries()) {
    if (hideBelow !== null && row.depth > hideBelow) continue;
    hideBelow = folded.has(row.object.id) ? row.depth : null;
    rows.push({
      row,
      parent: (data?.rows[i + 1]?.depth ?? 0) > row.depth,
    });
  }
  const titleCell = (row: ViewRow, parent: boolean): React.JSX.Element => {
    const { object } = row;
    const title = object.title === "無題" ? "" : object.title;
    const closed = folded.has(object.id);
    return (
      <span className="od-cell-title">
        {view.nested ? (
          <button
            type="button"
            className="od-cell-fold"
            aria-label={closed ? "配下を開く" : "配下を畳む"}
            aria-expanded={!closed}
            disabled={!parent}
            onClick={() => {
              const next = new Set(folded);
              if (closed) next.delete(object.id);
              else next.add(object.id);
              setFolds({ viewId: view.id, ids: next });
              store(`fold:${view.id}`, [...next]);
            }}
          >
            {parent ? (closed ? "▸" : "▾") : ""}
          </button>
        ) : null}
        {typeOf(object.type)?.checkbox ? (
          <input
            type="checkbox"
            aria-label={`${object.title}を完了にする`}
            checked={object.done}
            onChange={() =>
              act(() => client.patchObject(object.id, { done: !object.done }))
            }
          />
        ) : null}
        {row.titleEditable ? (
          <input
            key={title}
            className="od-cell-input"
            aria-label="Title"
            placeholder="無題"
            defaultValue={title}
            onKeyDown={commitOnEnter}
            onBlur={(event) => {
              const next = event.currentTarget.value.trim();
              if (next !== title)
                act(() => client.patchObject(object.id, { title: next }));
            }}
          />
        ) : (
          <span>{object.title}</span>
        )}
        {object.type === target?.name ? null : (
          <span
            className="od-type"
            data-type={object.type}
            data-color={typeOf(object.type)?.color ?? undefined}
          >
            {typeLabel(object.type)}
          </span>
        )}
        <button
          type="button"
          className="od-cell-open"
          aria-label={`${object.title}を開く`}
          title="ページを開く"
          onClick={() => open(object.id)}
        >
          ↗
        </button>
        <button
          type="button"
          className="od-cell-open"
          aria-label={`${object.title}をゴミ箱へ移す`}
          title="ゴミ箱へ移す"
          onClick={() => trash(object)}
        >
          ×
        </button>
      </span>
    );
  };

  const tableView = (
    <div className="od-table-wrap">
      <table className="od-table">
        <thead>
          <tr>
            <th>Title</th>
            {columns.map((field) => (
              <th key={field.id}>
                <Popover
                  label={`${field.name}${view.sort === field.id ? (view.desc ? " ↓" : " ↑") : ""}`}
                  ariaLabel={`列「${field.name}」`}
                >
                  {(close) => (
                    <div className="od-menu">
                      {field.kind === "context" ? null : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              close();
                              update({
                                sort: field.id,
                                desc: false,
                                thenBy: view.thenBy.filter(
                                  (level) => level.by !== field.id,
                                ),
                              });
                            }}
                          >
                            昇順で並べ替え ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              close();
                              update({
                                sort: field.id,
                                desc: true,
                                thenBy: view.thenBy.filter(
                                  (level) => level.by !== field.id,
                                ),
                              });
                            }}
                          >
                            降順で並べ替え ↓
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          update({ hidden: [...view.hidden, field.id] });
                        }}
                      >
                        列を隠す
                      </button>
                      {field.kind === "context" ? null : (
                        <>
                          <h3>Field</h3>
                          <input
                            key={field.name}
                            aria-label="Fieldの名前"
                            defaultValue={field.name}
                            onKeyDown={commitOnEnter}
                            onBlur={(event) => {
                              const name = event.currentTarget.value.trim();
                              if (name && name !== field.name)
                                setField(field.id, { name });
                            }}
                          />
                          <div className="od-chips">
                            {KINDS.map(([kind, label]) => (
                              <button
                                key={kind}
                                type="button"
                                aria-pressed={field.kind === kind}
                                onClick={() => setField(field.id, { kind })}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </Popover>
              </th>
            ))}
            <th>
              {target ? (
                <button
                  type="button"
                  aria-label="Fieldを追加"
                  title={`#${typeLabel(target.name)}にFieldを追加`}
                  onClick={() =>
                    patchType(target.name, {
                      fields: [
                        ...target.fields,
                        { id: newId(), name: "新しいField", kind: "text" },
                      ],
                    })
                  }
                >
                  ＋
                </button>
              ) : null}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, parent }) => {
            // 入れ子の行は種別が違うことがある。その種別に無いFieldは空にする。
            const own = fieldsOf(row.object.type);
            return (
              <tr key={row.object.id}>
                <td style={{ paddingLeft: `${8 + row.depth * 20}px` }}>
                  {titleCell(row, parent)}
                </td>
                {columns.map((field) => (
                  <td key={field.id}>
                    {own.some((candidate) => candidate.id === field.id)
                      ? cell(row, field)
                      : null}
                  </td>
                ))}
                <td />
              </tr>
            );
          })}
          {target || scope === "object" ? (
            <tr>
              <td colSpan={columns.length + 2}>
                <input
                  className="od-cell-input od-table-new"
                  value={newText}
                  onChange={(event) => {
                    setNewText(event.currentTarget.value);
                    setPick(0);
                  }}
                  aria-label={
                    target ? `#${typeLabel(target.name)}を追加` : "Objectを追加"
                  }
                  placeholder={
                    target ? `＋ #${typeLabel(target.name)}` : "＋ 追加"
                  }
                  title="「#種別 Title」で、ほかの種別も追加できる"
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    // 候補が出ている間は、矢印で選び、EnterかTabで種別を入れる。
                    if (suggestions.length) {
                      const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
                      if (move) {
                        event.preventDefault();
                        setPick(
                          (pick + move + suggestions.length) %
                            suggestions.length,
                        );
                        return;
                      }
                      if (event.key === "Enter" || event.key === "Tab") {
                        event.preventDefault();
                        complete(suggestions[pick] ?? suggestions[0]!);
                        return;
                      }
                    }
                    const typed = newText.trim();
                    if (
                      event.key !== "Enter" ||
                      event.nativeEvent.isComposing ||
                      !typed
                    )
                      return;
                    // 「#Memo 考え」のように、先頭の#で種別を選べる。
                    const [, word = "", rest = ""] =
                      /^#(\S+)\s*(.*)$/.exec(typed) ?? [];
                    const named = types.find((definition) =>
                      [definition.name, typeLabel(definition.name)].some(
                        (candidate) =>
                          candidate.toLowerCase() === word.toLowerCase(),
                      ),
                    );
                    const type = named ?? target;
                    const title = named ? rest.trim() : typed;
                    if (!type) return;
                    setNewText("");
                    // 一つの値で絞っている選択は、新しいObjectの初期値にする。
                    const initial = Object.fromEntries(
                      type.name !== target?.name
                        ? []
                        : view.filters
                            .filter(
                              (candidate) =>
                                candidate.values.length === 1 &&
                                fields.some(
                                  (field) =>
                                    field.id === candidate.fieldId &&
                                    field.kind === "select",
                                ),
                            )
                            .map((candidate) => [
                              candidate.fieldId,
                              textNodes(candidate.values[0]!),
                            ]),
                    );
                    act(async () => {
                      const id = newId();
                      await client.createObject({
                        id,
                        type: type.name,
                        title,
                        parentId: anchorId,
                      });
                      if (Object.keys(initial).length)
                        await client.patchObject(id, { fields: initial });
                    });
                  }}
                />
                {suggestions.length ? (
                  <div className="od-chips od-type-suggest" role="listbox">
                    {suggestions.map((definition, index) => (
                      <button
                        key={definition.name}
                        type="button"
                        role="option"
                        aria-selected={index === pick}
                        // 入力欄からフォーカスを外さずに選ぶ。
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => complete(definition)}
                      >
                        #{typeLabel(definition.name)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );

  /* ---------- Timeline ---------- */

  const viaNote = (via: readonly string[]): string =>
    via.length ? `via ${via.join(" › ")}` : "";
  const entryRow = (entry: ObjectTimelineEntry): React.JSX.Element => {
    if (entry.kind === "unit")
      return (
        <li
          className="od-row"
          data-type="mention"
          key={`${entry.hostId}-${entry.unitId}`}
        >
          <span className="od-type">
            {entry.unitKind === "section" ? "見出し" : "言及"}
          </span>
          <button type="button" onClick={() => open(entry.hostId)}>
            <strong>{entry.text}</strong>
            <small>
              {[entry.hostTitle, viaNote(entry.via)]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </button>
          <time>{formatTime(entry.time)}</time>
        </li>
      );
    const { object } = entry;
    const note = entry.mentioned
      ? [entry.field ? `${entry.field}で言及` : "言及", viaNote(entry.via)]
          .filter(Boolean)
          .join(" · ")
      : viaNote(entry.via) || (anchorId ? "直接" : "");
    return (
      <li
        className="od-row"
        data-type={object.type}
        data-color={typeOf(object.type)?.color ?? undefined}
        key={object.id}
      >
        <span className="od-type">{typeLabel(object.type)}</span>
        <button type="button" onClick={() => open(object.id)}>
          <strong>{object.title}</strong>
          {note ? <small>{note}</small> : null}
        </button>
        {typeOf(object.type)?.checkbox ? (
          <span className="od-row-status" data-done={object.done}>
            {object.done ? "完了" : "未完了"}
          </span>
        ) : null}
        <time>{formatTime(entry.time)}</time>
      </li>
    );
  };

  return (
    <section className="od-panel">
      {tabs}
      <div className="od-view-tools">
        {display}
        {table ? sort : null}
        {filter}
        {more}
      </div>
      {table ? (
        tableView
      ) : data?.entries.length ? (
        <ul className="od-rows">{data.entries.map(entryRow)}</ul>
      ) : (
        <p className="od-empty">まだありません。</p>
      )}
    </section>
  );
};
