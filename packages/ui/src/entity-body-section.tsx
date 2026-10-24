import { useState, type ReactNode } from "react";

export const EntityBodySection = ({
  collapsible,
  headerActions,
  children,
}: {
  readonly collapsible: boolean;
  readonly headerActions?: ReactNode;
  readonly children: (visible: boolean) => ReactNode;
}): React.JSX.Element => {
  const [open, setOpen] = useState(!collapsible);
  if (!collapsible) return <>{children(true)}</>;
  return (
    <details
      className="entity-body-section"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>本文</summary>
      {headerActions && (
        <div className="entity-body-section-actions">{headerActions}</div>
      )}
      <div className="entity-body-section-content">{children(open)}</div>
    </details>
  );
};
