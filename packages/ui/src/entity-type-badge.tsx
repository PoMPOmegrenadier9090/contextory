import { Badge } from "@mantine/core";

const ENTITY_TYPE_STYLES: Readonly<
  Record<string, { readonly color: string; readonly label: string }>
> = {
  area: { color: "orange", label: "Area" },
  project: { color: "violet", label: "Project" },
  task: { color: "teal", label: "Task" },
  entry: { color: "blue", label: "Entry" },
  topic: { color: "grape", label: "Topic" },
  resource: { color: "cyan", label: "Resource" },
};

export interface EntityTypeBadgeProps {
  readonly type: string;
  readonly size?: "xs" | "sm" | "md" | "lg" | "xl";
}

export const EntityTypeBadge = ({
  type,
  size = "sm",
}: EntityTypeBadgeProps): React.JSX.Element => {
  const style = ENTITY_TYPE_STYLES[type] ?? { color: "gray", label: type };
  return (
    <Badge
      className="entity-type-badge"
      color={style.color}
      radius="sm"
      size={size}
      style={{ flexShrink: 0 }}
      variant="light"
    >
      {style.label}
    </Badge>
  );
};
