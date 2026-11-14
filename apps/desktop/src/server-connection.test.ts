import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  connectionFile,
  parseServerConnection,
  type SecretCipher,
} from "./server-connection.js";

const saved = {
  url: "https://pkm.example.com",
  clientId: "id",
  clientSecret: "secret",
};

describe("parseServerConnection", () => {
  it("keeps only the origin of an https URL", () => {
    expect(
      parseServerConnection(
        {
          url: " https://pkm.example.com/daily ",
          clientId: "id ",
          clientSecret: "s",
        },
        null,
      ),
    ).toEqual({
      url: "https://pkm.example.com",
      clientId: "id",
      clientSecret: "s",
    });
  });

  it("refuses plain http except on this machine", () => {
    const input = { clientId: "id", clientSecret: "s" };
    expect(() =>
      parseServerConnection({ ...input, url: "http://pkm.example.com" }, null),
    ).toThrow("https");
    expect(
      parseServerConnection({ ...input, url: "http://127.0.0.1:3210" }, null)
        .url,
    ).toBe("http://127.0.0.1:3210");
  });

  it("reuses the stored secret only for the same Client ID", () => {
    expect(
      parseServerConnection(
        { url: saved.url, clientId: "id", clientSecret: "" },
        saved,
      ).clientSecret,
    ).toBe("secret");
    expect(() =>
      parseServerConnection(
        { url: saved.url, clientId: "other", clientSecret: "" },
        saved,
      ),
    ).toThrow("Client Secret");
  });
});

describe("connectionFile", () => {
  const directories: string[] = [];
  afterEach(() =>
    Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true })),
    ),
  );
  const cipher: SecretCipher = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...value].reverse().join("")),
    decryptString: (value) => [...value.toString()].reverse().join(""),
  };

  it("stores the secret encrypted and reads it back", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pkm-connection-"));
    directories.push(directory);
    const file = connectionFile(join(directory, "connection.json"), cipher);

    expect(await file.load()).toBeNull();
    await file.save(saved);
    expect(
      await readFile(join(directory, "connection.json"), "utf8"),
    ).not.toContain("secret");
    expect(await file.load()).toEqual(saved);
    await file.clear();
    expect(await file.load()).toBeNull();
  });

  it("refuses to save without encryption", async () => {
    const file = connectionFile("/nonexistent/connection.json", {
      ...cipher,
      isEncryptionAvailable: () => false,
    });
    await expect(file.save(saved)).rejects.toThrow("暗号化");
  });
});
