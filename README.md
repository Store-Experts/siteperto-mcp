# SitePerto MCP · beta

Conecte sua IA a **um site escolhido por você**, envie o site HTML pronto e peça alterações em texto, CSS e JavaScript. Confira a prévia e publique pelo painel do [SitePerto](https://siteperto.com).

O fluxo usa MCP e OAuth com PKCE, no mesmo padrão de conexão por endereço, login e autorização usado por servidores remotos como os da Cloudflare. É uma integração independente; não é um plugin oficial do ChatGPT, Claude, Codex ou Antigravity. A disponibilidade de servidores personalizados depende do aplicativo e do plano de cada fornecedor.

## Depois de conectar: peça na conversa

“Crie um site simples para uma loja de calçados.” Depois: “Coloque no SitePerto e me mande a prévia.” Essa sequência passou no ChatGPT em 06/10/2026, com conta, site e conexão pessoal já configurados; o modelo encontrou a integração sem seleção manual de ferramenta e enviou os arquivos sem download/novo anexo de ZIP. A prévia é para o dono conferir; a publicação e o endereço público continuam pelo painel.

O teste não comprova facilidade da configuração inicial, disponibilidade em todas as contas/planos, compatibilidade com outros aplicativos ou instalação pública. A primeira configuração abaixo é uma opção avançada em beta.

## Primeira conexão remota em beta

1. Adicione `https://api.storeexperts.com.br/mcp` como servidor MCP remoto em um aplicativo compatível com Streamable HTTP e OAuth.
2. Use Google para entrar ou criar sua conta gratuita, sem cartão, e continue na mesma conexão. Os termos aparecem antes de continuar; quem já possui senha pode usar o acesso existente.
3. Escolha seu site e clique em **Autorizar conexão**. Se ainda não possui site e sua conta é elegível, dê um nome ao primeiro e use **Criar site e autorizar**: ele começa protegido, dentro das cotas da conta.

Você não copia chaves. Se já estiver conectado e só houver um site elegível, ele vem selecionado. A autorização dura até sete dias; o aplicativo renova automaticamente o acesso de uma hora dentro desse período. Depois, você autoriza novamente. Revogue a conexão no editor do site quando quiser.

O cadastro e o primeiro site são confirmados por você na tela do SitePerto. As ferramentas da IA não criam contas nem publicam automaticamente. A continuidade com Google passou em testes de callback e banco isolado; a comprovação completa com uma conta Google nova no navegador ainda está pendente.

**Exemplo de pedido:** “Consulte meu site, leia o título e o CSS e altere a chamada principal. Preserve as imagens e me mostre a prévia.”

A conexão remota não consegue ler o localhost ou as pastas do computador. Para essa jornada, use a ponte abaixo.

## Distribuição pelo diretório: em preparação

A pasta `plugin/` contém o pacote remoto de metadados, endpoint fixo e assets públicos/sintéticos, sem hooks, executáveis ou credenciais. `python package-plugin.py /caminho/de/saida` gera o ZIP por uma lista limitada de seis arquivos; `python package-plugin.test.py` verifica exclusões, limites e bloqueio de configurações indevidas. Não há publicação ou aprovação no diretório. Identidade verificada, validação no portal e revisão externa continuam necessárias. Consulte os [requisitos oficiais de submissão](https://developers.openai.com/plugins/deploy/submission).

## Seu projeto local: conectar uma vez, depois enviar

Pré-requisito: Node.js 22 ou superior e uma pasta de saída estática com `index.html`, como `dist` ou `out`. Não envie fontes que precisam de build, PHP, banco ou servidor Node.

Você pode iniciar sem clonar nem editar JSON, com a versão pública fixada:

```sh
npx --yes --ignore-scripts --package=github:Store-Experts/siteperto-mcp#v0.2.0 siteperto connect /caminho/absoluto/meu-site/dist
npx --yes --ignore-scripts --package=github:Store-Experts/siteperto-mcp#v0.2.0 siteperto send /caminho/absoluto/meu-site/dist
```

O primeiro comando conecta; o segundo é usado para as atualizações. O npm obtém somente esta integração e suas dependências fixadas. A versão por tag facilita repetir a instalação; confira o código e o fornecedor antes de executá-la.

Com o pacote baixado ou o repositório clonado, instale as dependências nesta pasta:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node src/cli.mjs connect /caminho/absoluto/meu-site/dist
```

O navegador abre o SitePerto para a mesma escolha de site e autorização. Depois de modificar ou gerar os arquivos:

```sh
node src/cli.mjs send /caminho/absoluto/meu-site/dist
```

O envio retorna os links de prévia e do editor. `inspect` verifica os arquivos sem enviá-los; `status` mostra qual site está conectado. A ponte não compila, executa scripts nem instala dependências do seu projeto.

Para um editor de IA com MCP local por stdio, conecte a pasta antes e configure:

```json
{
  "mcpServers": {
    "siteperto": {
      "command": "node",
      "args": ["/caminho/absoluto/siteperto-mcp/src/cli.mjs", "mcp", "/caminho/absoluto/meu-site/dist"]
    }
  }
}
```

O formato acima é referência para clientes que aceitam `mcpServers`; cada aplicativo tem seu próprio formato. A IA não recebe parâmetro para mudar a pasta. A configuração não contém uma chave.

## Atualizar é diferente de publicar

A conexão mantém **uma atualização pendente própria**, em vez de ocupar a biblioteca com um novo tema a cada envio. Um pacote idêntico reutiliza o resultado. Uma atualização diferente substitui apenas a versão pendente da própria conexão, dentro da cota existente.

O tema ativo e os rascunhos de outras origens são preservados. Se alguém editar a versão pendente no painel, um novo envio sem leitura dessa revisão é recusado. Na conexão remota, `read_files` seguido de `edit_files` permite trabalhar sobre a revisão atual e preservar todos os outros arquivos, incluindo imagens. O site no ar só muda quando você publica pelo painel. Esta versão não oferece publicação automática.

## Ferramentas remotas

| Ferramenta | Ação |
| --- | --- |
| `get_site` | Site autorizado, arquivos disponíveis, revisão e links |
| `read_files` | Até dez arquivos de texto, total de 256 KiB; conteúdo binário omitido |
| `edit_files` | Até dez arquivos de texto existentes, até 256 KiB, com revisão obrigatória; preserva os demais arquivos |
| `send_update` | Pacote completo com até 600 arquivos e 6 MiB de conteúdo, incluindo `index.html` |

A edição parcial aceita sites HTML prontos e preserva o manifesto. Ela não adiciona nem apaga arquivos. Para trocar imagens, adicionar páginas ou enviar pacotes maiores, envie o pacote completo pela ponte local. A edição parcial pode preservar conjuntos de até 32 MiB; a ponte respeita os limites existentes de até 100 MiB e 600 arquivos, sem aumentar a cota do plano.

## Segurança e armazenamento

- OAuth Authorization Code com PKCE S256, código de uso único válido por cinco minutos, audiência fixa e tokens de acesso de até uma hora.
- Uma autorização vincula usuário, aplicativo e **um único site**; permissões, identidade ativa e plano são revalidados no uso e na escrita. Não há acesso a contatos, pagamentos, DNS, outros projetos ou credencial administrativa.
- Renovação rotaciona os tokens. Reutilizar o token de renovação imediatamente anterior revoga a conexão. O servidor guarda hashes das credenciais; a auditoria registra ações e IDs, nunca os tokens ou o conteúdo dos arquivos.
- A ponte guarda suas credenciais em uma pasta privada fora do site, com permissões do sistema operacional. Não cole credenciais na conversa, no código, em issues ou no Git.
- Destino HTTPS fixo. Nenhum download arbitrário de URL, build, comando remoto ou execução de código enviado. O retorno local abre temporariamente apenas `127.0.0.1` durante a autorização e fecha ao concluir ou após cinco minutos.
- Arquivos privados, links simbólicos, caminhos de travessia e formatos de credenciais reconhecidos são recusados. A detecção não reconhece todos os segredos ou dados pessoais: revise os arquivos públicos.
- Limites por IP/conexão, quatro requisições MCP concorrentes e um envio por processo; até 20 tentativas de atualização por hora por conexão. Limites operacionais não são SLA.
- Até três conexões ativas por usuário/site e 20 por usuário, com limites globais. Cadastros públicos de aplicativos expiram em 30 dias. A rotina limpa credenciais expiradas; conserva somente a referência da atualização pendente por até 30 dias após a expiração, para retomar a mesma conexão sem ocupar outra vaga. Revogações com mais de um dia são removidas. A auditoria própria tem retenção de até 90 dias e teto conjunto de 50.000 registros; os mais antigos saem primeiro, sem afetar auditorias de outros serviços.
- O conector não mantém uma cópia ZIP permanente nem aumenta a cota. Os arquivos ficam na biblioteca e nos mecanismos de histórico já existentes.
- O processo local tem os privilégios do usuário. Não é um sandbox contra malware ou contra uma IA que já tenha acesso independente ao computador.

## Desenvolvimento e compatibilidade

```sh
npm test
```

Dependências fixadas e lockfile: [SDK oficial MCP](https://github.com/modelcontextprotocol/typescript-sdk) 1.32.1 e fflate 0.8.3. Protocolo testado pelo SDK, sem chamar um modelo pago. Em 06/10/2026, o teste sintético em produção concluiu login, envio local, leitura e edição remota, renovação automática, deduplicação e revogação; o tema ativo e outro rascunho permaneceram idênticos. Um teste do protocolo não substitui a homologação do aplicativo de IA escolhido.

A conexão manual antiga de uma hora continua disponível como opção avançada em `src/server.mjs`, para usuários existentes; a jornada OAuth é a opção recomendada para novas conexões.

Documentação do produto: [conectar IA ao SitePerto](https://siteperto.com/guias/conectar-ia-local). Referências: [MCP autorização](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [Cloudflare MCP](https://github.com/cloudflare/mcp-server-cloudflare).
