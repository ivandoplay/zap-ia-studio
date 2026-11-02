# Proposta de arquitetura — backend do CRM

**Estado:** desenho inicial para revisão; ainda não implementado.  
**Restrição central:** preservar o visual e os fluxos do frontend como padrão, mantendo os formatos de resposta/rotas sempre que viável. O usuário autorizou alterações de frontend se necessárias para o melhor resultado; mudanças perceptíveis devem ser justificadas e validadas antes da troca.

## Inventário observado no frontend atual

A aba CRM tem quatro subvisões: **Inbox**, **Contatos**, **Kanban** e **Coach**. O backend também sustenta mensagens e anexos, contatos e exportação, tags, ações em lote, tarefas, notas internas, agendamento, marcação de lida/não lida, arquivar/fixar/ignorar/bloquear, envio e encaminhamento, reações/edições/remoções, busca de histórico, follow-ups e sugestões/coach. O inventário de rotas está em `src/server.js`; o contrato que a UI consome está em `public/app.js`.

Rotas atuais observadas incluem `/api/crm/contact-directory`, `/api/crm/:chatId` e subrotas de mensagens, tarefas, notas, agenda, envio, histórico, tags, operações em lote, exportações e `/api/wa/sync-history`. Antes da implementação, extrair uma matriz completa de método + rota + payload + resposta + efeito persistido; este resumo não substitui essa matriz.

## Estado atual relevante (não assumir que tempo real inexiste)

O frontend já possui um caminho de atualização híbrido parcial:

- `public/inbox-realtime.js` assina mudanças de `zapia_contacts` no Supabase Realtime por usuário;
- ao receber uma notificação, o browser antecipa um `GET /api/cloud/poll` e renderiza a lista;
- `startCloudPoller()` também mantém polling de contingência (aproximadamente a cada 3,5 s em aba visível, com variação de estado/visibilidade);
- o endpoint `/api/cloud/poll` retorna um snapshot de contatos, estado WhatsApp e estatísticas.

Logo, a tarefa não é simplesmente “adicionar WebSocket ao frontend”. A investigação deve descobrir onde a cadeia atual falha: Evolution → webhook/worker → persistência canônica → publicação Supabase Realtime → refresh/autenticação → merge e renderização. A reescrita deve tornar a fonte de verdade e os estados de entrega explícitos, preservando a compatibilidade do frontend.

## Componentes propostos

**Protótipo já iniciado (worktree isolada, sem ligação ao servidor atual):** `src/crmV2/evolutionEvent.js` normaliza variantes de webhook e constrói chave de deduplicação; `src/crmV2/eventIngress.js` define a fronteira tenant → persistência idempotente/outbox. O adapter durável é uma interface ainda não implementada; esses módulos não recebem tráfego e não alteram banco.

1. **Evolution adapter** — cliente único com timeout, retry limitado, validação de resposta, normalização de erros, logs sem segredos e contrato por versão/provider. Status de conexão não deve bloquear a leitura de mensagens/contatos: cache e timeout separados para o snapshot CRM.
2. **Event ingress** — endpoint/receptor de webhook ou consumidor Socket.IO, validação de assinatura/segredo conforme suportado, allowlist de eventos, limite de tamanho e ACK rápido após persistência durável.
3. **Normalizer** — transforma payloads Baileys/Cloud API em eventos internos versionados, mantendo `raw` redigido/limitado somente quando necessário para diagnóstico.
4. **CRM domain services** — operações de conversas, mensagens, contatos, metadados comerciais e tarefas. Separar efeitos externos (Evolution) de transações do banco.
5. **Repository/persistence** — transações, constraints de unicidade e migrações explícitas; preservar linhas existentes e relacionamentos. Adotar uma fonte de verdade definida por entidade.
6. **Outbox/dispatcher** — registrar notificações de mudança na mesma transação dos dados; publicar para o canal de atualização depois do commit, com retry e marcação de entrega.
7. **Realtime notifier** — usar o canal que o frontend já suporta, se ele for confiável no projeto; a primeira mensagem da notificação só sinaliza qual entidade mudou. Se for necessário trocar transporte de browser, isso fica para proposta e aprovação separada, pois altera frontend.
8. **Reconciler** — tarefas incrementais e retomáveis para mensagens/chats, usando paginação suportada pela versão instalada, watermark com sobreposição e deduplicação. Executar também após reinício/reconexão.
9. **Compatibility API** — manter rotas e DTOs existentes enquanto o frontend não muda. Validar cada rota por snapshot/contract test.
10. **Observabilidade** — métricas de atraso do evento, fila pendente, falhas/retry, último cursor reconciliado e status da Evolution; correlation ID sem dados pessoais desnecessários.

## Identidade e preservação de dados

- Identificador de mensagem: identidade técnica do provedor, no mínimo account/instância + `key.id` ou equivalente; não deduplicar por texto ou timestamp.
- Identidade de chat/contato: namespace de conta/slot/instância + identificador canônico do canal (por exemplo, JID). Telefone normalizado pode servir como índice de busca ou alias, mas não como prova suficiente para fundir registros.
- `pushName`, nome de exibição e telefone são atributos mutáveis, não chaves primárias.
- Duplicatas existentes não serão silenciosamente fundidas. Preservar histórico e relações; qualquer merge aprovado deve registrar IDs de origem/destino, motivo, operador e reversibilidade.
- Mensagem sem conteúdo decodificável permanece preservada como payload tipado/mídia, não descartada.

## Sequência do fluxo de uma mensagem

1. Evolution envia evento.
2. Ingress valida instância/evento, calcula chave idempotente e persiste evento/atualização na transação.
3. Normalizer atualiza mensagem, chat e resumo de contato sem sobrescrever campos comerciais locais indevidamente.
4. Outbox recebe notificação de alteração na mesma transação.
5. Dispatcher publica uma notificação para o usuário/tenant autorizado.
6. Browser refaz leitura canônica pela API já existente; se a notificação se perder, o reconciler e o polling de segurança corrigem o estado.
7. Métricas registram o atraso ponta a ponta.

## Contratos e compatibilidade

- Antes de criar tabelas/rotas novas, capturar os contratos atuais consumidos por `public/app.js` e reproduzi-los em testes.
- A camada de domínio nova pode conviver com adapters antigos temporariamente; evitar renomear IDs usados por deep links, tarefas e Kanban.
- O frontend deve continuar funcionando quando o canal realtime estiver desconectado: endpoints REST e sincronização de recuperação são suficientes para corrigir o estado.
- Se a UI atual depender de detalhes inconsistentes do backend, criar uma camada adapter em vez de propagar o legado para o novo domínio.

## Implantação em paralelo

1. Mapear modelo de dados/contratos e verificar versão/provider Evolution.
2. Construir backend isolado com schema/namespace separado e dados sintéticos ou cópia anonimizada.
3. Executar testes unitários, contratos, fluxos Playwright e carga básica sem tocar produção.
4. Fazer teste de ponta a ponta com o número autorizado somente quando o endpoint de teste estiver isolado e a mensagem de teste acordada.
5. Comparar comportamento novo/atual em modo sombra, sem duplicar envios.
6. Permitir teste do usuário.
7. Só após aprovação explícita planejar migração compatível e reversível; não trocar o serviço em produção automaticamente.
