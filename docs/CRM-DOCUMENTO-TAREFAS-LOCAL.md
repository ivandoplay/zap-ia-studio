# CRM — documento, tarefas, marcadores e filtros (local)

04/11/2026. Continuação da fatia metadata. **Preparado/testado localmente; não é declaração de paridade integral, homologação ou ativação em produção.**

## Ordem vigente

Concluir correções e testes autonomamente, **sem deploy agora/automático**. O titular pediu avisar quando tudo estiver concluído/validado para fazerem o deploy juntos. A ordem mais recente substitui a autorização anterior de autopublicação. Preservar painel antigo, implantação gradual, rollback, assinatura, segurança e gates; nenhum custo novo ou mensagem real foi autorizado por esta fatia.

## Reposição implementada

- `docNumber`: CPF/CNPJ **informado**, texto até40caracteres, mantendo a semântica do oficial fixado em `7630b62b40b4518d06a157c4dc5055747fcb157e`. Não verifica CPF/CNPJ, identidade, WhatsApp, cadastro fiscal ou titularidade; não consulta serviço externo. Exibe/edita na ficha nativa autorizada, detalhe da agenda e exemplo demonstrativo. Busca demonstrativa inclui o documento. Novo cadastro de exemplo não herda documento da fixture anterior.
- Migração **nova** `20261104008000_crm_documento_busca.sql`: estende cinco funções, preservando ACL, search_path, guardas e escopos. A05000histórica permaneceu intacta. DTO de registro antigo oferece documento vazio **sem UPDATE, mudança de revisão ou habilitação de conta**. GET de ficha anuncia `documentFieldSupported:true`, permitindo editar documento inclusive na primeira ficha; fonte antiga sem suporte não ganha campo desconhecido no formulário.
- Agenda SQL busca documento, e-mail, origem, responsável e anotação por substring **literal**, sem converter `%`/`_` em curingas. Mantém proprietário, UUID da instância, visibilidade, salvo/não salvo e paginação. Esta busca da agenda **não** é projeção de metadata em todas as linhas da caixa de entrada.
- Tarefas nativas: adicionar/editar/concluir/remover, UUID estável por item, texto200, limite30. Alterações só são enviadas junto com **Salvar cadastro**, em uma revisão CAS da ficha. Remover não apaga conversa; concluir não agenda/envia nada. Erro/conflito mantém o formulário/rascunho, sem repetição automática. A demonstrativa também permite remover tarefa, preservando as demais e o histórico fictício.
- Marcadores nativos editáveis: salvo, lead quente, fixado e arquivado, os quatro booleanos já existentes no contrato. São **metadata do CRM**, não bloqueio WhatsApp, configuração de IA ou comando de instância. A projeção desses marcadores no inbox nativo continua pendente; não chamar isso de arquivamento operacional completo.
- Durante a confirmação, formulário fica `inert` e o submit fica desabilitado: não permite editar o rascunho que já está em trânsito nem duplo envio. Em erro conhecido o formulário volta a permitir correção; conflito/resultado incerto seguem bloqueando reenvio até leitura explícita.
- Kanban demonstrativo agora utiliza a mesma lista filtrada da busca/filtros do inbox, em vez de todas as linhas carregadas. Painel avançado funciona em Conversas/Kanban, mantém seleções/abertura ao trocar de visão e informa o número de filtros ativos (instância/etapa/etiqueta/negócio). Em Contatos/Coach permanece oculto, como no oficial. Não há consulta por linha, associação por telefone ou fallback de instância.

## Validação e evidência

Skills consultadas: TDD, projection-patterns, supabase-postgres-best-practices. Interfaces: contrato/SDK, UI de navegador, HTTP Express e RPC SQL PGlite descartável; não são sessões reais nem PostgreSQL/Auth/RLS homologados.

- **15 testes novos** sobre a base metadata802. RED→GREEN documentados para campo documento, busca/clone demo, tarefas nativas/remoção demo, marcadores e Kanban/filtros. Seleção combinada **81/81**,43506,872464ms; depois, captura/validação nativa **13/13**,9011,424468ms, incluindo edição a320px sem overflow.
- **Full final815/817**,277034,232598ms. Somente as duas falhas históricas `ienvia-branding.test.mjs`/`static-release-package.test.mjs`, relativas ao release/assinatura antigos. Não são sucesso completo e continuam bloqueando publicação. Full anterior desta rodada também815/817,267626,088309ms; o final confirma os ajustes visuais/mobile e validação da flag.
- Cadeia **SDK→HTTP→SQL** cobre documento, tarefas, marcadores e busca. Primeira ficha canônica confirma suporte/CPF informado; identidade e histórico não recebem anotação de cadastro. Não há rota nova de envio/verificação fiscal.
- Compatibilidade: DTO antigo sem documento legível; flag opcional aceita somente booleano; primeira ficha usa revisão0; fonte antiga não mostra campo; upgrade não regrava perfil/revisão/updated_at nem liga escrita. Segurança: helpers privados, anon negado, outro proprietário negado, master somente leitura, gates e CAS preservados; pesquisa literal e isolamento entre contas.
- Chromium: lista/tarefas preservadas, limite30, alteração única, confirmação pendente sem duplo envio, nenhum storage de documento/rascunho nem chamada WhatsApp. Capturas sintéticas `crm-fields-desktop-1440.png` e `crm-fields-mobile-320.png`; checklist/mobile inspecionados. Capturas antigas metadata permanecem históricas.
- Build/verificação: **102 assets**, demonstração sem APIs/credenciais/sessão. Nenhum commit/push/deploy/SQL remoto/custo/WhatsApp/IA paga. Evidência consolidada `crm-fields-evidence.json` em `/home/user/auditoria/implantacao-gradual/`.
- Logs grandes foram comprimidos sem perda; procurar o sufixo `.log.gz` quando o `.log` histórico não existir. O full atual é `crm-fields-full-final.log.gz`.

## O que continua pendente

Projeção autenticada de metadata no inbox/filtros sem N+1 ou associação por telefone; biblioteca/cores de etiquetas e atalhos reais do compositor; operações/mídias/importação/exportação/backup/sincronização e microcontroles restantes; reauditoria das demais abas; homologação de dados/Auth/RLS/concorrência/migração e assinatura final. Gates reais continuam desligados.

A inspeção de `/` confirmou que no oficial é **menu de atalhos no compositor**, não atalho global de busca. Um ensaio prematuro de teste com essa interpretação foi descartado antes de implementar qualquer listener/novo comportamento; logs de ensaio preservados. O menu real continua pendente, sem reinvenção de fluxo.

Antes de ativar qualquer aba: reconfirmar deployment oficial e reconciliar mudanças, concluir matriz, homologar no ambiente autorizado, conferir assinatura e rollback e **avisar o titular para publicar juntos**. Não declarar toda a reforma concluída a partir desta fatia.


## Atualização posterior — atalhos do compositor (demo)

`CRM-ATALHOS-COMPOSITOR-LOCAL.md` registra seletor inline `/`, filtro por código/título/texto, setas/Enter/Tab/Escape, expansão literal do primeiro nome e gerenciador CRUD/remoção confirmada **em memória demonstrativa**. Nativo não recebe fixtures nem compositor/envio ou consulta extra.9testes novos; full validado824/826 (só as duas falhas históricas de release/assinatura),103assets. Um full intermediário expôs modal fechado ainda conectado; reproduzido e corrigido com verificação de diálogo aberto,3repetições13/13 e full validado. Menu/gerenciador demonstrativos não estão mais ausentes; biblioteca autenticada e demais pendências operacionais continuam. **Sem deploy agora/automático: avisar ao concluir/validar toda a reforma para publicar com o titular.**
