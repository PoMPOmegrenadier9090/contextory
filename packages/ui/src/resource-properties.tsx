import { Button, Group, Popover, Stack, TagsInput } from "@mantine/core";
import { useState } from "react";
import {
  ENTITY_ID_PREFIXES,
  type EntityType,
  type PkmEntitySummary,
} from "@pkm/contracts";
import { EntityMultiSelect } from "./entity-query-context.js";

const relatedTypes = ["area", "project", "task", "resource"] as const;
const isType = (id: string, type: EntityType): boolean =>
  id.startsWith(`${ENTITY_ID_PREFIXES[type]}_`);

export const ResourceAuthorsInput = ({
  value,
  disabled = false,
  onChange,
  label = "著者",
}: {
  readonly value: readonly string[];
  readonly disabled?: boolean;
  readonly label?: string;
  readonly onChange: (values: string[]) => void;
}): React.JSX.Element => (
  <TagsInput
    label={label}
    placeholder="著者名を入力してEnter"
    value={[...value]}
    disabled={disabled}
    clearable
    splitChars={[",", "、"]}
    comboboxProps={{ withinPortal: false }}
    onChange={onChange}
  />
);

export const ResourceRelationsInput = ({
  entityId,
  value,
  entities,
  disabled = false,
  onChange,
}: {
  readonly entityId: string;
  readonly value: readonly string[];
  readonly entities: readonly PkmEntitySummary[];
  readonly disabled?: boolean;
  readonly onChange: (values: string[]) => void;
}): React.JSX.Element => (
  <Stack gap="xs">
    {relatedTypes.map((type) => (
      <EntityMultiSelect
        key={type}
        entityType={type}
        excludeIds={[entityId]}
        label={`関連${type[0]!.toUpperCase()}${type.slice(1)}`}
        searchable
        clearable
        disabled={disabled}
        value={value.filter((id) => isType(id, type))}
        data={[
          ...entities
            .filter(
              (entity) =>
                entity.type === type &&
                entity.id !== entityId &&
                entity.deletedAt === null,
            )
            .map((entity) => ({
              value: entity.id,
              label: entity.displayName ?? entity.id,
            })),
          ...value
            .filter(
              (id) =>
                isType(id, type) &&
                !entities.some(
                  (entity) => entity.id === id && entity.deletedAt === null,
                ),
            )
            .map((id) => ({ value: id, label: id })),
        ]}
        comboboxProps={{ withinPortal: false }}
        onChange={(ids) =>
          onChange([...value.filter((id) => !isType(id, type)), ...ids])
        }
      />
    ))}
  </Stack>
);

export const ResourcePropertyCell = ({
  kind,
  entity,
  entities,
  readOnly,
  disabled,
  onCommit,
}: {
  readonly kind: "authors" | "relatedEntities";
  readonly entity: PkmEntitySummary;
  readonly entities: readonly PkmEntitySummary[];
  readonly readOnly: boolean;
  readonly disabled: boolean;
  readonly onCommit: (values: string[]) => void;
}): React.JSX.Element => {
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const values =
    kind === "authors"
      ? (entity.authors ?? [])
      : (entity.relatedEntityIds ?? []);
  const text =
    values
      .map((value) =>
        kind === "authors"
          ? value
          : (entities.find((candidate) => candidate.id === value)
              ?.displayName ?? value),
      )
      .join(", ") || "—";
  const label = `${entity.displayName ?? entity.id}の${kind === "authors" ? "著者" : "関連"}`;
  if (readOnly)
    return (
      <span className="entity-topics-text" title={text}>
        {text}
      </span>
    );
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      width={320}
      withinPortal
      trapFocus
      shadow="sm"
    >
      <Popover.Target>
        <button
          className="entity-topics-button"
          type="button"
          aria-label={label}
          title={text}
          aria-expanded={opened}
          disabled={disabled}
          onClick={() => {
            setDraft([...values]);
            setOpened((value) => !value);
          }}
        >
          {text}
        </button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          {kind === "authors" ? (
            <ResourceAuthorsInput value={draft} onChange={setDraft} />
          ) : (
            <ResourceRelationsInput
              entityId={entity.id}
              value={draft}
              entities={entities}
              onChange={setDraft}
            />
          )}
          <Group justify="flex-end">
            <Button size="xs" variant="subtle" onClick={() => setOpened(false)}>
              取消
            </Button>
            <Button
              size="xs"
              onClick={() => {
                onCommit(draft);
                setOpened(false);
              }}
            >
              保存
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};
