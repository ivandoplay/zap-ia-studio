# Contratos de API observados — Ienvia

Este documento registra caminhos extraídos diretamente dos consumidores do painel legado e dos routers atuais. Caminhos dinâmicos estão representados com placeholders. A presença de uma chamada no frontend não significa que ela esteja habilitada em todos os ambientes ou permissões.

## 1. Consumidores do frontend legado

Arquivos analisados:

- `public/app.js` — 10.469 linhas, aproximadamente 466 KB.
- `public/campanhas.js` — aproximadamente 25,6 KB.
- `public/inbox-realtime.js` — aproximadamente 212 KB.

O `public/app.js` contém chamadas para pelo menos estes grupos:

### Sessão e inicialização

- `/api/auth/status`
- `/api/auth/login`
- `/api/auth/refresh`
- `/api/auth/logout`
- `/api/auth/verify-pin`
- `/api/auth/change-password`
- `/api/bootstrap`
- `/api/cloud/poll`
- `/api/cloud/realtime-config`
- `/api/cloud/commands/:id/status)

### Operação e configurações

- `/api/business`
- `/api/business/system-prompt`
- `/api/business/apply-template`
- `/api/business/catalog/*`
- `/api/business/knowledge-upload`
- `/api/settings`
- `/api/ai/test`
- `/api/simulator/send`
- `/api/simulator/reset`
- `/api/simulator/teach`

### WhatsApp e canais

- `/api/wa/connect`
- `/api/wa/disconnect`
- `/api/wa/slot-config`
- `/api/wa/device-rename`
- `/api/wa/sync-history`
- `/api/wa/toggle-bot`
- `/api/wa/test-owner-alert`
- `/api/wa/proactive-queue/*`
- `/api/wa/proactive-send`
- `/api/evolution-cloud/status`
- `/api/evolution-cloud/connect`
- `/api/evolution-cloud/disconnect`
- `/api/evolution-cloud/refresh-qr`

### CRM e conversas legadas

O consumidor legado inclui operações sob `/api/crm/*`, entre elas:

- diretório de contatos, novo contato, etiquetas e respostas rápidas;
- envio de texto, mídia, áudio, PIX, cartão de contato e itens da biblioteca;
- histórico, marcação de lida/não lida, arquivar, fixar, bloquear e limpar mensagens;
- notas internas, tarefas, agendamento de mensagem, pausa/retomada e sugestões de resposta;
- ações em lote e ações sobre mensagens específicas.

Os caminhos dinâmicos e métodos devem ser levantados no código consumidor antes de cada migração, pois a mesma rota base pode ter mais de uma operação.

### Treinamento e biblioteca de mídia

- `/api/training-packs/:id`
- `/api/training-packs/:id/full`
- `/api/training-packs/:id/messages`
- `/api/training-packs/:id/skills`
- `/api/training-packs/import-text`
- `/api/training-packs/import-zip`
- `/api/voice-library`
- `/api/voice-library/:id`
- `/api/voice-library/transcribe`
- `/api/voice-library/:id/toggle`

### Campanhas legadas

O arquivo `public/campanhas.js` consome:

- `/api/campaigns`
- `/api/campaigns/:id`
- `/api/campaigns/:id/recipients`
- `/api/campaigns/folders`
- `/api/campaigns/folders/:folderId/files`
- `/api/campaigns/import-preview`

## 2. Routers de módulos novos registrados em src/server.js

Os routers abaixo foram inspecionados. Seus caminhos são relativos ao prefixo indicado:

### Dashboard — `/api/dashboard`

- `GET /summary`
- `GET /appearance`
- `PUT /appearance`

### Conexões — `/api/connections`

- `GET /configuration`
- `GET /pairing`
- `GET /summary`

### Canais — `/api/channels`

- `GET /`
- `GET /:id/threads`
- `GET /:id/threads/:threadId/messages`
- `GET /:id/dispatches/:requestId`
- `POST /:id/dispatches/:requestId/review`
- `GET /:id/execution`
- `POST /:id/pairing`
- `POST /:id/executor`
- `GET /:id/legacy-link`
- `POST /`
- `PATCH /:id`

### Conversas V3 — `/api/conversations-v3`

- `GET /instances`
- `GET /instances/:instanceId/threads`
- `GET /instances/:instanceId/threads/:threadId/messages`

Comandos registrados no router complementar:

- `POST /instances/:instanceId/threads/:threadKey/messages`
- `POST /instances/:instanceId/threads/:threadKey/media`
- `POST /instances/:instanceId/threads/:threadKey/read`
- `PATCH /instances/:instanceId/threads/:threadKey`
- `POST /instances/:instanceId/threads/:threadKey/notes`
- `POST /instances/:instanceId/threads/:threadKey/pause`
- `POST /instances/:instanceId/threads/:threadKey/resume`
- `PATCH /instances/:instanceId/threads/:threadKey/profile`

### CRM — `/api/crm-v2`

- `GET /tags`, `PATCH /tags`
- `GET /quick-replies`, `PATCH /quick-replies`
- `GET /contacts`, `GET /contacts/:id`, `POST /contacts`, `PATCH /contacts/:id`
- `GET /threads/:id/profile`, `PATCH /threads/:id/profile`

### Campanhas V2 — `/api/campaigns-v2`

Rotas observadas incluem rascunhos, destinatários, importação, pastas e arquivos:

- `GET /drafts`, `GET /drafts/:id`, `GET /drafts/:id/recipients`
- `POST /drafts`, `PUT /drafts/:id`
- `POST /drafts/:id/recipients/:recipientId/remove`
- `POST /import-preview`
- `GET /folders`, `GET /folders/:folderId/files`, `POST /folders`

### Outros módulos

Os seguintes routers estão montados, mas seus contratos completos ainda precisam ser extraídos individualmente:

- `/api/accounts-v2`
- `/api/security-settings-v2`
- `/api/ai-settings-v2`
- `/api/simulator-v2`
- `/api/resources-v2`
- `/api/training-v2`
- `/api/evolution-cloud`

## 3. Observações importantes para a migração

1. Existem duas gerações de contratos: APIs legadas ainda consumidas pelo painel e routers V2/V3 mais novos. Não trocar uma pela outra sem verificar paridade funcional e estado de dados.
2. O CRM V2 trabalha com projeções e registros salvos específicos; o painel legado também chama operações CRM antigas. A migração da Inbox precisa manter histórico, envio e ações do mesmo tenant, sem misturar identificadores de thread, contato e instância.
3. Campanhas legadas e V2 possuem contratos distintos. A migração deve preservar rascunhos, importação, mídia, agendamento e as restrições de execução configuradas no backend.
4. Canais e conexões possuem operações de pareamento e executor com controle de permissões. A UI não deve inferir que um canal está pronto apenas por ter registro salvo.
5. O mapa estático acima é ponto de partida. Para cada tela migrada, documentar método, payload, resposta, erros, permissões, limites, idempotência e comportamento em modo local versus Vercel.
