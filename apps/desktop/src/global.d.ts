import type { DesktopApi } from "./desktop-api.js";

declare global {
  interface Window {
    readonly pkm: DesktopApi;
  }
}

export {};
