import type { EntityType } from "@pkm/contracts";
import { EntityCreateMenu } from "./entity-create-menu.js";
import { ActionIcon } from "@mantine/core";
import { useEffect, useState } from "react";

// Ignore bounce at the top; reveal only after a deliberate upward scroll stops.
export const createScrollVisibilityController = (
  onVisible: (visible: boolean) => void,
  initialY = 0,
): { scroll: (y: number) => void; dispose: () => void } => {
  let lastY = initialY;
  let upwardDistance = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    scroll(y) {
      const nextY = Math.max(0, y);
      const delta = nextY - lastY;
      lastY = nextY;
      clearTimer();
      if (nextY <= 8) {
        upwardDistance = 0;
        onVisible(true);
      } else if (delta > 0) {
        upwardDistance = 0;
        onVisible(false);
      } else if (delta < 0) {
        upwardDistance -= delta;
        if (upwardDistance >= 12) {
          timer = setTimeout(() => onVisible(true), 180);
        }
      }
    },
    dispose: clearTimer,
  };
};

export const FloatingActions = ({
  hidden = false,
  navigationKey,
  onCapture,
  onCreate,
}: {
  readonly hidden?: boolean;
  readonly navigationKey: string;
  readonly onCapture: () => void;
  readonly onCreate: (type: EntityType) => void;
}): React.JSX.Element => {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    const controller = createScrollVisibilityController(
      setVisible,
      window.scrollY,
    );
    const onScroll = (): void => controller.scroll(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      controller.dispose();
    };
  }, [navigationKey]);

  return (
    <div
      className="floating-actions"
      role="toolbar"
      aria-label="クイック操作"
      data-hidden={hidden || !visible || undefined}
      inert={hidden || !visible}
    >
      <ActionIcon
        aria-label="クイックメモ"
        title="クイックメモ"
        size={44}
        radius="xl"
        variant="subtle"
        onClick={onCapture}
      >
        ✎
      </ActionIcon>
      <EntityCreateMenu onCreate={onCreate}>
        <ActionIcon
          aria-label="新規作成"
          title="新規作成"
          size={44}
          radius="xl"
          variant="filled"
        >
          ＋
        </ActionIcon>
      </EntityCreateMenu>
    </div>
  );
};
