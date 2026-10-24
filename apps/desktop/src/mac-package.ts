import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

const manifestAt = (directory: string): PackageManifest => {
  const value = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  ) as PackageManifest;
  if (typeof value.name !== "string" || typeof value.version !== "string") {
    throw new Error(`Invalid package metadata: ${directory}`);
  }
  return value;
};

const dependencyPath = (from: string, name: string): string | null => {
  let current = from;
  while (true) {
    const candidate = join(current, "node_modules", name);
    if (existsSync(candidate)) return realpathSync(candidate);
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
};

// pnpm links point outside each workspace package. Recreate the production
// dependency graph with links wholly inside the app, preserving multiple versions.
export const copyRuntimePackages = (
  sourceRoot: string,
  appRoot: string,
  workspaceRoot: string,
): number => {
  const installed = new Map<string, string>();
  const workspace = realpathSync(workspaceRoot);
  const addPackage = (source: string): string => {
    source = realpathSync(source);
    const existing = installed.get(source);
    if (existing) return existing;
    const metadata = manifestAt(source);
    const key = createHash("sha256").update(source).digest("hex").slice(0, 16);
    const target = join(
      appRoot,
      ".runtime",
      key,
      metadata.name.split("/").at(-1)!,
    );
    installed.set(source, target);
    if (source.startsWith(`${workspace}${sep}`)) {
      mkdirSync(target, { recursive: true });
      cpSync(join(source, "package.json"), join(target, "package.json"));
      cpSync(join(source, "dist"), join(target, "dist"), {
        recursive: true,
        filter: (path) => !path.includes(".test."),
      });
    } else {
      cpSync(source, target, {
        recursive: true,
        verbatimSymlinks: true,
        filter: (path) =>
          !relative(source, path).split(sep).includes("node_modules"),
      });
    }
    linkDependencies(source, target, metadata);
    return target;
  };
  const linkDependencies = (
    source: string,
    target: string,
    metadata: PackageManifest,
  ): void => {
    const dependencies = {
      ...metadata.peerDependencies,
      ...metadata.dependencies,
      ...metadata.optionalDependencies,
    };
    for (const name of Object.keys(dependencies)) {
      const dependency = dependencyPath(source, name);
      if (!dependency) {
        if (
          Object.hasOwn(metadata.optionalDependencies ?? {}, name) ||
          metadata.peerDependenciesMeta?.[name]?.optional === true
        )
          continue;
        throw new Error(
          `Missing runtime dependency ${name} in ${source}; run corepack pnpm install first`,
        );
      }
      const packaged = addPackage(dependency);
      const link = join(target, "node_modules", name);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(relative(dirname(link), packaged), link);
    }
  };
  linkDependencies(sourceRoot, appRoot, manifestAt(sourceRoot));
  return installed.size;
};

const run = (command: string, args: readonly string[]): void => {
  execFileSync(command, [...args], { stdio: "inherit" });
};

const createIcon = (
  source: string,
  output: string,
  temporaryRoot: string,
): void => {
  // Modern ICNS entries contain PNGs. Writing the container directly also works
  // on Macs where iconutil rejects an otherwise valid generated iconset.
  const sizes: readonly [string, number][] = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
    ["ic11", 32],
    ["ic12", 64],
    ["ic13", 256],
    ["ic14", 512],
  ];
  const chunks = sizes.map(([tag, size]) => {
    const png = join(temporaryRoot, `${tag}.png`);
    execFileSync(
      "/usr/bin/sips",
      ["-z", String(size), String(size), source, "--out", png],
      { stdio: "pipe" },
    );
    const data = readFileSync(png);
    const header = Buffer.alloc(8);
    header.write(tag, 0, 4, "ascii");
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const data = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(data.length + 8, 4);
  writeFileSync(output, Buffer.concat([header, data]));
};

export const packageMacDesktop = (): void => {
  if (
    process.platform !== "darwin" ||
    !["arm64", "x64"].includes(process.arch)
  ) {
    throw new Error(
      "desktop:package must run on an arm64 or x64 Mac; it builds for the current Mac architecture",
    );
  }
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const desktop = join(repo, "apps", "desktop");
  const metadata = manifestAt(desktop);
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(metadata.version)) {
    throw new Error(
      "Desktop package version must use major.minor.patch, optionally with a prerelease suffix",
    );
  }
  const electron = dependencyPath(desktop, "electron");
  if (!electron)
    throw new Error(
      "Electron is not installed; run corepack pnpm install first",
    );
  const stage = mkdtempSync(join(tmpdir(), "pkms-package-"));
  try {
    const imageRoot = join(stage, "image");
    const bundle = join(imageRoot, "Contextory.app");
    const resources = join(bundle, "Contents", "Resources");
    const appRoot = join(resources, "app");
    console.log(
      `Packaging Contextory ${metadata.version} for macOS ${process.arch}...`,
    );
    mkdirSync(imageRoot);
    run("/usr/bin/ditto", [join(electron, "dist", "Electron.app"), bundle]);
    mkdirSync(join(appRoot, "apps", "desktop"), { recursive: true });
    for (const name of ["dist", "dist-renderer", "electron-main.cjs"]) {
      cpSync(join(desktop, name), join(appRoot, "apps", "desktop", name), {
        recursive: true,
        filter: (path) =>
          !path.includes(".test.") && !path.endsWith("mac-package.js"),
      });
    }
    const packages = copyRuntimePackages(
      desktop,
      appRoot,
      join(repo, "packages"),
    );
    writeFileSync(
      join(appRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "pkm",
          productName: "Contextory",
          version: metadata.version,
          type: "module",
          main: "apps/desktop/electron-main.cjs",
          dependencies: metadata.dependencies,
        },
        null,
        2,
      )}\n`,
    );
    const plist = join(bundle, "Contents", "Info.plist");
    const settings = {
      CFBundleDisplayName: "Contextory",
      CFBundleName: "Contextory",
      CFBundleIdentifier: "com.pkms.desktop",
      CFBundleShortVersionString: metadata.version.split("-")[0]!,
      CFBundleVersion: metadata.version.split("-")[0]!,
      CFBundleIconFile: "pkm.icns",
      LSApplicationCategoryType: "public.app-category.productivity",
    };
    for (const [key, value] of Object.entries(settings)) {
      run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
    }
    run("/usr/libexec/PlistBuddy", [
      "-c",
      "Delete :ElectronAsarIntegrity",
      plist,
    ]);
    createIcon(
      join(repo, "apps", "web", "public", "icon.png"),
      join(resources, "pkm.icns"),
      stage,
    );
    run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle]);
    run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);

    const executable = join(bundle, "Contents", "MacOS", "Electron");
    const storage = pathToFileURL(
      join(appRoot, "node_modules", "@pkm", "storage-node", "dist", "index.js"),
    ).href;
    const nativeCheck = `const { IndexDatabase } = await import(${JSON.stringify(storage)}); const index = new IndexDatabase(":memory:"); console.log("Packaged Electron SQLite check passed:", process.versions.electron, index.database.prepare("select sqlite_version() as version").get().version); index.close();`;
    execFileSync(executable, ["--input-type=module", "-e", nativeCheck], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
      timeout: 30_000,
    });
    execFileSync(executable, [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "",
        PKM_ELECTRON_SMOKE: "1",
      },
      stdio: "inherit",
      timeout: 30_000,
    });
    console.log(
      `Packaged ${packages} runtime dependencies; development files and Vault data are excluded.`,
    );
    symlinkSync("/Applications", join(imageRoot, "Applications"));
    const fileName = `Contextory-${metadata.version}-${process.arch}.dmg`;
    const image = join(stage, fileName);
    run("/usr/bin/hdiutil", [
      "create",
      "-volname",
      "Contextory",
      "-srcfolder",
      imageRoot,
      "-fs",
      "HFS+",
      "-format",
      "UDZO",
      "-o",
      image,
    ]);
    run("/usr/bin/hdiutil", ["verify", image]);
    const output = join(repo, "release");
    mkdirSync(output, { recursive: true });
    // Only replace generated outputs once packaging and verification succeed.
    rmSync(join(output, "Contextory.app"), { recursive: true, force: true });
    renameSync(bundle, join(output, "Contextory.app"));
    renameSync(image, join(output, fileName));
    console.log(
      `Ready: ${join(output, fileName)}\nApp: ${join(output, "Contextory.app")}\nLocal ad-hoc signature; Apple notarization is not included.`,
    );
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  packageMacDesktop();
}
