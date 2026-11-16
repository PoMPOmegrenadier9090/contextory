import type { ObjectClient } from "@pkm/core";
import type { ObjectStore } from "@pkm/storage-node";

/** このMacのSQLiteを、サーバーと同じObjectClientとして使う。 */
export const localObjectClient = (store: ObjectStore): ObjectClient => {
  // 同期の例外も、HTTPと同じくrejectとして返す。
  const run = <T>(work: () => T): Promise<T> => Promise.resolve().then(work);
  return {
    loadPage: (hostId) => run(() => store.loadPage(hostId)),
    savePage: (hostId, doc, baseRevision) =>
      run(() => store.savePage(hostId, doc, Date.now(), baseRevision)),
    searchObjects: (query, exclude = null) =>
      run(() => store.search(query, exclude)),
    createObject: (input) => run(() => store.createObject(input, Date.now())),
    patchObject: (id, patch) =>
      run(() => store.patchObject(id, patch, Date.now())),
    queryView: (viewId, anchorId, today) =>
      run(() => store.queryView(viewId, anchorId, today)),
    types: () => run(() => store.types()),
    updateType: (name, patch) => run(() => store.updateType(name, patch)),
    overview: (from, to) => run(() => store.overview(from, to)),
  };
};
