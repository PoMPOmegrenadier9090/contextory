import { Stack } from "@mantine/core";
import { EntityParentLinks, useNotification } from "@pkm/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EntityEditorProps } from "./entity-editor.js";
import { EntityEditor } from "./entity-editor.js";
import type {
  DesktopEntityTab,
  DesktopTabs,
  DesktopTabChange,
} from "./desktop-tabs.js";

export type DesktopTabStatus = "saved" | "dirty" | "saving" | "warning";

interface DesktopEntityTabProps extends Omit<
  EntityEditorProps,
  | "document"
  | "backlinks"
  | "onSaved"
  | "onDirtyChange"
  | "externalChangeDetected"
  | "onConflictResolved"
  | "saveBeforeLeaveRef"
  | "onStatusChange"
> {
  readonly tab: DesktopEntityTab;
  readonly labelledBy: string | undefined;
  readonly active: boolean;
  readonly tabs: DesktopTabs;
  readonly revision: number;
  readonly change: DesktopTabChange | undefined;
  readonly onDocumentChanged: (document: DesktopEntityTab["document"]) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onStatus: (id: string, status: DesktopTabStatus) => void;
}

export const DesktopEntityTabPanel = ({
  tab,
  labelledBy,
  active,
  tabs,
  revision,
  change,
  onDocumentChanged,
  onRefresh,
  onStatus,
  ...editorProps
}: DesktopEntityTabProps): React.JSX.Element => {
  const [document, setDocument] = useState(tab.document);
  const [backlinks, setBacklinks] = useState(tab.backlinks);
  const [externalChange, setExternalChange] = useState(
    tab.document.hasExternalChange,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const notifyError = useNotification("error");
  useEffect(() => {
    if (loadError !== null) notifyError(loadError);
  }, [loadError, notifyError]);
  const documentRef = useRef(document);
  const dirtyRef = useRef(tab.document.draft !== null);
  const lastSavedHash = useRef<string | null>(null);
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const refreshSequence = useRef(0);
  const documentSequence = useRef(0);
  const backlinksSequence = useRef(0);
  const mounted = useRef(false);
  const lastChange = useRef<DesktopTabChange | undefined>(undefined);
  const pendingRefresh = useRef({ document: false, backlinks: false });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshSequence.current += 1;
      documentSequence.current += 1;
      backlinksSequence.current += 1;
    };
  }, []);

  const replaceDocument = useCallback(
    (next: DesktopEntityTab["document"]): void => {
      documentRef.current = next;
      setDocument(next);
      setExternalChange(next.hasExternalChange);
      onDocumentChanged(next);
    },
    [onDocumentChanged],
  );

  const reload = useCallback(
    async (loadDocument = true, loadBacklinks = true): Promise<void> => {
      const sequence = ++refreshSequence.current;
      const documentRequest = loadDocument ? ++documentSequence.current : 0;
      const backlinksRequest = loadBacklinks ? ++backlinksSequence.current : 0;
      try {
        const [next, refs] = await Promise.all([
          loadDocument
            ? window.pkm.loadEntity(tab.id)
            : Promise.resolve(documentRef.current),
          loadBacklinks
            ? window.pkm.getBacklinks(tab.id)
            : Promise.resolve(null),
        ]);
        if (!mounted.current) return;
        if (refs !== null && backlinksRequest === backlinksSequence.current)
          setBacklinks(refs);
        if (!loadDocument || documentRequest !== documentSequence.current)
          return;
        setLoadError(null);
        if (dirtyRef.current) {
          setExternalChange(
            next.hasExternalChange ||
              (next.fileHash !== documentRef.current.fileHash &&
                next.fileHash !== lastSavedHash.current),
          );
        } else {
          setExternalChange(next.hasExternalChange);
          if (
            next.fileHash !== documentRef.current.fileHash ||
            next.draft !== null
          ) {
            replaceDocument(next);
          }
        }
      } catch (reason) {
        if (mounted.current && sequence === refreshSequence.current)
          setLoadError(
            reason instanceof Error ? reason.message : String(reason),
          );
      }
    },
    [replaceDocument, tab.id],
  );

  useEffect(() => {
    if (change !== lastChange.current) {
      const previous = lastChange.current;
      lastChange.current = change;
      const documentChanged =
        (change?.document ?? 0) !== (previous?.document ?? 0);
      pendingRefresh.current.document ||=
        documentChanged && change?.fileHash !== documentRef.current.fileHash;
      pendingRefresh.current.backlinks ||=
        (change?.backlinks ?? 0) !== (previous?.backlinks ?? 0);
      if (
        dirtyRef.current &&
        documentChanged &&
        change?.fileHash !== documentRef.current.fileHash &&
        change?.fileHash !== lastSavedHash.current
      )
        setExternalChange(true);
    }
    if (!active) return;
    const pending = pendingRefresh.current;
    if (!pending.document && !pending.backlinks) return;
    pendingRefresh.current = { document: false, backlinks: false };
    void reload(pending.document, pending.backlinks);
  }, [active, change, reload]);

  useEffect(
    () =>
      tabs.register(tab.id, {
        save: () => saveRef.current?.() ?? Promise.resolve(true),
        document: () => documentRef.current,
      }),
    [tab.id, tabs],
  );

  const handleDirty = useCallback((dirty: boolean): void => {
    dirtyRef.current = dirty;
  }, []);
  const handleStatus = useCallback(
    (status: DesktopTabStatus): void => {
      onStatus(
        tab.id,
        externalChange || loadError !== null ? "warning" : status,
      );
    },
    [externalChange, loadError, onStatus, tab.id],
  );
  useEffect(() => {
    if (externalChange || loadError !== null) onStatus(tab.id, "warning");
  }, [externalChange, loadError, onStatus, tab.id]);

  const handleSaved = useCallback(
    async (hash: DesktopEntityTab["document"]["fileHash"]): Promise<void> => {
      lastSavedHash.current = hash;
      await reload(true, false);
    },
    [reload],
  );

  const handleResolved = useCallback(
    async (next: DesktopEntityTab["document"] | null): Promise<void> => {
      if (!mounted.current) return;
      dirtyRef.current = false;
      if (next === null) {
        await tabs.close(tab.id);
      } else {
        refreshSequence.current += 1;
        documentSequence.current += 1;
        backlinksSequence.current += 1;
        replaceDocument(next);
        await reload();
      }
      await onRefresh();
    },
    [onRefresh, reload, replaceDocument, tab.id, tabs],
  );

  return (
    <section
      role={labelledBy === undefined ? undefined : "tabpanel"}
      id={`entity-panel-${tab.id}`}
      aria-labelledby={labelledBy}
      aria-label={
        labelledBy === undefined
          ? (document.entity.displayName ?? document.entity.id)
          : undefined
      }
      hidden={!active}
      className="desktop-entity-panel"
    >
      <Stack gap="sm">
        <EntityParentLinks
          entity={document.entity}
          entities={editorProps.entities}
          onOpenEntity={editorProps.onOpenReference}
        />
        <EntityEditor
          {...editorProps}
          active={active}
          relationRevision={revision}
          document={document}
          backlinks={backlinks}
          externalChangeDetected={externalChange}
          onDirtyChange={handleDirty}
          onStatusChange={handleStatus}
          onSaved={handleSaved}
          onConflictResolved={handleResolved}
          saveBeforeLeaveRef={saveRef}
        />
      </Stack>
    </section>
  );
};
