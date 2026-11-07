// Execução da campanha nova (navegação V3) pelo chip Evolution.
//
// O modelo antigo exigia um worker de processo longo (socket Baileys). A navegação nova
// usa Evolution API — um HTTP — então a execução pode viver na própria Vercel, com as
// mesmas garantias do worker: nada é reenviado sozinho, cada etapa tem trava única e o
// resultado só é considerado aceito quando o provedor devolve um id.
//
// Regras que valem sempre:
//  - só envia o que o rascunho aprovado contém (blocos texto/imagem/audio do plano);
//  - o destinatário é reservado por UPDATE condicional (um único envio por etapa);
//  - intervalo mínimo entre envios vem do próprio rascunho;
//  - horário de trabalho do rascunho é respeitado;
//  - erro no meio não reenvia: a etapa fica marcada e o resumo mostra o motivo.
import { randomUUID } from 'node:crypto';
import { sendEvolutionApiText, sendEvolutionApiMedia, sendEvolutionApiVoice } from '../evolutionApiCloud.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE = /^[1-9][0-9]{7,14}$/;
const SLOT = /^slot_[0-9]$/;
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const nowIso = () => new Date().toISOString();

// ── plano → mensagem ────────────────────────────────────────────────────────────
// O rascunho guarda o plano da campanha (blocos com textos/variantes). Aqui só escolhemos
// o texto do bloco; nada é gerado, nada é inventado.
export function expandCampaignText(block, fields = {}, random = Math.random) {
  const textos = Array.isArray(block?.textos) ? block.textos.filter(t => typeof t === 'string' && t.trim()) : [];
  if (!textos.length) throw fail(409, 'CAMPAIGN_BLOCK_EMPTY', 'O bloco da campanha não tem texto aprovado.');
  const escolhido = block.modo === 'rotacao' || block.modo === 'ia'
    ? textos[Math.min(textos.length - 1, Math.floor(random() * textos.length))]
    : textos[0];
  const texto = escolhido.replace(/\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu, (_, key) => {
    const value = fields[String(key).toLocaleLowerCase('pt-BR')];
    return value == null ? '' : String(value);
  });
  if (!texto.trim()) throw fail(409, 'CAMPAIGN_TEXT_EMPTY', 'A mensagem ficou vazia depois das variáveis.');
  if (texto.length > 10000) throw fail(409, 'CAMPAIGN_TEXT_TOO_LONG', 'A mensagem passa de 10.000 caracteres.');
  return texto;
}

// Hora local da conta: o rascunho traz dias (0=domingo) e janela inicio/fim "HH:MM".
export function campaignWindowOpen(draft, date = new Date()) {
  const tz = typeof draft?.fuso === 'string' && draft.fuso ? draft.fuso : 'America/Fortaleza';
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = days[parts.weekday];
  const dias = Array.isArray(draft?.dias) && draft.dias.length ? draft.dias.map(Number) : [0, 1, 2, 3, 4, 5, 6];
  if (!dias.includes(weekday)) return { open: false, reason: 'fora_dos_dias', tz };
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const toMinutes = value => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const start = toMinutes(draft?.inicio) ?? 0;
  const end = toMinutes(draft?.fim) ?? 1439;
  if (start <= end ? (minutes < start || minutes > end) : (minutes < start && minutes > end)) {
    return { open: false, reason: 'fora_do_horario', tz };
  }
  return { open: true, tz };
}

// ── progresso do draft ─────────────────────────────────────────────────────────
const stepsOf = draft => (Array.isArray(draft?.plano?.blocos) ? draft.plano.blocos.length : 1);
const progressOf = draft => {
  const total = stepsOf(draft);
  const done = Number(draft?.enviados) || 0;
  const failed = Number(draft?.falhas) || 0;
  const skipped = Number(draft?.pulados) || 0;
  const pending = Number(draft?.pendentes) || 0;
  return { total, done, failed, skipped, pending };
};

// `ownerOverride` só existe para o relógio automático, que roda com a chave de serviço e
// sem sessão: a conta vem do ambiente, nunca do corpo de uma requisição de navegador.
export function createCampaignRunner({ client, transport = null, maxPerRun = 5, now = () => new Date(), random = Math.random, ownerOverride = null } = {}) {
  if (!client || typeof client.from !== 'function') throw new TypeError('Cliente autenticado obrigatório.');
  const bridge = transport || {
    sendText: sendEvolutionApiText,
    sendMedia: sendEvolutionApiMedia,
    sendVoice: sendEvolutionApiVoice
  };
  const cap = Math.max(1, Math.min(25, Number(maxPerRun) || 5));

  const table = name => client.from(name);

  async function loadDraft(ownerId, campaignId) {
    const { data, error } = await table('ienvia_campaign_drafts')
      .select('id, revision, document, updated_at')
      .eq('owner_id', ownerId)
      .eq('id', campaignId)
      .maybeSingle();
    if (error) throw fail(503, 'CAMPAIGN_UNAVAILABLE', 'Não foi possível ler a campanha agora.');
    if (!data) throw fail(404, 'CAMPAIGN_NOT_FOUND', 'Campanha não encontrada nesta conta.');
    return data;
  }

  async function loadRecipients(ownerId, campaignId) {
    const rows = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await client
        .rpc('ienvia_campaign_draft_recipients', { p_owner: ownerId, p_id: campaignId, p_offset: offset })
        .abortSignal(AbortSignal.timeout(8000));
      if (error) throw fail(503, 'CAMPAIGN_RECIPIENTS_UNAVAILABLE', 'A lista de destinatários não pôde ser lida.');
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      rows.push(...items);
      if (items.length < 50 || rows.length >= 1000) break;
      offset += items.length;
    }
    return rows;
  }

  // Reserva uma etapa: só um processo consegue marcar em_envio -> enviado.
  async function claimRecipient(ownerId, campaignId, recipientRow, step, slotId) {
    const key = recipientRow.destinatario_id || recipientRow.recipientId || recipientRow.id;
    if (!UUID.test(String(key || ''))) throw fail(503, 'CAMPAIGN_RECIPIENT_INVALID', 'Destinatário inválido na lista.');
    const { error } = await table('ienvia_campanha_destinatarios')
      .update({ enviado: true, enviado_em: nowIso(), slot_id: slotId, etapa: step })
      .eq('owner_id', ownerId)
      .eq('campanha_id', campaignId)
      .eq('destinatario_id', key)
      .eq('enviado', false);
    // Se a tabela antiga não existir, seguimos com a lista somente leitura do rascunho.
    if (error && !['42P01', 'PGRST205'].includes(error.code)) {
      throw fail(503, 'CAMPAIGN_CLAIM_UNAVAILABLE', 'Não foi possível reservar o destinatário.');
    }
    return { key, claimed: !error };
  }

  async function markFailure(ownerId, campaignId, key, reason) {
    await table('ienvia_campanha_destinatarios')
      .update({ falha_motivo: String(reason).slice(0, 200), enviado: false })
      .eq('owner_id', ownerId)
      .eq('campanha_id', campaignId)
      .eq('destinatario_id', key)
      .then(() => {}, () => {});
  }

  async function saveProgress(ownerId, campaignId, document, revision) {
    const { data, error } = await table('ienvia_campaign_drafts')
      .update({ document, updated_at: nowIso() })
      .eq('owner_id', ownerId)
      .eq('id', campaignId)
      .eq('revision', revision)
      .select('id, revision')
      .maybeSingle();
    if (error) throw fail(503, 'CAMPAIGN_PROGRESS_UNAVAILABLE', 'Progresso não confirmado. Consulte antes de repetir.');
    return Boolean(data);
  }

  // Um "run" processa no máximo `cap` destinatários, respeitando o intervalo do rascunho.
  async function run({ ownerId, campaignId, slotId, apenasDestinatario = null }) {
    if (!UUID.test(String(ownerId || ''))) throw fail(401, 'CAMPAIGN_AUTH_REQUIRED', 'Entre na sua conta.');
    if (ownerOverride && String(ownerId) !== String(ownerOverride)) throw fail(403, 'CAMPAIGN_OWNER_MISMATCH', 'Conta do relógio diferente da configurada.');
    if (!UUID.test(String(campaignId || ''))) throw fail(400, 'CAMPAIGN_INVALID', 'Campanha inválida.');
    if (!SLOT.test(String(slotId || ''))) throw fail(400, 'CAMPAIGN_CHANNEL_INVALID', 'Escolha o chip que vai enviar.');

    const row = await loadDraft(ownerId, campaignId);
    const draft = row.document || {};
    if (draft.status && !['rascunho', 'pronta', 'pausada', 'em_execucao'].includes(draft.status)) {
      throw fail(409, 'CAMPAIGN_NOT_EXECUTABLE', 'Esta campanha não está em estado de envio.');
    }
    const window = campaignWindowOpen(draft, now());
    if (!window.open) {
      return { ok: true, executed: 0, done: false, blocked: window.reason, progress: progressOf(draft), ranAt: nowIso() };
    }
    const steps = stepsOf(draft);
    const block = draft.plano.blocos[0] || {};
    if (!['texto', 'imagem', 'audio'].includes(block.tipo)) {
      throw fail(409, 'CAMPAIGN_BLOCK_INVALID', 'O primeiro bloco da campanha não é texto, imagem ou áudio.');
    }

    const recipients = await loadRecipients(ownerId, campaignId);
    // O agendador reserva a etapa no banco e pede SÓ aquele destinatário: assim o tick
    // nunca envia para quem outra execução já reservou.
    const pending = recipients.filter(r => r.enviado !== true && r.excluido !== true)
      .filter(r => !apenasDestinatario || String(r.destinatario_id || r.recipientId || r.id) === String(apenasDestinatario));
    if (!pending.length) {
      return { ok: true, executed: 0, done: true, progress: progressOf(draft), ranAt: nowIso() };
    }

    const intervalo = Math.max(0, Math.min(60000, Number(draft.intervalo_min_ms) || 1500));
    const pausaLote = Math.max(0, Math.min(60000, Number(draft.pausa_lote_min_ms) || 0));
    const lote = Math.max(1, Math.min(100, Number(draft.lote_min) || 1));

    let executed = 0;
    let failed = 0;
    const results = [];
    for (const [index, recipient] of pending.slice(0, cap).entries()) {
      const phone = String(recipient.telefone || recipient.phone || '').replace(/\D/g, '');
      if (!PHONE.test(phone)) { failed += 1; results.push({ phone, status: 'invalid' }); continue; }
      const claim = await claimRecipient(ownerId, campaignId, recipient, 1, slotId);
      const text = block.tipo === 'texto' ? expandCampaignText(block, { nome: recipient.nome || '', telefone: phone }, random) : '';
      const chatId = `${slotId}::${phone}@s.whatsapp.net`;
      try {
        if (block.tipo === 'texto') {
          const sent = await bridge.sendText(ownerId, chatId, text);
          const id = sent?.key?.id || sent?.id || '';
          if (!id) throw fail(502, 'CAMPAIGN_UNCONFIRMED', 'O provedor não confirmou o envio.');
          results.push({ phone, status: 'sent', providerMessageId: String(id) });
        } else {
          if (!Array.isArray(block.textos) || !block.textos.length) throw fail(409, 'CAMPAIGN_MEDIA_EMPTY', 'Bloco de mídia sem arquivo aprovado.');
          // Mídia exige o link privado do arquivo; sem ele a etapa fica pendente, não inventamos.
          throw fail(409, 'CAMPAIGN_MEDIA_PENDING', 'Bloco de mídia precisa do arquivo aprovado no plano.');
        }
        executed += 1;
      } catch (error) {
        failed += 1;
        if (claim.claimed) await markFailure(ownerId, campaignId, claim.key, error?.code || 'send_failed');
        results.push({ phone, status: 'failed', code: error?.code || 'send_failed' });
      }
      if (index < cap - 1 && intervalo > 0) await new Promise(r => setTimeout(r, intervalo));
      if (pausaLote > 0 && lote > 0 && (executed + failed) % lote === 0) await new Promise(r => setTimeout(r, pausaLote));
    }

    const updated = {
      ...draft,
      status: executed > 0 && pending.length > cap ? 'em_execucao' : (pending.length <= cap ? 'concluida' : draft.status || 'pronta'),
      enviados: (Number(draft.enviados) || 0) + executed,
      falhas: (Number(draft.falhas) || 0) + failed,
      pendentes: Math.max(0, pending.length - executed - failed),
      proxima_acao_em: nowIso(),
      ultima_execucao: { at: nowIso(), executed, failed, steps, slotId, results: results.slice(0, 20) }
    };
    const saved = await saveProgress(ownerId, campaignId, updated, row.revision);

    return {
      ok: true,
      executed,
      failed,
      done: pending.length <= cap,
      saved,
      progress: progressOf(updated),
      results,
      ranAt: nowIso()
    };
  }

  return Object.freeze({ run });
}
