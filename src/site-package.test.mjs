import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { unzipSync } from "fflate";
import { prepareSitePackage } from "./site-package.mjs";

async function fixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "siteperto-connector-fixture-"));
  try { await writeFile(path.join(root, "index.html"), '<!doctype html><html><head><title>Fixture</title></head><body>Fixture</body></html>'); await callback(root); }
  finally {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith("siteperto-connector-fixture-"));
    await rm(target, { recursive: true, force: true });
  }
}

test("prepares reproducible ZIPs and does not include private configuration or build dependencies", async () => fixture(async (root) => {
  await mkdir(path.join(root, "assets")); await writeFile(path.join(root, "assets", "site.js"), "document.title='Fixture';");
  await mkdir(path.join(root, ".git")); await writeFile(path.join(root, ".git", "config"), "private");
  await mkdir(path.join(root, "node_modules")); await writeFile(path.join(root, "node_modules", "private.js"), "private");
  await writeFile(path.join(root, ".env"), "PRIVATE=value");
  const first = await prepareSitePackage(root);
  const second = await prepareSitePackage(root);
  assert.deepEqual(first.archive, second.archive);
  assert.equal(first.fileCount, 2); assert.equal(first.excludedCount, 3);
  assert.deepEqual(Object.keys(unzipSync(first.archive)).sort(), ["assets/site.js", "index.html"]);
  const inspection = await prepareSitePackage(root, { includeArchive: false });
  assert.equal("archive" in inspection, false); assert.equal(inspection.contentSha256, first.contentSha256);
}));

test("rejects recognized credentials in public JavaScript before producing an upload", async () => fixture(async (root) => {
  for (const secret of ["spc_" + "a".repeat(43), "ghp_" + "a".repeat(36), "-----BEGIN PRIVATE KEY-----"]) {
    await writeFile(path.join(root, "site.js"), `const privateKey='${secret}';`);
    await assert.rejects(prepareSitePackage(root), (error) => { assert.match(error.message, /credencial privada/); assert.equal(error.message.includes(secret), false); return true; });
  }
}));

test("requires an absolute ready-output directory and does not execute source projects", async () => fixture(async (root) => {
  await assert.rejects(prepareSitePackage("relative/path"), /absoluta/);
  await mkdir(path.join(root, "unbuilt"));
  await assert.rejects(prepareSitePackage(path.join(root, "unbuilt")), /index.html/);
}));

test("rejects symlinks to files outside the selected root", async (context) => fixture(async (root) => {
  const outside = path.join(path.dirname(root), path.basename(root) + "-outside.txt");
  try {
    await writeFile(outside, "private fixture");
    try { await symlink(outside, path.join(root, "linked.txt"), "file"); }
    catch (error) { if (process.platform === "win32" && error.code === "EPERM") { context.skip("Windows does not allow unprivileged file symlinks in this environment"); return; } throw error; }
    await assert.rejects(prepareSitePackage(root), /simbólico/);
  } finally { await rm(outside, { force: true }); }
}));

test("file-count limit stops a package before any request can be sent", async () => fixture(async (root) => {
  for (let index = 0; index < 600; index++) await writeFile(path.join(root, `file-${index}.txt`), "fixture");
  await assert.rejects(prepareSitePackage(root), /600 arquivos/);
}));
