# CRM — biblioteca de etiquetas e cores

05/11/2026. **Preparação local validada; sem aplicação remota/ativação/publicação. Reforma geral incompleta.**

## Ordem vigente

O pedido mais recente é **“Termina tudo por favor depois quando acabar faz o deploy”**. Substitui a ordem anterior de apenas avisar para deploy conjunto: há autorização para publicar depois de concluir/validar **toda** a reforma. Não autoriza publicação incompleta, custo/upgrade, mensagens reais ou bypass de assinatura/permissão. Manter implantação gradual, backup, rollback e painel antigo. Informar impedimento real de acesso/infraestrutura/assinatura, não inventar sucesso.

## Referência e alcance

Oficial7630b62b40b4518d06a157c4dc5055747fcb157e: storage `normalizeCustomTagItem`/`saveCustomTag`/`deleteCustomTag`, app3223–3255 e4720–4777. Biblioteca por negócio/conta; nome até32, corHEX6/default#10b981, upsert por nome sem diferenciar maiúsculas e ID estável. Renomear/remover também propaga o nome exato nas fichas da conta. Mensagens não são tocadas.

A implementação nova prepara GET/PATCH `/api/crm-v2/tags`, contrato/SDK/view próprios, catálogo autenticado e cores na ficha/Kanban/filtros. Não importa business.customTags/presets e não interfere nos defaults antigos. Demo/menus anteriores preservados; a entrada nativa “Etiquetas e cores” fica em Ferramentas e na Ficha360.

**Não é paridade completa de aplicação de etiquetas a contatos:** criação na biblioteca não alterna automaticamente o novo rótulo na ficha selecionada como o handler antigo fazia; atribuição continua pelo editor de ficha. Chips de seleção/aplicação e migração dos presets/dados originais precisam reauditoria antes de declarar equivalência/publicar.

## SQL e integridade

Nova migração11000 depende de10000 (helpers trim/UTF16) e da sequência CRM anterior. Duas tabelas privadas, `ienvia_crm_tag_libraries` e `ienvia_crm_tag_changes`; getter e mutação RPC com auth.uid()/reader/writer existentes, RLS/ACL sem grants diretos, search_path vazio, timeouts, lock da biblioteca e revisãoCAS global. Nenhuma conta habilitada e nenhum registro antigo reescrito ao instalar.

Snapshot `saved_tag_library_v1`, owner, revisão, data e itensUUID/name/color. Até200definições; nomes até32UTF16 e cores exclusivamente#rrggbb. Upsert preserva ID por nome; edição com colisão não sobrescreve outra definição. Nome/cor são dados, não CSS arbitrário/HTML/URL.

Renomear/apagar existente busca **somente fichas salvas próprias** com o nome antigo exato, locks ordenados e até501candidatas. Até500 são aplicadas pelo helperCAS de perfil, com auditoria/revisão/datas de cada ficha. Renomear deduplica etiquetas preservando ordem; apagar só remove o rótulo. Outras contas e fichas não afetadas não mudam. Qualquer erro reverte biblioteca, fichas e auditoria; mais500 retorna422CRM_TAG_BULK_LIMIT sem alteração parcial. Grandes cascatas exigem plano específico, não lote parcial silencioso.

Os nomes globais32 exigiam ampliar o validador de perfil antes limitado24.11000 copia o helper08000 alterando **apenas24→32**, comprovado por comparação reversa. O arquivo08000 permanece intacto. O contrato JS acompanha32, mantendo8etiquetas por ficha. Migração não modifica perfis/revisões/datas/gates existentes, coberto em fixture de upgrade.

Não existe FK que proíba rótulos livres nas fichas: a propagação alcança correspondências existentes na transação, não impede que uma edição futura crie de novo um nome livre antigo. Comparações Unicode/collation, volume e concorrência precisam homologação real; não se presume identidade perfeita entre todos os case-folds JS/PostgreSQL.

## UI, sessão e dados seguros

Consulta somente ao abrir a biblioteca, nunca por linha do inbox. Permissão própria `canEditTags`, dois gates CRM existentes false na composição/contas reais, suporte readonly e canSend/canPair/canAutomatefalse. GET/PATCH exatos/sem owner/query; PATCH não faz refresh/replay. SDK exige GET válido; erro/conflito/incerto bloqueia até consulta explícita. Não há ledger de requestId.

Biblioteca desconhecida não inventa cores. Depois de snapshot válido, cores comprovadas pintam fichas/Kanban e definem nomes do filtro; rótulo livre usa fallback visual verde do original. CSS recebe apenas HEX validado. Cor não é gravada em cada contato nem afirma estado de IA/não-lidas.

Renomear/remover exige confirmação sobre as fichas da conta; Escape cancela sem perder rascunho. Busy/inert e diálogo conectado **e aberto** impedem eventos/retornos descartados. Contexto409scopeChanged fecha a tela inteira. Nenhum texto é enviado ao WhatsApp/IA ou salvo em localStorage/sessionStorage.

Após cascata confirmada, sem editor de ficha aberto, a lista é consultada novamente na fonte — não se inventam DTOs/revisões localmente. Com formulário de ficha aberto, ele é preservado e o usuário é avisado para consultar novamente; um salvamento antigo enfrenta oCAS alterado. Cores são repintadas sem destruir o formulário.

### Correção de integridade do editor

O campo de etiquetas separava tudo por vírgula. Um nome válido como `Loja, Centro` viraria duas etiquetas ao salvar outro campo; aspas também não tinham round-trip seguro. Agora formatter/parserCSV puro preserva vírgulas/aspas com escape e rejeita texto malformado, sem divisão silenciosa. Entrada antiga simples continua compatível; campo até600 acomoda8nomes máximos/escapes. Placeholder/descrição explicam aspas. Testes comprovam salvar anotação mantendo exatamente os rótulos existentes.

## Evidência

**17novos:** contrato/SDK/sessão/CSV4, SQL4, HTTP→Express→PGlite2, browser7. Seleção112/112 antes doCSV;95/95 após upgrade/refresh; final116/116,73225,893344ms. Browser cobre readonly/cores320px,CRUD, confirmação/Escape, rascunho protegido, descarte de modal/retorno, schema/owner/contexto, consulta real após cascata e vírgulas/aspas.

**Full final870/872**,278733,698089ms. Somente `ienvia-branding`500vs200 e `static-release-package`versão assinada divergente, falhas históricas ainda impeditivas de publicar. Full anterior868/870 era antes doCSV; não confundir com final. Build/verify105assets estáticos, sem API/sessão operacional; somente o contrato puro extra vai ao review.

Logs/revisão/evidência: `auditoria/implantacao-gradual/crm-tags-*`, fora do repo. Logs grandesgzip sem perda. PGlite/Chromium não certificam JWT/Auth/RLS/PostgreSQL concorrente, plano/latência sob carga, celular físico ouWCAG. Sem SQL remoto/deploy/commit/push/mensagens/custo/IA paga.

## Ativação, rollback e pendências

Antes de ativar, concluir toda a matriz e homologar dados/permissões/concorrência. Não ligar gates ou aplicarSQL só pelos testes locais. Leitores compatíveis32 precisam estar disponíveis antes de permitir gravar32: rollback para um cliente nativo antigo que só aceitava24 pode falhar fechado. Não truncar nomes para “corrigir” isso; manter leitor compatível/painel antigo, desligar escrita e restaurar pelo plano aprovado.

Faltam migração dos presets/IDs/dados antigos, aplicação por chips/gesto original, grandes cascatas quando necessárias, operações/mídias/import/export/backup/sync, reauditoria demais abas, Auth/RLS/delegação/dados/assinatura/rollback e fechamento real. A autorização de deploy é condicional a concluir/validar tudo; **nenhum deploy foi feito nesta fatia**.
