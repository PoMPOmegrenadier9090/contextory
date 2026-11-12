import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ObjectApp } from "@pkm/ui/object-app";

import { createHttpObjectClient } from "./object-client.js";
import "../../../packages/ui/src/object-app.css";
import "../../../packages/editor/src/editor.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("Web application root is missing");

createRoot(root).render(
  <StrictMode>
    <ObjectApp client={createHttpObjectClient()} />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const register = () => {
    void navigator.serviceWorker
      .register("/sw.js", { type: "module", updateViaCache: "imports" })
      .catch(() => {
        // Static caching is optional; network access and browser drafts still work.
      });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
