import type { DesktopApi, DesktopConnectionApi } from "./desktop-api.js";

declare global {
  interface Window {
    readonly pkm: DesktopApi;
    readonly pkmConnection: DesktopConnectionApi;
  }
}

export {};
