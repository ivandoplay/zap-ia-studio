# Campanhas com chip na Evolution API

## O problema corrigido

O motor de campanhas rodava apenas no **motor local** e só sabia enviar por um
socket Baileys (`slot.sock`). Quando o chip estava conectado na Evolution API:

1. `chipDisponivel()` devolvia `false` para todos os chips da conta;
2. a seleção da próxima etapa devolvia `null` e nada era reservado;
3. o executor respondia `indisponivel` e o agendador tentava de novo a cada 5s;
4. a campanha ficava eternamente "Em andamento", com "Próxima ação" no passado,
   sem enviar nada e sem mostrar erro.

Agora o emissor escolhe o transporte **por etapa**:

| Situação do chip | Transporte |
| --- | --- |
| Socket Baileys conectado neste motor | direto pelo socket (sem mudanças) |
| Instância `zap-ia-slot_N` conectada na Evolution API | `POST /api/campaigns/:id/steps/send` no painel |

## Como o envio pela nuvem funciona

O motor local não conhece `EVOLUTION_API_KEY` e nunca precisa conhecê-la.

1. O motor reserva a etapa (`ienvia_reservar_worker_campanha`), como antes.
2. Se o chip não tem socket, ele pede o envio ao painel com a **sessão do próprio
   titular**: `POST /api/campaigns/:campaignId/steps/send`
   `{ destinatarioId, etapa, tentativaId }`.
3. O painel confere que o checkpoint pertence àquela conta, está `em_envio` com a
   mesma `tentativa_id` e lê o **material já reservado** — o conteúdo enviado não
   pode divergir do que foi reservado.
4. O painel envia pela instância do slot:
   - texto → `POST /message/sendText/zap-ia-slot_N`
   - imagem → `POST /message/sendMedia/...` (`mediatype: image`, URL assinada de 5 min)
   - áudio em nota de voz → `POST /message/sendWhatsAppAudio/...` (base64)
   - áudio como anexo → `POST /message/sendMedia/...` (`mediatype: document`)
5. A resposta devolve o `messageId`. Só então o motor confirma a etapa.

Nada disso dispara reenvio: sem resposta ou com resposta incerta, a etapa fica
`incerta` e exige conferência humana, como antes.

## Configuração

No motor local (`.env`):

```
IENVIA_CLOUD_PANEL_URL=https://zap-ia-studio.vercel.app   # painel que guarda a chave
IENVIA_CAMPANHAS_EXPERIMENTAL=1                            # 0 desliga o motor
```

Na Vercel (nada novo é obrigatório além do que já existe para a Evolution API):

```
EVOLUTION_API_URL=...
EVOLUTION_API_KEY=...            # segredo; nunca no cliente
EVOLUTION_DEFAULT_USER_ID=...    # conta dona das instâncias zap-ia-slot_N
```

## Diagnóstico rápido

- **Campanha pausada com `preparacao`**: a consulta de chips do painel falhou, a
  sessão do titular expirou, ou o chip está desconectado. Confira a aba
  Início & Conexão e retome.
- **Campanha segue "Em andamento" sem enviar**: nenhum chip está disponível —
  exatamente o caso que antes ficava silencioso. Confira se a instância aparece
  como conectada em `/api/evolution-cloud/status`.
- **Etapa `incerta`**: o envio pode ter sido aceito. Confira a conversa no chip
  antes de decidir; marcar como "não enviada" pode duplicar.

## Arquivos envolvidos

- `src/campanhaIntegracaoMotor.js` — escolhe o transporte por etapa.
- `src/campanhaCanalEvolution.js` — cliente do motor local para o painel.
- `src/evolutionApiCloud.js` — `getEvolutionApiCampaignChannels` e os envios por slot.
- `src/server.js` — rota `POST /api/campaigns/:campaignId/steps/send`.
- `src/supabaseCloud.js` — liga o canal Evolution ao motor de campanhas.
- `src/campanhaMediaPrivada.js` — `ticket()` aceita validade (`segundos`).
