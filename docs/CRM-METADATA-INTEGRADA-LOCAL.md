# CRM — agenda/Ficha360 conectadas ao contrato autenticado

04/11/2026. Continuação automática da paridade. **Código local preparado/testado, não ativação de escrita ou migração homologada em produção.**

## Autorização atual de deploy

**Ordem atual: “Pronto pode continuar quando concluir tudo você me avisa para a gente fazer o deploy”.** Continuar desenvolvimento/testes sem confirmação rotineira, **sem deploy agora e sem autopublicação**. Ao terminar tudo e validar, avisar para publicar junto com o titular. Esta ordem substitui a autorização anterior de publicação automática. Preservar migração gradual/rollback, assinatura, segurança, nenhum custo novo ou mensagem real.

## Fatia metadata base (histórico; extensão abaixo)

- Contrato puro único em `public/v2/assets/crm-metadata-contract.js`, reexportado por `src/crm/contracts.js`. Schema e validações operacionais existentes preservados; medição UTF8 usa `TextEncoder`, utilizável no navegador sem `Buffer`. Não expõe SQL, credenciais ou integrações. Nenhuma migração foi alterada/aplicada.
- SDK `crm-metadata-client.js`: valida proprietário, identidade canônica, revisão, página/cursor, projeção e permissões/capacidades. Campos privados extras não são propagados. A resposta não pode conceder envio/pareamento/automação, nem conceder escrita a suporte. Dono não é enviado pelo navegador como argumento de escopo.
- Política `crm-metadata-policy.js`: allowlist exata das rotas existentes `/api/crm-v2/contacts`, `/contacts/:id`, `/threads/:id/profile`. Só listagem aceita query validada; rejeita parâmetros repetidos, proprietário, fragmentos, métodos extras e corpo em GET. Não amplia acesso ao CRM operacional antigo ou aos endpoints de envio.
- Sessão existente: GET pode seguir a recuperação de autenticação; POST/PATCH de metadata **não são repetidos** por401/falha/rede. Resultado desconhecido bloqueia novas mutações no SDK até consulta explícita. Não guarda operação para executar depois.
- Portas nativas `crm-metadata-view.js`: **agenda autenticada de registros salvos**, busca/paginação20por página, filtro salvo/não salvo e detalhe. Diferencia projeção de fichas salvas de agenda integral do WhatsApp. Cadastros manuais não verificam identidade, não escolhem instância nem iniciam conversa automaticamente.
- Ficha do histórico: botão explícito **Consultar ficha salva**. Não realiza N+1 em toda a lista, não chama bootstrap antigo nem consulta dados adicionais simplesmente ao abrir o histórico. Confere identidade do resultado com a thread selecionada. Exibe ausência como ausência, falha como falha, não defaults fabricados.
- Edição/criação de cadastro **somente se o servidor liberar** os dois bloqueios já existentes e devolver permissão válida. Formulário usa CAS/revisão, centavos inteiros sem float acumulado, dados de cadastro/negociação/retorno/etiquetas/anotação. Anotação da ficha não é mensagem de nota interna. Conflito/resultado desconhecido preservam rascunho, desabilitam repetição e exigem consulta explícita.
- As opções `allowWrites` do servidor e liberação da conta no banco continuam **desligadas** no produto. Liberações e alterações usadas nos testes são exclusivamente sintéticas/descartáveis.
- Ciclo de vida: consulta abortada/versionada; troca de thread/instância, filtro, aba, conta, pagehide ou dispose remove dados e rejeita resposta tardia. Rascunho/metadata não são persistidos no browser. Componentes removidos não notificam erro de operação antiga na nova tela.
- Integração nativa por injeção de portas em `conversations-app/view/hub`. A demonstrativa não importa o SDK/cliente de sessão/formulários autenticados, não faz API nem recebe metadata real. Build estático continua102assets.

## Validação

Skills: TDD, projection-patterns e padrões locais de isolamento/erros e testes de navegador. Interfaces delegadas: SDK/contrato, cliente de sessão, UI nativa, HTTP e banco SQL sintético. Nenhuma skill ampliou autorização externa.

- RED→GREEN por SDK ausente, rota não permitida e porta nativa ausente; logs `crm-metadata-{red,session-red,ui-red}.log`.
-16testes novos. Seleção combinada **150/150 PASS**,54365,965392ms, incluindo a cadeia real **SDK→HTTP Express→SQL PGlite** e os testes antigos de bloqueio/RLS/CAS. **Full final800/802 PASS**,260029,727227ms; somente as mesmas duas falhas históricas de release/assinatura. Full inicial799/802 também expôs uma espera incompleta no teste de Contatos após a nova leitura assíncrona; o teste passou a aguardar o resultado (não só o cabeçalho), passou3vezes6/6 e o full final confirmou a correção. Hashes constam na evidência `crm-metadata-evidence.json`/`crm-metadata-full.log.gz`.
- Chromium: consulta literal/sem XSS; nenhum envio; leitura com suporte; permissões/escrita sintéticas; criação com UUID único; conflito com rascunho intacto/sem replay; agenda21registros em duas páginas; filtro literal; migração ausente não vira vazio; resposta tardia;320px sem overflow e limpeza no pagehide.
- Fixture de criação inicialmente colocava `phone` indevidamente dentro de `profile`: corrigida a fixture ao contrato válido, não relaxado o contrato. Isso não é falha operacional comprovada nem teste real de WhatsApp.
- Capturas nativas com dados sintéticos: `crm-metadata-ficha-1440.png` e `crm-metadata-agenda-320.png`. Não usar o preview4183 estático como prova desta integração; ele continua demo sem API. O servidor nativo dos testes é efêmero, não foi publicado.

## Ainda não equivale a CRM integral migrado

- Não faz backfill, associação automática de contatos por telefone nem busca no corpo das últimas12mensagens de todos os clientes.
- Não projeta metadata em todos os cartões/filtros do inbox. A consulta explícita de ficha não equivale a projeção global de CRM ou biblioteca completa de etiquetas.
- Documento/CPF-CNPJ (`docNumber`) e equivalência de todos os campos do oficial continuam pendentes; não alterar contratos/SQL existentes de forma incompatível para acrescentá-los sem migração e teste.
- Tarefas são consultadas na ficha; editor colaborativo completo/remoção, contadores, teclado `/`, estado fino de UI e demais itens continuam na matriz `CONVERSAS-PARIDADE-GRADUAL.md`.
- IA/pausas/agendamentos/envio/mídia/PIX/cartão/sincronização, importação/backup/restauração e coordenação por instância não foram ativados por estas portas.
- A homologação PostgreSQL real/Auth/RLS/delegação/concorrência e migração de dados reais continua necessária. PGlite não comprova isso.
- O pacote Motor/release exige assinatura correspondente ao código final. A chave privada padrão **não está disponível no workspace**; não foi gerada outra chave, alterada a chave pública, desligada a verificação ou servido ZIP sem assinatura para ocultar as falhas históricas.

## Deploy

Nenhum commit/push, publicação, SQL remoto ou alteração de produção nesta fatia. O pedido de deploy depois de tudo foi registrado; não foi apresentado como cumprido. Antes da publicação: fechar matriz por aba, reconciliar oficial vigente, resolver homologações/assinatura/transporte de publicação, testar completo e implantar isoladamente com retorno ao painel anterior.


## Atualização posterior — documento/tarefas/marcadores/filtros

Consulte `CRM-DOCUMENTO-TAREFAS-LOCAL.md` e a evidência `crm-fields-evidence.json`. Documento informado40caracteres, migração aditiva08000 (05000intacta), busca literal estendida na agenda; tarefas e marcadores editáveis por CAS na ficha autorizada; remoção de tarefa no exemplo; Kanban demonstrativo respeita busca/filtros e painel/contador avançado. Gates reais desligados; sem projeção global do inbox, backfill ou homologação/ativação.15testes novos,81/81seleção, full final815/817 (somente as duas falhas históricas de release/assinatura). As pendências de documento e editor básico de tarefas nas seções históricas acima foram resolvidas **localmente**; demais pendências não foram encerradas.

**Diretriz vigente:** continuar automaticamente, mas não publicar agora/automaticamente. Avisar quando toda a reforma estiver concluída/validada para fazerem o deploy juntos.


## Atualização posterior — atalhos do compositor (demo)

`CRM-ATALHOS-COMPOSITOR-LOCAL.md` registra seletor inline `/`, filtro por código/título/texto, setas/Enter/Tab/Escape, expansão literal do primeiro nome e gerenciador CRUD/remoção confirmada **em memória demonstrativa**. Nativo não recebe fixtures nem compositor/envio ou consulta extra.9testes novos; full validado824/826 (só as duas falhas históricas de release/assinatura),103assets. Um full intermediário expôs modal fechado ainda conectado; reproduzido e corrigido com verificação de diálogo aberto,3repetições13/13 e full validado. Menu/gerenciador demonstrativos não estão mais ausentes; biblioteca autenticada e demais pendências operacionais continuam. **Sem deploy agora/automático: avisar ao concluir/validar toda a reforma para publicar com o titular.**


## Atualização posterior — projeção autenticada no inbox/Kanban (local, desligada)

`CRM-PROJECAO-INBOX-LOCAL.md` registra a nova RPC09000 `ienvia_list_instance_threads_crm`, uma junção limitada owner+thread UUID por página, DTO validado e marcador `saved_profiles_by_thread_v1`. Opt-in `crm=profiles` exige `features.crmProfilesRead:true`; **allowCrmProjection permanece false na composição real**. Histórico padrão não recebe CRM extra. Não há backfill, associação por telefone, alteração de fichas/revisões ou habilitação de escrita.

UI nativa preparada para filtros/etiquetas/etapas/valores persistidos e Kanban somente leitura após fonte comprovada; ausência de ficha não vira etapa/valor inventados. IA/não-lidas continuam desconhecidas. Perda de fonte/DTO falha fechada; troca de contexto409 inclui scopeChanged e descarta a tela antiga. Consulta explícita da ficha continua separada, sem N+1/realtime prometido. Isso atualiza as pendências históricas de projeção acima **somente quanto à implementação local**, não quanto à ativação/homologação.

15cenários novos; seleção123/123 antes dos reforços;34/34 e browser18/18 com geometria320px; após reforço de capacidade91/91 e browser20/20;104assets estáticos. Paginar instâncias conserva fonte confirmada; revogar a capacidade reinicia a consulta sem misturar snapshots, e desmarcar instância invalida a fonte. Full final/hashes/revisão em `crm-projection-evidence.json`/`crm-projection-review.md`, em auditoria/implantacao-gradual fora do repo. Permanecem biblioteca autenticada/cores/operações/mídia/import/backup/sync, reauditoria das outras abas e homologação/assinatura. **Sem deploy agora/automático: concluir/validar tudo e avisar para publicar junto com o titular.**


## Atualização05/11 — etiquetas/cores autenticadas (local) e autorização de deploy

`CRM-ETIQUETAS-CORES-LOCAL.md` registra biblioteca por conta, cores seguras, CRUD CAS e propagação auditada de renomeação/remoção nas fichas próprias.11000 aditiva amplia apenas o helper de perfil24→32 sem regravar registros, mantém as migrações antigas e gates reaisfalse. Até500fichas por transação, acima disso recusa/reverte tudo. UI confirma cascatas, conserva rascunho de ficha aberto ou relê a lista na fonte; não envia mensagens. Corrigido round-trip de etiquetas com vírgulas/aspas no editor.17novos;116/116seleção; **full final870/872**,278733,698089ms, só duas falhas históricas de release/assinatura;105assets estáticos.

Dados/presets antigos não importados, aplicação por chips/gesto original ainda pendente; não declarar equivalência completa das etiquetas ou da reforma. A ordem **mais recente** agora é “Termina tudo por favor depois quando acabar faz o deploy”: substitui a antiga espera por deploy conjunto. Autoriza publicar **depois de concluir/validar toda a reforma**, com implantação gradual/backup/rollback e sem custos/mensagens/bypass. Neste momento o fechamento completo ainda não ocorreu; nada publicado/aplicado remotamente.
