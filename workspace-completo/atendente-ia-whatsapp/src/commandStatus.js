const SEND_ACTIONS = new Set(['send_crm_reply', 'send_crm_attachment', 'send_crm_recorded_voice', 'send_crm_library_voice']);
const VISIBLE_STATUSES = new Set(['pending', 'processing', 'done', 'error']);

// Nunca retorna payload, conversa, telefone, mídia ou o resultado completo.
export async function getSafeCommandStatus(client, userId, commandId) {
  if (!client || !userId || !commandId) throw new Error('Não foi possível consultar o envio.');
  const { data, error } = await client.from('zapia_commands')
    .select('id,action,status,confirmed:result->sentRealWhatsApp')
    .eq('user_id', userId)
    .eq('id', commandId)
    .maybeSingle();
  if (error) throw new Error('Não foi possível consultar o envio.');
  if (!data || !SEND_ACTIONS.has(data.action) || !VISIBLE_STATUSES.has(data.status)) return null;
  const out = { id: data.id, status: data.status, confirmed: data.status === 'done' && data.confirmed === true };
  return out;
}
