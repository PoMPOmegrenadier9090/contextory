import { afterEach, expect, it, vi } from "vitest";
import { downloadAsset } from "./asset-download.js";

afterEach(() => vi.unstubAllGlobals());

it("downloads an attachment in the current page with its Unicode filename", () => {
  const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const append = vi.fn();
  vi.stubGlobal("document", { createElement: () => link, body: { append } });
  const path = "assets/images/e1f9a674-05cc-4bef-bdbd-c59433c7a6c2.png";
  downloadAsset(path, "図①.png");
  const url = new URL(link.href, "https://pkm.example.com");
  expect(url.pathname).toBe(`/api/${path}`);
  expect(url.searchParams.get("download")).toBe("1");
  expect(url.searchParams.get("fileName")).toBe("図①.png");
  expect(link.download).toBe("図①.png");
  expect(append).toHaveBeenCalledWith(link);
  expect(link.click).toHaveBeenCalledOnce();
  expect(link.remove).toHaveBeenCalledOnce();
  expect(() => downloadAsset("../vault.yaml")).toThrow("Invalid asset path");
});
