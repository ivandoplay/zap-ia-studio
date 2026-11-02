# Testes, validação e implantação segura

**Princípio:** testar o backend novo antes de qualquer substituição. O estado atual de produção não deve ser alterado durante o desenvolvimento do protótipo.

## Fase 0 — contrato e ambiente

- Registrar commit/versão do backend atual e inventariar todas as rotas usadas pelo frontend CRM.
- Confirmar versão da Evolution instalada, provider, formato real de eventos e paginação; não inferir pela documentação pública.
- Criar namespace/banco e credenciais de teste segregados, sem gravar em tabelas de produção.
- Proibir no ambiente isolado envio automático, campanhas, tarefas agendadas e automações de follow-up.
- Preparar fixtures sintéticas que representem mensagens de texto, mídia, áudio, status, edição, remoção, contato sem nome, contato com nome, diferentes slots e reordenação de eventos.

## Fase 1 — testes automáticos

### Unitários

- Normalização de cada evento e variações de provider.
- Idempotência de evento repetido e mensagem repetida.
- Ordenação por timestamp/ID e proteção contra evento atrasado sobrescrevendo estado mais novo.
- Correspondência de chat usando identificador técnico; nunca fusão por semelhança de nome/telefone.
- Preservação de histórico, mensagens sem texto, campos de CRM e relações de tarefas/tags/notas.
- Retry, timeout, respostas inválidas e limites de payload.

### Contrato Evolution

- Validar rotas, headers, payloads, paginação, erros e respostas contra a versão efetivamente instalada.
- Começar por operações de leitura em conta de teste.
- Para operações de envio, testar em ambiente isolado e exclusivamente para `5586981638438`, número autorizado pelo usuário; jamais enviar para outro destinatário.
- Confirmar que timeout ambíguo não provoca reenvio duplicado sem estratégia de reconciliação.

### Persistência e concorrência

- Restrição única/idempotência sob eventos simultâneos.
- Evento/outbox em transação: ou ambos gravados, ou nenhum.
- Reprocessar fila após restart e publicar outbox pendente.
- Migração preserva IDs, histórico, relações e campos CRM; rollback validado em cópia.

## Fase 2 — integração e interface

- Testar webhook/socket com eventos sintéticos: recebimento, envio, recibos, edição, remoção, reconexão e duplicatas.
- Simular perda do push, queda do banco, atraso de rede, expiração de token e retorno de aba em background; reconciliação deve reparar a visão.
- Executar Playwright sobre Inbox, Contatos, Kanban e Coach, incluindo busca, filtros, envio de teste, anexos, tarefas, notas, tags, ações em lote e exportação.
- Conferir que os DTOs novos preservam os fluxos do frontend existente; testar em larguras já suportadas (320/375/768/1440 px) sem modificar visual.
- Medir latência da recepção até exibição e registrar atraso do pior caso; alvo acordado para condições normais: aproximadamente 5–10 segundos.

## Fase 3 — teste de ponta a ponta

1. Validar primeiro sem WhatsApp real usando dados sintéticos.
2. Configurar ambiente Evolution de teste sem alterar webhook da instância de produção.
3. Se um teste real for necessário, usar só o número `5586981638438` autorizado pelo usuário e desabilitar qualquer envio colateral. Sem autorização para outros números.
4. Testar recebimento e confirmação de exibição automática; só enviar a mensagem de prova se o backend sandbox e o destinatário estiverem confirmados.
5. Capturar IDs técnicos, horários e resultado sem registrar segredo/API key no log.
6. O usuário testa a nova versão em sandbox e decide se aceita ou pede ajustes.

## Critérios de aceite propostos

- Frontend atual abre as quatro subvisões sem mudança visual/regressão funcional.
- Mensagem de entrada aparece automaticamente sem clique/refresh manual; o push acelera e o fallback corrige perda de evento.
- Repetições e reordenação não criam mensagens duplicadas nem apagam dados mais recentes.
- Recuperação após desconexão cobre a lacuna desde o último ponto confirmado.
- Nenhum contato/histórico é fundido por telefone/nome apenas.
- Operações de envio têm estados explícitos: pendente, confirmado, falhou ou resultado ambíguo; não duplicar em retry cego.
- Falha do serviço novo não bloqueia o backend atual durante teste paralelo.
- Logs/métricas suficientes para localizar falha sem expor credenciais ou conteúdo sensível desnecessário.

## Troca e reversão (somente após aprovação explícita)

- Preparar plano de migração e compatibilidade, backup verificado e janela de observação.
- Usar ativação por feature flag/roteamento para migrar gradualmente; preservar acesso ao backend antigo.
- Não permitir gravação dupla em fluxos de envio. Para dados, usar estratégia de leitura sombra ou sincronização controlada com chaves idempotentes.
- Definir critérios de rollback e ensaiá-los em staging antes de produção.
- A promoção a produção fica bloqueada até aprovação do usuário após os testes.
