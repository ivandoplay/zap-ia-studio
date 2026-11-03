# Integração com Evolution API v2

Este projeto usa a Evolution API v2 para gerenciar as instâncias WhatsApp em nuvem. A URL configurada para o servidor é `https://pool-evolution-api-067.cloud2.pageup.dev.br` (versão verificada: 2.3.7).

## Variáveis de ambiente

- `EVOLUTION_API_URL`: URL base HTTPS da Evolution API. O código usa a URL acima como padrão.
- `EVOLUTION_API_KEY`: chave global da Evolution API. Guardar somente como segredo no ambiente (por exemplo, Vercel); nunca commitar ou enviar em chat.
- `EVOLUTION_DEFAULT_USER_ID`: usuário Supabase autorizado para a instância cloud única deste projeto.
- `EVOLUTION_INSTANCE_USERS`: mapa JSON opcional `{"nome-da-instancia":"user_id"}` para mapear instâncias.

## Instâncias e pareamento

O painel usa os nomes `zap-ia-slot_1`, `zap-ia-slot_2` e `zap-ia-slot_3`. No fluxo cloud, cada slot é criado com integração `WHATSAPP-BAILEYS`; o webhook recebe mensagens por `/api/evolution-webhook/webhook`.

Sessões existentes no Evolution Go não são copiadas para a Evolution API. Cada número precisa ser pareado novamente no painel, por QR ou código.

## Endpoints v2 usados

- `GET /instance/fetchInstances` e `GET /instance/connectionState/{instance}` — lista e estado.
- `POST /instance/create`, `GET /instance/connect/{instance}` e `POST /webhook/set/{instance}` — criação, pareamento e webhook.
- `POST /message/sendText/{instance}` e `POST /message/sendMedia/{instance}` — mensagens.
- `POST /chat/findContacts/{instance}`, `/chat/findMessages/{instance}` e `/chat/markMessageAsRead/{instance}` — contatos, histórico e leitura.

A confirmação HTTP da API significa que ela aceitou a solicitação, não que o WhatsApp entregou a mensagem. O CRM mantém o envio como pendente até receber confirmação/ACK.

## Campanhas com o chip na Evolution API

O motor de campanhas envia por este canal quando o chip não tem socket Baileys
neste processo. Funcionamento e diagnóstico em
[`CAMPANHAS-EVOLUTION-API.md`](CAMPANHAS-EVOLUTION-API.md). No motor local,
configure `IENVIA_CLOUD_PANEL_URL` com a URL do painel que guarda a chave.

## Segurança

Se uma chave já apareceu em código, documentação ou conversa, considere-a comprometida e rotacione-a no provedor. Configure a nova chave diretamente como `EVOLUTION_API_KEY` no ambiente de produção; não a registre em arquivos do projeto.
