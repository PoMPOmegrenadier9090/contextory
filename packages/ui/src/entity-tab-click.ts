import type { MouseEvent } from "react";

// Navigation controls opt in explicitly; property editors keep their normal clicks.
export const captureEntityTabClick = (
  event: MouseEvent<HTMLElement>,
  open: (id: string) => void,
): void => {
  if (
    event.defaultPrevented ||
    event.altKey ||
    event.shiftKey ||
    !(event.metaKey || event.ctrlKey) ||
    event.button !== 0
  )
    return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const link = target.closest<HTMLElement>("[data-open-entity]");
  const id = link?.dataset.openEntity;
  if (!id || link?.matches(":disabled, [aria-disabled='true']")) return;
  event.preventDefault();
  event.stopPropagation();
  open(id);
};
