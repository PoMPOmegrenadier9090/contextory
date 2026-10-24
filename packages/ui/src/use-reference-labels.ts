import type { DirectReference } from "@pkm/core";
import { useContext, useEffect, useMemo, useState } from "react";
import { EntityQueryContext } from "./entity-query-context.js";
import {
  buildDirectReferenceCompletionOptions,
  type DirectReferenceCompletionOption,
} from "./reference-completion.js";

export const useReferenceLabels = (
  references: readonly DirectReference[],
  options: readonly DirectReferenceCompletionOption[],
): ReadonlyMap<string, string> => {
  const source = useContext(EntityQueryContext);
  const [resolved, setResolved] = useState<
    readonly DirectReferenceCompletionOption[]
  >([]);
  const known = new Map(options.map((option) => [option.id, option]));
  const missingKey = JSON.stringify([
    ...new Set(
      references
        .filter(
          (reference) =>
            reference.label === null && !known.has(reference.targetId),
        )
        .map((reference) => reference.targetId),
    ),
  ]);
  useEffect(() => {
    if (!source || source.ready === false) return;
    const ids = JSON.parse(missingKey) as string[];
    if (!ids.length) return;
    const controller = new AbortController();
    void Promise.all(
      Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) =>
        source.options(
          {
            ids: ids.slice(index * 100, (index + 1) * 100),
            limit: 100,
          },
          controller.signal,
        ),
      ),
    )
      .then((pages) => {
        if (!controller.signal.aborted)
          setResolved(
            buildDirectReferenceCompletionOptions(
              pages
                .flatMap((page) => page)
                .map((option) => ({
                  ...option,
                  areaId: null,
                  projectId: null,
                  taskId: null,
                  resourceId: null,
                })),
            ),
          );
      })
      .catch(() => {
        /* Keep a readable placeholder when the target is unavailable. */
      });
    return () => controller.abort();
  }, [
    source?.options,
    source?.ready,
    source?.vaultId,
    source?.labelRevision ?? source?.revision,
    missingKey,
  ]);
  return useMemo(
    () =>
      new Map(
        [...resolved, ...options].map((option) => [
          option.id,
          option.label ?? option.displayName ?? "無題のEntry",
        ]),
      ),
    [resolved, options],
  );
};
