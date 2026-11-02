# Reescrita do backend do CRM — caderno de projeto

**Status:** levantamento e protótipo inicial isolado. O core de normalização/idempotência e a fronteira de ingestão estão em worktree local. Uma rota temporária Evolution read-only também foi implementada e testada sinteticamente, mas ainda não publicada nem chamada contra produção. O backend CRM continua sem adapter/outbox real ligado e não foi substituído.

## Objetivo acordado

Reescrever o backend que sustenta toda a aba CRM, mantendo a aparência e o fluxo visual existentes no frontend. O novo backend deve eliminar fontes concorrentes de estado, preservar o histórico e apresentar mensagens novas automaticamente. O transporte será híbrido: eventos em tempo real como caminho principal e sincronização incremental como recuperação.

A validação acontecerá primeiro em ambiente paralelo e isolado. O backend atual e os dados de produção não serão substituídos até o usuário testar e aprovar o novo fluxo.

## Arquivos deste caderno

- [Contrato público da Evolution API e incompatibilidades observadas](./evolution-api-contract.md)
- [Auditoria estática do backend atual e candidatos para as falhas](./current-backend-audit.md)
- [Viabilidade de diagnóstico com a credencial server-side já configurada](./diagnostic-access-feasibility.md)
- [Proposta de arquitetura do novo backend CRM](./backend-architecture.md)
- Protótipo isolado de eventos: `src/crmV2/evolutionEvent.js`, `src/crmV2/eventIngress.js`; testes em `tests/crm-v2-event-ingress.test.mjs` na worktree `/home/user/crm-backend-rewrite` (branch local `agent/crm-backend-rewrite`).
- Diagnóstico temporário: `src/crmV2/readOnlyEvolutionDiagnostics.js` + `GET /api/evolution-cloud/diagnostics/read-only` em `src/evolutionApiCloud.js`; segue sem deploy, conforme [relatório de acesso](./diagnostic-access-feasibility.md).
- [Plano de testes, migração e reversão](./test-and-rollout.md)
- [Decisões confirmadas e perguntas restantes](./open-questions.md)

## Fronteiras de segurança para testes

- Usar somente o ambiente paralelo/sandbox até a aprovação do usuário.
- Não executar campanhas, envios em lote ou ações sobre outros contatos.
- Para um teste real de envio, usar exclusivamente o número de teste que o usuário autorizou e registrar o resultado sem expor credenciais.
- Preservar todos os dados de origem; qualquer consolidação exige uma identidade técnica verificável e uma trilha de auditoria.

## Regra de implementação

Primeiro fechar contrato, inventário de funcionalidades e plano de compatibilidade; depois construir módulos novos atrás de uma interface compatível com o frontend. Não substituir o backend atual em uma única etapa irreversível.
