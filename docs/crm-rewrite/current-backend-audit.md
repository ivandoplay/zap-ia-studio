# Auditoria estática inicial do backend CRM atual

**Data:** 2026-11-02.  
**Tipo de evidência:** leitura do código local em `d8c35d4`; não houve chamada autenticada à Evolution, consulta/escrita no banco, recebimento de webhook ou teste de produção nesta auditoria. Portanto, os itens abaixo são achados estáticos e hipóteses de falha, não diagnóstico confirmado do ambiente ao vivo.

## Mapa inicial de rotas CRM

A UI chama rotas em `public/app.js`; as implementações ficam principalmente em `src/server.js`.

| Grupo | Rotas observadas |
|---|---|
| Inbox/contatos | `GET /api/crm/contact-directory`, `POST /api/crm/new-contact`, `PUT /api/crm/:chatId`, `DELETE /api/crm/:chatId`, `POST /api/crm/bulk-action` |
| Exportação/importação | `GET /api/crm/export.csv`, `GET /api/crm/contacts.vcf`, `GET /api/crm/:chatId/vcard.vcf`, `GET /api/crm/:chatId/export.txt` |
| Tags | `GET /api/crm/tags`, `POST /api/crm/tags`, `DELETE /api/crm/tags/:tagId` |
| Conversa e estado | `POST /api/crm/:chatId/clear-messages`, `/block`, `/mark-read`, `/mark-unread`, `/toggle-ignore`, `/archive`, `/pin`, `/pause`, `/resume` |
| Ações comerciais | `POST /api/crm/:chatId/tasks`, `PATCH/DELETE /api/crm/:chatId/tasks/:taskId`, `POST /api/crm/:chatId/internal-note`, `DELETE /api/crm/:chatId/internal-note/:noteId`, `POST /api/crm/:chatId/schedule-message`, `DELETE /api/crm/:chatId/schedule-message/:schedId` |
| Mensagens | `POST /api/crm/:chatId/send` e `/reply`, `/send-item`, `/send-pix`, `/send-attachment`, `/send-audio`, `/send-library-voice`, `/send-vcard`, `POST /api/crm/:chatId/messages/:msgId/react`, `PUT/DELETE /api/crm/:chatId/messages/:msgId`, `POST /api/crm/:chatId/messages/:msgId/forward`, `POST /api/crm/:chatId/fetch-history` |
| IA/automação | `POST /api/crm/:chatId/suggest-reply`, `POST /api/crm/check-followups`, `POST /api/crm/funnel-coach`, `POST /api/crm/demo-seed` |
| Sincronização adicional | `POST /api/wa/sync-history` |

Inventário de nomes/métodos concluído para as rotas explícitas; faltam registrar, por rota, payload, permissões, códigos de resposta, efeitos na persistência e política de side effects. `demo-seed` é dado de demonstração e deve ficar bloqueado em testes reais.

## Caminho atual de uma mensagem recebida

1. `src/evolutionApiCloud.js` configura webhook por instância com `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, `SEND_MESSAGE`, `CONTACTS_UPDATE` e `CHATS_UPDATE`, entre alguns eventos de conexão.
2. A rota pública é montada em `/api/evolution-webhook/webhook` antes do middleware de autenticação comum. No código observado, não há validação de assinatura/token do webhook; o roteamento de tenant usa `EVOLUTION_INSTANCE_USERS` ou `EVOLUTION_DEFAULT_USER_ID`.
3. `src/evolutionApiWebhook.js` resolve evento/contato, carrega histórico de `zapia_contacts`, e, para mensagem recebida com IA ligada, chama geração de IA e pode enviar resposta antes de salvar a mensagem recebida com `saveHistory`.
4. `saveHistory` lê o JSON do contato, mescla mensagens e faz upsert do mesmo registro `zapia_contacts`. O upsert gera a alteração que pode acionar Supabase Realtime.
5. `public/inbox-realtime.js` assina `postgres_changes` na tabela `zapia_contacts` filtrada pelo usuário. A notificação apenas dispara evento no browser; o browser busca o snapshot autenticado via `/api/cloud/poll`.
6. O browser também faz polling periódico e re-renderiza quando `refreshLiveStateOnly()` recebe o snapshot. Erros de refresh são engolidos (`catch {}`), sem indicação visível de atraso/falha.

## Checagens read-only do ambiente conectado

- A configuração Vercel de produção contém as variáveis necessárias para o roteamento do webhook Evolution. Os valores de credenciais não foram abertos nem utilizados nesta checagem.
- Consultas somente de metadados ao Supabase confirmaram que `zapia_contacts` possui chave primária composta `(user_id, chat_id)`, RLS ativo com política por usuário ativo, e está incluída na publicação `supabase_realtime`. Isso afasta, como hipótese geral, a ausência da publicação ou de RLS na tabela; ainda não comprova que uma instância específica está inscrita/recebendo eventos.
- A linha de contato mantém o histórico em `data` JSONB; `zapia_workspaces` guarda configurações e dados do workspace também em JSONB. Nenhuma linha de cliente foi consultada nesta etapa.
- Testes de browser/realtime existentes, executados com a flag obrigatória de isolamento, confirmam que um sinal sintético antecipa o poll e que a sessão realtime é encerrada ao trocar o contexto. Isso valida o mecanismo do browser em cenário simulado, não a cadeia real Supabase → endpoint → Evolution.

## Candidatos prioritários para o atraso/perda observado

### A. Persistência ocorre depois da IA e do envio da resposta

No ramo de mensagem recebida, `saveHistory` é chamado depois de carregar/gerar resposta, enviar resposta quando aplicável e montar o histórico. Assim, o evento pode não aparecer no Supabase Realtime até essa cadeia terminar. Se a geração/envio lançar erro, o `catch` responde HTTP 200 com `ok:false` sem salvar a mensagem recebida naquele caminho. Isso pode explicar atraso e, em alguns erros, perda da mensagem na projeção CRM. **Impacto provável alto; precisa teste de sandbox.**

### B. Poll de contatos espera consulta externa de estado Evolution

`GET /api/cloud/poll` aguarda `mergeEvolutionApiStatus()`. Em cloud, essa função consulta a lista de instâncias e estados de conexão da Evolution; as chamadas fazem `fetch` sem `AbortSignal`/timeout nesta camada e a leitura de estado é sequencial. O browser só substitui/renderiza `state.contacts` depois que `/api/cloud/poll` termina; qualquer erro de fetch também cai em `catch {}` no browser. Portanto, uma Evolution lenta pode atrasar/bloquear justamente o refresh disparado pelo evento de banco. **Candidato prioritário e diretamente observável no código; não comprovado ao vivo.**

### C. Persistência direta e sincronização do worker são caminhos concorrentes

O webhook grava diretamente em `zapia_contacts`; o sync do worker em `src/supabaseCloud.js` faz read/merge/upsert com união de mensagens para conciliar dispositivos. O caminho do webhook lê o JSON e grava o registro diretamente, fora desse reconciliador. Escritas simultâneas de webhook, worker e ações CRM podem perder atualizações de campos ou mensagens por read-modify-write concorrente. Requer reprodução determinística com falhas simuladas antes de declarar perda real.

### D. Cobertura de eventos é parcial e não idempotente de ponta a ponta

O `EVENTS` configurado não inclui os eventos de edição/remoção de mensagem nem `CONTACTS_UPSERT`, `CONTACTS_SET`, `CHATS_UPSERT`, `CHATS_SET` ou `CHATS_DELETE`. O handler só persiste alguns eventos. A documentação pública lista mais eventos úteis ao CRM. Além disso, a rota trata falhas de processamento como resposta HTTP 200 em alguns caminhos, o que pode impedir retry automático pelo fornecedor.

### E. Histórico salvo no webhook é limitado e usa atualização read-modify-write

`saveHistory` conserva no máximo 120 mensagens na matriz do JSONB. Isso não deve ser tomado como política aceitável para preservar histórico completo; é preciso mapear o armazenamento oficial do histórico e planejar backfill/migração sem descartar mensagens antigas. A operação também lê e depois sobrescreve `data`, sem transação/lock no código desse módulo.

## Próximos testes isolados recomendados

1. **Latência:** simular Evolution `connectionState` lenta e medir se o snapshot de contatos fica bloqueado no endpoint de poll. O teste não usa credenciais nem WhatsApp real.
2. **Webhook:** alimentar payload sintético de `MESSAGES_UPSERT` com IA lenta, IA falhando e resposta do provider falhando; confirmar se a mensagem recebida já fica persistida antes de qualquer efeito posterior.
3. **Concorrência:** intercalar duas gravações no mesmo contato (evento webhook + tarefa/etapa CRM) para verificar perda de campos; testar deduplicação por ID técnico.
4. **Eventos:** verificar payloads sintéticos para edição, remoção, recibo, contato e chat; tratar tipos não suportados de modo observável.
5. **Canal realtime:** simular falha de inscrição/perda de evento e provar que a reconciliação REST recupera o estado dentro do alvo de 5–10 segundos, sem depender do status remoto da Evolution.

Não alterar a configuração do webhook da instância real para esses testes. Primeiro construir testes com stubs/fixtures e ambiente isolado.
