import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { prepareSitePackage } from "./site-package.mjs";

const API = "https://api.storeexperts.com.br/connect/v1";
const token = process.env.SITEPERTO_CONNECTOR_TOKEN;
const directory = process.env.SITEPERTO_SITE_DIRECTORY;
const server = new McpServer({ name: "siteperto-local", version: "0.1.0" });
const result = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

// These tools have no input arguments. Bound framing before the SDK buffers it.
let inputFrameBytes = 0;
process.stdin.on("data", (chunk) => {
  for (const byte of Buffer.from(chunk)) {
    inputFrameBytes = byte === 10 ? 0 : inputFrameBytes + 1;
    if (inputFrameBytes > 65536) {
      process.stderr.write("Mensagem MCP acima do limite permitido.\n");
      process.exit(1);
    }
  }
});

async function apiRequest(operation, archive) {
  if (typeof token !== "string" || !/^spc_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Conecte este projeto pelo painel e configure sua chave temporária no cliente local.");
  const body = archive ? new FormData() : undefined;
  if (body) body.set("file", new Blob([archive]), "siteperto-local.zip");
  const response = await fetch(`${API}/${operation}`, {
    method: archive ? "POST" : "GET", headers: { Authorization: `Bearer ${token}` },
    body, redirect: "error", signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error("A conexão expirou, foi revogada ou perdeu permissão. Conecte novamente pelo painel.");
    if (response.status === 429) throw new Error("Limite de envio atingido. Aguarde antes de tentar novamente.");
    throw new Error("O SitePerto não aceitou o envio. Confira o pacote e os limites no painel.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Resposta indisponível.");
  const chunks = []; let length = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 65536) throw new Error("Resposta acima do limite permitido.");
      chunks.push(Buffer.from(chunk.value));
    }
  } finally { await reader.cancel(); }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed?.ok || !parsed.data || typeof parsed.data !== "object") throw new Error("Resposta inválida.");
  return parsed.data;
}

const safeTool = (callback) => async () => {
  try { return result(await callback()); }
  catch (error) {
    const known = error instanceof Error && !/spc_|Bearer|-----BEGIN/.test(error.message);
    return { ...result({ message: known ? error.message : "Não foi possível concluir. Confira a conexão e a pasta do site." }), isError: true };
  }
};

server.registerTool("inspect_site", {
  title: "Conferir site pronto", description: "Verifica a pasta estática previamente autorizada, arquivos, tamanho e credenciais reconhecidas. Não envia arquivos nem executa comandos.",
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, safeTool(() => prepareSitePackage(directory, { includeArchive: false })));
server.registerTool("connection_info", {
  title: "Conferir conexão SitePerto", description: "Consulta somente o projeto vinculado à chave temporária. Não lê clientes, formulários, pagamentos ou conteúdo de outros projetos.",
  inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
}, safeTool(() => apiRequest("site")));
server.registerTool("send_draft", {
  title: "Enviar rascunho ao SitePerto", description: "Envia a pasta estática autorizada como rascunho, respeitando a cota existente. Não publica, substitui ou exclui temas. A publicação é feita no painel pelo usuário.",
  inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, safeTool(async () => { const pack = await prepareSitePackage(directory); return apiRequest("draft", pack.archive); }));

server.onerror = () => { process.stderr.write("Falha de protocolo na conexão SitePerto.\n"); };
await server.connect(new StdioServerTransport());
