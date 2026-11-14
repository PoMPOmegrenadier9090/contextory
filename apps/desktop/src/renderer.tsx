import { ObjectApp } from "@pkm/ui/object-app";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../../packages/ui/src/object-app.css";
import "../../../packages/editor/src/editor.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("Desktop renderer root is missing");
if (navigator.platform.startsWith("Mac"))
  document.documentElement.dataset.desktopPlatform = "mac";

const connection = await window.pkmConnection.get();
createRoot(root).render(
  <StrictMode>
    <ObjectApp
      client={window.pkm}
      location={
        connection
          ? `${new URL(connection.url).host}へ保存`
          : "このMacのSQLiteへ保存"
      }
    />
  </StrictMode>,
);
