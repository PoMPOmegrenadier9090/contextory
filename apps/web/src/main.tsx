import "@mantine/core/styles.css";
import { AppearanceProvider } from "@pkm/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createHttpPkmClient } from "./api-client.js";
import { WebApp } from "./web-app.js";
import "./web.css";
import "../../../packages/ui/src/compact.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("Web application root is missing");

createRoot(root).render(
  <StrictMode>
    <AppearanceProvider>
      <WebApp client={createHttpPkmClient()} />
    </AppearanceProvider>
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
