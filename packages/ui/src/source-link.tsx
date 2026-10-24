import { ActionIcon } from "@mantine/core";

export const sourceWebUrl = (value: string | null): string | null => {
  try {
    const url = new URL(value ?? "");
    return ["https:", "http:"].includes(url.protocol) &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
};

export const SourceLink = ({
  value,
}: {
  readonly value: string | null;
}): React.JSX.Element | null => {
  const url = sourceWebUrl(value);
  return url === null ? null : (
    <ActionIcon
      component="a"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      variant="subtle"
      size="sm"
      aria-label="Source URIを開く"
      title="Source URIを開く"
    >
      ↗
    </ActionIcon>
  );
};
