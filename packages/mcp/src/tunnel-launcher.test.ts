import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
const run = promisify(execFile);
const launcher = fileURLToPath(
  new URL("../../../deploy/start-openai-tunnel.sh", import.meta.url),
);
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
const fixture = async (values: Record<string, string>) => {
  const dir = await mkdtemp(join(tmpdir(), "pkm-tunnel-launcher-"));
  dirs.push(dir);
  const binary = join(dir, "fake-tunnel-client");
  // Capture the CLI contract without connecting to OpenAI or using real secrets.
  await writeFile(
    binary,
    '#!/usr/bin/env bash\nprintf "%s\\n" "$CONTROL_PLANE_API_KEY"\nprintf "%s\\n" "$@"\n',
    { mode: 0o700 },
  );
  const envFile = join(dir, ".env");
  await writeFile(
    envFile,
    Object.entries({
      CONTROL_PLANE_API_KEY: "test-key",
      OPENAI_TUNNEL_ID: "tunnel_test",
      TUNNEL_CLIENT_BIN: binary,
      PKM_MCP_TOKEN: "a".repeat(64),
      ...values,
    })
      .map(([key, value]) => `${key}='${value}'`)
      .join("\n"),
  );
  return { envFile };
};
it("forwards both discovery and tool-call authentication to the loopback-published port", async () => {
  const { envFile } = await fixture({ PKM_MCP_HTTP_PORT: "9001" });
  const output = await run("bash", [launcher, envFile], {
    env: { PATH: process.env.PATH },
  });
  const args = output.stdout.trim().split("\n");
  expect(args[0]).toBe("test-key");
  expect(args).toContain("env:CONTROL_PLANE_API_KEY");
  expect(args).toContain("url=http://127.0.0.1:9001/mcp");
  expect(
    args.filter((arg) => arg === `Authorization: Bearer ${"a".repeat(64)}`),
  ).toHaveLength(2);
  expect(args).toContain("127.0.0.1:18080");
  expect(output.stderr).toBe("");
});
it("accepts the old bearer name and keeps the same precedence as Compose and PKM", async () => {
  const { envFile } = await fixture({
    PKM_MCP_TOKEN: "",
    MCP_BEARER_TOKEN: "b".repeat(64),
  });
  expect(
    (
      await run("bash", [launcher, envFile], {
        env: { PATH: process.env.PATH },
      })
    ).stdout,
  ).toContain(`Authorization: Bearer ${"b".repeat(64)}`);
});
it("rejects bad ports, missing credentials and short bearer tokens before starting a tunnel", async () => {
  for (const values of [
    { PKM_MCP_HTTP_PORT: "65536" },
    { OPENAI_TUNNEL_HEALTH_PORT: "0" },
    { PKM_MCP_TOKEN: "short" },
    { CONTROL_PLANE_API_KEY: "" },
    { PKM_MCP_AUTH: "oauth" },
  ]) {
    const { envFile } = await fixture(values);
    await expect(
      run("bash", [launcher, envFile], { env: { PATH: process.env.PATH } }),
    ).rejects.toMatchObject({ code: 1, stdout: "" });
  }
});
