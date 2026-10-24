import type { PkmEntityDocument, PkmBacklink } from "@pkm/contracts";
import type { PkmIndexChanges, PkmFileHash } from "@pkm/contracts";

export interface DesktopTabChange {
  readonly document: number;
  readonly backlinks: number;
  readonly fileHash: PkmFileHash | null | undefined;
}

// Keep each tab's revisions so React batching cannot drop an earlier event.
export const updateDesktopTabChanges = (
  current: ReadonlyMap<string, DesktopTabChange>,
  changes: PkmIndexChanges,
  openIds: readonly string[],
): ReadonlyMap<string, DesktopTabChange> => {
  const next = new Map<string, DesktopTabChange>();
  const entities = new Map(
    changes.entities.map((entity) => [entity.id, entity]),
  );
  for (const id of openIds) {
    const previous = current.get(id);
    const document = changes.reset || entities.has(id);
    const backlinks = changes.reset || changes.backlinkIds.includes(id);
    if (document || backlinks)
      next.set(id, {
        document: (previous?.document ?? 0) + Number(document),
        backlinks: (previous?.backlinks ?? 0) + Number(backlinks),
        fileHash: document ? entities.get(id)?.fileHash : previous?.fileHash,
      });
    else if (previous) next.set(id, previous);
  }
  return next;
};

export interface DesktopEntityTab {
  readonly id: string;
  readonly document: PkmEntityDocument;
  readonly backlinks: readonly PkmBacklink[];
}

export interface DesktopTabSnapshot {
  readonly tabs: readonly DesktopEntityTab[];
  readonly activeId: string | null;
}

export interface DesktopTabEditor {
  save(): Promise<boolean>;
  document(): PkmEntityDocument;
}

// Serializes navigation/close with editor saves. Entity IDs are tab identities;
// sessions live only in memory and never create a second editor for an Entity.
export class DesktopTabs {
  private state: DesktopTabSnapshot = { tabs: [], activeId: null };
  private readonly editors = new Map<string, DesktopTabEditor>();
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;

  constructor(
    private readonly load: (id: string) => Promise<DesktopEntityTab>,
    private readonly changed: (state: DesktopTabSnapshot) => void,
  ) {}

  snapshot(): DesktopTabSnapshot {
    return this.state;
  }

  register(id: string, editor: DesktopTabEditor): () => void {
    this.editors.set(id, editor);
    return () => {
      if (this.editors.get(id) === editor) this.editors.delete(id);
    };
  }

  currentDocument(): PkmEntityDocument | null {
    const id = this.state.activeId;
    if (id === null) return null;
    return (
      this.editors.get(id)?.document() ??
      this.state.tabs.find((tab) => tab.id === id)?.document ??
      null
    );
  }

  private publish(state: DesktopTabSnapshot): void {
    this.state = state;
    this.changed(state);
  }

  private enqueue(
    action: (generation: number) => Promise<boolean>,
  ): Promise<boolean> {
    const generation = this.generation;
    const pending = this.queue.then(() =>
      generation === this.generation ? action(generation) : false,
    );
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private async save(id: string | null): Promise<boolean> {
    if (id === null) return true;
    return (await this.editors.get(id)?.save()) ?? true;
  }

  open(id: string, onOpened?: () => void): Promise<boolean> {
    return this.enqueue(async (generation) => {
      if (this.state.activeId === id) {
        onOpened?.();
        return true;
      }
      if (!(await this.save(this.state.activeId))) return false;
      if (generation !== this.generation) return false;
      const existing = this.state.tabs.find((tab) => tab.id === id);
      const tab = existing ?? (await this.load(id));
      if (generation !== this.generation) return false;
      this.publish({
        tabs:
          existing === undefined ? [...this.state.tabs, tab] : this.state.tabs,
        activeId: id,
      });
      onOpened?.();
      return true;
    });
  }

  prepare(id: string, onPrepared?: () => void): Promise<boolean> {
    return this.enqueue(async (generation) => {
      if (this.state.tabs.some((tab) => tab.id === id)) {
        onPrepared?.();
        return true;
      }
      const tab = await this.load(id);
      if (generation !== this.generation) return false;
      this.publish({ ...this.state, tabs: [...this.state.tabs, tab] });
      onPrepared?.();
      return true;
    });
  }

  workspace(onOpened?: () => void): Promise<boolean> {
    return this.enqueue(async (generation) => {
      if (!(await this.save(this.state.activeId))) return false;
      if (generation !== this.generation) return false;
      this.publish({ ...this.state, activeId: null });
      onOpened?.();
      return true;
    });
  }

  close(id: string, canClose: () => boolean = () => true): Promise<boolean> {
    return this.enqueue(async (generation) => {
      if (!canClose()) return true;
      const position = this.state.tabs.findIndex((tab) => tab.id === id);
      if (position < 0) return true;
      const saved = await this.save(id);
      if (generation !== this.generation) return false;
      if (!saved) {
        this.publish({ ...this.state, activeId: id });
        return false;
      }
      const tabs = this.state.tabs.filter((tab) => tab.id !== id);
      this.publish({
        tabs,
        activeId:
          this.state.activeId === id
            ? (tabs[position]?.id ?? tabs[position - 1]?.id ?? null)
            : this.state.activeId,
      });
      return true;
    });
  }

  saveAll(): Promise<boolean> {
    return this.enqueue(async (generation) => {
      for (const tab of this.state.tabs) {
        const saved = await this.save(tab.id);
        if (generation !== this.generation) return false;
        if (!saved) {
          this.publish({ ...this.state, activeId: tab.id });
          return false;
        }
      }
      return true;
    });
  }

  saveActive(): Promise<boolean> {
    return this.enqueue(async (generation) => {
      const saved = await this.save(this.state.activeId);
      return generation === this.generation && saved;
    });
  }

  reset(): void {
    this.generation += 1;
    this.editors.clear();
    this.publish({ tabs: [], activeId: null });
  }
}
