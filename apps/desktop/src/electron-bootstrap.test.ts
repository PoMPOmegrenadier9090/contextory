import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it.each([
  { packaged: true, customPath: false, expected: "/settings/PKM" },
  { packaged: true, customPath: true, expected: "/settings/custom" },
  { packaged: false, customPath: false, expected: "/settings/development" },
])("preserves device settings after renaming: %o", (scenario) => {
  const app = {
    // Electron also adds this switch internally; only explicit argv is an override.
    commandLine: { hasSwitch: () => true },
    getPath: (name: string) =>
      name === "appData"
        ? "/settings"
        : scenario.customPath
          ? "/settings/custom"
          : "/settings/development",
    setName: vi.fn(),
    setPath: vi.fn(),
    whenReady: () => ({ then: () => ({ catch: () => undefined }) }),
  };
  const source = readFileSync(
    new URL("../electron-main.cjs", import.meta.url),
    "utf8",
  );
  runInNewContext(source, {
    require: (name: string) => {
      if (name === "node:path") return { join };
      if (name === "node:process")
        return {
          defaultApp: !scenario.packaged,
          argv: scenario.customPath ? ["--user-data-dir=/settings/custom"] : [],
        };
      if (name === "electron")
        return { app, protocol: { registerSchemesAsPrivileged: () => {} } };
      throw new Error(`Unexpected module: ${name}`);
    },
  });
  expect(app.setName).toHaveBeenCalledWith("Contextory");
  expect(app.setPath).toHaveBeenCalledWith("userData", scenario.expected);
});
