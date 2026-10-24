import { isComposingKey } from "./input-keyboard.js";
import {
  Button,
  Checkbox,
  Group,
  Input,
  Popover,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import {
  deadlineFromInput,
  deadlineInputValue,
  formatDeadline,
  isAllDayDate,
} from "./task-deadline.js";

export const TaskDeadlineInput = ({
  value,
  label,
  ariaLabel,
  disabled = false,
  compact = false,
  onCommit,
  onError,
}: {
  readonly value: string | null;
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly onCommit: (value: string | null) => Promise<void>;
  readonly onError?: ((reason: unknown) => void) | undefined;
}): React.JSX.Element => {
  const [draft, setDraft] = useState(deadlineInputValue(value));
  const [allDay, setAllDay] = useState(value === null || isAllDayDate(value));
  const [opened, setOpened] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const name = ariaLabel ?? label ?? "日時";
  useEffect(() => {
    setDraft(deadlineInputValue(value));
    setAllDay(value === null || isAllDayDate(value));
  }, [value]);
  const open = (): void => {
    setDraft(deadlineInputValue(value));
    setAllDay(value === null || isAllDayDate(value));
    setError(null);
    setOpened(true);
  };
  const commit = async (
    input = dateInput.current?.value ?? draft,
  ): Promise<void> => {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const next = deadlineFromInput(input);
      if (next !== value) await onCommit(next);
      setOpened(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      onError?.(reason);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Input.Wrapper label={label} className="task-deadline-input">
      <Popover
        opened={opened}
        onChange={(next) => {
          if (!saving) setOpened(next);
        }}
        width={300}
        position="bottom-start"
        withinPortal
        trapFocus
      >
        <Popover.Target>
          <button
            type="button"
            className="task-deadline-trigger"
            data-compact={compact || undefined}
            aria-label={name}
            aria-haspopup="dialog"
            aria-expanded={opened}
            disabled={disabled || saving}
            onClick={() => (opened ? setOpened(false) : open())}
          >
            <span>
              {value === null
                ? compact
                  ? "—"
                  : "日付を選択"
                : formatDeadline(value)}
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M5 5h14v16H5zM8 3v4M16 3v4M5 10h14" />
            </svg>
          </button>
        </Popover.Target>
        <Popover.Dropdown
          aria-label={`${name}を選択`}
          onKeyDown={(event) => {
            if (isComposingKey(event.nativeEvent)) return;
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
          }}
        >
          <Stack gap="sm">
            <TextInput
              ref={dateInput}
              type={allDay ? "date" : "datetime-local"}
              step={allDay ? undefined : 1}
              label={name}
              aria-label={`${name}の日付`}
              value={draft}
              disabled={saving}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onInput={(event) => setDraft(event.currentTarget.value)}
            />
            <Checkbox
              label="終日"
              aria-label={`${name}を終日にする`}
              checked={allDay}
              disabled={saving}
              onChange={(event) => {
                const nextAllDay = event.currentTarget.checked;
                setAllDay(nextAllDay);
                setDraft(
                  draft === ""
                    ? ""
                    : nextAllDay
                      ? draft.slice(0, 10)
                      : `${draft.slice(0, 10)}T00:00:00`,
                );
              }}
            />
            <Text size="xs" c="dimmed">
              日本時間（Asia/Tokyo）
            </Text>
            {error && (
              <Text size="xs" c="red" role="alert">
                {error}
              </Text>
            )}
            <Group justify="space-between">
              <Button
                variant="subtle"
                disabled={saving}
                onClick={() => void commit("")}
              >
                解除
              </Button>
              <Button loading={saving} onClick={() => void commit()}>
                適用
              </Button>
            </Group>
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Input.Wrapper>
  );
};
