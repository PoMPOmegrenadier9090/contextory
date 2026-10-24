import { ActionIcon } from "@mantine/core";

export const EntityPinButton = ({
  pinned,
  onToggle,
}: {
  readonly pinned: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element => (
  <ActionIcon
    aria-label={pinned ? "このEntityのピンを外す" : "このEntityをピン留め"}
    aria-pressed={pinned}
    title={pinned ? "ピンを外す" : "ピン留め"}
    color={pinned ? "yellow" : "gray"}
    variant="subtle"
    onClick={onToggle}
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={pinned ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
    </svg>
  </ActionIcon>
);
