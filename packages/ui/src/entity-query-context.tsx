import type { PkmEntityOption } from "@pkm/contracts";
import { createContext, useContext, useEffect, useState } from "react";
import {
  MultiSelect,
  Select,
  TagsInput,
  type MultiSelectProps,
  type SelectProps,
  type TagsInputProps,
} from "@mantine/core";
import type { EntityPage, EntityPageQuery, EntityType } from "@pkm/contracts";

export interface EntityQuerySource {
  readonly vaultId?: string | undefined;
  readonly ready?: boolean;
  readonly getCachedPage?: (query: EntityPageQuery) => EntityPage | undefined;
  readonly query: (
    query: EntityPageQuery,
    signal?: AbortSignal,
  ) => Promise<EntityPage>;
  readonly revision: number;
  readonly labelRevision?: number;
  readonly calendarRevision: number;
  readonly options: (
    query: EntityPageQuery,
    signal?: AbortSignal,
  ) => Promise<readonly PkmEntityOption[]>;
}
export const EntityQueryContext = createContext<EntityQuerySource | null>(null);

const useSuggestions = (type: EntityType | readonly EntityType[]) => {
  const source = useContext(EntityQueryContext);
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState("");
  const [composing, setComposing] = useState(false);
  const [options, setOptions] = useState<{ value: string; label: string }[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const typeKey = JSON.stringify(type);
  useEffect(() => {
    if (!source || !opened || source.ready === false || composing) return;
    const controller = new AbortController();
    setError(null);
    setOptions([]);
    const timer = setTimeout(() => {
      const types = JSON.parse(typeKey) as EntityType | EntityType[];
      void source
        .options(
          {
            ...(typeof types === "string" ? { type: types } : { types }),
            q: search,
            nameOnly: true,
            limit: 30,
          },
          controller.signal,
        )
        .then((items) => {
          if (!controller.signal.aborted)
            setOptions(
              items.map((e) => ({
                value: e.id,
                label: e.displayName ?? e.id,
              })),
            );
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : String(reason));
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, source?.revision, opened, search, typeKey, composing]);
  return {
    remote: source !== null,
    options,
    error,
    setOpened,
    setSearch,
    setComposing,
  };
};
const seedOptions = (data: SelectProps["data"], selected: readonly string[]) =>
  (data ?? []).flatMap((item) =>
    typeof item === "string"
      ? selected.includes(item)
        ? [{ value: item, label: item }]
        : []
      : "value" in item && selected.includes(item.value)
        ? [item]
        : [],
  );

// Persisted capture context and selection IDs may not be in the current page.
// Resolve only those labels instead of preloading the entire option collection.
const useSelectedOptions = (
  data: SelectProps["data"],
  selected: readonly string[],
) => {
  const source = useContext(EntityQueryContext);
  const seeded = seedOptions(data, selected);
  const missingKey = JSON.stringify(
    selected.filter((id) => !seeded.some((item) => item.value === id)),
  );
  const [options, setOptions] = useState<{ value: string; label: string }[]>(
    [],
  );
  useEffect(() => {
    if (!source || source.ready === false) return;
    const ids = JSON.parse(missingKey) as string[];
    if (!ids.length) return;
    const controller = new AbortController();
    void Promise.all(
      Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
        source.options(
          { ids: ids.slice(i * 100, (i + 1) * 100), limit: 100 },
          controller.signal,
        ),
      ),
    )
      .then((pages) => {
        if (!controller.signal.aborted)
          setOptions(
            pages.flatMap((items) =>
              items.map((entity) => ({
                value: entity.id,
                label: entity.displayName ?? entity.id,
              })),
            ),
          );
      })
      .catch(() => {
        /* ID remains visible if label lookup is unavailable. */
      });
    return () => controller.abort();
  }, [source, missingKey]);
  return options.filter((item) => selected.includes(item.value));
};

export const EntitySelect = ({
  entityType,
  ...props
}: SelectProps & { entityType: EntityType | readonly EntityType[] }) => {
  const s = useSuggestions(entityType);
  const selected = props.value == null ? [] : [props.value];
  const selectedOptions = useSelectedOptions(props.data, selected);
  if (!s.remote) return <Select {...props} />;
  const data = [
    ...new Map(
      [
        ...selectedOptions,
        ...seedOptions(props.data, selected),
        ...s.options,
      ].map((item) => [item.value, item]),
    ).values(),
  ];
  for (const id of selected)
    if (!data.some((item) => item.value === id))
      data.push({ value: id, label: id });
  return (
    <Select
      {...props}
      data={data}
      searchable
      filter={({ options }) => options}
      onDropdownOpen={() => s.setOpened(true)}
      onDropdownClose={() => s.setOpened(false)}
      onSearchChange={s.setSearch}
      onCompositionStart={() => s.setComposing(true)}
      onCompositionEnd={() => s.setComposing(false)}
      nothingFoundMessage={s.error ?? "候補なし（検索で絞り込めます）"}
      error={props.error ?? s.error}
    />
  );
};
export const EntityMultiSelect = ({
  entityType,
  excludeIds = [],
  ...props
}: MultiSelectProps & {
  entityType: EntityType;
  excludeIds?: readonly string[];
}) => {
  const s = useSuggestions(entityType);
  const selectedOptions = useSelectedOptions(props.data, props.value ?? []);
  if (!s.remote) return <MultiSelect {...props} />;
  const data = [
    ...new Map(
      [
        ...selectedOptions,
        ...seedOptions(props.data, props.value ?? []),
        ...s.options,
      ].map((item) => [item.value, item]),
    ).values(),
  ];
  return (
    <MultiSelect
      {...props}
      data={data.filter((option) => !excludeIds.includes(option.value))}
      searchable
      filter={({ options }) => options}
      onDropdownOpen={() => s.setOpened(true)}
      onDropdownClose={() => s.setOpened(false)}
      onSearchChange={s.setSearch}
      onCompositionStart={() => s.setComposing(true)}
      onCompositionEnd={() => s.setComposing(false)}
      error={props.error ?? s.error}
    />
  );
};
export const EntityTagsInput = (props: TagsInputProps) => {
  const s = useSuggestions("topic");
  return (
    <TagsInput
      {...props}
      {...(s.remote
        ? {
            data: s.options.map((item) => item.label),
            onDropdownOpen: () => s.setOpened(true),
            onDropdownClose: () => s.setOpened(false),
            onSearchChange: s.setSearch,
            onCompositionStart: () => s.setComposing(true),
            onCompositionEnd: () => s.setComposing(false),
            error: props.error ?? s.error,
          }
        : {})}
    />
  );
};
