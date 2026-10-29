import { mergeContactMessagesUnion, normalizeSlotId, parseContactChannelKey } from './storage.js';

/** Limpa apenas mensagens do slot, preservando dados comerciais da ficha. */
export function limparHistoricoSlot(contatos, slotId, epoch) {
  const slot = normalizeSlotId(slotId);
  let total = 0;
  for (const [key, contato] of Object.entries(contatos || {})) {
    if (normalizeSlotId(contato?.slotId || parseContactChannelKey(key).slotId) !== slot) continue;
    contatos[key] = { ...contato, messages: [], lastMessageAt: null, unreadCount: 0, unreadAlert: false, disconnectedHidden: true, historyEpoch: epoch };
    total++;
  }
  return total;
}

/** Não mistura cache de outra geração ao snapshot autoritativo mais recente. */
export function mesclarContatoComEpoca(remoto, local, epoch) {
  if (!local || (epoch && local.historyEpoch !== epoch)) return { ...remoto };
  const mensagens = mergeContactMessagesUnion(remoto.messages || [], local.messages || [], remoto.historyClearedAt || local.historyClearedAt || null);
  return { ...remoto, messages: mensagens, disconnectedHidden: Boolean(remoto.disconnectedHidden && local.disconnectedHidden && mensagens.length === 0) };
}

export function visivelNaCaixa(contato) {
  return contato?.disconnectedHidden !== true;
}

/** Offline ou falha de rede não provam encerramento de sessão. */
export function deveLimparAposDesconexao({ motivo, outroDispositivoAtivo } = {}) {
  return outroDispositivoAtivo === false && ['logout_confirmado', 'desconexao_manual', 'qr_novo'].includes(motivo);
}
