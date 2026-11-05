# Instâncias independentes e aplicativo PWA

## Decisões de produto — 03/11/2026

O titular corrigiu a proposta de motor fixo por número. **Instância é a unidade de configuração e execução**, com UUID e nome livre. O número não é o ID e não precisa ser o nome. Uma conta pode planejar uma instância Evolution para atendimento/CRM e outra local para campanhas, inclusive com o mesmo número verificado. A simultaneidade depende das regras e capacidades reais do WhatsApp/provedor; não deve ser testada com sessões reais sem autorização.

O titular delegou a solução de histórico ao desenvolvimento e pediu aproveitamento completo do PWA: mesmas páginas/permissões do site, notificações e recursos móveis, implementados com segurança por etapas. Confirmou **bloquear e avisar quando não houver executor disponível**, sem nova fila automática ou troca silenciosa.

## Arquitetura decidida para o mesmo número

Esta seção é uma **decisão para a migração**, não afirma que a coordenação abaixo já foi integrada ao CRM/motor real.

1. **Instância:** UUID por conta, nome livre, transporte, executor e opções independentes de CRM/IA/campanhas. Instâncias não são fundidas porque têm o mesmo telefone ou nome. O contrato interno histórico `/api/channels` e os nomes `channels-*` continuam compatíveis nesta rodada; no produto são apresentados como Instâncias.
2. **Identidade do número:** vínculo comprovado pelo backend a partir da sessão/provedor autenticado, dentro da conta. Telefone digitado, nome de instância ou payload não autenticado não comprovam identidade. Não há mesclagem entre contas.
3. **Conversa canônica:** uma conversa por cliente e identidade verificada do número, com vínculo às instâncias de origem. Evita duas fichas apenas porque o mesmo número foi conectado em duas instâncias. Identidades de cliente ambíguas (ex.: LID sem resolução confiável) não são unidas por adivinhação.
4. **Histórico:** preservar ingresso bruto por instância e projetar o histórico canônico com proveniência. Dedupe entre transportes exige uma chave WhatsApp realmente estável, direção e identidade da conversa; não deduplicar apenas por texto/horário nem assumir que ID do envelope do provedor é ID WhatsApp. Falta de prova preserva eventos e registra ambiguidade em vez de apagar mensagem legítima. ACK só progride e não confunde aceite com entrega.
5. **Visibilidade:** ocultar uma instância não apaga eventos. A conversa padrão pode continuar visível por outra instância autorizada ao CRM. A interface deve explicar que ocultar a origem local não faz desaparecer do WhatsApp uma mensagem sincronizada na instância Evolution. Filtros por origem continuam disponíveis.
6. **IA:** um único coordenador transacional por conversa/evento de entrada, com política atual e instância responsável explícita. Não permitir duas respostas automáticas porque duas instâncias receberam o mesmo evento. Manter bloqueios globais existentes até migração revisada.
7. **Envio:** escolher explicitamente uma instância elegível e seu executor pertencente à conta. Não trocar de instância quando offline, não aproveitar outra sessão e nunca repetir automaticamente um envio de resultado incerto. Uso de motor local não garante menor risco de spam; consentimento, relevância, opt-out e ritmo continuam necessários.

A implementação do catálogo dinâmico, vínculo verificado de número, dedupe entre instâncias e coordenação transacional de IA **permanece pendente**. O backend operacional ainda usa os três slots antigos. A ponte 2A continua protegendo as identidades até essa migração.

## Implementado localmente nesta rodada

### Instâncias na interface

- `/instancias/` apresenta a base de cadastros UUID com nome livre, transporte e funções independentes.
- `/canais/` é mantido como alias compatível; não há quebra de bookmarks ou renomeação de sessões.
- Navigation, títulos e ações usam Instâncias. Contrato interno/SQL anterior preservado.
- Cadastro não conecta e as opções ainda não controlam automaticamente os motores/CRM legados. O aviso de migração permanece visível.

### PWA nas novas telas

- Manifesto referenciado nas três telas novas, com escopo raiz, ícones PNG 192/512, atalhos e entrada pela Visão geral.
- Controle compartilhado “Aplicativo no celular”: instalação/instruções, estado de atualização, confirmação de rascunhos antes de recarregar e teste de aviso neste dispositivo.
- Instalação e permissão de notificação só por ação do usuário. Nenhuma solicitação automática.
- Atualização do worker não usa `skipWaiting` automático. A nova interface solicita aplicação depois de confirmação; não força recarga de outras abas com rascunhos.
- Indicador offline não presume estado do motor. Escritas pelo cliente de sessão moderno são bloqueadas quando o navegador informa falta de rede; não são enfileiradas.
- Página offline genérica: não expõe conta, contatos ou histórico. Navegações autenticadas não são guardadas no cache do novo worker.
- O novo worker ignora APIs, POST/mutações, uploads, terceiros, requisições com autorização/PIN, Range e assets com query. Só guarda o shell público mínimo e assets estáticos explícitos; respeita `private/no-store`.
- Ativação remove somente caches com prefixos deste aplicativo, preservando caches de outros aplicativos na mesma origem.

### Notificações: distinção obrigatória

O botão atual **testa uma notificação genérica neste dispositivo** quando a permissão e o navegador permitem. Não assina um serviço push, não está ligado à chegada de mensagens e não ativa avisos automáticos com o aplicativo fechado.

No Chromium deste ambiente, a permissão nativa permaneceu negada mesmo após o pedido de concessão do teste. O teste real verificou a resposta honesta de permissão negada; o ramo concedido e a chamada de exibição foram cobertos por teste de contrato injetado. Não afirmar entrega nativa/Android/iOS validada a partir disso.

### Revisão visual isolada

A revisão estática tem 33 assets, incluindo `/instancias/`. Remove links de manifesto/ícone de instalação e usa o controlador em modo de demonstração: **zero registro de service worker, permissão, API ou notificação real**. A CSP continua sem rede/worker. Publicar esse projeto não atualiza o PWA operacional principal.

## Ainda pendente para o aplicativo completo

- Catálogo/dispatcher operacional dinâmico e identidade canônica de número/conversa descritos acima.
- Web Push real: assinatura por operador/dispositivo, validação de origem, chaves VAPID privadas fora do Git, destinatário autenticado, revogação no logout/troca de conta, outbox e worker de entrega. Notificação genérica por padrão, sem texto sensível na tela bloqueada. Sem promessa de entrega garantida.
- Integração de notificações a eventos deduplicados e políticas/visibilidade, evitando alertas em dobro e alertas de conta de suporte como se fossem do operador.
- Compartilhamento do sistema: receber texto/arquivos como rascunho vinculado à conta autenticada, com prazo/limites, descarte e confirmação antes de enviar. Não habilitar `share_target` inseguro nem colocar conteúdo privado em query string, logs ou cache público.
- Testes em Android/iOS reais de instalação, permissões, áreas seguras, atualização e limitações de segundo plano. PWA não executa Baileys continuamente nem garante funcionamento 24 horas com o telefone fechado.
- Pacote legítimo assinado do motor e aplicação/publicação operacionais devidamente autorizadas.

## Skills consultadas e aplicação

- `codebase-design`: controlador PWA separado da apresentação e do transporte; nada de recriar a aplicação dentro de um wrapper.
- `sharp-edges`: ação explícita para instalar, atualizar e pedir permissão; sem cache privado nem fallback de instância.
- `property-based-testing`: inventário das invariantes de identidade/isolamento e casos negativos, sem adicionar dependência nova de testes. Não se declara uma suíte gerativa nova nesta rodada.
- `tdd`: teste PWA inicialmente vermelho por módulo ausente, seguido do contrato e testes de integração.
- `frontend-design`: termos de domínio corrigidos, componentes coerentes com o design já aprovado e estados de preparação legíveis.
- `webapp-testing`: Playwright local, worker real em origem de teste, comportamento offline e capturas desktop/mobile; nenhuma chamada operacional.
- `web-design-guidelines`: referência de revisão consultada; não se afirma auditoria formal contra a revisão remota mais recente.

## Evidências iniciais

- 90/90 selecionados (`instances-pwa-selected.log`).
- Manifesto estático: 33 assets verificados.
- Browser real: worker ativo, manifesto/atalhos, negação de notificação tratada, API de escrita não chamada offline, navegação offline com query sem histórico privado no cache.
- Browser de demonstração: Instâncias e painel PWA em 1440/390px; controles simulados sem API, registro de worker ou pedido de permissão.
- Capturas em `previews/instancias-pwa/`.
- Suíte completa será registrada após o término; não declarar toda a suíte verde.

### Resultado final da regressão

**371/373** na suíte completa (`instances-pwa-full.log`). Persistem apenas as falhas históricas `ienvia-branding.test.mjs` e `static-release-package.test.mjs`. Nenhum pacote assinado foi alterado. **90/90** selecionados passaram. Não houve aplicação de SQL, envio, pareamento, atualização do PWA principal ou validação física Android/iOS.


### Continuação do backend — catálogo e execução explícita

Etapa local documentada em [Catálogo/execução de instâncias](CATALOGO-EXECUCAO-INSTANCIAS.md): referências UUID sem teto fixo, ledger durável, despacho manual explícito, bloqueios offline/conta/executor/revisões, timeout sem replay e adaptador legado opt-in. Validação selecionada 63/63; completa 391/393 com as mesmas duas falhas históricas. Sem migração remota, publicação operacional ou bootstrap de novas sessões. IA/campanhas e dedupe/conversa canônica permanecem pendentes da integração dos coordenadores.


### Reconciliação e executores preparados

[Continuação local](RECONCILIACAO-E-EXECUTORES.md): revisão auditada sem reenvio/liberação cega, composição autenticada opt-in, portas locais UUID com lease e adaptador Evolution protegido por mapa/ID/revisão. **78/78 selecionados e 406/408 completa**, mesmas duas falhas históricas. Os processos existentes não carregam os novos drivers; não houve conexão WhatsApp real nem SQL remoto. Automação e recursos móveis pendentes continuam bloqueados/não anunciados como concluídos.

### Sessões adquiridas e histórico UUID preparados localmente

Os números e pendentes dos blocos acima são históricos. A [nova etapa local](SESSOES-E-HISTORICO-UUID.md) implementa lease durável, porta concreta sobre socket Baileys **já adquirido**, journal privado de ingresso, CRM canônico/dedupe/proveniência e GETs autenticados de histórico. **88/88 selecionados e 436/438 na completa**, mesmas duas falhas históricas. Ocultar CRM preserva o ingresso; conversa PN é unificada apenas na mesma conta/negócio verificado, LID continua provisório. Recebidas, ACKs e intenções de saída agora têm caminhos duráveis testados; contatos/edições/grupos ainda não possuem projeção completa. Sem nova UI de histórico, bootstrap/auth UUID, migração de dados antigos ou ativação real. Sem commit, push, deploy ou SQL remoto. IA/campanhas, coordenação entre motores e recursos PWA push/share continuam pendentes.

### Interface de histórico readonly

A [interface local de histórico](HISTORICO-INTERFACE.md) foi preparada em `/historico/`, com seleção explícita da instância, conversa canônica/origens, filtros/paginação, temas e mobile. Contrato compartilhado, proteção contra respostas atrasadas e limpeza na troca/perda de contexto. **163/163 selecionados, 448/450 completa**, somente as duas falhas históricas. Demonstração separada com 39 assets, sem APIs ou sessões. Nenhuma publicação, SQL remoto ou motor real; dados antigos ainda não migrados. A tela não transforma o PWA em executor contínuo nem implementa push/share, IA ou campanhas coordenadas.

### Demonstração publicada e supervisão local

Autorização posterior do titular publicou somente a revisão estática em https://ienvia-reforma-visual.vercel.app/historico/ — commit `0ffa9ea`, 39 assets conferidos, principal/main inalterados. O [próximo trabalho foi dividido](WORKER-SUPERVISAO-E-MIGRACAO.md) em supervisão do worker e ensaio de migração. Supervisor opt-in sobre porta já adquirida implementado localmente: start/heartbeat/recover/stop sem conectar, reenviar ou liberar lease. **172/172 selecionados e 457/459 completa**, mesmas duas falhas históricas. Nenhum worker real/SQL remoto/migração foi ativado; auth UUID, migração de contatos/histórico e recursos móveis ainda pendentes.
