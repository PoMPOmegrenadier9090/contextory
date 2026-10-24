import { useEffect, useState } from "react";

import { parseQuickOpenRecent, rememberQuickOpen } from "./quick-open-state.js";

const storageKey = (vaultId: string): string =>
  `pkm:quick-open:recent:${vaultId}`;
const readRecent = (vaultId: string | null): readonly string[] => {
  if (vaultId === null || typeof window === "undefined") return [];
  try {
    return parseQuickOpenRecent(
      window.localStorage.getItem(storageKey(vaultId)),
    );
  } catch {
    return [];
  }
};

export const useQuickOpenRecent = (
  vaultId: string | null,
  selectedId: string | null,
): readonly string[] => {
  const [state, setState] = useState(() => ({
    vaultId,
    ids: readRecent(vaultId),
  }));
  useEffect(() => {
    const ids = readRecent(vaultId);
    const next = selectedId === null ? ids : rememberQuickOpen(ids, selectedId);
    setState({ vaultId, ids: next });
    if (vaultId !== null) {
      try {
        window.localStorage.setItem(storageKey(vaultId), JSON.stringify(next));
      } catch {
        // Recent suggestions remain available when browser storage is unavailable.
      }
    }
  }, [vaultId, selectedId]);
  return state.vaultId === vaultId ? state.ids : [];
};
