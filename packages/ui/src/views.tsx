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
  type ViewResult,
  type ViewRow,
} from "@pkm/core";
import { typeLabel } from "@pkm/editor";
import { useEffect, useState } from "react";

import { dateRange, localDate } from "./object-date.js";

export const KIND_LABEL = {
  text: "テキスト",
  reference: "参照",
  date: "日付",
  select: "選択",
} as const;

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

/** 参照するObjectを、@と同じ候補から選ぶ。 */
const RefPicker = ({
  client,
  exclude,
  onPick,
}: {
  readonly client: ObjectClient;
  readonly exclude: string;
  readonly onPick: (id: string) => void;
}): React.JSX.Element => {
  const [query, setQuery] = useState<string | null>(null);
  const [found, setFound] = useState<readonly ObjectSummary[]>([]);
  useEffect(() => {
    if (query === null) return;
    let live = true;
    void client.searchObjects(query, exclude).then(
      (result) => {
        if (live) setFound(result);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [query]);
  if (query === null)
    return (
      <button
        type="button"
        className="od-cell-add"
        aria-label="参照を追加"
        onClick={() => setQuery("")}
      >
        ＋
      </button>
    );
  return (
    <span className="od-picker">
      <input
        autoFocus
        aria-label="参照するObject"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onBlur={() => setQuery(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setQuery(null);
        }}
      />
      <ul>
        {found.map((object) => (
          <li key={object.id}>
            <button
              type="button"
              // 入力欄のフォーカスを保ち、クリックより先に閉じないようにする。
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuery(null);
                onPick(object.id);
              }}
            >
              {object.title}
              <small>#{typeLabel(object.type)}</small>
            </button>
          </li>
        ))}
      </ul>
    </span>
  );
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
}: ViewTabsProps): React.JSX.Element => {
  const views = owner.views.filter((candidate) => candidate.scope === scope);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState<{
    readonly viewId: string;
    readonly data: ViewResult;
  } | null>(null);
  const view = views.find((candidate) => candidate.id === selected) ?? views[0];
  const viewId = view?.id;

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
    setSelected(id);
    setEditing(true);
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
          onClick={() => setSelected(candidate.id)}
        >
          {candidate.name}
        </button>
      ))}
      <button
        type="button"
        onClick={() =>
          add({
            scope,
            name: "新しいView",
            layout: "table",
            type: null,
            reach: "direct",
            done: "all",
            filters: [],
            sort: "created",
            desc: true,
            hidden: [],
            nested: false,
          })
        }
      >
        ＋ View
      </button>
      {inheritable.length ? (
        <select
          aria-label="継承元のViewを複製"
          value=""
          onChange={(event) => {
            const source = inheritable.find(
              (candidate) => candidate.id === event.currentTarget.value,
            );
            if (source) add(source);
          }}
        >
          <option value="">継承元から複製…</option>
          {inheritable.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      ) : null}
      {view ? (
        <button
          type="button"
          className="od-view-edit"
          aria-pressed={editing}
          onClick={() => setEditing(!editing)}
        >
          Viewの設定
        </button>
      ) : null}
    </div>
  );
  if (!view) return <section className="od-panel">{tabs}</section>;

  const update = (patch: Partial<ViewDefinition>): void =>
    saveViews(
      owner.views.map((candidate) =>
        candidate.id === view.id ? { ...candidate, ...patch } : candidate,
      ),
    );
  /** 絞り込む種別。種別のページではその種別、Objectのページでは選んだ種別。 */
  const target = types.find(
    (definition) =>
      definition.name === (scope === "type" ? owner.name : view.type),
  );
  const fields: readonly FieldDefinition[] = target
    ? [...target.fields, ...target.inherited]
    : [CONTEXT_FIELD];
  const columns = fields.filter((field) => !view.hidden.includes(field.id));
  const data = loaded?.viewId === view.id ? loaded.data : null;
  const typeOf = (name: string): TypeDefinition | undefined =>
    types.find((definition) => definition.name === name);
  const write = (row: ViewRow, fieldId: string, value: DocNode[]): void =>
    act(() =>
      client.patchObject(row.object.id, { fields: { [fieldId]: value } }),
    );
  const setField = (id: string, patch: Partial<FieldDefinition>): void => {
    if (target)
      patchType(target.name, {
        fields: target.fields.map((field) =>
          field.id === id ? { ...field, ...patch } : field,
        ),
      });
  };

  const settings = (
    <div className="od-view-settings">
      <label>
        名前
        <input
          key={view.name}
          defaultValue={view.name}
          onKeyDown={commitOnEnter}
          onBlur={(event) => {
            const name = event.currentTarget.value.trim();
            if (name && name !== view.name) update({ name });
          }}
        />
      </label>
      <label>
        表示形式
        <select
          value={view.layout}
          onChange={(event) =>
            update({
              layout: event.currentTarget.value as ViewDefinition["layout"],
            })
          }
        >
          <option value="table">表</option>
          <option value="timeline">Timeline</option>
        </select>
      </label>
      {scope === "object" ? (
        <>
          <label>
            種別
            <select
              value={view.type ?? ""}
              onChange={(event) =>
                update({ type: event.currentTarget.value || null, filters: [] })
              }
            >
              <option value="">すべて</option>
              {types.map((definition) => (
                <option key={definition.name} value={definition.name}>
                  #{typeLabel(definition.name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            範囲
            <select
              value={view.reach}
              // 階層では、直接の配下を行にして、その下へ辿る。
              disabled={view.layout === "table" && view.nested}
              onChange={(event) =>
                update({
                  reach: event.currentTarget.value as ViewDefinition["reach"],
                })
              }
            >
              <option value="direct">直接の配下</option>
              <option value="all">配下のすべて</option>
            </select>
          </label>
        </>
      ) : null}
      {view.layout === "table" ? (
        <label>
          <input
            type="checkbox"
            checked={view.nested}
            onChange={() => update({ nested: !view.nested })}
          />
          階層で表示
        </label>
      ) : null}
      <label>
        完了
        <select
          value={view.done}
          onChange={(event) =>
            update({
              done: event.currentTarget.value as ViewDefinition["done"],
            })
          }
        >
          <option value="all">すべて</option>
          <option value="open">未完了だけ</option>
          <option value="done">完了だけ</option>
        </select>
      </label>
      {fields
        .filter((field) => field.kind === "select" || field.kind === "date")
        .map((field) => (
          <label key={field.id}>
            {field.name}
            <select
              value={
                view.filters.find((filter) => filter.fieldId === field.id)
                  ?.value ?? ""
              }
              onChange={(event) => {
                const value = event.currentTarget.value;
                update({
                  filters: [
                    ...view.filters.filter(
                      (filter) => filter.fieldId !== field.id,
                    ),
                    ...(value ? [{ fieldId: field.id, value }] : []),
                  ],
                });
              }}
            >
              <option value="">指定なし</option>
              {field.kind === "date"
                ? DATE_FILTERS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))
                : (field.options ?? []).map((option) => (
                    <option key={option}>{option}</option>
                  ))}
            </select>
          </label>
        ))}
      {view.layout === "table" ? (
        <>
          <label>
            並べ替え
            <select
              value={view.sort}
              onChange={(event) => update({ sort: event.currentTarget.value })}
            >
              <option value="created">作成日</option>
              <option value="updated">更新日</option>
              <option value="title">Title</option>
              {fields
                .filter((field) => field.kind !== "context")
                .map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={view.desc}
              onChange={() => update({ desc: !view.desc })}
            />
            降順
          </label>
          {fields
            .filter((field) => view.hidden.includes(field.id))
            .map((field) => (
              <button
                key={field.id}
                type="button"
                onClick={() =>
                  update({
                    hidden: view.hidden.filter((id) => id !== field.id),
                  })
                }
              >
                列「{field.name}」を出す
              </button>
            ))}
        </>
      ) : null}
      <button
        type="button"
        onClick={() => saveViews(owner.views.filter((v) => v.id !== view.id))}
      >
        このViewを削除
      </button>
      {scope === "object" ? (
        <p>このViewは、#{typeLabel(owner.name)}のすべてのページに出る</p>
      ) : null}
    </div>
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
  const refCell = (row: ViewRow, field: FieldDefinition): React.JSX.Element => {
    const value = row.values[field.id] ?? [];
    const ids = field.kind === "context" ? row.object.contexts : refIds(value);
    // 文字も書いてある参照は、ここで書き換えると文字が消えるので、ページで編集する。
    const editable =
      field.kind === "context" ||
      value.every((node) => !isText(node) || !node.text?.trim());
    if (!editable) return <span>{textOf(value)}</span>;
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
        <RefPicker
          client={client}
          exclude={row.object.id}
          onPick={(id) =>
            write(row, field.id, refNodes([...new Set([...ids, id])]))
          }
        />
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
        <input
          key={text}
          type="date"
          aria-label={label}
          defaultValue={text}
          onChange={(event) =>
            write(row, field.id, textNodes(event.currentTarget.value))
          }
        />
      );
    if (field.kind === "select")
      return (
        <select
          key={text}
          aria-label={label}
          defaultValue={text}
          onChange={(event) =>
            write(row, field.id, textNodes(event.currentTarget.value))
          }
        >
          <option value="" />
          {[
            ...new Set([...(field.options ?? []), ...(text ? [text] : [])]),
          ].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    // 参照が混ざる文は、ここで書き換えると参照が消えるので、ページで編集する。
    if (!value.every(isText)) return <span>{text}</span>;
    return (
      <input
        key={text}
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

  const table = (
    <div className="od-table-wrap">
      <table className="od-table">
        <thead>
          <tr>
            <th>Title</th>
            {columns.map((field) => (
              <th key={field.id}>
                <details name="od-column">
                  <summary>
                    {field.name}
                    {view.sort === field.id ? (view.desc ? " ↓" : " ↑") : ""}
                  </summary>
                  <div className="od-column-menu">
                    {field.kind === "context" ? null : (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            update({ sort: field.id, desc: false })
                          }
                        >
                          昇順で並べ替え
                        </button>
                        <button
                          type="button"
                          onClick={() => update({ sort: field.id, desc: true })}
                        >
                          降順で並べ替え
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        update({ hidden: [...view.hidden, field.id] })
                      }
                    >
                      列を隠す
                    </button>
                    {field.kind !== "context" &&
                    target?.fields.some((own) => own.id === field.id) ? (
                      <>
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
                        <select
                          aria-label="Fieldの型"
                          value={field.kind}
                          onChange={(event) =>
                            setField(field.id, {
                              kind: event.currentTarget
                                .value as keyof typeof KIND_LABEL,
                            })
                          }
                        >
                          {Object.entries(KIND_LABEL).map(([kind, label]) => (
                            <option key={kind} value={kind}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : null}
                  </div>
                </details>
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
          {(data?.rows ?? []).map((row) => (
            <tr key={row.object.id}>
              <td style={{ paddingLeft: `${8 + row.depth * 20}px` }}>
                <span className="od-cell-title">
                  {typeOf(row.object.type)?.checkbox ? (
                    <input
                      type="checkbox"
                      aria-label={`${row.object.title}を完了にする`}
                      checked={row.object.done}
                      onChange={() =>
                        act(() =>
                          client.patchObject(row.object.id, {
                            done: !row.object.done,
                          }),
                        )
                      }
                    />
                  ) : null}
                  <button type="button" onClick={() => open(row.object.id)}>
                    {row.object.title}
                  </button>
                  {target ? null : (
                    <span
                      className="od-type"
                      data-type={row.object.type}
                      data-color={typeOf(row.object.type)?.color ?? undefined}
                    >
                      {typeLabel(row.object.type)}
                    </span>
                  )}
                </span>
              </td>
              {columns.map((field) => (
                <td key={field.id}>{cell(row, field)}</td>
              ))}
              <td />
            </tr>
          ))}
          {target ? (
            <tr>
              <td colSpan={columns.length + 2}>
                <input
                  className="od-table-new"
                  aria-label={`#${typeLabel(target.name)}を追加`}
                  placeholder={`＋ #${typeLabel(target.name)}を追加（Enter）`}
                  onKeyDown={(event) => {
                    const input = event.currentTarget;
                    const title = input.value.trim();
                    if (
                      event.key !== "Enter" ||
                      event.nativeEvent.isComposing ||
                      !title
                    )
                      return;
                    input.value = "";
                    // 選択の条件は、新しいObjectの初期値にする。
                    const initial = Object.fromEntries(
                      view.filters
                        .filter((filter) =>
                          fields.some(
                            (field) =>
                              field.id === filter.fieldId &&
                              field.kind === "select",
                          ),
                        )
                        .map((filter) => [
                          filter.fieldId,
                          textNodes(filter.value),
                        ]),
                    );
                    act(async () => {
                      const id = newId();
                      await client.createObject({
                        id,
                        type: target.name,
                        title,
                        parentId: anchorId,
                      });
                      if (Object.keys(initial).length)
                        await client.patchObject(id, { fields: initial });
                    });
                  }}
                />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );

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
      {editing ? settings : null}
      {view.layout === "table" ? (
        table
      ) : data?.entries.length ? (
        <ul className="od-rows">{data.entries.map(entryRow)}</ul>
      ) : (
        <p className="od-empty">まだありません。</p>
      )}
    </section>
  );
};
