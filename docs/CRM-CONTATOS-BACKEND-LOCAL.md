# Contatos e Ficha 360 — backend local preparado

04/11/2026. Continuação da restauração do CRM original. Esta etapa prepara dados e operações reais de cadastro/ficha, mas **não ativa a migração nem transforma os controles demonstrativos em operações de produção**.

## O que está implementado

- Criação de contato manual, leitura e edição com revisão obrigatória.
- Ficha vinculada explicitamente a uma conversa canônica já existente no histórico UUID.
- Nome, empresa, cidade, e-mail, origem do lead, responsável, etiquetas, anotação da ficha, cinco etapas, negociação/ganho/perda/motivo, tarefas, retorno combinado e marcações de salvo/quente/fixado/arquivado.
- Valores monetários em **centavos inteiros**, não números de ponto flutuante.
- Agenda paginada, busca literal por nome/telefone/empresa/cidade/etiqueta, filtros por instância, visibilidade e salvo/não salvo.
- Trilha de revisões transacional com ator, ação e nomes dos campos alterados, sem copiar o conteúdo privado das notas.
- Validação no servidor e no SQL, permissões por conta e modo suporte somente leitura.

**Anotação da ficha não é mensagem de nota interna no chat.** Nesta fase ela fica na metadata CRM e não entra no histórico WhatsApp. A implementação operacional do histórico de notas internas continua pendente.

## Dois bloqueios de escrita, desligados por padrão

1. Aplicação: `createCrmRouter` só permite alterações com `allowWrites === true`. O registro em `src/server.js` **não** passa essa opção.
2. Banco: a tabela privada `ienvia_crm_write_accounts` precisa de liberação explícita da conta. A migração não habilita nenhuma conta. A própria RPC rejeita escrita sem liberação, mesmo que seja chamada diretamente e não passe pelo Express.

A permissão `canEditContacts` só fica verdadeira se os dois bloqueios permitirem e o operador for dono da conta. Suporte não ganha escrita. Não há endpoint público para habilitar contas. As liberações usadas nos testes existem somente no banco sintético descartável.

Não aplicar a migração ou habilitar essas opções para experimentar no serviço em uso. São necessárias homologação e autorização separadas.

## Identidade e preservação de dados

- Contato manual recebe UUID e telefone **informado**, com `identityKind: unverified_contact`. Não comprova WhatsApp, não associa instância e não escolhe saída.
- Não acrescentamos país, DDD ou nono dígito por heurística. O formato informado deve conter os dígitos internacionais; o `+` é normalizado.
- Repetir o telefone de uma conversa não junta cadastros nem históricos. Um cadastro manual não vira contato verificado por coincidência textual.
- Ficha canônica referencia a chave composta conta/conversa já existente. Identidade própria do negócio e do cliente vêm do histórico validado, não dos campos editáveis.
- LIDs continuam provisórios e isolados por instância. Outro número próprio/negócio não compartilha a ficha automaticamente.
- Ler uma conversa sem ficha devolve `contact: null`: não cria cadastro, etapa, nome ou nota silenciosamente.
- Alterações de metadata não mexem nas tabelas de ingresso, mensagens, ACK, lease, dispatcher ou flags dos motores. Ocultar CRM continua sendo filtro; não apaga histórico nem interrompe ingresso.
- IA, campanhas, bloqueio no WhatsApp, não lidas, identidade e agendamentos executáveis não são campos aceitos pelo novo patch.

## Rotas preparadas

O namespace é **`/api/crm-v2`**, separado do CRM legado em `/api/crm`. Essa separação evita alterar seu isolamento ou deixar uma rota nova cair num handler operacional antigo.

| Método | Caminho | Comportamento |
|---|---|---|
| GET | `/api/crm-v2/contacts` | Página de cadastros/fichas que já foram salvos. Não é backfill automático de todos os contatos legados. |
| POST | `/api/crm-v2/contacts` | Criação manual com `requestId` UUID, sem verificação ou envio. |
| GET | `/api/crm-v2/contacts/:id` | Consulta por conta e cadastro. |
| PATCH | `/api/crm-v2/contacts/:id` | Altera somente metadata, com `expectedRevision`. |
| GET | `/api/crm-v2/threads/:id/profile` | Consulta identidade canônica e ficha, ou ficha ausente explícita. |
| PATCH | `/api/crm-v2/threads/:id/profile` | Primeira ficha exige revisão zero; edições posteriores exigem revisão atual. |

Não existem endpoints novos de envio, remoção de histórico, pareamento ou automação.

A listagem aceita `limit` de 1 a 50, cursor UUID `after`, busca literal `q`, `instanceId`, `visibility` (`visible`, `hidden`, `all`) e `saved` (`all`, `saved`, `unsaved`). A primeira página não representa um teto de cadastros. A busca não procura no corpo de mensagens ou notas.

Cadastros manuais não têm origem: aparecem sem filtro de instância, exceto na seleção exclusiva de origens ocultas. Fichas canônicas respeitam o vínculo de origem e a visibilidade da instância.

## Conflitos, repetição e falhas

- O UUID `requestId` identifica a criação dentro da conta. Mesmo pedido normalizado retorna o cadastro atual sem duplicar; intenção diferente com o mesmo UUID devolve conflito.
- Edição usa CAS/revisão e lock transacional. Uma tela desatualizada não sobrescreve a ficha de outra; recebe 409 e deve consultar novamente.
- Não há repetição automática de mutações. Falha de confirmação é resultado desconhecido: consultar antes de decidir. O SDK PostgREST instalado também restringe retries automáticos aos métodos idempotentes; estas RPCs usam POST.
- Conta trocada durante a requisição não recebe o resultado anterior, mesmo que a alteração já tenha sido confirmada no contexto original.
- Migração ausente é 503 explícito, nunca lista vazia ou fallback ao CRM antigo.
- DTO é validado e limitado: dono, fonte, identidade, ID, revisão e paginação incompatíveis são rejeitados. Campos extras privados não são propagados.
- Respostas usam `Cache-Control: no-store, private`; erros não devolvem payloads ou detalhes SQL privados.

## Arquivos

- `src/crm/contracts.js`: contratos de entrada e DTO operacionais, separados do validador demonstrativo.
- `src/crm/router.js`: rotas de metadata, opt-in e sem dependências dos motores.
- `supabase/migrations/20261104005000_crm_contacts_profiles.sql`: proposta local de tabelas privadas, bloqueio por conta, validação, RPCs e revisão transacional.
- `src/server.js`: import, namespace e classificação de contexto mínimo; preserva rotas/armazenamento legados.
- `tests/crm-{contract,http,profiles-sql}.test.mjs`: contratos, Express com SQL real sintético e RPC/RLS no PGlite.
- `tests/dashboard-http.test.mjs`: integração com autenticação/contexto do servidor completo e regressão de isolamento do legado.
- `tests/helpers/instance-sql-fixture.mjs`: migração e liberações exclusivamente no banco sintético descartável.

## Validação e limites

**Resultados finais:** 50/50 na seleção dirigida; 506/508 na suíte completa. As duas falhas preexistentes continuam em `ienvia-branding.test.mjs` e `static-release-package.test.mjs` (release assinado). `git diff --check` limpo e 50 assets da demonstrativa íntegros. Nenhuma falha nova ficou pendente nesta seleção.

Os ciclos RED/GREEN e resultados finais são registrados em `/home/user/auditoria/arquitetura-v2/crm-functional-*`. A revisão de segurança fica em `CRM-CONTATOS-REVISAO-SEGURANCA.md` nessa mesma pasta.

As interfaces testadas foram: contrato de entrada/saída, RPCs e privilégios SQL, HTTP com banco sintético, e autenticação/roteamento integrado. A seleção dessas interfaces segue a delegação técnica já concedida pelo titular; não acrescenta autorização operacional.

PGlite não comprova concorrência multissessão PostgreSQL, autenticação JWT no banco remoto ou migração de dados reais. Antes de habilitar: testar PostgreSQL real autorizado, concorrência/retomada, planos com grande volume, retenção/exclusão de conta e compatibilidade do backfill. A busca de substring não ganhou índice trigram nem extensão nova nesta etapa.

Skills utilizadas: TDD, codebase-design, projection-patterns, api-design-principles, supabase-postgres-best-practices, sharp-edges e differential-review.

## O que continua pendente

- Conectar SDK/formulários da nova interface à metadata operacional e refletir corretamente revisão/ausência/conflito.
- Cadastro e projeção dos contatos legados, backfill não destrutivo e resolução explícita de vínculos manuais.
- Histórico operacional de notas internas, tarefas colaborativas além do CAS e auditoria consultável na UI.
- Coordenação IA/campanhas, pausas efetivas, agendamentos/executor, mídia/cartão nativo, CSV/importação/restauração e demais integrações indicadas no inventário do CRM original.
- PWA push/share e homologação conjunta posterior.

A demonstrativa publicada não foi modificada nesta etapa. Não houve commit/push de backend, deploy principal, SQL remoto, leitura de dados de clientes ou operação WhatsApp.

## Continuação: UI autenticada conectada localmente

Consulte `CRM-METADATA-INTEGRADA-LOCAL.md`. Agenda paginada de registros salvos e consulta explícita de Ficha360 agora usam o contrato autenticado; formulários/criação/CAS estão preparados por permissão, mas gates reais continuam desligados. O contrato puro foi movido para `public/v2/assets/crm-metadata-contract.js`, reexportado pelo caminho antigo sem remover suas validações. Há teste SDK→HTTP→SQL sintético. Não significa backfill, agenda integral, metadata completa do inbox ou envio habilitado.


## Atualização posterior — documento/tarefas/marcadores/filtros

Consulte `CRM-DOCUMENTO-TAREFAS-LOCAL.md` e a evidência `crm-fields-evidence.json`. Documento informado40caracteres, migração aditiva08000 (05000intacta), busca literal estendida na agenda; tarefas e marcadores editáveis por CAS na ficha autorizada; remoção de tarefa no exemplo; Kanban demonstrativo respeita busca/filtros e painel/contador avançado. Gates reais desligados; sem projeção global do inbox, backfill ou homologação/ativação.15testes novos,81/81seleção, full final815/817 (somente as duas falhas históricas de release/assinatura). As pendências de documento e editor básico de tarefas nas seções históricas acima foram resolvidas **localmente**; demais pendências não foram encerradas.

**Diretriz vigente:** continuar automaticamente, mas não publicar agora/automaticamente. Avisar quando toda a reforma estiver concluída/validada para fazerem o deploy juntos.
