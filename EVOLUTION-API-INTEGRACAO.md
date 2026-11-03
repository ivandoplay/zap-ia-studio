# Integração com Evolution API v2

Este projeto usa a Evolution API v2 para gerenciar as instâncias WhatsApp em nuvem. A URL configurada para o servidor é `https://pool-evolution-api-067.cloud2.pageup.dev.br` (versão verificada: 2.3.7).

## Variáveis de ambiente

- `EVOLUTION_API_URL`: URL base HTTPS da Evolution API. O código usa a URL acima como padrão.
- `EVOLUTION_API_KEY`: chave global da Evolution API. Guardar somente como segredo no ambiente (por exemplo, Vercel); nunca commitar ou enviar em chat.
- `EVOLUTION_DEFAULT_USER_ID`: titular dos nomes legados exatos `zap-ia-slot_1/2/3`; outras contas usam `zap-ia-<UUID>-slot_N`. Nunca é fallback para instância arbitrária.
- `EVOLUTION_INSTANCE_USERS`: para nomes personalizados, mapa explícito `{"nome-da-instancia":{"userId":"UUID","slotId":"slot_2"}}`. Dois nomes não podem representar o mesmo chip.
- `EVOLUTION_WEBHOOK_SECRET`: segredo independente exigido no header `x-ienvia-webhook-secret`; deve existir tanto no receptor como na configuração do webhook Evolution.
- `EVOLUTION_WEBHOOK_BASE_URL`: origem HTTPS estável do receptor (opcional). Nunca usar destino de preview protegido para eventos de produção.

## Instâncias e pareamento

A conta legada usa os nomes `zap-ia-slot_1`, `zap-ia-slot_2` e `zap-ia-slot_3`; outras contas usam nomes com o UUID do titular. No fluxo cloud, cada slot é criado com integração `WHATSAPP-BAILEYS`; o webhook recebe mensagens por `/api/evolution-webhook/webhook`.

Sessões existentes no Evolution Go não são copiadas para a Evolution API. Cada número precisa ser pareado novamente no painel, por QR ou código.

## Endpoints v2 usados

- `GET /instance/fetchInstances` e `GET /instance/connectionState/{instance}` — lista e estado.
- `POST /instance/create`, `GET /instance/connect/{instance}` e `POST /webhook/set/{instance}` — criação, pareamento e webhook.
- `POST /message/sendText/{instance}` e `POST /message/sendMedia/{instance}` — mensagens.
- `POST /chat/findContacts/{instance}`, `/chat/findMessages/{instance}` e `/chat/markMessageAsRead/{instance}` — contatos, histórico e leitura.

A confirmação HTTP da API significa que ela aceitou a solicitação, não que o WhatsApp entregou a mensagem. O CRM mantém o envio como pendente até receber confirmação/ACK.

## Segurança

Se uma chave já apareceu em código, documentação ou conversa, considere-a comprometida e rotacione-a no provedor. Configure a nova chave diretamente como `EVOLUTION_API_KEY` no ambiente de produção; não a registre em arquivos do projeto.


## Pareamento e estado do QR

No contrato da versão 2.3.7, `base64` contém a imagem do QR, `code` contém o payload cru do QR e `pairingCode` é o código numérico de pareamento (quando disponível). O painel não deve tratar `code` como código numérico; se a imagem não vier, converte o payload `code` em QR localmente. O status é consultado até a instância ficar conectada; ao conectar, QR e código deixam de ser exibidos.

## Mensagens, arquivos e confirmação

- O bridge autentica a chamada com o header `apikey`, resolve a instância pertencente à conta autorizada e usa `{ number, text }` para texto.
- Mídia é enviada como JSON com `number`, `mediatype`, `media` (URL acessível à Evolution API), `caption`, `fileName` e, quando conhecido, `mimetype`. Portanto, o armazenamento de mídia precisa gerar uma URL que o serviço consiga buscar.
- Contatos usam `contact` como array, com `fullName`, `wuid`, `phoneNumber` e `organization`. Atualização e exclusão de mensagens seguem os campos exigidos pela v2.3.7; leitura não é chamada com uma lista vazia.
- No CRM, **Sincronizar** consulta `POST /chat/findChats/{instância}` para trazer conversas existentes e importa o histórico em lotes. Em uma conversa, **Carregar histórico do WhatsApp** consulta `POST /chat/findMessages/{instância}` por páginas de até 100 registros, grava as mensagens no CRM sem incrementar não lidas e deduplica pelo ID WhatsApp. Mensagens de mídia sem URL acessível são representadas por um marcador; a importação de histórico não baixa o arquivo automaticamente.
- A Evolution só pode devolver o que já está gravado no banco dela. Conectar uma instância não garante que todo o histórico antigo do celular tenha sido sincronizado para a Evolution; disponibilidade e quantidade dependem dos dados persistidos pelo serviço.
- Webhook é configurado no formato `{ webhook: { enabled, url, byEvents, base64, events, headers } }`. Em Vercel, a URL usa o host de produção da plataforma para não gravar URL de preview como destino permanente.
- Respostas HTTP 2xx contendo `error: true`, `success: false` ou estados de falha são rejeitadas. Um envio aceito pela API fica pendente até o webhook/ACK confirmar entrega; não se deve exibi-lo como entregue apenas porque a chamada retornou sucesso.

Os contratos acima foram conferidos contra o código e os schemas da tag Evolution API v2.3.7 (`cd800f2`); versões diferentes devem ser verificadas antes de alterar payloads.


## Correções locais de 03/11/2026 — ainda não publicadas

Consulte [o relatório completo e as pendências de homologação](docs/AUDITORIA_2026-11-03.md).
A migração `20261103120000_evolution_ingress_send_safety.sql` é pré-requisito para o novo código.
O webhook recusa gravação sem banco durável ou sem autenticação; campanhas recusam envio se a trava SQL estiver indisponível.
Não aplicar código sozinho: preparar banco e segredo, configurar o header nas instâncias já pareadas e somente então realizar o rollout.
`npm test` executa a suíte isolada; `npm run test:evolution` cobre o recorte Evolution. A suíte completa permanece vermelha enquanto o release assinado estiver desatualizado.
