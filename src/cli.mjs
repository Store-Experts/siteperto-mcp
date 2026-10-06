#!/usr/bin/env node
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { prepareSitePackage } from "./site-package.mjs";
import { openLocalSession, LocalOAuthProvider, localSiteInfo, sendLocalUpdate, trustedFetch, MCP_URL } from "./oauth-client.mjs";

const [command = "help", directory, ...extra] = process.argv.slice(2);
async function connect(session) {
  let resolveCode, rejectCode;
  const callback = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  let provider;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/plain; charset=utf-8"); response.setHeader("Cache-Control", "no-store"); response.setHeader("Referrer-Policy", "no-referrer");
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== "/callback" || request.headers.origin) { response.writeHead(404); response.end("Página não encontrada."); return; }
    const state = url.searchParams.get("state") || "", expected = provider?.nonce || "";
    if (state.length !== expected.length || !expected || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) { response.writeHead(400); response.end("Retorno não autorizado."); return; }
    const code = url.searchParams.get("code");
    if (!/^spo_c_[A-Za-z0-9_-]{43}$/.test(code || "")) { response.writeHead(400); response.end("Conexão não autorizada. Volte à IA e tente novamente."); rejectCode(new Error("Conexão não autorizada.")); return; }
    response.end("Autorização recebida. Volte ao seu editor para conferir a conexão."); resolveCode(code);
  });
  server.maxConnections = 4; server.requestTimeout = 10_000; server.headersTimeout = 5000;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const timeout = setTimeout(() => rejectCode(new Error("Tempo de conexão encerrado. Inicie novamente.")), 5 * 60_000);
  // Callback rejection is observed even if a failed discovery ends the flow first.
  callback.catch(() => {});
  try {
    provider = new LocalOAuthProvider(session, { redirectUrl: `http://127.0.0.1:${server.address().port}/callback`, authorize: async (url) => {
      process.stdout.write(`Entre no SitePerto e escolha o site que esta pasta poderá atualizar:\n${url.href}\n`);
      if (process.env.SITEPERTO_NO_BROWSER === "1") return;
      const argumentsForPlatform = process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url.href]] : process.platform === "darwin" ? ["open", [url.href]] : ["xdg-open", [url.href]];
      execFile(argumentsForPlatform[0], argumentsForPlatform[1], { windowsHide: true }, () => {});
    } });
    await session.locked(async () => {
      const first = await auth(provider, { serverUrl: MCP_URL, scope: "site.read site.update", fetchFn: trustedFetch });
      if (first === "REDIRECT") {
        const code = await callback;
        if (await auth(provider, { serverUrl: MCP_URL, authorizationCode: code, scope: "site.read site.update", fetchFn: trustedFetch }) !== "AUTHORIZED") throw new Error("Conexão não concluída.");
      }
    });
    const info = await localSiteInfo(session);
    process.stdout.write(`Conectado: ${info.project.name}. Você já pode enviar atualizações desta pasta.\n`);
  } finally { clearTimeout(timeout); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
try {
  if (command === "mcp" && directory && !extra.length) {
    const { startLocalMcp } = await import("./oauth-server.mjs");
    await startLocalMcp(directory);
  } else if (!directory || extra.length || !["connect", "send", "inspect", "status"].includes(command)) {
    process.stdout.write("SitePerto — seu site local, pronto para conferir\n\nsiteperto connect ./dist  Conecte uma vez pelo navegador\nsiteperto send ./dist     Envie a atualização e receba a prévia\nsiteperto inspect ./dist  Confira arquivos, tamanho e exclusões\nsiteperto status ./dist   Veja qual site está conectado\nsiteperto mcp ./dist      Inicie o MCP local da pasta já conectada\n\nO envio atualiza a área de trabalho; publicar continua sob seu controle no painel.\n");
    if (command !== "help") process.exitCode = 1;
  } else {
    const session = await openLocalSession(directory);
    if (command === "connect") { await prepareSitePackage(session.directory, { includeArchive: false }); await connect(session); }
    else if (command === "inspect") process.stdout.write(JSON.stringify(await prepareSitePackage(session.directory, { includeArchive: false })) + "\n");
    else if (command === "status") process.stdout.write(JSON.stringify(await localSiteInfo(session)) + "\n");
    else { const pack = await prepareSitePackage(session.directory); process.stdout.write(JSON.stringify(await sendLocalUpdate(session, pack.archive)) + "\n"); }
  }
} catch (error) {
  // Do not print HTTP bodies, private configuration, stack traces or credentials.
  const message = error instanceof Error && !/spo_|spc_|Bearer|-----BEGIN|https?:\/\//.test(error.message) ? error.message : "Não foi possível concluir. Confira a pasta e conecte novamente pelo SitePerto.";
  process.stderr.write(message + "\n"); process.exitCode = 1;
}
