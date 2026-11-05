# CRM — projeção de fichas salvas no inbox e Kanban

Data: 04/11/2026. **Preparação local validada; não ativada em produção. Não é conclusão da reforma.**

A ordem vigente é continuar autonomamente, sem deploy agora/automático. Avisar ao concluir e validar toda a reforma para publicar junto com o titular. Nenhum envio real, custo, SQL remoto ou integração paga é autorizado por esta fatia.

## Fonte e fronteiras

A migração **nova** `20261104009000_crm_thread_profiles_projection.sql` cria `ienvia_list_instance_threads_crm`. Mantém as funções históricas e os arquivos04000/05000/08000 intactos. É uma consulta estável, `SECURITY DEFINER`, `search_path=''`, timeout3s, autorização pelo mesmo `ienvia_get_instance_execution` e EXECUTE apenas para `authenticated`, não anon/service_role/PUBLIC.

Uma página limitada de threads da instância/owner/origem/visibilidade é selecionada antes da junção com `ienvia_crm_contacts` por **owner_id + thread_id UUID**. Uma RPC por página; não faz GET de ficha por linha nem varredura de históricos. Não usa telefone para unir registros, não cria ficha/default/etapa, não faz backfill, não altera perfil/revisão/dados e não habilita escrita. Cadastro manual de mesmo telefone continua separado. LID permanece identidade provisória, com telefone null e sem unificação com PN.

O snapshot declara `crmProjection: 'saved_profiles_by_thread_v1'`; cada thread tem `crmContact: DTO | null`. O DTO reaproveita o contrato validado de fichas: owner, thread, origem canônica, identidade, revisão, campos e datas. O documento vazio compatível não migra/regrava o registro. Cadastro sem ficha permanece explicitamente sem ficha, não um lead novo de valor zero.

## Contrato opt-in e bloqueios

- `createChannelsRouter({getLocalContext, allowCrmProjection=false})`: padrão **false**. A composição real do servidor não foi alterada para ligar esse parâmetro.
- Catálogo declara `features.crmProfilesRead` booleano. Só capacidade true permite ao reader pedir `GET /api/channels/:id/threads?...&crm=profiles`.
- Gate desligado rejeita a solicitação antes da RPC. Sem opt-in, o histórico antigo continua sem CRM/PII adicionais e preserva compatibilidade de query. Query projetada restringe campos e rejeita duplicados/valores inválidos.
- A rota revalida viewer/tenant/role depois da RPC. Mudança retorna409 com `scopeChanged:true`, sem payload privado; cliente encerra a tela e descarta dados antigos. Não é apenas um erro genérico de lista.
- Marcador/DTO/owner/identidade inválidos geram erro fechado. Não existe fallback para outra fonte nem silêncio transformando falha em caixa vazia. Uma paginação que perde o marcador não mistura páginas. Paginar o catálogo de instâncias com a mesma capacidade conserva a fonte/controles já validados; mudar a capacidade confirmada descarta o snapshot e inicia uma consulta nova (não é fallback após erro). Desmarcar a instância invalida a fonte e desabilita filtros; uma nova leitura só reativa metadata depois do marcador válido.
- `canSend`/`canDelete` continuam false. Capacidade de leitura não concede `canEditContacts`, escrita de ficha, automação, pausa de IA ou envio.

## UI nativa preparada

O adaptador projeta apenas o que está persistido: nome, empresa, documento, cidade, e-mail, origem, responsável, notas, etapa/status, valor em centavos convertido para apresentação, etiquetas, tarefas e marcadores. `unread`, `aiEnabled` e `needsHuman` continuam null; não são inferidos da existência de ficha.

Após a primeira página válida, filtros CRM/etiquetas/etapa passam a usar esse snapshot. Sem fonte comprovada, ficam indisponíveis. IA e não-lidas continuam indisponíveis. Busca só percorre campos/páginas carregados; não finge pesquisa global nas últimas12 mensagens.

O Kanban nativo é **somente leitura**, com as cinco etapas existentes e valores informados. Mover fica disabled, cards não são arrastáveis e não há PATCH/POST. Thread sem ficha não entra automaticamente em uma coluna: o painel informa a quantidade não distribuída. Filtros e escolhas do painel avançado conservam estado entre Conversas/Kanban. A demo continua com seu comportamento próprio, não fornece exemplos ao adaptador autenticado.

A ficha informa a revisão do snapshot ou sua ausência. A consulta explícita na Ficha360 continua disponível pela porta de metadata e pode receber revisão mais recente; **não se promete sincronização em tempo real nem snapshot global de todas as páginas**. Atualizações de um perfil não reescrevem retroativamente a página carregada nesta fatia.

## Testes e evidência

**15 cenários novos:** contrato/reader/adaptador3; SQL4; HTTP→Express→PGlite2; browser6. Há isolamento de tenant/ACL/master, visibilidade/cursor/paginação, DTO equivalente à consulta canônica, upgrade sem mudar cadastro/revisão/gates, PN/LID, cadastro manual não unido por telefone, gates defaultfalse, query e troca de contexto. Browser valida busca por documento/filtros/etiquetas, valor/Kanban somente leitura, ausência de ficha, geometria320px, fonte corrompida, perda de marcador ao paginar e descarte completo após409scopeChanged, paginação de instâncias conservando capacidade, revogação/reinício de fonte e desmarcação de instância, sem N+1/writes.

Seleção ampla123/123 antes do último reforço de contexto;34/34 e browser18/18 com verificação responsiva nessa etapa. Após reforço de capacidade:91/91; browser final20/20. Build/verify: **104assets** estáticos sem funções/API/sessão operacional. **Full final839/841**,294675,205923ms: somente as duas falhas históricas de release/assinatura (`ienvia-branding`500vs200; `static-release-package` versão divergente). Nenhuma falha funcional nova. Evidência e hashes: `auditoria/implantacao-gradual/crm-projection-evidence.json` (fora do repositório). Full inicial836/838 tinha apenas as duas falhas históricas de release; não é o full final do reforço de contexto. Logs preservados, grandes em `.log.gz`.

## Implantação futura e rollback — não executados

1. Concluir as outras pendências, reauditar o original e homologar Auth/RLS/PostgreSQL real, dados/permissões e concorrência em ambiente autorizado. PGlite/Chromium não equivalem à homologação do serviço.
2. Revisar/aplicar a migração aditiva somente com autorização da janela; nenhuma alteração de dados é exigida por essa leitura. Verificar backup e versão do backend.
3. Manter gatefalse inicialmente. Habilitação futura explícita por implantação do backend revisto, somente após aceite; não foi criado bypass/env/rota de ativação silenciosa.
4. Rollback de leitura: voltar `allowCrmProjection=false` e reabrir a tela para reler catálogo. Clientes antigos permanecem no histórico original. Requisição projetada em andamento falha fechada, não mistura fontes. Não é necessário apagar contatos nem reverter dados para desligar essa projeção. Eventual remoção da RPC é decisão separada, fora desta execução.
5. Manter painel/CRM antigos e reversão por aba até equivalência. Corrigir as pendências de pacote/assinatura com chave compatível, nunca substituir a chave pública ou servir ZIP sem assinatura para passar testes. Avisar o titular antes de publicar.

## O que continua pendente

Ativação/homologação real dessa leitura; biblioteca autenticada de atalhos; etiquetas globais/cores; operações/mídias/importação/exportação/backup/sync; pesquisa global de mensagens e estados de IA/não-lidas não fornecidos por esta fonte; reauditoria demais abas; Auth/RLS/delegação/dados/concorrência/migração e assinatura/rollback. **Não anunciar “tudo pronto” a partir desta preparação local.**
