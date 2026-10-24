import { Menu } from "@mantine/core";
import type { EntityType } from "@pkm/contracts";
import type { ReactElement } from "react";
import { ENTITY_TYPE_OPTIONS } from "./entity-actions.js";
import { EntityIcon } from "./entity-icon.js";

export const EntityCreateMenu = ({
  children,
  onCreate,
}: {
  readonly children: ReactElement;
  readonly onCreate: (type: EntityType) => void;
}): React.JSX.Element => (
  <Menu position="top-end" shadow="md" withinPortal>
    <Menu.Target>{children}</Menu.Target>
    <Menu.Dropdown>
      {ENTITY_TYPE_OPTIONS.filter((option) => option.value !== "entry").map(
        (option) => (
          <Menu.Item
            key={option.value}
            leftSection={<EntityIcon type={option.value} />}
            onClick={() => onCreate(option.value)}
          >
            {option.label}
          </Menu.Item>
        ),
      )}
    </Menu.Dropdown>
  </Menu>
);
