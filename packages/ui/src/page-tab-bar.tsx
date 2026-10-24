import { ActionIcon, Menu } from "@mantine/core";
import { useEffect, useRef } from "react";
import type { PkmEntitySummary } from "@pkm/contracts";
import { RESOURCE_TYPE_OPTIONS } from "./entity-options.js";
import { entityUiTitle } from "./entity-label.js";
import { EntityIcon } from "./entity-icon.js";
import { EntityStatusLight } from "./entity-status.js";
import type { PageTab, PageTabSnapshot } from "./page-tabs.js";

export const pageTabLabel = (
  tab: PageTab,
  entities: readonly PkmEntitySummary[],
): string => {
  const location = tab.location;
  switch (location.kind) {
    case "entity":
      return entityUiTitle(
        entities.find((entity) => entity.id === location.entityId) ?? {
          id: location.entityId,
          type: "entry",
          displayName: null,
          body: "",
        },
      );
    case "workspace":
      return "Home";
    case "collection":
      if (location.resourceType)
        return `Resources / ${RESOURCE_TYPE_OPTIONS.find((option) => option.value === location.resourceType)!.label}`;
      return {
        area: "Areas",
        project: "Projects",
        task: "Tasks",
        entry: "Entries",
        topic: "Topics",
        resource: "Resources",
      }[location.type];
    case "timeline":
      return "Timeline";
    case "todos":
      return "チェックリスト";
  }
};

export const PageTabBar = ({
  snapshot,
  entities,
  statuses = {},
  disabled = false,
  panelId,
  onSelect,
  onClose,
  onNew,
  onMove,
}: {
  readonly snapshot: PageTabSnapshot;
  readonly entities: readonly PkmEntitySummary[];
  readonly statuses?: Readonly<Record<string, string>>;
  readonly disabled?: boolean;
  readonly panelId: (tab: PageTab) => string;
  readonly onSelect: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onNew: () => void;
  readonly onMove: (id: string, beforeId: string) => void;
}): React.JSX.Element => {
  const list = useRef<HTMLDivElement>(null);
  const dragged = useRef<string | null>(null);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [snapshot.activeId]);
  const labels = new Map(
    snapshot.tabs.map((tab) => [tab.id, pageTabLabel(tab, entities)]),
  );
  return (
    <div className="page-tab-strip">
      <div
        role="tablist"
        aria-label="開いているタブ"
        className="page-tabs"
        ref={list}
        onKeyDown={(event) => {
          if (
            (event.target as HTMLElement).getAttribute("role") !== "tab" ||
            event.nativeEvent.isComposing ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey ||
            disabled
          )
            return;
          const position = snapshot.tabs.findIndex(
            (tab) => tab.id === snapshot.activeId,
          );
          const next =
            event.key === "ArrowRight"
              ? (position + 1) % snapshot.tabs.length
              : event.key === "ArrowLeft"
                ? (position + snapshot.tabs.length - 1) % snapshot.tabs.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? snapshot.tabs.length - 1
                    : -1;
          if (next < 0) return;
          event.preventDefault();
          const id = snapshot.tabs[next]!.id;
          onSelect(id);
          list.current
            ?.querySelector<HTMLButtonElement>(`[id="page-tab-${id}"]`)
            ?.focus();
        }}
      >
        {snapshot.tabs.map((tab) => {
          const location = tab.location;
          const entity =
            location.kind === "entity"
              ? entities.find((item) => item.id === location.entityId)
              : undefined;
          const status =
            location.kind === "entity"
              ? statuses[location.entityId]
              : undefined;
          const statusLabel =
            status === "dirty"
              ? "未保存"
              : status === "saving"
                ? "保存中"
                : status === "warning"
                  ? "保存・外部更新を確認"
                  : "";
          const label = labels.get(tab.id)!;
          return (
            <div
              key={tab.id}
              className="page-tab-item"
              data-active={snapshot.activeId === tab.id || undefined}
              draggable={!disabled}
              onDragStart={(event) => {
                dragged.current = tab.id;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", tab.id);
              }}
              onDragEnd={() => {
                dragged.current = null;
              }}
              onDragOver={(event) => {
                if (dragged.current && !disabled) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged.current && !disabled)
                  onMove(dragged.current, tab.id);
                dragged.current = null;
              }}
            >
              <button
                type="button"
                role="tab"
                id={`page-tab-${tab.id}`}
                aria-controls={panelId(tab)}
                aria-selected={snapshot.activeId === tab.id}
                tabIndex={snapshot.activeId === tab.id ? 0 : -1}
                className="page-tab"
                title={statusLabel ? `${label}（${statusLabel}）` : label}
                disabled={disabled}
                onClick={() => onSelect(tab.id)}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    onClose(tab.id);
                  }
                }}
              >
                {entity ? (
                  <EntityIcon type={entity.type} status={entity.status} />
                ) : (
                  <span aria-hidden="true">
                    {location.kind === "workspace" ? "⌂" : "≡"}
                  </span>
                )}
                <span className="page-tab-label">{label}</span>
                {entity?.type === "project" && (
                  <EntityStatusLight status={entity.status} />
                )}
                {statusLabel && (
                  <span
                    className="page-tab-status"
                    data-status={status}
                    aria-label={statusLabel}
                  >
                    {status === "warning" ? "!" : "●"}
                  </span>
                )}
              </button>
              <ActionIcon
                variant="subtle"
                size="sm"
                className="page-tab-close"
                aria-label={`${label}のタブを閉じる`}
                disabled={disabled}
                onClick={() => onClose(tab.id)}
              >
                ×
              </ActionIcon>
            </div>
          );
        })}
      </div>
      <ActionIcon
        variant="subtle"
        aria-label="新規タブを開く"
        title="新規タブ（⌘/Ctrl+T）"
        disabled={disabled}
        onClick={onNew}
      >
        ＋
      </ActionIcon>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            aria-label={`タブを選択（${snapshot.tabs.length}個）`}
            disabled={disabled}
          >
            ⌄
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {snapshot.tabs.map((tab) => (
            <Menu.Item key={tab.id} onClick={() => onSelect(tab.id)}>
              {snapshot.activeId === tab.id ? "✓ " : ""}
              {labels.get(tab.id)}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    </div>
  );
};
