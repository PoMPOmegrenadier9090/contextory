import { STATUS_OPTIONS } from "./entity-options.js";

export const EntityStatusLight = ({
  status,
}: {
  readonly status: string | null | undefined;
}): React.JSX.Element | null =>
  status === "in_progress" ? (
    <span className="entity-status-light" title="進行中" aria-hidden="true" />
  ) : null;

export const EntityStatusLabel = ({
  status,
}: {
  readonly status: string | null | undefined;
}): React.JSX.Element | null => {
  const label = STATUS_OPTIONS.find((option) => option.value === status)?.label;
  return label ? (
    <span className="entity-status-label" data-entity-status={status}>
      <EntityStatusLight status={status} />
      <span>{label}</span>
    </span>
  ) : null;
};
