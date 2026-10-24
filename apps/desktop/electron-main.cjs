const { app, protocol } = require("electron");
const path = require("node:path");
const process = require("node:process");

// Keep existing device settings and Chromium storage when changing the app name.
const userData =
  !process.defaultApp &&
  !process.argv.some(
    (argument) =>
      argument === "--user-data-dir" || argument.startsWith("--user-data-dir="),
  )
    ? path.join(app.getPath("appData"), "PKM")
    : app.getPath("userData");
app.setName("Contextory");
app.setPath("userData", userData);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "pkm-asset",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

void app
  .whenReady()
  .then(() => import("./dist/electron-main.js"))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
