# Configurar Evolution API v2 na Vercel

## Variáveis do projeto

Abra [Vercel → zap-ia-studio → Environment Variables](https://vercel.com/ivandoplays-projects/zap-ia-studio/settings/environment-variables) e configure:

| Nome | Valor | Tipo |
|---|---|---|
| `EVOLUTION_API_URL` | `https://pool-evolution-api-067.cloud2.pageup.dev.br` | Texto |
| `EVOLUTION_API_KEY` | Chave global emitida pela Evolution API v2 | Sensível/criptografado |

Selecione **Production** e **Preview**. Não copie a chave para este documento, código, issues ou chat.

O backend também precisa da variável existente `EVOLUTION_DEFAULT_USER_ID`, que restringe o uso cloud à conta configurada. Não remova essa proteção.

## Ativar

Variáveis novas ou alteradas só entram em vigor em um deployment novo. Faça o deployment apenas quando a migração do código estiver pronta. Depois, confira `/api/evolution-webhook/health` e, já autenticado no painel, o estado dos slots.

## Parear os números

A sessão do Evolution Go não migra. Após a atualização, conecte cada número pelo painel e escaneie o QR (ou use o código de pareamento). Só faça o teste de mensagem entre números que você controla.
