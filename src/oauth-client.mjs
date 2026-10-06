import { mkdir, lstat, readFile, writeFile, rename, unlink, chmod, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

export const API_ORIGIN = "https://api.storeexperts.com.br";
export const MCP_URL = `${API_ORIGIN}/mcp`;
const allowedPaths = new Set(["/mcp", "/register", "/token", "/revoke", "/connect/v2/site", "/connect/v2/update", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"]);
export async function trustedFetch(input, options = {}) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin !== API_ORIGIN || !allowedPaths.has(url.pathname) || url.username || url.password || url.hash || url.search) throw new Error("Destino de conexão inválido.");
  return fetch(input, { ...options, redirect: "error", signal: AbortSignal.timeout(30_000) });
}
export async function openLocalSession(directory, { storageRoot } = {}) {
  const chosen = path.resolve(directory), info = await lstat(chosen);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Escolha uma pasta real de saída estática.");
  const root = await realpath(chosen);
  const base = storageRoot ? path.resolve(storageRoot) : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "SitePerto", "connections") : path.join(os.homedir(), ".local", "state", "siteperto", "connections");
  const relative = path.relative(root, base);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("Escolha a pasta do site; credenciais devem ficar fora dela.");
  await mkdir(base, { recursive: true, mode: 0o700 });
  if ((await lstat(base)).isSymbolicLink()) throw new Error("A pasta privada de conexão não pode ser um link.");
  let windowsOwner;
  if (process.platform === "win32") {
    windowsOwner = execFileSync("whoami.exe", [], { encoding: "utf8", windowsHide: true }).trim();
    if (!/^[^\r\n]+\\[^\r\n]+$/.test(windowsOwner)) throw new Error("Não foi possível proteger a conexão local.");
    execFileSync("icacls.exe", [base, "/reset"], { stdio: "pipe", windowsHide: true });
    execFileSync("icacls.exe", [base, "/inheritance:r", "/grant:r", `${windowsOwner}:(OI)(CI)F`, "SYSTEM:(OI)(CI)F"], { stdio: "pipe", windowsHide: true });
  } else await chmod(base, 0o700);
  const identity = process.platform === "win32" ? root.toLowerCase() : root;
  const file = path.join(base, createHash("sha256").update(identity).digest("hex") + ".json");
  async function read() {
    const stat = await lstat(file).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (!stat) return { version: 1, directory: root };
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 || (process.platform !== "win32" && (stat.mode & 0o077))) throw new Error("Reconecte esta pasta: configuração privada inválida.");
    if (windowsOwner) execFileSync("icacls.exe", [file, "/reset"], { stdio: "pipe", windowsHide: true });
    const data = JSON.parse(await readFile(file, "utf8"));
    if (data.version !== 1 || data.directory !== root || (data.client && (typeof data.client.client_id !== "string" || data.client.client_id.length > 100 || data.client.client_secret || data.client.token_endpoint_auth_method !== "none" || ![API_ORIGIN, API_ORIGIN + "/"].includes(data.client.issuer)))) throw new Error("Reconecte esta pasta: identidade de conexão inválida.");
    if (data.tokens && (!/^spo_a_[A-Za-z0-9_-]{43}$/.test(data.tokens.access_token || "") || !/^spo_r_[A-Za-z0-9_-]{43}$/.test(data.tokens.refresh_token || "") || ![API_ORIGIN, API_ORIGIN + "/"].includes(data.tokens.issuer) || typeof data.accessExpiresAt !== "number")) throw new Error("Reconecte esta pasta: acesso privado inválido.");
    return data;
  }
  async function save(data) {
    if (data.directory !== root || data.version !== 1) throw new Error("Configuração fora da pasta autorizada.");
    const existing = await lstat(file).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error("Configuração privada inválida.");
    const body = JSON.stringify(data);
    if (Buffer.byteLength(body) > 16 * 1024) throw new Error("Configuração privada acima do limite.");
    const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    try { await writeFile(temporary, body, { flag: "wx", mode: 0o600 }); await rename(temporary, file); }
    finally { await unlink(temporary).catch(() => {}); }
  }
  async function locked(callback) {
    const lock = `${file}.lock`;
    try { await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 }); }
    catch { throw new Error("Outra operação está usando esta conexão. Aguarde e tente novamente."); }
    try { return await callback(); } finally { await unlink(lock).catch(() => {}); }
  }
  return { directory: root, read, save, locked };
}
export class LocalOAuthProvider {
  constructor(session, { redirectUrl, authorize } = {}) { this.session = session; this.redirectUrl = redirectUrl; this.authorize = authorize; this.verifier = undefined; this.nonce = randomBytes(32).toString("base64url"); }
  get clientMetadata() { return { client_name: "SitePerto — conexão local", redirect_uris: [String(this.redirectUrl)], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "site.read site.update" }; }
  state() { return this.nonce; }
  async clientInformation() { return (await this.session.read()).client; }
  async saveClientInformation(client) { const data = await this.session.read(); data.client = client; await this.session.save(data); }
  async tokens() { return (await this.session.read()).tokens; }
  async saveTokens(tokens) {
    const data = await this.session.read(); data.tokens = tokens;
    data.accessExpiresAt = Date.now() + Math.min(Number(tokens.expires_in) || 0, 3600) * 1000;
    await this.session.save(data);
  }
  async redirectToAuthorization(url) {
    if (!this.authorize || url.origin !== API_ORIGIN || url.pathname !== "/authorize" || url.searchParams.get("state") !== this.nonce) throw new Error("Entre novamente usando o comando conectar do SitePerto.");
    await this.authorize(url);
  }
  saveCodeVerifier(value) { this.verifier = value; }
  codeVerifier() { if (!this.verifier) throw new Error("Conexão não iniciada."); return this.verifier; }
  async invalidateCredentials(scope) {
    const data = await this.session.read();
    if (scope === "all" || scope === "client") delete data.client;
    if (scope === "all" || scope === "tokens") { delete data.tokens; delete data.accessExpiresAt; }
    if (scope === "all" || scope === "verifier") this.verifier = undefined;
    await this.session.save(data);
  }
  async validateResourceURL(server, resource) {
    if (String(server) !== MCP_URL || (resource !== undefined && resource !== MCP_URL)) throw new Error("Recurso de conexão inválido.");
    return new URL(MCP_URL);
  }
}
export async function localAccessToken(session) {
  return session.locked(async () => {
    let saved = await session.read();
    if (!saved.tokens) throw new Error("Conecte esta pasta ao SitePerto antes de enviar.");
    if (!saved.accessExpiresAt || saved.accessExpiresAt <= Date.now() + 30_000) {
      const provider = new LocalOAuthProvider(session, { redirectUrl: saved.client?.redirect_uris?.[0] });
      const result = await auth(provider, { serverUrl: MCP_URL, scope: "site.read site.update", fetchFn: trustedFetch });
      if (result !== "AUTHORIZED") throw new Error("Entre novamente usando o comando conectar do SitePerto.");
      saved = await session.read();
    }
    return saved.tokens.access_token;
  });
}
export async function localSiteInfo(session) {
  const token = await localAccessToken(session);
  const response = await trustedFetch(`${API_ORIGIN}/connect/v2/site`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("A conexão expirou ou perdeu permissão. Conecte novamente.");
  const text = await boundedResponseText(response);
  const result = JSON.parse(text);
  if (!result.ok || !result.data?.project?.id) throw new Error("Resposta de conexão inválida.");
  return result.data;
}
export async function sendLocalUpdate(session, archive) {
  const token = await localAccessToken(session);
  const body = new FormData(); body.set("file", new Blob([archive]), "atualizacao-siteperto.zip");
  const response = await trustedFetch(`${API_ORIGIN}/connect/v2/update`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body });
  if (!response.ok) throw new Error("Atualização recusada. Confira sua conexão, a cota e possíveis edições no painel.");
  const text = await boundedResponseText(response);
  const result = JSON.parse(text);
  if (!result.ok || !result.data?.id) throw new Error("Resposta de envio inválida.");
  return result.data;
}
export async function boundedResponseText(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Resposta indisponível.");
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 256 * 1024) throw new Error("Resposta acima do limite.");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}
