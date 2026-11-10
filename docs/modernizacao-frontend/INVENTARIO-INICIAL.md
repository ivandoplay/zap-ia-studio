# Inventário inicial de telas e integração — Ienvia

Data do levantamento: 2026-11-09

Este inventário separa o que foi observado no código do que ainda precisa de inspeção funcional. Não é uma declaração de que todas as operações já foram testadas.

## 1. Repositório principal: telas publicadas

A árvore do repositório contém 839 entradas. O frontend legado está concentrado em `public/`, com um arquivo principal grande (`public/app.js`, aproximadamente 468 KB) e páginas HTML por rota.

Páginas HTML identificadas:

| Rota/tela | Arquivo observado |
|---|---|
| Painel principal | `public/painel.html` |
| Visão geral | `public/visao-geral/index.html` |
| Inbox | `public/inbox/index.html` |
| Campanhas | `public/campanhas/index.html` |
| Conexões | `public/conexoes/index.html` |
| Instâncias | `public/instancias/index.html` |
| Canais | rota configurada no deploy; verificar arquivo/roteamento exato |
| Contas | `public/contas/index.html` |
| Configurações | `public/configuracoes/index.html` |
| Inteligência artificial | `public/inteligencia-artificial/index.html` |
| Simulador | `public/simulador/index.html` |
| Catálogo | `public/catalogo/index.html` |
| Áudios | `public/audios/index.html` |
| Treinamento | `public/treinamento/index.html` |
| Histórico | `public/historico/index.html` |
| Segurança | `public/seguranca/index.html` |
| Login | `public/login/index.html` |
| Configuração de senha | `public/setup-password/index.html` |
| Callback de autenticação | `public/auth/callback/index.html` |

Observação: as páginas HTML por rota repetem boa parte da estrutura de login e shell do painel. A migração deve consolidar isso em layout e rotas do Next.js, preservando diferenças de conteúdo e comportamento.

## 2. Módulos backend confirmados

Os seguintes routers são registrados explicitamente em `src/server.js`:

| Prefixo HTTP | Router/serviço | Observação |
|---|---|---|
| `/api/dashboard` | overview parity + dashboard | Contexto e visão geral |
| `/api/connections` | connections router | Resumo, configuração e pareamento |
| `/api/channels` | channels router | Canais, instâncias e pareamento delegado ao motor existente |
| `/api/conversations-v3` | conversations V3 + commands | Leitura e comandos da Inbox |
| `/api/crm-v2` | CRM router | Projeção e operações CRM habilitadas por gates |
| `/api/accounts-v2` | accounts router | Contas e administração |
| `/api/security-settings-v2` | security router | Segurança, PIN, fila e alertas conforme gates |
| `/api/ai-settings-v2` | AI settings router | Configuração e teste de IA |
| `/api/simulator-v2` | simulator router | Sessões e treinamento do simulador |
| `/api/resources-v2` | resources router | Recursos, mídia e transcrição |
| `/api/training-v2` | training router | Treinamento e prévias |
| `/api/campaigns-v2` | campaigns router | Campanhas, mídia, IA e agendamento |
| `/api/evolution-cloud` | Evolution API cloud router | Integração Evolution |

Rotas de autenticação observadas diretamente em `src/server.js`:

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/verify-pin`

A lista acima não pretende cobrir todas as rotas legadas nem todos os métodos/ações de cada router. A próxima etapa de auditoria deve enumerar cada router e seus métodos HTTP antes de conectar uma tela migrada.

## 3. Projeto de referência: páginas Next.js

O repositório `ivandoplay/ienvia` contém 93 entradas na árvore. As páginas identificadas no App Router são:

- `/visao-geral`
- `/inbox`
- `/contatos`
- `/campanhas`
- `/canais-instancias`
- `/ia-automacao`
- `/relatorios`
- `/configuracoes`
- `/login`
- `/setup-password`
- `/auth/callback`

Componentes e dados centrais:

- `web/components/app-shell.tsx`: navegação, sidebar, header, workspace picker e shell responsivo.
- `web/components/workspace-context.tsx`: contexto de workspace baseado na autenticação e no banco do protótipo.
- `web/components/module-page.tsx`: cabeçalho/layout comum de módulos.
- `web/app/globals.css`: sistema visual global.
- `web/lib/data/*`: consultas do modelo de dados do protótipo.
- `web/app/api/workspaces/*`: rotas Next.js específicas do modelo de workspaces do protótipo.

### Limitações confirmadas no protótipo

- A Visão Geral declara explicitamente que ainda não consulta métricas operacionais reais.
- A Inbox possui dados seed demonstrativos para modo demo e lógica própria de workspace/conversas.
- Campanhas inicia com registros e métricas ilustrativas no modo demo e informa que a confirmação salva apenas na demonstração, sem enviar mensagens.
- O AppShell depende de WorkspaceProvider e mostra estado de demonstração/sessão Supabase.
- Portanto, não importar as rotas API `/api/workspaces`, a modelagem de workspace ou o contexto Supabase como substitutos da autenticação e do backend do sistema principal.

## 4. Integração e deploy: riscos confirmados

### Vercel atual

O `vercel.json` do sistema principal declara:

- `outputDirectory: public`
- função `api/index.js` com inclusão explícita de `src/**`, `public/**`, scripts e outros arquivos.
- rewrites das rotas do painel para `api/index.js`, além de `/painel` para `/painel.html` e `/api/*` para o Express serverless.

Isso impede tratar a inclusão do Next.js na raiz como uma alteração trivial. O primeiro frontend Next deve ser construído em uma topologia isolada ou em projeto/deploy separado, sem substituir essa configuração antes de uma validação específica.

### Sessão e autorização

- O painel legado apresenta login por usuário/senha e fluxo de PIN local opcional.
- O backend de API verifica Bearer token no modo Vercel e prepara o contexto do tenant.
- O modo local possui regras adicionais de worker e PIN.
- O protótipo Next usa Supabase SSR/Workspace Auth com outro modelo. Essa camada deve ser substituída/adaptada para consumir a autenticação do sistema principal, não reutilizada diretamente.

### Tempo real

- O servidor Express cria WebSocket no modo local.
- O trecho de inicialização do servidor desativa esse servidor HTTP/WebSocket no ambiente Vercel.
- Antes da migração da Inbox, definir como o frontend web hospedado na Vercel receberá atualizações: mecanismo existente disponível no backend, Supabase Realtime ou polling controlado. A escolha depende de inspeção do código de eventos e não deve ser presumida.

## 5. Correção de precisão do primeiro plano

A tabela preliminar de rotas no documento de decisões era uma hipótese de organização, não um inventário de endpoints verificados. Use este documento como inventário estrutural inicial. Não implementar chamadas com nomes de rota presumidos: conferir o router correspondente e os consumidores atuais antes de cada integração.

## 6. Próxima sequência segura

1. Enumerar rotas/métodos de cada router Express e chamadas feitas por `public/app.js`, `public/campanhas.js` e `public/inbox-realtime.js`.
2. Mapear componentes de protótipo para as telas reais, separando estilo reaproveitável de lógica/mocks.
3. Definir autenticação server-side, proxy same-origin e estratégia de tempo real.
4. Só então adicionar a aplicação Next.js isolada e migrar o shell/Visão Geral.
5. Validar build e testes existentes antes de ampliar o escopo.


## 7. Atualização posterior do inventário

Este arquivo é o retrato estrutural inicial de 2026-11-09. Depois dele, o frontend Next foi implementado em `web/`, com rotas para os módulos listados no documento de status, BFF same-origin, sessão inicial compatível com o painel principal, shell responsivo, tema claro/escuro e CI. A sequência original da seção 6 foi executada parcialmente e não deve ser lida como o estado atual do projeto.

Consulte `STATUS-MIGRACAO.md` para o estado atualizado, os commits/CI e as pendências reais. A implementação continua em branch e não substitui o painel legado publicado.
