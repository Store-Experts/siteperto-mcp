import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openLocalSession, localSiteInfo, sendLocalUpdate } from "./oauth-client.mjs";
import { prepareSitePackage } from "./site-package.mjs";

export async function startLocalMcp(directory) {
  const session = await openLocalSession(directory);
  const server = new McpServer({ name: "siteperto-local", version: "0.2.0" });
  let frameBytes = 0;
  process.stdin.on("data", (chunk) => {
    for (const byte of Buffer.from(chunk)) {
      frameBytes = byte === 10 ? 0 : frameBytes + 1;
      if (frameBytes > 65536) { process.stderr.write("Mensagem MCP acima do limite.\n"); process.exit(1); }
    }
  });
  const tool = (operation) => async () => {
    try { return { content: [{ type: "text", text: JSON.stringify(await operation()) }] }; }
    catch { return { content: [{ type: "text", text: "Não foi possível concluir. Confira a pasta, conexão e atualização no painel. Se o acesso expirou, use siteperto connect nesta pasta." }], isError: true }; }
  };
  server.registerTool("get_site", { title: "Ver o site conectado", description: "Consulta apenas o site autorizado para esta pasta. Sem dados de contatos ou cobrança.", annotations: { readOnlyHint: true, openWorldHint: false } }, tool(() => localSiteInfo(session)));
  server.registerTool("inspect_site", { title: "Conferir arquivos locais", description: "Confere somente a pasta de saída configurada pelo usuário. Não executa builds ou comandos.", annotations: { readOnlyHint: true, openWorldHint: false } }, tool(() => prepareSitePackage(session.directory, { includeArchive: false })));
  server.registerTool("send_update", { title: "Enviar atualização", description: "Envia a saída estática da pasta configurada para a área de trabalho do site autorizado. Reutiliza a atualização anterior da conexão, com proteção de edição humana. Retorna a prévia. Publicar continua no painel.", annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false } }, tool(async () => {
    const pack = await prepareSitePackage(session.directory);
    return sendLocalUpdate(session, pack.archive);
  }));
  await server.connect(new StdioServerTransport());
}
