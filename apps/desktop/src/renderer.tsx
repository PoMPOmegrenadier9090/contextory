import "@mantine/core/styles.css";
import {
  AppearanceProvider,
  ImageClipboardContext,
  copyImage,
  assetPathFromMarkdownUrl,
} from "@pkm/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { DesktopApp } from "./desktop-app.js";
import "./renderer.css";
import "../../../packages/ui/src/compact.css";

const root = document.querySelector<HTMLDivElement>("#root");
if (root === null) throw new Error("Desktop renderer root is missing");
if (navigator.platform.startsWith("Mac"))
  document.documentElement.dataset.desktopPlatform = "mac";

createRoot(root).render(
  <StrictMode>
    <AppearanceProvider>
      <ImageClipboardContext.Provider
        value={async (image) => {
          if (image.src.startsWith("pkm-asset://vault/")) {
            const path = assetPathFromMarkdownUrl(
              image.src.slice("pkm-asset://vault/".length),
            );
            if (path !== null) {
              await copyImage(
                image,
                window.pkm
                  .readImage(path)
                  .then(
                    (asset) =>
                      new Blob(
                        [
                          Uint8Array.from(atob(asset.dataBase64), (character) =>
                            character.charCodeAt(0),
                          ),
                        ],
                        { type: asset.mimeType },
                      ),
                  ),
              );
              return;
            }
          }
          await copyImage(image);
        }}
      >
        <DesktopApp />
      </ImageClipboardContext.Provider>
    </AppearanceProvider>
  </StrictMode>,
);
