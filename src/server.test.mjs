import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("real SDK handshake exposes only three bounded tools and keeps the configured local directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "siteperto-mcp-fixture-"));
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("server.mjs", import.meta.url))], env: { SITEPERTO_SITE_DIRECTORY: root, SITEPERTO_CONNECTOR_TOKEN: "" }, stderr: "pipe" });
  const client = new Client({ name: "siteperto-fixture", version: "0.1.0" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  try {
    await writeFile(path.join(root, "index.html"), "<!doctype html><html><body>Fixture</body></html>");
    await client.connect(transport);
    const listing = await client.listTools();
    assert.deepEqual(listing.tools.map((tool) => tool.name).sort(), ["connection_info", "inspect_site", "send_draft"]);
    const inspection = await client.callTool({ name: "inspect_site", arguments: {} });
    assert.equal(inspection.isError, undefined);
    const summary = JSON.parse(inspection.content[0].text);
    assert.equal(summary.fileCount, 1);
    assert.equal("archive" in summary, false);
    const invalid = await client.callTool({ name: "connection_info", arguments: {} });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /chave temporária/);
    const forged = await client.callTool({ name: "inspect_site", arguments: { directory: path.dirname(root), projectId: "other-project" } });
    if (!forged.isError) assert.equal(JSON.parse(forged.content[0].text).fileCount, 1);
    assert.equal(stderr.includes("spc_"), false);
  } finally {
    await client.close(); await transport.close();
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith("siteperto-mcp-fixture-"));
    await rm(target, { recursive: true, force: true });
  }
});

test("oversized stdio frames stop the client without echoing input or credentials", async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("server.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { errors += chunk.toString(); });
  const finished = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  child.stdin.on("error", () => {});
  child.stdin.end("x".repeat(65537));
  assert.equal(await finished, 1);
  assert.equal(output, ""); assert.match(errors, /Mensagem MCP acima do limite/);
  assert.equal(errors.includes("x".repeat(100)), false);
});
