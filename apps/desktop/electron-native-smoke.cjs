const { app } = require("electron");

void app
  .whenReady()
  .then(async () => {
    // Resolve types from source even when CI lints before building the workspace.
    const storage = /** @type {unknown} */ (await import("@pkm/storage-node"));
    const { IndexDatabase } =
      /** @type {typeof import("../../packages/storage-node/src/index-database.js")} */ (
        storage
      );
    const index = new IndexDatabase(":memory:");
    const { version } = /** @type {{ version: string }} */ (
      index.database.prepare("SELECT sqlite_version() AS version").get()
    );
    index.close();
    console.log(`Electron native smoke passed: SQLite ${version}`);
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
