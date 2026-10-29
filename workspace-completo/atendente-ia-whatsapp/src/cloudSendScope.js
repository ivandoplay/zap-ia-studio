// As rotas de envio só precisam da conversa aberta, não de milhares de fichas.
// Sem correspondência exata, manter o carregamento completo e comportamento anterior.
export function scopedSendChatId(method, path) {
  if (String(method).toUpperCase() !== 'POST') return null;
  const match = /^\/crm\/([^/]+)\/(?:send|reply|send-attachment|send-audio|send-library-voice)\/?$/.exec(String(path || ''));
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return id && id.length <= 512 && !id.includes('/') ? id : null;
  } catch { return null; }
}

export async function fetchScopedCloudContact(client, userId, chatId) {
  const { data, error } = await client.from('zapia_contacts').select('chat_id, data')
    .eq('user_id', userId).eq('chat_id', chatId).maybeSingle();
  if (error) throw new Error(`Falha ao carregar conversa: ${error.message}`);
  return data ? [data] : [];
}
