import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";

// Precompress at build time so mobile requests do not spend server CPU on
// recompressing the same hashed JavaScript/CSS files.
const compressedAssets: Plugin = {
  name: "compressed-assets",
  async writeBundle(options, bundle) {
    if (!options.dir) throw new Error("Missing Web output directory");
    const root = options.dir;
    await Promise.all(
      Object.values(bundle)
        .filter((file) => /\.(js|css)$/.test(file.fileName))
        .map(async (file) => {
          // Read the final files: Vite strips internal CSS markers after the
          // generateBundle phase, and compressed bytes must exactly match identity.
          const path = join(root, file.fileName);
          const bytes = await readFile(path);
          await Promise.all([
            writeFile(path + ".gz", gzipSync(bytes)),
            writeFile(
              path + ".br",
              brotliCompressSync(bytes, {
                params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
              }),
            ),
          ]);
        }),
    );
  },
};

const staticWorker: Plugin = {
  name: "static-worker",
  enforce: "post",
  buildStart() {
    this.emitFile({
      type: "chunk",
      id: fileURLToPath(new URL("./src/service-worker.ts", import.meta.url)),
      name: "service-worker-runtime",
      preserveSignature: "strict",
    });
  },
  generateBundle: {
    order: "post",
    handler(_options, bundle) {
      const html = bundle["index.html"];
      const runtime = Object.values(bundle).find(
        (file) =>
          file.type === "chunk" && file.name === "service-worker-runtime",
      );
      if (
        !html ||
        html.type !== "asset" ||
        !runtime ||
        runtime.type !== "chunk" ||
        !runtime.exports.includes("configureStaticWorker")
      )
        throw new Error("Missing PWA shell or worker runtime");
      const shell =
        typeof html.source === "string"
          ? html.source
          : Buffer.from(html.source).toString("utf8");
      const assetFiles = Object.values(bundle)
        .filter((file) => /\.(js|css)$/.test(file.fileName))
        .map((file) => "/" + file.fileName)
        .sort();
      const coreFiles = [
        ...shell.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
      ].map((match) => match[1]);
      const version = createHash("sha256")
        .update(JSON.stringify({ shell, assetFiles }))
        .digest("hex")
        .slice(0, 16);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `import { configureStaticWorker } from ${JSON.stringify("/" + runtime.fileName)};\nconfigureStaticWorker(self, ${JSON.stringify({ version, coreFiles, assetFiles, shell })});\n`,
      });
    },
  },
};

export default defineConfig({
  plugins: [react(), compressedAssets, staticWorker],
  resolve: {
    dedupe: ["react", "react-dom", "@mantine/core", "@mantine/hooks"],
  },
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
  },
});
