# Implantação gradual — paridade antes da troca

## Diretriz confirmada pelo titular — 04/11/2026

Não substituir o painel completo de uma vez. Comparar **aba por aba** com a versão oficialmente publicada, incluindo ferramentas, atalhos, opções, padrões e microcomportamentos. Repor lacunas e testar antes de migrar aquela aba. Melhorias pequenas de preservação são decisões técnicas delegadas; novidades que mudem regras de negócio, custo, dados ou segurança precisam de confirmação. Aparência mais moderna não é prova de maior completude.

Esta etapa é preparatória. Nenhuma alteração em produção, SQL, autenticação, configurações, conexão, envio ou cobrança foi realizada. A tentativa anterior de atualizar a demonstração online não foi concluída e não é prova de homologação.

## Fonte oficial fixada, não uma cópia presumida

Consulta somente de metadados do último deploy de produção READY do projeto `zap-ia-studio`:

- Deployment: `dpl_E2HmxAaSGyKxk87bifwNJHsNmy9n`.
- Branch: `main`.
- Commit: `7630b62b40b4518d06a157c4dc5055747fcb157e`.
- Objeto Git desse commit disponível localmente, consultado por `git show`, sem checkout/reset e sem alterar a árvore de trabalho.
- `public/app.js` atual coincide byte a byte com o commit publicado; `public/painel.html` e `src/server.js` atuais **não** coincidem. Portanto o inventário oficial usa o commit fixado, não a suposição de que todo arquivo chamado original no workspace é a versão publicada.
- Evidência: `/home/user/auditoria/implantacao-gradual/01-visao-geral-inventario.json`, com hashes, 37 IDs e handlers da seção oficial.

Antes da ativação de cada aba, consultar novamente o deployment oficial. Se tiver mudado, reconciliar o novo commit; não implantar com base desatualizada nem sobrescrever correções feitas fora da reforma.

## Critério de passagem por aba

1. Inventariar interface estática **e elementos dinâmicos**, handlers, chamadas, permissões e persistência da versão oficial.
2. Comparar destinos: preservado na própria aba, reorganizado em outra área com acesso equivalente, ausente, alteração intencional ou não comprovado. Um controle apenas movido não deve desaparecer do percurso do usuário.
3. Repor lacunas localmente com TDD e teste de navegador. Conferir defaults, seleção/instância, atalhos, teclado/celular, confirmação, retorno, erro, refresh e preservação de dados.
4. Homologar contrato e dados reais no ambiente apropriado, somente com autorização para a integração necessária. Demo/rascunho/botão visível não contam como efeito operacional implementado.
5. Preparar ativação isolada e reversão: preservar a aba antiga acessível, não redirecionar todos os menus e não remover o caminho anterior antes do aceite. Definir controles de entrada conforme a arquitetura oficial, sem presumir um feature flag ainda inexistente.
6. Liberar uma aba por vez, validar, e somente depois seguir para a próxima. Operações destrutivas/custo/envio não são disparadas para demonstrar que funcionam.

## Primeira aba — Visão geral

**Estado atualizado: primeira reposição local implementada/testada; substituição operacional ainda NÃO aprovada.** A matriz abaixo registra o inventário inicial e suas pendências. A reposição descrita ao final distingue o que foi corrigido do que continua dependendo do legado/homologação.

A versão oficial chama a aba inicial de **Central de Conexão & Monitoramento** e reúne recursos que a nova Visão geral de leitura não apresenta integralmente. Primeiros itens encontrados:

| Recurso oficial | Referência | Primeira comparação / pendência |
|---|---|---|
| Baixar Motor ZIP no cabeçalho e painel de versão/download | `downloadLatestMotorZip`, `motorDownloadPanel`, `dashMotorVersionBadge`, `btnDashDownloadMotor` | A nova Visão geral não tem o atalho equivalente. Há trabalho anterior de Motor/Conexões; ainda verificar fluxo, versão, plataformas, autenticação e release assinado, sem prometer ZIP funcional. |
| Atalhos Testar no Simulador e Editar Treinamento | `switchTab('simulador')`, `switchTab('treinamento')` no cabeçalho | Há menus para essas áreas, mas os atalhos contextuais do cabeçalho não foram repostos. Repor o acesso respeitando a disponibilidade de cada aba durante a migração. |
| Checklist de ativação com ocultação por usuário | `saasOnboardingBox`, `renderSaasOnboardingBox` | Ausente na nova Visão geral. Conferir passos, destinos, retomada e persistência por identidade, sem inventar progresso ou ler chaves em claro no frontend. |
| Prontidão de WhatsApp, IA, perfil e alerta pessoal | `readinessStrip`, `renderReadinessAndFunnel` | O novo diagnóstico distingue motor/conexão, mas não substitui esse conjunto de indicadores. Preservar informação útil sem chamar chave cadastrada de IA operacional. |
| Mensagens recebidas e respostas da IA | `statIncoming`, `statReplies`, `renderStatsAndLogs` | Os cartões novos de conversas/campanhas têm outra semântica; não equivalem a esses acumuladores. Faltam mapeamento de fonte, escopo, valores indisponíveis e exibição. |
| Áudios/imagens processados e mídia/PIX enviados | `statMultimodal`, `statMediaPix` | Ausentes na Visão geral nova. Não substituir por zero nem deduzir de total de conversas. |
| Aguardando humano, com acesso ao CRM | `statHandoffsPending` clicável | Há contagem nova e sinal de atenção; verificar equivalência do atalho, filtro/destino e comportamento com zero. |
| Funil, taxa de avanço/passagem e latência média | `funnelSummaryBar`, `renderReadinessAndFunnel` | Gráfico novo de última atividade não substitui funil/latência. Preservar a fórmula original documentada, sem chamar passagem de venda/conversão comprovada. |
| Multi-chip: seleção, apelido, transporte, IA por chip, QR, código e aparelhos | `waSlotsTabBar`, `waSlotLabelInput`, `waSlotAiEnabledCheck`, `btnConnectQr`, `btnConnectCode`, `waOnlineDevicesBox` | Reorganizado em Instâncias/Conexões. Ainda conferir equivalência e acesso a partir da inicial, sem reintroduzir três slots fixos ou troca silenciosa de número. |
| Abordagem avulsa aprovada: nome/telefone/template/texto/áudio/canal | `dashProactive*`, `btnSendProactiveNow` | Não aparece no novo resumo. Listas/campanhas e ensaio de Segurança não comprovam a equivalência de envio avulso. Mapear o fluxo original e preservar a capacidade sem criar outro executor nem ativar envio nesta auditoria. |
| Registro de atividades e indicação do motor/provedor | `logsContainer`, `activeEngineBadge`, `renderStatsAndLogs` | Não está no resumo novo. Diagnóstico de conexão não equivale a log. Verificar escopo, dados sensíveis, atualização e paginação/limites antes da reposição. |
| Atualização automática/manual, estados offline, falha e suporte | handlers e ciclo de leitura das duas implementações | Precisa comparação detalhada. O novo resumo tem proteções de obsolescência; preservar essas proteções sem perder os recursos oficiais. |

### Plano inicial da aba (histórico; reposições aplicadas ao final)

- Completar leitura dos handlers e endpoints oficiais e registrar comportamento de cada item, não somente IDs.
- Separar lacuna real, mudança de local e diferença de semântica; acompanhar cada pendência até teste correspondente.
- Implementar primeiramente os ajustes de acesso/navegação e depois indicadores/checklists/logs com contrato de dados correto. Não adicionar ação real para preencher uma lacuna visual.
- Revalidar as rotas de implantação para que uma aba já migrada não envie o usuário a outra ainda não homologada sem acesso ao fluxo antigo.
- Depois de corrigir e testar, preparar o plano de ativação/reversão dessa aba. A inicial ainda não está liberada para substituir a oficial.

## Sequência e estado

1. Visão geral: primeira reposição local aplicada/testada; homologação e ferramentas legadas ainda pendentes, sem aprovação operacional.
2. Conversas/CRM: inventário de handlers/callsites e matriz ampliados; primeiras correções locais de busca/filtros/etiquetas/Contatos aplicadas e testadas. A etapa continua com pendências explícitas em `CONVERSAS-PARIDADE-GRADUAL.md`; não aprovada para substituir a oficial.
3. Instâncias e Conexões/Motor: reauditoria pendente.
4. Histórico: reauditoria pendente.
5. Campanhas: reauditoria pendente.
6. Treinamento: reauditoria pendente.
7. Catálogo/Áudios: reauditoria pendente.
8. Simulador: reauditoria pendente.
9. IA: reauditoria pendente.
10. Segurança/Configurações: reauditoria pendente.
11. Contas/Administração: reauditoria pendente.

Essas reauditorias não apagam os testes e implementações locais anteriores; são a checagem final, mais minuciosa, exigida pelo titular antes da transição operacional.

## Autonomia de execução confirmada novamente pelo titular

Revisar, repor, testar e avançar automaticamente, sem solicitar confirmação rotineira por aba ou por detalhe já existente. Perguntar quando surgir ideia **extra** ou proposta de fazer diferente do fluxo existente. Não tratar decisões técnicas de preservação como novidade de negócio. Não confundir essa autonomia com permissão para inventar prova de integração ou publicar com falha conhecida.

## Visão geral — primeira reposição local aplicada

- `src/dashboard/parity.js`: `GET /api/dashboard/parity`, somente leitura, integrado depois da autenticação/PIN/contexto de tenant. Não usa RPC nova: configuração/estatísticas/logs do workspace atestado e quatro contagens HEAD exatas por tenant (`data->>stage`), sem carregar contatos. No worker, usa a memória existente da conta. A RPC da Visão geral principal continua separada e não foi aplicada remotamente.
- Acumuladores recebidas/respostas/multimodal/mídia+PIX; soma incompleta permanece indisponível, não zero. Funil mantém a fórmula original `(aguardando_humano+concluido)/total`, sem chamá-la de venda. Latência ausente não é fabricada. Erro de funil não elimina estatística disponível.
- Checklist de cinco itens, minimizar/expandir/ocultar/restaurar, persistência no navegador por operador+tenant. A preferência antiga `zapia_onb_hide_*/zapia_onb_collapsed_*` é respeitada na própria conta, sem regravar as chaves nem aplicar a preferência do operador a um cliente em suporte. Conexão não consultada e teste desconhecido não viram feitos. Não promete RLS garantida ou IA funcional por ter chave cadastrada.
- Prontidão de chave/perfil/alerta e status de conexão do snapshot fresco do resumo; obsolescência deixa de confirmar prontidão. Não altera IA/PIN/chips/treinamento.
- Até45 logs privados do tenant, texto literal, conhecidos tokens/chaves/PIN/integradores e telefones protegidos. Log com formato inválido fica indisponível, não vazio inventado. Isso não é coletor universal de segredos desconhecidos e não comprova entrega. Não exportar esse conteúdo como público.
- Atalhos do Simulador, Treinamento e Instâncias. Motor/download e abordagem avulsa mantêm caminho explícito para o **painel antigo**, sem inventar download homologado, enviar mensagem ou substituir avulso por campanha. Continuam pendências para migração nativa integral, incluindo os problemas históricos do release assinado.
- UI complementar preserva os KPIs/gráfico existentes com semânticas distintas. Refresh manual e consulta complementar espaçada em30s no ciclo do resumo, sem iniciar segundo poller independente. Erro mantém último complemento marcado obsoleto; troca de identidade limpa/descarta resposta tardia e não cai em demo.
- Na demonstração, links legados para áreas já reformadas apontam às respectivas demonstrações, não à página em preparo; os fluxos Motor/avulso permanecem explicitamente indisponíveis no site fictício. Não alterou os destinos de compatibilidade legada da página nativa.

### Evidência e limites atuais

18 testes novos e71 selecionados passaram. Suíte completa final: **776/778**,256160,544264ms; somente as duas falhas históricas (`ienvia-branding.test.mjs`, `static-release-package.test.mjs`). Resultado em `overview-full.log.gz` e `overview-evidence.json`. Pacote estático102assets, sem auth/session-client/API e com CSP preservada. Chromium nativo testa contadores, fórmula, logs literais/segredos, atalhos, preferências novas/antigas, refresh/falha, identidade e owner divergente. Demonstração testa1440/390/320/dois temas, sem API/external/overflow.

Captura `/home/user/auditoria/implantacao-gradual/visao-geral-paridade-1440.png`, preview local4183. Nenhuma publicação, SQL, troca de rota oficial ou ação operacional foi realizada. Atualização online da simulação continua bloqueada pelo envio do pacote, conforme `demo-publication-status.json`; o pacote da tentativa anterior é histórico e NÃO contém esta reposição nova.

A Visão geral ganhou a primeira reposição de microparidade, mas **não está liberada para substituir a oficial**: persistem homologação do resumo principal/origem, caminhos legados de Motor/avulso e integração/instâncias UUID. A sequência automática avança no inventário de Conversas sem apagar os caminhos antigos nem anunciar toda a implantação como concluída.

## Continuação automática — primeiras correções do CRM

A auditoria não parou no inventário. Consulte `CONVERSAS-PARIDADE-GRADUAL.md`:161IDs,126referências inline/templates,87funções referenciadas,45listeners diretos,76callsites auxiliares (inventário lexical, não prova de cobertura). Correções locais: ficha/arquivadas na busca, humano/quentes, contexto+destaques/contador/anterior/próximo da busca no chat, etiquetas personalizadas no filtro e indisponibilidade explícita de Contatos nativo em vez de tela vazia. Pausas foram conferidas no HTML realmente publicado:30min/2h/24h/manual — anotação antiga1h/4h não era fonte correta.

8testes novos; seleção combinada108/108; full final784/786 (só as mesmas duas falhas históricas),265384,934733ms. Capturas320/1440 sem overflow/erros/API;102assets verificados. Nada publicado ou ativado. Próxima fatia permanece no CRM (metadata/agenda/Ficha360 e pendências menores), sem pedir novo aceite rotineiro e sem confundir backend local bloqueado com migração pronta.

## Ordem de deploy final e integração de metadata

O titular pediu concluir tudo e depois fazer o deploy correto. Não é autorização para publicar o estado incompleto nem abandonar a transição por aba. Requisitos de integração/dados/assinatura/rollback continuam. A fatia seguinte já conecta UI nativa à agenda de registros salvos e ficha autenticada; CRUD/CAS preparado por permissão, gates reais desligados,16testes novos/150seleção. Consulte `CRM-METADATA-INTEGRADA-LOCAL.md`. Nenhuma publicação ocorreu.


## Diretriz mais recente — avisar antes de publicar

O titular pediu: **“Pronto pode continuar quando concluir tudo você me avisa para a gente fazer o deploy”**. A autorização anterior de autopublicação está substituída. Continuar autonomamente correções e testes, **sem deploy agora/automático**. Avisar ao concluir/validar tudo para publicar juntos; implantação gradual e rollback permanecem obrigatórios. Não confundir fatia local validada com conclusão de toda a reforma.


## Atualização posterior — documento/tarefas/marcadores/filtros

Consulte `CRM-DOCUMENTO-TAREFAS-LOCAL.md` e a evidência `crm-fields-evidence.json`. Documento informado40caracteres, migração aditiva08000 (05000intacta), busca literal estendida na agenda; tarefas e marcadores editáveis por CAS na ficha autorizada; remoção de tarefa no exemplo; Kanban demonstrativo respeita busca/filtros e painel/contador avançado. Gates reais desligados; sem projeção global do inbox, backfill ou homologação/ativação.15testes novos,81/81seleção, full final815/817 (somente as duas falhas históricas de release/assinatura). As pendências de documento e editor básico de tarefas nas seções históricas acima foram resolvidas **localmente**; demais pendências não foram encerradas.

**Diretriz vigente:** continuar automaticamente, mas não publicar agora/automaticamente. Avisar quando toda a reforma estiver concluída/validada para fazerem o deploy juntos.


## Atualização posterior — atalhos do compositor (demo)

`CRM-ATALHOS-COMPOSITOR-LOCAL.md` registra seletor inline `/`, filtro por código/título/texto, setas/Enter/Tab/Escape, expansão literal do primeiro nome e gerenciador CRUD/remoção confirmada **em memória demonstrativa**. Nativo não recebe fixtures nem compositor/envio ou consulta extra.9testes novos; full validado824/826 (só as duas falhas históricas de release/assinatura),103assets. Um full intermediário expôs modal fechado ainda conectado; reproduzido e corrigido com verificação de diálogo aberto,3repetições13/13 e full validado. Menu/gerenciador demonstrativos não estão mais ausentes; biblioteca autenticada e demais pendências operacionais continuam. **Sem deploy agora/automático: avisar ao concluir/validar toda a reforma para publicar com o titular.**


## Atualização posterior — projeção autenticada no inbox/Kanban (local, desligada)

`CRM-PROJECAO-INBOX-LOCAL.md` registra a nova RPC09000 `ienvia_list_instance_threads_crm`, uma junção limitada owner+thread UUID por página, DTO validado e marcador `saved_profiles_by_thread_v1`. Opt-in `crm=profiles` exige `features.crmProfilesRead:true`; **allowCrmProjection permanece false na composição real**. Histórico padrão não recebe CRM extra. Não há backfill, associação por telefone, alteração de fichas/revisões ou habilitação de escrita.

UI nativa preparada para filtros/etiquetas/etapas/valores persistidos e Kanban somente leitura após fonte comprovada; ausência de ficha não vira etapa/valor inventados. IA/não-lidas continuam desconhecidas. Perda de fonte/DTO falha fechada; troca de contexto409 inclui scopeChanged e descarta a tela antiga. Consulta explícita da ficha continua separada, sem N+1/realtime prometido. Isso atualiza as pendências históricas de projeção acima **somente quanto à implementação local**, não quanto à ativação/homologação.

15cenários novos; seleção123/123 antes dos reforços;34/34 e browser18/18 com geometria320px; após reforço de capacidade91/91 e browser20/20;104assets estáticos. Paginar instâncias conserva fonte confirmada; revogar a capacidade reinicia a consulta sem misturar snapshots, e desmarcar instância invalida a fonte. Full final/hashes/revisão em `crm-projection-evidence.json`/`crm-projection-review.md`, em auditoria/implantacao-gradual fora do repo. Permanecem biblioteca autenticada/cores/operações/mídia/import/backup/sync, reauditoria das outras abas e homologação/assinatura. **Sem deploy agora/automático: concluir/validar tudo e avisar para publicar junto com o titular.**


## Atualização posterior — biblioteca autenticada de atalhos (local)

`CRM-BIBLIOTECA-ATALHOS-LOCAL.md` registra persistência nova por conta, leitura explícita e CRUD CAS/auditoria preparados. GET/PATCH exatos `/api/crm-v2/quick-replies`; migração aditiva10000, sem importar defaults/dados antigos. UI nativa em Ferramentas → Respostas rápidas / usa fonte autenticada comprovada, readonly sem permissão e sem exemplos/fallback. Editor/remoção confirmada preservam rascunho; suporte não grava; nenhum compositor/envio nativo foi ativado. Demo/atalhos inline anteriores intactos.

Os dois gates de escrita existentes continuam false na aplicação/contas reais; não houve SQL remoto/ativação. A pendência histórica “biblioteca autenticada ausente” está atualizada **quanto ao código local**, não à migração/homologação dos dados originais.14novos;94/94seleção;3repetições25/25browser; full validado853/855 (somente duas falhas históricas de release/assinatura),104assets. Full inicial tinha erro de espera por título intermediário quando a conta já havia sido corretamente descartada; teste passou a esperar o gate final, sem correção runtime/relaxamento de timeout.

Continuam migração/ativação real da biblioteca, etiquetas globais/cores/operações/mídias/import/export/backup/sync, reauditoria demais abas e homologação Auth/RLS/delegação/dados/concorrência/migração/assinatura/rollback. **Sem deploy agora/automático; avisar quando toda a reforma estiver concluída e validada para publicar com o titular.**


## Ordem mais recente — concluir tudo e depois fazer deploy

05/11/2026. O titular pediu: **“Termina tudo por favor depois quando acabar faz o deploy”**. Isso substitui a instrução anterior de apenas avisar para deploy conjunto: agora há autorização para publicar **depois** de concluir/validar toda a reforma, com implantação gradual/backup/rollback/painel antigo preservado. Não autoriza publicar estado incompleto ou chamar testes locais de homologação real. Não é autorização para custos/upgrade/mensagens reais/IA paga ou ativação prematura. Se acesso, infraestrutura ou assinatura bloquearem o fechamento/publicação segura, informar o impedimento real; não contornar proteções nem inventar sucesso. Continuar autonomamente sem pedir confirmações técnicas rotineiras.


## Atualização05/11 — etiquetas/cores autenticadas (local) e autorização de deploy

`CRM-ETIQUETAS-CORES-LOCAL.md` registra biblioteca por conta, cores seguras, CRUD CAS e propagação auditada de renomeação/remoção nas fichas próprias.11000 aditiva amplia apenas o helper de perfil24→32 sem regravar registros, mantém as migrações antigas e gates reaisfalse. Até500fichas por transação, acima disso recusa/reverte tudo. UI confirma cascatas, conserva rascunho de ficha aberto ou relê a lista na fonte; não envia mensagens. Corrigido round-trip de etiquetas com vírgulas/aspas no editor.17novos;116/116seleção; **full final870/872**,278733,698089ms, só duas falhas históricas de release/assinatura;105assets estáticos.

Dados/presets antigos não importados, aplicação por chips/gesto original ainda pendente; não declarar equivalência completa das etiquetas ou da reforma. A ordem **mais recente** agora é “Termina tudo por favor depois quando acabar faz o deploy”: substitui a antiga espera por deploy conjunto. Autoriza publicar **depois de concluir/validar toda a reforma**, com implantação gradual/backup/rollback e sem custos/mensagens/bypass. Neste momento o fechamento completo ainda não ocorreu; nada publicado/aplicado remotamente.
