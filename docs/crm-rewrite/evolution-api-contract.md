# Evolution API — referência pública relevante para o CRM

**Verificado em:** 2026-11-02.  
**Versão declarada nos OpenAPI públicos consultados:** `2.3.7` (OpenAPI `3.0.4`).  
**Limite importante:** isso descreve a documentação pública consultada; a versão e os recursos efetivamente instalados no ambiente do projeto ainda precisam ser confirmados. Não se deve inferir que a instância em uso roda exatamente `2.3.7`.

## Fontes oficiais consultadas

- [Índice da documentação](https://docs.evolutionfoundation.com.br/llms.txt)
- [Visão geral](https://docs.evolutionfoundation.com.br/evolution-api/index.md)
- [Variáveis de ambiente](https://docs.evolutionfoundation.com.br/evolution-api/configuration/env.md)
- [Configuração de webhooks](https://docs.evolutionfoundation.com.br/evolution-api/configuration/webhooks.md)
- [WebSocket](https://docs.evolutionfoundation.com.br/evolution-api/integrations/websocket.md)
- [Find chats](https://docs.evolutionfoundation.com.br/evolution-api/find-chats.md)
- [Find contacts](https://docs.evolutionfoundation.com.br/evolution-api/find-contacts.md)
- [Find messages](https://docs.evolutionfoundation.com.br/evolution-api/find-messages.md)
- [Send text](https://docs.evolutionfoundation.com.br/evolution-api/send-text-message.md)
- [Send media](https://docs.evolutionfoundation.com.br/evolution-api/send-media-message.md)
- [Mark as read](https://docs.evolutionfoundation.com.br/evolution-api/mark-message-as-read.md)
- [Set/get webhook](https://docs.evolutionfoundation.com.br/evolution-api/set-webhook.md) · [Get webhook](https://docs.evolutionfoundation.com.br/evolution-api/get-webhook.md)
- [Connection state](https://docs.evolutionfoundation.com.br/evolution-api/get-connection-state.md) · [Fetch instances](https://docs.evolutionfoundation.com.br/evolution-api/fetch-all-instances.md)
- OpenAPI público: [chat.yaml](https://docs.evolutionfoundation.com.br/api-reference/openapi/Evolution-API/chat.yaml)

## Autenticação e estado da instância

A referência documenta autenticação por `apikey` no cabeçalho. A consulta `GET /instance/connectionState/{instanceName}` retorna estado `open`, `close` ou `connecting`. `GET /instance/fetchInstances` lista instâncias, mas a própria configuração documentada permite limitar a exposição dessas instâncias. A nova integração não deve pressupor que qualquer chave global possa enumerá-las.

## Operações usadas pelo CRM

| Finalidade | Operação documentada | Observação |
|---|---|---|
| Consultar conversas | `POST /chat/findChats/{instanceName}` | A consulta aceita filtros e paginação (`where`, `take`, `skip`, `orderBy`). |
| Consultar contatos | `POST /chat/findContacts/{instanceName}` | Campos documentados incluem `id`, `pushName`, `number` e `profilePictureUrl`. |
| Recuperar mensagens | `POST /chat/findMessages/{instanceName}` | Retorno paginado em `messages`, com `total`, `pages`, `currentPage` e `records`; inclui `key`, `message`, `messageType`, `fromMe` e `timestamp`. |
| Enviar texto | `POST /message/sendText/{instanceName}` | A página pública descreve `number` e `textMessage: { text }`. A forma exata deve ser validada contra a instalação conectada. |
| Enviar mídia | `POST /message/sendMedia/{instanceName}` | O OpenAPI público descreve `multipart/form-data` com `number`, `mediatype`, arquivo `media`, e campos opcionais `caption` e `fileName`. |
| Marcar mensagem lida | `POST /chat/markMessageAsRead/{instanceName}` | Validar formato de chave/identificador exigido pela instância. |
| Consultar conexão | `GET /instance/connectionState/{instanceName}` | Não confundir estado de conexão com disponibilidade do backend CRM. |
| Consultar webhook | `GET /webhook/find/{instanceName}` | A configuração pode ser nula se não houver webhook. |
| Configurar webhook | `POST /webhook/set/{instanceName}` | Deve ser operação controlada, validada e auditada; não alterar configuração em produção sem plano aprovado. |

## Eventos relevantes

A documentação de webhooks enumera eventos como `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `MESSAGES_EDITED`, `MESSAGES_DELETE`, `SEND_MESSAGE`, `CONTACTS_SET`, `CONTACTS_UPSERT`, `CONTACTS_UPDATE`, `CHATS_SET`, `CHATS_UPSERT`, `CHATS_UPDATE`, `CHATS_DELETE` e `CONNECTION_UPDATE`. O catálogo também inclui eventos de presença, grupos, etiquetas e erros.

Para o CRM, o processamento deve distinguir pelo menos:

1. mensagem nova recebida/enviada;
2. atualização de status/recibo;
3. edição ou remoção;
4. atualização do chat e do contato;
5. evento de conexão;
6. lote de sincronização inicial (`*_SET`) versus evento incremental (`*_UPSERT`/`*_UPDATE`).

Não tratar qualquer evento como prova de entrega exatamente uma vez: webhooks e reconexões podem repetir ou reordenar notificações. A ingestão deve ser idempotente e o estado persistido deve ser reconciliável.

## Tempo real e recuperação

A documentação de WebSocket informa transporte Socket.IO e opção de eventos globais ou por instância. Ela indica `WEBSOCKET_ENABLED=true` e, para eventos globais, `WEBSOCKET_GLOBAL_EVENTS=true`; existe também configuração por instância em `/websocket/set/{instanceName}`. No ambiente do projeto, a opção mais apropriada entre webhook e WebSocket depende do que a instância realmente suporta e de como é possível expor o receptor de forma segura.

Estratégia recomendada:

- **Push:** receber evento, validar origem/instância e persistir primeiro; só então notificar o CRM.
- **UI:** publicar uma notificação pequena de alteração (não confiar no payload do fornecedor como estado final) e recarregar os dados canônicos pela API do CRM.
- **Recuperação:** após reconexão, evento perdido ou lacuna de cursor, buscar conversas/mensagens incrementalmente, com sobreposição temporal e deduplicação por identidade do provedor.
- **Reconciliação:** periodicamente conferir dados recentes e sinalizar falhas, sem depender de um refresh manual do atendente.

## Divergências que precisam de prova de contrato

A inspeção do código atual encontrou formatos que não coincidem literalmente com o OpenAPI público consultado:

- `src/evolutionApiCloud.js` envia texto com campo `text`; a página pública atual descreve `textMessage: { text }`.
- O código atual consulta histórico usando `page`/`offset`; a referência `findMessages` descreve paginação por `take`/`skip` e retorno paginado em `messages.records`.
- O envio atual de mídia usa estrutura JSON com mídia por URL/base64 em alguns fluxos; o OpenAPI público consultado descreve multipart com arquivo.

Essas diferenças **não provam por si só que o código está errado**: versões, providers (Baileys/Cloud API), opções do servidor e exemplos de documentação podem divergir. Antes de reimplementar, registrar a versão da instância e executar testes de contrato não destrutivos em ambiente isolado. Não mudar payload de produção por inferência documental.

## Fontes

As rotas, campos e configurações acima foram resumidos das páginas oficiais vinculadas. Em caso de divergência, prevalecem a versão efetivamente instalada e os testes de contrato aprovados para esse ambiente; registrar a divergência em vez de ocultá-la.
