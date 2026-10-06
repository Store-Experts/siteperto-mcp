import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { openLocalSession, LocalOAuthProvider, trustedFetch, boundedResponseText, API_ORIGIN, MCP_URL } from "./oauth-client.mjs";
async function fixture(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "siteperto-oauth-test-"));
  const site = path.join(root, "site"), storageRoot = path.join(root, "private");
  await mkdir(site);
  try { await callback({ root, site, storageRoot }); }
  finally {
    const resolved = await realpath(root);
    assert.equal(resolved, await realpath(root));
    assert.ok(path.basename(resolved).startsWith("siteperto-oauth-test-") && path.dirname(resolved).toLowerCase() === (await realpath(os.tmpdir())).toLowerCase());
    await rm(resolved, { recursive: true, force: true });
  }
}
test("Local session binds a physical folder and stores credentials privately outside its site", async () => fixture(async ({ site, storageRoot }) => {
  const session = await openLocalSession(site, { storageRoot });
  const client = { client_id: "client-a", token_endpoint_auth_method: "none", issuer: API_ORIGIN + "/", redirect_uris: ["http://127.0.0.1:1234/callback"] };
  const provider = new LocalOAuthProvider(session, { redirectUrl: client.redirect_uris[0] });
  await provider.saveClientInformation(client);
  await provider.saveTokens({ access_token: "spo_a_" + "a".repeat(43), refresh_token: "spo_r_" + "r".repeat(43), token_type: "Bearer", expires_in: 3600, issuer: API_ORIGIN + "/" });
  assert.equal((await readdir(site)).length, 0);
  const files = await readdir(storageRoot);
  assert.equal(files.length, 1); assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  assert.equal((await provider.tokens()).access_token, "spo_a_" + "a".repeat(43));
  assert.ok((await session.read()).accessExpiresAt <= Date.now() + 3_600_000);
  await provider.invalidateCredentials("tokens"); assert.equal(await provider.tokens(), undefined);
  const saved = JSON.parse(await readFile(path.join(storageRoot, files[0]), "utf8"));
  saved.directory = "another-folder";
  await writeFile(path.join(storageRoot, files[0]), JSON.stringify(saved));
  await assert.rejects(() => session.read(), /inválida/);
  await assert.rejects(() => openLocalSession(site, { storageRoot: path.join(site, "keys") }), /fora dela/);
}));
test("Local session serializes renewal and does not allow simultaneous access to its credential file", async () => fixture(async ({ site, storageRoot }) => {
  const session = await openLocalSession(site, { storageRoot });
  await session.locked(async () => { await assert.rejects(() => session.locked(async () => {}), /Outra operação/); });
  assert.equal((await readdir(storageRoot)).length, 0);
}));
test("Local OAuth rejects foreign issuers, destinations and oversized responses before exposing contents", async () => {
  for (const url of ["http://127.0.0.1:3001/private", "https://attacker.example/token", API_ORIGIN + "/token?secret=omitted", API_ORIGIN + "/admin/settings"]) await assert.rejects(() => trustedFetch(url), /inválido/);
  assert.equal(await boundedResponseText(new Response("synthetic")), "synthetic");
  await assert.rejects(() => boundedResponseText(new Response("x".repeat(257 * 1024))), /limite/);
});
test("Official OAuth client SDK discovers, registers, starts PKCE and exchanges a code without manual keys", async () => {
  let data = { version: 1, directory: "synthetic" }, authorization, tokenRequests = 0;
  const session = { read: async () => structuredClone(data), save: async (next) => { data = structuredClone(next); } };
  const provider = new LocalOAuthProvider(session, { redirectUrl: "http://127.0.0.1:1234/callback", authorize: async (url) => { authorization = url; } });
  const fetchFn = async (input, options = {}) => {
    const url = new URL(String(input)); assert.equal(url.origin, API_ORIGIN);
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp") return Response.json({ resource: MCP_URL, authorization_servers: [API_ORIGIN + "/"], scopes_supported: ["site.read", "site.update"] });
    if (url.pathname === "/.well-known/oauth-authorization-server") return Response.json({ issuer: API_ORIGIN + "/", authorization_endpoint: API_ORIGIN + "/authorize", token_endpoint: API_ORIGIN + "/token", registration_endpoint: API_ORIGIN + "/register", response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"] });
    if (url.pathname === "/register") return Response.json({ ...JSON.parse(options.body), client_id: "client-a" }, { status: 201 });
    if (url.pathname === "/token") {
      tokenRequests++; const body = new URLSearchParams(options.body);
      assert.equal(body.get("resource"), MCP_URL); assert.equal(body.get("grant_type"), "authorization_code"); assert.ok(body.get("code_verifier"));
      return Response.json({ access_token: "spo_a_" + "a".repeat(43), refresh_token: "spo_r_" + "r".repeat(43), expires_in: 3600, token_type: "Bearer", scope: "site.read site.update" });
    }
    return new Response("", { status: 404 });
  };
  assert.equal(await auth(provider, { serverUrl: MCP_URL, scope: "site.read site.update", fetchFn }), "REDIRECT");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("resource"), MCP_URL);
  assert.equal(authorization.searchParams.get("state"), provider.nonce);
  assert.equal(await auth(provider, { serverUrl: MCP_URL, authorizationCode: "spo_c_" + "c".repeat(43), scope: "site.read site.update", fetchFn }), "AUTHORIZED");
  assert.equal(tokenRequests, 1);
  assert.equal(data.tokens.issuer, API_ORIGIN + "/");
});
