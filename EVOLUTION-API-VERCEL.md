# Configurar Evolution API v2 na Vercel

## Variáveis do projeto

Abra [Vercel → zap-ia-studio → Environment Variables](https://vercel.com/ivandoplays-projects/zap-ia-studio/settings/environment-variables) e configure:

| Nome | Valor | Tipo |
|---|---|---|
| `EVOLUTION_API_URL` | `https://pool-evolution-api-067.cloud2.pageup.dev.br` | Texto |
| `EVOLUTION_API_KEY` | Chave global emitida pela Evolution API v2 | Sensível/criptografado |
| `EVOLUTION_WEBHOOK_SECRET` | Segredo independente; registrar também no header do webhook Evolution | Sensível/criptografado |
| `EVOLUTION_WEBHOOK_BASE_URL` | Origem HTTPS estável do receptor, opcional | Texto |

Selecione **Production**. Use **Preview** apenas com banco, instância e segredos próprios de homologação; não conecte previews à instância de produção. Não copie a chave para este documento, código, issues ou chat.

Preserve `EVOLUTION_DEFAULT_USER_ID` para os nomes legados exatos. Outras contas usam UUID no nome. Nomes personalizados exigem `EVOLUTION_INSTANCE_USERS` com `userId` e `slotId` explícitos; nomes desconhecidos são recusados.

## Ativar

**Pré-requisito do código auditado em 03/11/2026:** aplicar e homologar a migração `20261103120000_evolution_ingress_send_safety.sql`, configurar o segredo e o header nas instâncias já existentes. Consulte [a auditoria](docs/AUDITORIA_2026-11-03.md). Não desconecte nem repareie instâncias já conectadas apenas para atualizar o webhook.

Variáveis novas ou alteradas só entram em vigor em um deployment novo. Faça o deployment apenas quando a migração do código estiver pronta. Depois, confira `/api/evolution-webhook/health` e, já autenticado no painel, o estado dos slots.

## Parear os números

A sessão do Evolution Go não migra. Após a atualização, conecte cada número pelo painel e escaneie o QR (ou use o código de pareamento). Só faça o teste de mensagem entre números que você controla.
