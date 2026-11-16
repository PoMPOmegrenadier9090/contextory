import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import type { ObjectStore } from "@pkm/storage-node";

/** 残すバックアップの数。1日1回なら1週間分。 */
export const BACKUP_KEEP = 7;
const BACKUP_FILE = /^objects-.+\.sqlite$/;

/** dirに日時つきの複製を作り、古いものを消して新しいBACKUP_KEEP個を残す。 */
export const rotateBackup = async (
  store: ObjectStore,
  dir: string,
  now = new Date(),
): Promise<void> => {
  // ISOの日時は文字の順で並べると古い順になる。
  await store.backup(
    join(dir, `objects-${now.toISOString().replace(/[:.]/g, "-")}.sqlite`),
  );
  const old = (await readdir(dir))
    .filter((name) => BACKUP_FILE.test(name))
    .sort()
    .slice(0, -BACKUP_KEEP);
  await Promise.all(old.map((name) => rm(join(dir, name))));
};
