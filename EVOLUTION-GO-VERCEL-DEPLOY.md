# Evolution Go Webhook — Deploy no Vercel (grátis)

A maneira mais barata de integrar o Evolution Go ao Ienvia Motor: o webhook server vira uma **rota do motor no Vercel** — sem VPS, sem cartão, sem servidor.

## URL do webhook

```
https://zap-ia-studio.vercel.app/api/evolution-webhook/webhook
```

## O que roda onde

| Componente | Onde | Custo |
|---|---|---|
| Ienvia Motor (painel, IA, webhook) | Vercel | grátis |
| WhatsApp + webhook delivery | Evolution Go (PageUp) | R$ 9,90/mês |
| Dados (business, settings, histórico) | Supabase | grátis |

## Passo 1: Configurar variáveis de ambiente no Vercel

Painel Vercel → Projeto → Settings → Environment Variables (ou via API `POST /v9/projects/{id}/env?upsert=true` com array de objetos `[{"key","value","type":"plain","target":["production"]}]`):

```
EVOLUTION_GO_URL=https://pool-evolution-go-025.cloud2.pageup.dev.br
EVOLUTION_GO_API_KEY=de641771b68731fb4340696241bd2cd6
EVOLUTION_INSTANCE_USERS={"ienvia-teste-06a36777":"28f17e53-1ab8-4ec7-8556-666df0d4add6","ienvia-teste-9ef7cfdd":"28f17e53-1ab8-4ec7-8556-666df0d4add6"}
EVOLUTION_DEFAULT_USER_ID=28f17e53-1ab8-4ec7-8556-666df0d4add6
```

> **Obs:** o `EVOLUTION_INSTANCE_USERS` é um JSON mapeando o **nome da instância** do Evolution Go ao **user_id do Supabase** (do usuário/empresa). Use `EVOLUTION_DEFAULT_USER_ID` para um único usuário.
> `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já estão configurados no projeto (o motor usa).
>
> **Importante:** após mudar env vars no Vercel, faça um **redeploy** (novo push no Git ou "Redeploy" no painel) — o serverless só lê as env vars atualizadas no deployment novo. Verifique com `GET /api/evolution-webhook/status` (mostra `instances` populado).

## Passo 2: Deploy

O deploy é **automático** ao fazer push no GitHub (o projeto Vercel já está conectado). Para deploy manual:

```bash
vercel deploy --prod
```

Ou no painel Vercel: Deployments → *Deploy*.

> **Dica:** commits cujo autor não é uma conta Git reconhecida (ex.: e-mail de estudante) ficam **BLOCKED** no Vercel. Faça commits com o autor GitHub (`git config user.name`/`user.email`) — caso contrário, faça rebase para corrigir o autor e force-push.

## Passo 3: Configurar a webhook URL no Evolution Go

```bash
./scripts/evolution-setup.sh https://zap-ia-studio.vercel.app/api/evolution-webhook/webhook
```

(O script configura a webhookUrl em todas as instâncias conectadas.)

> **ANTI-LOOP:** se você tem 2 instâncias (ex.: número pessoal + número business) e só quer que o **business** responda, remova o webhook da instância cliente:
> ```bash
> # Reconectar a instância cliente com webhookUrl vazio
> curl -X POST https://pool-evolution-go-025.cloud2.pageup.dev.br/instance/connect \
>   -H "apikey: <token_da_instância_cliente>" -H "Content-Type: application/json" \
>   -d '{"instance":"<nome_instância_cliente>","webhookUrl":"","events":""}'
> ```
> Se ambas tiverem webhook, elas respondem uma à outra → loop infinito.

## Passo 4: Testar

1. No WhatsApp, mande uma mensagem para qualquer número da instância
2. O Evolution Go dispara o webhook → a IA do Ienvia Motor responde
3. Caso não responda, veja os logs no Vercel: Deployments → *Visit* → Logs

## Como encontrar o user_id do Supabase

Supabase → SQL Editor:

```sql
select id from auth.users;
```

Ou pelo painel: faça login no painel do Ienvia Motor e veja o ID do usuário.

## Histórico de conversas

O webhook guarda o histórico das conversas em **Supabase** (`zapia_contacts`) — persistente entre chamadas (serverless não tem memória duradoura). Sem Supabase configurado, usa memória interna (VPS/desenvolvimento).

## Configurar as chaves de IA

Cada cliente coloca suas chaves no **painel do Ienvia Motor** (aba "Motor de IA") — elas ficam no Supabase (`zapia_workspaces.settings`). O webhook usa as mesmas automaticamente.

## Variantes de deploy

- **Vercel (este guia)**: grátis, sem servidor — ideal para a comunicação (webhook)
- **VPS** (Oracle grátis / KingHost / Serverspace): roda o docker-compose completo (motor + webhook no mesmo host) — veja `ORACLE-CLOUD-DEPLOY.md` e `GRATISVPS-DEPLOY.md` (aviso: GratisVPS é scam)

## Passo 5: Controlar IA por número (no painel)

O painel do Ienvia Motor já tem o toggle **"Atendimento automático"** (botEnabled):
- **Ligado** → a IA responde as mensagens do WhatsApp
- **Desligado** → a IA não responde; a mensagem é registrada no CRM e o dono responde manualmente

O webhook respeita `settings.botEnabled` do `zapia_workspaces`. Para mensagem de fallback quando a IA está desligada, use `settings.iaOffReply`.

> **Importante:** o toggle do painel atualiza o motor local. O motor sincroniza para o Supabase. O webhook lê do Supabase — pode haver alguns segundos de atraso.
