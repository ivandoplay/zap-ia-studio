# Conversas / CRM — reauditoria gradual contra o publicado

04/11/2026. **Primeiras correções locais aplicadas e testadas; paridade operacional integral NÃO aprovada.** A autonomia delegada permite revisar, corrigir e testar sem pedir confirmação rotineira. Só consultar o titular para ideia extra/proposta diferente do existente. Não ativar WhatsApp, SQL remoto ou custos para demonstrar um botão.

## Referência verificável

- Commit oficial fixado: `7630b62b40b4518d06a157c4dc5055747fcb157e` (deployment `dpl_E2HmxAaSGyKxk87bifwNJHsNmy9n`). Não foi consultada sessão ou conteúdo privado de produção.
- `git show` do HTML, app e servidor publicados. O `public/app.js` local coincide com esse commit; **o HTML local não coincide**. É necessário conferir os dois, não confiar só no nome “original”.
- Inventário inicial: 161 IDs e39 candidatos lexicais de chamadas inline. `if` é palavra de controle, não um handler:38 nomes candidatos reais nesse recorte. A contagem inicial não era cobertura de comportamento.
- `scripts/audit-crm-official-parity.py` gera `02-conversas-handlers.json`:126 referências inline/templates,87 funções declaradas referenciadas,45 listeners diretos por ID,76 locais de chamadas API/auxiliares (53 templates distintos por método+rota). É **inventário lexical**, não AST/call graph, inventário exaustivo de todos os listeners por variável/delegação, nem prova de equivalência. As contagens incluem auxiliares compartilhados do CRM, como ignorados/backup/respostas rápidas.
- Leitura manual: filtros, renderização/janela de mensagens, destaques/navegação, sincronização de etiquetas, pausa, abas, menus, biblioteca `/`, composição/envio/anexos, agenda, backup/restore, sincronização e histórico antigo. Endpoints foram lidos no código, não chamados.

## Matriz de preservação e pendências

“Demo” abaixo significa memória sintética, nunca execução real. “Preparado” não significa ativado. Não remover o caminho `/painel#crm` por esta entrega.

| Comportamento oficial | Situação comparada e ação desta rodada |
|---|---|
| Conversas, Contatos, Kanban e Coach | Organização já restaurada na demo. Nativo ainda usa somente o leitor UUID. **Corrigida a tela vazia** ao escolher Contatos no nativo: mostra integração pendente/volta segura, sem fabricar agenda vazia ou chamar API nova. Não chamar isso de agenda operacional migrada. |
| Busca de contatos: ficha e arquivadas | **Corrigido** filtro local: nome, número, empresa, cidade, e-mail, origem, resumo/anotação disponíveis, prévia e etiquetas; query não vazia pode encontrar arquivadas, mantendo padrão sem arquivadas quando não há busca. Busca literal e sem mutação. A busca nas últimas12 mensagens de todos os contatos, `docNumber` e campos ainda não projetados continuam pendentes — não carregar todos os históricos secretamente para fingir equivalência. |
| Com você / Quentes | **Corrigidos**: etapa explícita `aguardando_humano` prevalece sobre sinal antigo `needsHuman`; sem etapa, mantém compatibilidade com o sinal existente. Quentes respeita etiquetas com `quente/valor/vip` e sentimento `hot`, sem perder o sinal demonstrativo existente. O adaptador nativo continua sem metadata; os filtros dependentes permanecem indisponíveis, não computados como dados reais. |
| Busca dentro do chat | **Reposto** destaque literal, contador, anterior/próximo com volta circular e manutenção do contexto completo carregado; antes a reforma retirava mensagens não correspondentes. Rascunho e instância de saída não mudam. Sem API extra, sem busca remota implícita. Marca apenas texto renderizável, via nós DOM, sem executar HTML nem buscar corpo temporário/excluído. Não é busca global em mensagens não carregadas. Formatação rica/citações completas do legado ainda exigem conferência própria. |
| Filtro por etiquetas personalizadas | **Corrigida** a lista fixa de três etiquetas: agora acompanha as etiquetas dos contatos carregados e conserva a seleção. A criação via ficha passa a aparecer no filtro. Não é integração com toda a biblioteca de etiquetas da conta; CRUD global, cores e metadata não carregada continuam pendentes. |
| Filtros avançados, contadores, etapas/negócio/canal | Etapas/negócio e UUID/visibilidade existem localmente; falta ainda equivalência fina dos contadores, biblioteca global de etiquetas e estado/retorno dos painéis. Não reintroduzir `slot_1` como escolha de saída: UUID/nome livre/saída explícita são exigências posteriores expressas do titular. |
| Pausa temporária da IA | Conferido diretamente no **HTML oficial**:30min,2h,24h,manual e reativar. A demo já correspondia; novo teste impede “corrigir” para a anotação antiga equivocada de1h/4h. Corrigida a documentação, não o comportamento oficial. Só memória na demo; nativo não altera worker ou IA. Compatibilidade operacional `forever`/`manual`, expiração e ações de assumir/retomar ainda dependem de integração. |
| Agenda/cadastro/edição, empresa/e-mail/documento/origem | CRUD local anterior em `src/crm/` continua preparado, com dois bloqueios independentes desligados (aplicação+conta no banco). A UI nativa não está integrada. Documento (`docNumber`), notas/instância no fluxo de nova conversa e equivalência de todos os formulários ainda exigem reposição/mapeamento antes da ativação. Cadastro manual não comprova identidade; não mesclar automaticamente contatos por telefone. |
| Ficha360, ganho/perda/valor, etiquetas, responsável | UI demonstrativa e domínio local anteriores preservados; dinheiro operacional em centavos, não soma de floats da demo. Não são valores de produção nem garantia de persistência. Requer projeção/CRUD revisionado integrado e homologação de todas as permissões. |
| Tarefas, retorno S19, agendamentos | Exemplos anteriores preservados. S19 não pode virar campanha ou envio automático inventado. Agendamento é rascunho não executado. Confirmar todos presets, remoção de tarefas e contratos do executor, sem ativá-lo nesta auditoria. |
| Mensagens / notas internas | Separação de rascunhos e notas fictícias, citações, reações, favoritos, edição, exclusão e encaminhamento continuam limitados à demo. Nota interna não pode virar saída WhatsApp/ACK, e texto oculto não entra na busca. Backend de anotação da ficha não equivale ao histórico de notas internas. Escrita autenticada ainda pendente. |
| Respostas rápidas `/`, gerenciamento e teclado | Exemplos locais anteriores existem. Faltam biblioteca autenticada e equivalência do filtro por atalho/título/texto, ArrowUp/Down, Enter/Tab/Escape, edição/exclusão e preservação do compositor em todos estados. Não chamar sugestão pré-definida de IA gerada. |
| PIX, catálogo, biblioteca de áudio, voz e microfone | Opções/modelos locais não equivalem aos endpoints de envio. Integração de mídia autorizada, catálogo/biblioteca do tenant, upload, gravação e descarte, limites/erros e confirmação de envio continuam pendentes. Não pedir acesso a microfone/arquivos para testar a aparência. |
| Prints/clipboard/anexos e cartão de contato | Preservados na organização com bloqueios explicados. Os fluxos reais `send-attachment/send-vcard` ainda não foram migrados. Não ler clipboard nem contatar número real. |
| Não lida, fixar, arquivar, ignorar, bloquear, limpar/apagar | Efeitos fictícios e confirmações existentes preservados. Integração real precisa identidade UUID/conta, revisões/autorização e erros corretos. Pedido comum de não receber não ganha programação automática, conforme instrução expressa do titular. |
| Ações em massa | Memória demonstrativa; seleção limpa por escopo e mantém cadastro nas exclusões. Não é lote operacional. Conferir todos payloads/opções/contagem/seleção visível e confirmar destruição, sem criar automatismos de resposta/descadastro. |
| CSV/VCF/TXT, backup geral, importação/restore | Download de exemplo exige clique, CSV neutraliza fórmula. Arquivo fictício **não é backup geral compatível** com configurações/conversas originais, não permite restauração operacional. Exportação autenticada/escopo/formatos/importação/rollback continuam pendentes. |
| Sincronizar WhatsApp e buscar histórico antigo | Oficial tem caminhos distintos `wa/sync-history` e `crm/:chat/fetch-history`, offsets/lotes/partial/espera. Refresh da demo não comprova sincronização. Integrações permanecem bloqueadas; não iniciar conexão/sync real para teste. |
| Seleção de saída, offline, fila/ACK/reenvio | Saída UUID explícita do mesmo negócio, offline bloqueado e aceite diferente de entrega já protegidos nos testes locais. Preservar journal/lease/ACK e aviso de incerteza do oficial; não escolher automaticamente o número de ingresso nem reenviar em erro. |
| Falhas, paginação, suporte, identidade e celular | Regressões existentes passaram. GET-only e sem metadata inventada no nativo; falha SQL não vira caixa vazia. Aborts/gerações e descarte impedem dados de outra conta/conversa após troca. Isso não substitui homologação Auth/RLS/permissões no serviço. |

## Validação desta rodada

- **8 testes novos**, além das regressões existentes. RED→GREEN documentados para ficha/arquivadas, humano/quentes, Contatos vazio, busca contextual e etiquetas dinâmicas.
- Seleção combinada Conversas + revisão estática + Dashboard + Visão geral: **108/108 PASS**,41741,264476ms.
- Full final: **784/786 PASS**,265384,934733ms. Somente as duas falhas históricas: `ienvia-branding.test.mjs` e `static-release-package.test.mjs`. Não mascaradas, não atribuídas ao CRM, não corrigidas fora de escopo.
- Testes Chromium da busca cobrem literal/XSS, corpo omitido, exclusão válida, contador/navegação circular, rascunho/saída intactos, nenhum GET extra e suporte/nativo sem formulário de envio. Uma fixture de mensagem excluída inicialmente contrariava o contrato (corpo não nulo); corrigida a fixture para exclusão válida, **sem enfraquecer o contrato**.
- Chromium320/390 nos dois temas: contraste básico sem problemas detectados e sem overflow. Não é auditoria WCAG completa/celular físico.
- Build/verify:102assets, sem API/auth no site de revisão. Capturas320/1440:6mensagens preservadas,5destaques,0erros/0API/sem overflow. Preview4183 compartilhado com a Visão geral, caminho `/conversas/`.
- Logs/capturas/evidência em `/home/user/auditoria/implantacao-gradual/`: `crm-*.log`, `conversas-paridade-{1440,320}.png`, `crm-evidence.json`. Zip da tentativa anterior de publicação continua histórico/desatualizado; nenhuma publicação foi feita.

## Continuidade e critério de passagem

Esta é a primeira reposição de microparidade do CRM, **não o encerramento das pendências da matriz**. A próxima fatia continua no próprio CRM: metadata/agenda/Ficha360 e pequenos controles ainda ausentes, preservando os bloqueios operacionais. Não saltar para ativação só porque a demo está bonita ou os novos testes passaram.

Antes de qualquer troca oficial: reconciliar deployment vigente, concluir contratos/metadata/formulários e as ferramentas ainda pendentes, homologar Auth/RLS/permissões/fontes/ações no ambiente autorizado, verificar backup/rollback e entrada isolada reversível. Manter `/painel#crm` e o fluxo antigo até a equivalência efetiva. Nenhuma autorização nova de custo/envio/SQL remoto é inferida da autonomia de revisão.

## Fatia seguinte aplicada: metadata autenticada

Atualização posterior à matriz acima: `CRM-METADATA-INTEGRADA-LOCAL.md` registra agenda paginada de **registros salvos**, consulta explícita de ficha e preparação de formulários/CAS, agora ligadas às rotas existentes. A linha anterior “UI nativa não integrada” é histórica para essa fatia; não permanece como descrição da porta nova. Gates reais ainda desligados; não houve projeção de todos cartões, backfill ou migração/ativação.16testes novos e150/150seleção nesta continuação. A matriz restante não foi considerada resolvida.


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


## Atualização05/11 — etiquetas/cores autenticadas (local) e autorização de deploy

`CRM-ETIQUETAS-CORES-LOCAL.md` registra biblioteca por conta, cores seguras, CRUD CAS e propagação auditada de renomeação/remoção nas fichas próprias.11000 aditiva amplia apenas o helper de perfil24→32 sem regravar registros, mantém as migrações antigas e gates reaisfalse. Até500fichas por transação, acima disso recusa/reverte tudo. UI confirma cascatas, conserva rascunho de ficha aberto ou relê a lista na fonte; não envia mensagens. Corrigido round-trip de etiquetas com vírgulas/aspas no editor.17novos;116/116seleção; **full final870/872**,278733,698089ms, só duas falhas históricas de release/assinatura;105assets estáticos.

Dados/presets antigos não importados, aplicação por chips/gesto original ainda pendente; não declarar equivalência completa das etiquetas ou da reforma. A ordem **mais recente** agora é “Termina tudo por favor depois quando acabar faz o deploy”: substitui a antiga espera por deploy conjunto. Autoriza publicar **depois de concluir/validar toda a reforma**, com implantação gradual/backup/rollback e sem custos/mensagens/bypass. Neste momento o fechamento completo ainda não ocorreu; nada publicado/aplicado remotamente.
