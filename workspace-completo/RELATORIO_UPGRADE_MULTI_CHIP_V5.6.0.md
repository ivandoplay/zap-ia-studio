# 🚀 Relatório Oficial de Engenharia & Upgrade SaaS — ZAP-IA Studio `v5.6.0`

**Data:** 27/10/2026  
**Versão em Produção:** `v5.6.0` (`56cd800` — Online em `https://zap-ia-studio.vercel.app/`)  
**Banco de Dados & Realtime:** Supabase PostgreSQL `17.11` (`iuysmojhaxplnhfrxqkv`) — Migração `v560_multi_wa_slots_devices_and_atomic_claims` aplicada com sucesso e zero downtime  
**Pacotes Portáteis Atualizados:** `/home/user/ZAP-IA-Studio-Oficial-v5.0.zip` e `/home/user/ZAP-IA-Studio-Windows.zip` (`v5.6.0`, Auto-Update ativo na abertura)

---

## 1. Arquitetura Multi-Chip (`Chip 1`, `Chip 2`, `Chip 3`) & Multi-Aparelho

1. **Até 3 Números de WhatsApp Simultâneos por Conta (`WhatsAppMultiSlotManager`):**
   - Cada conta suporta até **3 sessões criptografadas independentes** (`Chip 1 · Principal`, `Chip 2`, `Chip 3`) via `@whiskeysockets/baileys` v7.
   - **Zero Disrupção no `Chip 1`:** o `Chip 1` mantém exatamente o cofre `data/wa_auth/<userId>/` e as chaves originais de conversa (`5586...@s.whatsapp.net` / `@lid`), preservando 100% da sessão e das **984 conversas atuais** sem pedir novo QR Code.
   - **Cofres Isolados para `Chip 2` e `Chip 3`:** armazenados em `slot_2/` e `slot_3/`, com blindagem em `clearAuthFolder()` (apaga somente arquivos do slot desconectado, jamais subpastas vizinhas).

2. **Topologia Flexível — 1 Único Aparelho OU Múltiplos Aparelhos na Mesma Conta:**
   - **1 aparelho online:** conecta `Chip 1`, `Chip 2` e `Chip 3` direto no mesmo celular Termux ou PC sem perguntar nada.
   - **2 ou mais aparelhos online simultaneamente:** ao clicar em **Gerar QR** ou **Gerar Código de 8 Dígitos** pelo painel da Vercel, abre automaticamente o **Seletor Inteligente de Aparelho** para você escolher em qual dispositivo deseja parear aquele chip, além de permitir **renomear apelidos dos aparelhos** (`ex: Celular Recepção`, `Notebook Escritório`).

3. **Caixa de Entrada Unificada por Horário + Cartões Separados por Chip + Filtro de Canal:**
   - Ao conectar `Chip 2` ou `Chip 3`, todas as conversas já existentes no aparelho entram automaticamente na fila cronológica (`lastMessageAt`).
   - Se o mesmo cliente mandar mensagem em dois chips diferentes, o CRM mantém **cartões separados e independentes por chip**, identificados pelas etiquetas visuais **`Chip 1` (Esmeralda)**, **`Chip 2` (Azul)** e **`Chip 3` (Roxo)** + seletor **`Canal: Todos os Chips | Chip 1 | Chip 2 | Chip 3`**.

4. **Cérebro Único Compartilhado + Chave Individual de IA por Chip:**
   - Todos os chips compartilham o mesmo **Treinamento, Skills, Biblioteca de Voz Humana `OGG/Opus`, Catálogo e PIX**, mas cada chip possui seu próprio **apelido comercial** e botão **`IA Ativa neste Chip`** (permitindo deixar um número 100% manual se desejar).

5. **Alertas de Fechamento Centralizados no `Chip 1 Principal` + Contingência Automática:**
   - Sempre que qualquer chip acionar `[[CHAMAR_HUMANO]]`, o alerta para o seu WhatsApp pessoal sai centralizado pelo **`Chip 1 Principal`** informando em qual chip o lead chamou (inclusive via *relay* entre aparelhos diferentes!). Caso o `Chip 1` esteja offline no momento, o sistema faz *failover* automático pelos `Chips 2/3` para nunca perder um fechamento.

6. **Disparador Proativo com Seletor de Canal + Rodízio Inteligente Anti-Ban:**
   - Tanto no disparo individual quanto na **Fila Segura em Lote**, você pode escolher um chip específico ou deixar em **`🔄 Rodízio Inteligente Anti-Ban`**, alternando automaticamente cada abordagem entre os chips conectados.

7. **Cota Comercial SaaS por Cliente (`1 | 2 | 3 Chips` na Aba `Clientes SaaS`):**
   - Na Torre Master (`@jeffersonivan` liberado com **3/3 Chips**), você define ao criar ou editar qualquer cliente (`ex: @lizandro`) se o plano dele libera **1, 2 ou 3 Chips**, com validação *server-side* no backend e na nuvem.

---

## 2. Resolução Integral dos 12 Furos Críticos de Concorrência, Banco & Estabilidade

| # | Falha Identificada na Auditoria Profunda | Solução Definitiva Implementada na `v5.6.0` |
|---|---|---|
| **1** | Corrida de comandos entre 2 aparelhos online (`SELECT` sem trava executando 2x) | RPC atômica PostgreSQL `public.claim_zapia_command(p_command_id, p_device_id)` com `UPDATE ... WHERE status = 'pending' RETURNING *`. |
| **2** | Guerra de *heartbeats* sobrescrevendo `zapia_wa_runtime` entre 2 dispositivos | Novas tabelas `zapia_worker_devices` e `zapia_wa_slots` com posse por `device_id` e proteção de espelhamento legado. |
| **3** | Sobrescrita cega de `business`/`settings` no `zapia_workspaces` em multi-aparelho | Hash determinístico `computeWorkspaceConfigHash` — só envia `business`/`settings` quando houve mutação real de configuração. |
| **4** | Clobber de telemetria (`stats`/`logs`/`proactive_queue`) apagando ajustes feitos na Vercel | RPC atômica `public.update_zapia_workspace_telemetry` que atualiza apenas colunas operacionais sem tocar em `business`/`settings`. |
| **5** | Risco de *loop* infinito de IA se `Chip 1` mandar mensagem para `Chip 2` da mesma conta | Guarda `isAnyOwnSlotPhone` cruzando todos os números conectados localmente e em aparelhos pares na nuvem (`peerSlotPhones`). |
| **6** | Exclusão/tombstone por telefone bloqueando o cliente em todos os chips | Tombstones e deduplicação `@lid <-> @s.whatsapp.net` isolados estritamente por `slotId` (`tel:...` vs `slot_2::tel:...`). |
| **7** | Alerta `[[CHAMAR_HUMANO]]` no `Chip 2` quando `Chip 1` está em outro aparelho ou offline | `deliverOwnerAlertCentralized` com comando nuvem `relay_owner_alert` para o aparelho do `Chip 1` + *failover* local imediato. |
| **8** | Parear o mesmo número de WhatsApp em dois slots simultâneos derrubando ambos | Guarda `findOtherConnectedSlotByPhone` que detecta duplicidade na hora, encerra o slot duplicado com aviso claro e protege o original. |
| **9** | Acúmulo infinito de linhas antigas em `zapia_commands` | Limpeza periódica automática `pruneOldCommands()` mantendo a tabela leve e rápida. |
| **10** | Download de mídia na nuvem sem `AbortSignal.timeout` em redes móveis instáveis | `AbortSignal.timeout(25_000)` aplicado em `ensureLocalMediaCached` e no encaminhamento de mídia do CRM. |
| **11** | Pico simultâneo de mensagens nos 3 chips estourando cota/RPM do Gemini | Semáforo *Bulkhead* `MAX_CONCURRENT_AI_CALLS = 2` com fila FIFO em `aiEngine.js`. |
| **12** | Bypass de limite de chips via chamada direta de API | Trava *server-side* `clampMaxWaSlots` tanto em `/api/wa/connect` quanto dentro de `dispatchCommandToWorker`. |

---

## 3. Evolução de Templates & Guia de Treinamento SaaS (`v5.6.0`)

- Adicionados novos modelos prontos em `src/templates.js` (**Profissional Liberal · 1ª Pessoa Solo** com `soloIdentity: true` propagado nativamente e **SaaS / Plataforma Digital / Assinaturas**).
- Atualizados o **Super-Prompt do ChatGPT** dentro do painel e o manual **`GUIA_VIBE_CODER_TREINAMENTO.md`** com diretrizes de **Cérebro Único Multi-Chip** e **Modo Solo 1ª Pessoa (`"eu"`) vs Modo Equipe (`"nós"`)**.
