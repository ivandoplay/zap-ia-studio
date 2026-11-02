# Evolution API: auditoria de cobertura e lacunas

Data da revisão: 2026-11-02. Escopo: chamadas CRM ↔ Evolution API e eventos que a aplicação assina. Nenhuma operação foi executada na instância real; esta auditoria é de código e testes locais.

## Correção de segurança incluída

`connectedInstanceForTenant()` agora exige conexão do slot gravado no `chatId` (`slot_1`, `slot_2` ou `slot_3`). Se o slot não existe ou está desconectado, a chamada falha com HTTP 503; não tenta outro chip. Isso evita envio, reação, edição, exclusão, leitura ou bloqueio no WhatsApp errado. Há teste de regressão que confirma que, com o slot 2 desconectado e o slot 1 conectado, nenhuma mensagem é enviada e o estado do slot 1 nem é consultado.

## Cobertura observada no código

| Capacidade | Situação | Observação |
|---|---|---|
| Enviar texto e mídia | Usada pelo CRM | O contrato de payload diverge da referência pública consultada. Mantido intacto até confirmar a versão efetiva do servidor; não foi feito envio de teste real. |
| Enviar contato | Usada pelo CRM | Escopo por slot e payload cobertos por testes. |
| Reagir, editar e apagar mensagem | Usadas pelo CRM | Todas agora respeitam estritamente o slot do chat. Exclusão continua explícita; nenhum teste apagou dados reais. |
| Marcar mensagem como lida | Usada pelo CRM | Lista vazia é ignorada sem chamar a API. |
| Bloquear contato | Usado pelo CRM | Ação explícita da interface; sujeito ao mesmo isolamento de slot. |
| Buscar chats e contatos | Usada para diretório/sincronização | Paginação e identificação do slot cobertas por testes. |
| Buscar histórico | Usada por rota de sincronização | A rota persiste dados no CRM e, por isso, não foi usada para diagnóstico. Paginação atual usa `page/offset`; a referência consultada usa `take/skip`, pendente confirmar contrato da instância antes de alterar. |
| Status de instância e QR/conexão | Usados pelo fluxo de conexão | Status é consultado; eventos de conexão/QR não são processados pelo handler de mensagens. |
| Diagnóstico read-only | Implementado e protegido | Não chama rotas de sincronização/persistência. |

## Eventos e endpoints ainda não aproveitados

- O webhook é configurado para `CONTACTS_UPDATE` e `CHATS_UPDATE`, mas `src/evolutionApiWebhook.js` atualmente responde `ignored: event` para eles. Existe um normalizador em `src/crmV2/evolutionEvent.js`, porém não está ligado a um consumidor persistente. Resultado: essas notificações não atualizam o CRM em tempo real; a cobertura atual de chats/contatos depende das consultas explícitas de diretório.
- Eventos de exclusão/edição de mensagens recebidos do provedor não são sincronizados para o histórico local. Não se recomenda apagar mensagens locais automaticamente; uma futura implementação deve criar tombstones/estado de edição e manter histórico auditável.
- Endpoints de perfil (nome/status/foto), presença/typing, validação de números (`whatsappNumbers`), arquivamento no WhatsApp e download/decodificação de mídia não têm ação equivalente clara no CRM atual. Não foram adicionados: alguns alterariam estado do WhatsApp e outros duplicariam dados já disponíveis nas consultas de contato/mensagem.
- O arquivamento existente do CRM é local. Não foi acoplado ao `archiveChat` do WhatsApp para não mudar o estado real da conta sem decisão funcional explícita.

## Divergências de contrato a validar antes de mudar

A referência pública de Evolution API consultada descreve `textMessage.text` para envio de texto e mídia em multipart; o código atual usa `text` e mídia JSON com URL. A mesma referência documenta paginação de `findMessages` por `take/skip`, enquanto o código usa `page/offset`. Como não foi confirmada a versão/compatibilidade da instância conectada, nenhum desses contratos foi trocado e nenhuma chamada real foi feita. Antes da mudança, comparar a OpenAPI da instância/versão efetiva ou validar com conta de teste isolada.

## Arquivos relacionados

- `src/evolutionApiCloud.js` — cliente HTTP, escopo por slot e endpoints usados.
- `src/evolutionApiWebhook.js` — webhook de mensagens e confirmações; demais eventos são ignorados.
- `src/crmV2/evolutionEvent.js` — normalizador existente ainda sem consumidor persistente.
- `tests/evolution-api-cloud.test.mjs` — contratos e regressão de isolamento de chip.
