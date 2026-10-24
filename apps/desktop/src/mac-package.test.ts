import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { copyRuntimePackages } from "./mac-package.js";

const roots: string[] = [];
const directory = (): string => {
  const root = mkdtempSync(join(tmpdir(), "pkms-package-test-"));
  roots.push(root);
  return root;
};
const makePackage = (
  root: string,
  name: string,
  dependencies = {},
  optionalDependencies = {},
): void => {
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      type: "commonjs",
      main: "dist/index.cjs",
      dependencies,
      optionalDependencies,
    }),
  );
  writeFileSync(
    join(root, "dist/index.cjs"),
    `module.exports = ${JSON.stringify(name)};`,
  );
};
const linkPackage = (from: string, name: string, target: string): void => {
  const link = join(from, "node_modules", name);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link);
};
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
describe("Mac app production dependencies", () => {
  it("keeps pnpm dependencies usable after their source and dev files are removed", () => {
    const root = directory();
    const source = join(root, "source");
    const desktop = join(source, "desktop");
    const workspace = join(source, "packages");
    const storage = join(workspace, "storage");
    const core = join(workspace, "core");
    const external = join(source, "store", "parser");
    const app = join(root, "app");
    makePackage(desktop, "desktop", {
      "@pkm/storage": "workspace:*",
      "@pkm/core": "workspace:*",
    });
    makePackage(storage, "@pkm/storage", { "@pkm/core": "workspace:*" });
    makePackage(core, "@pkm/core", { parser: "1" });
    makePackage(external, "parser", {}, { "missing-platform-addon": "1" });
    writeFileSync(join(storage, "secret-vault.md"), "must not ship");
    writeFileSync(join(storage, "dist", "index.test.js"), "must not ship");
    writeFileSync(
      join(storage, "dist", "index.cjs"),
      'module.exports = require("@pkm/core");',
    );
    writeFileSync(
      join(core, "dist", "index.cjs"),
      'module.exports = require("parser");',
    );
    linkPackage(desktop, "@pkm/storage", storage);
    linkPackage(desktop, "@pkm/core", core);
    linkPackage(storage, "@pkm/core", core);
    linkPackage(core, "parser", external);
    expect(copyRuntimePackages(desktop, app, workspace)).toBe(3);
    writeFileSync(
      join(app, "package.json"),
      '{"name":"packaged-app","version":"1.0.0"}',
    );
    const packagedStorage = realpathSync(
      join(app, "node_modules", "@pkm", "storage"),
    );
    expect(() =>
      readFileSync(join(packagedStorage, "secret-vault.md")),
    ).toThrow();
    expect(() =>
      readFileSync(join(packagedStorage, "dist", "index.test.js")),
    ).toThrow();
    rmSync(source, { recursive: true });
    const require = createRequire(join(app, "package.json"));
    expect(require("@pkm/storage") as unknown).toBe("parser");
    expect(require("@pkm/core") as unknown).toBe("parser");
    const relocated = join(root, "relocated.app");
    cpSync(app, relocated, { recursive: true, verbatimSymlinks: true });
    rmSync(app, { recursive: true });
    expect(
      createRequire(join(relocated, "package.json"))("@pkm/storage") as unknown,
    ).toBe("parser");
  });
  it("includes peer dependencies required by adapters after relocation", () => {
    const root = directory();
    const source = join(root, "source");
    const workspace = join(source, "packages");
    const adapter = join(source, "store", "adapter");
    const framework = join(source, "store", "framework");
    const app = join(root, "app");
    mkdirSync(workspace, { recursive: true });
    makePackage(source, "desktop", { adapter: "1" });
    makePackage(adapter, "adapter");
    makePackage(framework, "framework");
    writeFileSync(
      join(adapter, "package.json"),
      JSON.stringify({
        name: "adapter",
        version: "1.0.0",
        main: "dist/index.cjs",
        peerDependencies: { framework: "1", "optional-peer": "1" },
        peerDependenciesMeta: { "optional-peer": { optional: true } },
      }),
    );
    writeFileSync(
      join(adapter, "dist", "index.cjs"),
      'module.exports = require("framework");',
    );
    linkPackage(source, "adapter", adapter);
    linkPackage(adapter, "framework", framework);
    expect(copyRuntimePackages(source, app, workspace)).toBe(2);
    writeFileSync(
      join(app, "package.json"),
      '{"name":"app","version":"1.0.0"}',
    );
    rmSync(source, { recursive: true });
    expect(createRequire(join(app, "package.json"))("adapter") as unknown).toBe(
      "framework",
    );
  });
  it("reports missing required production dependencies instead of emitting a broken app", () => {
    const source = directory();
    const workspace = join(source, "packages");
    mkdirSync(workspace);
    makePackage(source, "desktop", { "missing-required": "1" });
    expect(() =>
      copyRuntimePackages(source, join(source, "app"), workspace),
    ).toThrow("Missing runtime dependency missing-required");
  });
});
