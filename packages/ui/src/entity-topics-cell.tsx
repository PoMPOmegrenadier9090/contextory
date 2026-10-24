import { EntityTagsInput } from "./entity-query-context.js";
import { Popover } from "@mantine/core";
import { useState } from "react";

export const EntityTopicsCell = ({
  label,
  value,
  options,
  readOnly = false,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly value: readonly string[];
  readonly options: readonly string[];
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
  readonly onChange: (value: string[]) => void;
}): React.JSX.Element => {
  const [opened, setOpened] = useState(false);
  const text = value.length === 0 ? "—" : value.join(", ");
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
      width={300}
      shadow="sm"
      withinPortal
      trapFocus
    >
      <Popover.Target>
        <button
          type="button"
          className="entity-topics-button"
          title={text}
          aria-label={label}
          aria-expanded={opened}
          disabled={disabled}
          onClick={() => setOpened((current) => !current)}
        >
          {text}
        </button>
      </Popover.Target>
      <Popover.Dropdown>
        <EntityTagsInput
          aria-label={label}
          data-autofocus
          data={[...options]}
          value={[...value]}
          disabled={disabled}
          clearable
          splitChars={[",", "、"]}
          comboboxProps={{ withinPortal: false }}
          onChange={onChange}
        />
      </Popover.Dropdown>
    </Popover>
  );
};
