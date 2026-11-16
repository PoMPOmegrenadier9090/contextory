const { app } = require("electron");
const process = require("node:process");

void app
  .whenReady()
  .then(async () => {
    // Resolve types from source even when CI lints before building the workspace.
    const storage = /** @type {unknown} */ (await import("@pkm/storage-node"));
    const { ObjectStore } =
      /** @type {typeof import("../../packages/storage-node/src/index.js")} */ (
        storage
      );
    new ObjectStore(":memory:").close();
    console.log(
      `Electron native smoke passed: Electron ${process.versions.electron}`,
    );
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
