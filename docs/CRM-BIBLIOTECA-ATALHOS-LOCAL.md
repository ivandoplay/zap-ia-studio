# CRM — biblioteca autenticada de atalhos (preparação local)

04/11/2026. **Código local validado; não aplicado/ativado em produção e não é conclusão da reforma.** Ordem vigente: continuar automaticamente, sem deploy agora/automático. Avisar quando toda a reforma estiver concluída/validada para publicar com o titular. Sem SQL remoto, mensagens reais ou custo novo.

## Referência e paridade

Conferido `src/storage.js` e `public/app.js` do SHA oficial7630b62b40b4518d06a157c4dc5055747fcb157e: biblioteca pertence ao negócio/perfil da conta, não a cada conversa/instância. `business_unico` continua no original, intocado. Código remove barras iniciais, passa a minúsculas e conserva ASCII a-z/0-9/_/-. Criar com código existente mantém o ID; editar um ID para código de outro item é recusado sem sobrescrever esse outro item. Ordem de inserção preservada.

A demonstração `/` e seu gerenciador continuam próprios/em memória, sem alteração nesta fatia. A implementação nova **não conecta compositor/envio nativo**, não interpola nomes na biblioteca, não chama IA nem WhatsApp. Atalhos salvos são texto literal; placeholders só serão usados pelo compositor quando este tiver integração autorizada separada.

## Persistência preparada

Nova migração aditiva `20261104010000_crm_quick_reply_library.sql`:

- `ienvia_crm_quick_libraries`: um documento privado por owner UUID, até200itens, revisão global e updatedAt; `ienvia_crm_quick_changes`: trilha de actor/revisão/operação/ID, sem corpo dos atalhos.
- GET RPC `ienvia_crm_get_quick_replies(p_owner)`: mesma autorização existente de reader CRM, owner ativo/master autorizado. `projection: saved_quick_replies_only_v1`; ausência de documento = snapshot autoritativo revision0/items[]/updatedAtnull, nunca lista de exemplos.
- Mutação RPC `ienvia_crm_mutate_quick_replies(p_revision,p_operation,p_item)`: dono derivado de auth.uid(), guard de escrita CRM já existente, lock do documento e CAS da revisão global. `save` cria/edita/upsert por código; `remove` remove ID explícito. Duas edições concorrentes não devem sobrescrever silenciosamente a mesma revisão; homologação concorrente real continua pendente.
- Tabelas com RLS e sem grants diretos a PUBLIC/anon/authenticated/service_role. RPCs somente authenticated. Helpers privados, search_path vazio, timeouts. Sem owner/actor fornecidos no corpo de escrita, sem associação a telefone, filas ou motores.
- Validação JS+SQL: UUID, chaves conhecidas, texto/título/código, duplicidade e até200itens. Contagem UTF16 e trim compatíveis com o formulário, incluindo caracteres suplementares. Código80, título160, texto4000. Limite recusa cadastro novo sem truncar biblioteca; edição de existente ainda permitida no limite. Não são restrições aplicadas aos dados antigos automaticamente.
- Apagar o último item mantém biblioteca nova vazia; não reaparecem exemplos. Isso **não altera a reposição de defaults do storage antigo**.

Nenhuma linha/flag da base antiga foi reescrita. **Não há importação/backfill de business.quickReplies.** Os dados antigos/defaults continuam no painel original; migração real desse conteúdo requer plano de mapeamento/IDs/limites/rollback e aceite. Não anunciar equivalência dos dados apenas porque o CRUD novo funciona.

## HTTP, sessão e gates

GET e PATCH exatos `/api/crm-v2/quick-replies`, sem query/owner pela URL. PATCH `{expectedRevision, operation:'save'|'remove', item}`. Um pedido de cadastro não é comando de envio. Os dois gates existentes permanecem desligados na aplicação/contas reais: `createCrmRouter(...allowWrites=false)` na composição real e guard SQL por conta, que esta migração não habilita. `canEditQuickReplies` só com ambos true, dono=self e snapshot válido; suporte não ganha escrita. `canSend/canPair/canAutomate=false`.

Contexto viewer/tenant **e role** capturado e revalidado depois da RPC.409de mudança inclui `scopeChanged:true`, impede retorno do conteúdo e encerra a tela no cliente. Essa correção também protege as rotas de ficha já existentes. Conflito CAS comum não é confundido com troca de conta.

Sessão admite apenas GET/PATCH no caminho exato, GET sem corpo. PATCH não faz refresh/replay automático por401/rede. SDK só escreve depois de GET validado; falha, conflito ou resultado incerto bloqueiam novas mutações até consulta explícita. CAS impede repetição silenciosa com a revisão antiga, **não é ledger de idempotência por requestId e não promete replay bem-sucedido**. Resultado desconhecido exige reler, não reenviar automaticamente.

## UI nativa

Ferramentas → Respostas rápidas / abre a biblioteca e faz **uma consulta explícita**, sem instância/conversa obrigatória, sem dados de demonstração e sem autoload ao entrar no CRM. Falha de migração/DTO mostra erro, não vazio nem fallback para endpoint legado.

Lista literal de código/título/texto e revisão; readonly quando não autorizado. Formulário e confirmação de remoção apenas com permissão comprovada. Confirmação não apaga mensagens/conversas. Cancelar por botão/Escape conserva rascunho. Corpo inerte durante confirmação/solicitação; duplicação sintética de submit não faz novo pedido. Conflito preserva rascunho, bloqueia escrita e oferece consulta explícita para revisar antes de salvar novamente.

Ações e respostas exigem diálogo conectado **e aberto**, sinal vivo e versão de contexto via cliente. Fechar/descartar aborta leitura e limpa dados do controlador; resposta tardia não reabre modal nem salva automaticamente. Não há armazenamento de textos em localStorage/sessionStorage, copiar para área de transferência ou download nesta fatia. Um PATCH já confirmado pelo usuário pode ter sido aplicado antes do abort; ao reabrir, consultar a biblioteca, nunca repetir automaticamente.

## Validação

14novos: contrato/SDK/sessão4, SQL3, Express→PGlite2 e browser5. Seleção94/94,76948,648876ms. Após corrigir sincronização de um teste de contexto,3repetições do browser25/25 (19014,76595;19999,399101;18655,251608ms).

**Full validado853/855**,330323,113123ms: somente as duas falhas históricas de release/assinatura (`ienvia-branding`500vs200; `static-release-package`versão divergente). Não é suite100% aprovada. Full inicial852/855,381778,715269ms tinha uma terceira falha: teste aguardava título intermediário da biblioteca quando409já encerrava corretamente a tela. Passou a esperar o gate final diretamente, sem aumentar timeout/enfraquecer a asserção de descarte. Não confundir esse erro de sincronização com correção runtime.

Build/verify104assets, sem API/sessão operacional no review estático; os três módulos novos são somente do bootstrap autenticado, não fixtures da demo. Browser cobre320px/literalidade, sem compositor/storage, CRUD/CAS, confirmação/Escape, conflito/rascunho, diálogo fechado/retorno tardio e troca de contexto. SQL cobre ACL/RLS sintético, gatefalse, tenant/master, UTF16, colisão, limite200/sem truncamento e auditoria sem conteúdo.

Logs/revisão/evidência fora do repo: `auditoria/implantacao-gradual/crm-library-*`. Logs grandes `.log.gz`. PGlite/Chromium não substituem homologação JWT/Auth/RLS/Postgres real/concorrência/volume/celular físico/WCAG. Nenhum deploy/commit/push/SQL remoto/envio/IA paga foi executado.

## Próximas frentes

Migração/homologação real da biblioteca e dos perfis, etiquetas globais/cores, operações/mídia/import/export/backup/sync, reauditoria demais abas, Auth/RLS/delegação/dados/concorrência/assinatura/rollback. Manter painel antigo até equivalência real. A ativação e publicação ficam para a janela acordada com o titular após concluir toda a reforma, não decorrentes destes testes locais.
