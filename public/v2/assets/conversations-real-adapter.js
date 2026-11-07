// Adapter da caixa de entrada nova ligado em dados REAIS.
//
// A UI (conversations-view.js) foi desenhada para um leitor de histórico por instância em UUID.
// Nesta conta a origem real é o CRM legado vivo, servido por /api/conversations-v3.
// Este módulo traduz o contrato da tela para o da API — sem demonstração, sem dado inventado:
// se a origem falhar, o erro sobe e a tela mostra a falha em vez de uma caixa vazia.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status = 503, detail = {}) => { throw Object.assign(new Error(message), { status, detail }); };

export function createRealConversationsAdapter({ request, scope = () => '', onScopeLost = () => {} } = {}) {
  if (typeof request !== 'function') throw TypeError('Consulta autenticada obrigatória.');
  // Se a conta ou a sessão mudar no meio da consulta, os dados antigos não podem continuar na tela.
  const initialScope = scope();
  let disposed = false;
  const same = () => {
    if (disposed || scope() !== initialScope) {
      onScopeLost();
      fail('A conta mudou. Reabra as conversas.', 409, { scopeChanged: true });
    }
  };
  const get = async (path, signal) => {
    same();
    const value = await request(path, { method: 'GET', signal });
    same();
    return value;
  };

  const check = response => {
    if (!response || response.ok !== true) fail('Resposta de conversas inválida.');
    return response;
  };

  // Comandos que alteram a conversa. Cada um devolve o que o servidor confirmou;
  // nenhum deles inventa estado local quando a origem falha.
  const write = async (path, method, body, signal) => {
    same();
    const value = await request(path, {method, body, signal});
    same();
    if (!value || value.ok !== true) fail('O servidor não confirmou a alteração.');
    return value;
  };
  const threadPath = (instanceId, threadId) => {
    if (!UUID.test(String(instanceId || ''))) fail('Instância inválida.', 400);
    if (typeof threadId !== 'string' || !threadId) fail('Conversa inválida.', 400);
    return `/api/conversations-v3/instances/${instanceId}/threads/${encodeURIComponent(threadId)}`;
  };

  return {
    demo: false,
    // Escrita liberada: os comandos usam as rotas reais abaixo.
    writable: true,
    canSend: true,

    async send({instanceId, threadId, text, signal} = {}) {
      const value = await write(`${threadPath(instanceId, threadId)}/messages`, 'POST', {text: String(text || '')}, signal);
      if (value.sent !== true) fail('O envio não foi confirmado pelo provedor.');
      return value;
    },

    // Mídia vai em base64 para a rota dedicada; o servidor não grava o binário.
    async sendMedia({instanceId, threadId, type, file, caption = '', voiceMessage = false, signal} = {}) {
      if (!file) fail('Escolha um arquivo antes de enviar.', 400);
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsDataURL(file);
      });
      const value = await write(`${threadPath(instanceId, threadId)}/media`, 'POST', {
        type, data, filename: String(file.name || ''), caption: String(caption || ''), voiceMessage: voiceMessage === true
      }, signal);
      if (value.sent !== true) fail('O envio do arquivo não foi confirmado pelo provedor.');
      return value;
    },

    async markRead({instanceId, threadId, unread = false, signal} = {}) {
      return write(`${threadPath(instanceId, threadId)}/read`, 'POST', {unread: unread === true}, signal);
    },

    async patchThread({instanceId, threadId, patch, signal} = {}) {
      if (!patch || typeof patch !== 'object') fail('Alteração inválida.', 400);
      return write(threadPath(instanceId, threadId), 'PATCH', patch, signal);
    },

    async addNote({instanceId, threadId, text, signal} = {}) {
      const value = await write(`${threadPath(instanceId, threadId)}/notes`, 'POST', {text: String(text || '')}, signal);
      return value.note || null;
    },

    async pause({instanceId, threadId, minutes = 60, reason = '', signal} = {}) {
      return write(`${threadPath(instanceId, threadId)}/pause`, 'POST', {minutes, reason}, signal);
    },

    async resume({instanceId, threadId, signal} = {}) {
      return write(`${threadPath(instanceId, threadId)}/resume`, 'POST', {}, signal);
    },

    async patchProfile({instanceId, threadId, patch, signal} = {}) {
      const value = await write(`${threadPath(instanceId, threadId)}/profile`, 'PATCH', patch, signal);
      return value.profile || null;
    },

    // Instâncias (chips) reais da conta.
    async catalog({ q = '', signal } = {}) {
      const params = new URLSearchParams();
      if (q) params.set('q', String(q).slice(0, 80));
      const data = check(await get('/api/conversations-v3/instances' + (params.toString() ? `?${params}` : ''), signal));
      if (!data.viewer?.id || !Array.isArray(data.items)) fail('Resposta de instâncias inválida.');
      const instances = data.items.map(item => {
        if (!UUID.test(String(item.id || ''))) fail('Instância sem identificador válido.');
        return {
          id: item.id,
          name: String(item.name || '').slice(0, 64) || 'Chip',
          transport: item.transport === 'evolution_api' ? 'evolution_api' : 'local_worker',
          crmVisible: item.crmVisible !== false,
          connection: item.connection || 'unknown',
          aiEnabled: item.aiEnabled === true,
          threads: Number.isSafeInteger(item.threads) ? item.threads : 0,
          unread: Number.isSafeInteger(item.unread) ? item.unread : 0
        };
      });
      return {
        viewer: data.viewer,
        tenant: data.tenant || { id: data.viewer.id, displayName: data.viewer.displayName || 'Minha conta' },
        // A caixa nova envia, marca lida, fixa, arquiva, pausa a IA e edita ficha pelo mesmo
        // backend; quem decide é a conta (suporte continua somente leitura no servidor).
        features: {
          manage: data.features?.manage === true,
          send: data.features?.send === true,
          metadata: data.features?.metadata === true
        },
        crmProfilesRead: data.features?.crmProfilesRead === true,
        instances,
        hasMore: false,
        nextCursor: null
      };
    },

    // Conversas da instância selecionada. Filtro e busca são resolvidos no servidor.
    async list({ instanceId, visibility = 'inbox', pill = '', q = '', after = null, signal } = {}) {
      if (!UUID.test(String(instanceId || ''))) fail('Selecione uma instância antes de consultar.', 400);
      const params = new URLSearchParams({ limit: '30', visibility, offset: String(Number(after) || 0) });
      if (pill) params.set('pill', String(pill));
      if (q) params.set('q', String(q).slice(0, 80));
      const data = check(await get(`/api/conversations-v3/instances/${instanceId}/threads?${params}`, signal));
      if (!Array.isArray(data.items)) fail('Lista de conversas inválida.');
      const items = data.items.map(row => {
        if (typeof row.id !== 'string' || !row.id) fail('Conversa sem identificador válido.');
        // Ficha salva do CRM: quando a origem projeta o cadastro, ele é preservado como veio.
        // Sem projeção, o campo simplesmente não existe (nada é inventado).
        const crmContact = row.crmContact && typeof row.crmContact === 'object' ? structuredClone(row.crmContact) : undefined;
        const profileName = crmContact?.profile?.name;
        return {
          id: row.id,
          chatId: row.chatId,
          name: String(profileName || row.name || '').slice(0, 80) || 'Contato WhatsApp',
          phone: row.phoneMasked || null,
          preview: typeof row.preview === 'string' ? row.preview : '',
          previewRole: row.previewRole || null,
          identityKind: row.identityKind === 'verified_pn' ? 'verified_pn' : 'provisional_lid',
          peerJid: row.peerJid || '',
          selfJid: '',
          createdAt: row.createdAt || null,
          unread: Number.isSafeInteger(row.unread) ? row.unread : 0,
          pinned: row.pinned === true,
          archived: row.archived === true,
          aiEnabled: row.aiEnabled === true,
          needsHuman: row.needsHuman === true,
          paused: row.paused || null,
          hot: row.hot === true || crmContact?.profile?.hot === true,
          saved: row.saved === true,
          followUp: row.followUp === true,
          stage: row.stage || null,
          company: row.company || '',
          city: row.city || '',
          email: row.email || '',
          notes: row.notes || '',
          leadSource: row.leadSource || '',
          tags: Array.isArray(row.tags) ? row.tags.slice(0, 12) : [],
          color: 0,
          dealStatus: row.dealStatus || null,
          dealValue: Number.isFinite(row.dealValue) ? row.dealValue : 0,
          messageCount: Number.isSafeInteger(row.messageCount) ? row.messageCount : 0,
          lastMessageAt: row.lastMessageAt || null,
          originIds: Array.isArray(row.originIds) && row.originIds.length ? row.originIds : [instanceId],
          ...crmContact ? { crmContact } : {}
        };
      });
      return {
        ownerId: data.viewer?.id || data.ownerId,
        instanceId,
        items,
        counts: data.counts || null,
        total: data.total,
        hasMore: data.hasMore === true,
        nextCursor: data.hasMore === true ? String((Number(after) || 0) + items.length) : null,
        crmProjection: data.crmProjection
      };
    },

    // Mensagens de uma conversa. `after` aqui é o `before` (timestamp) do histórico longo.
    dispose() { disposed = true; },

    async messages({ instanceId, threadId, before = null, after = null, signal } = {}) {
      if (!UUID.test(String(instanceId || ''))) fail('Instância inválida.', 400);
      if (typeof threadId !== 'string' || !threadId) fail('Conversa inválida.', 400);
      const params = new URLSearchParams({ limit: '80' });
      const cursor = before || after;
      if (cursor) params.set('before', String(cursor));
      const data = check(await get(`/api/conversations-v3/instances/${instanceId}/threads/${encodeURIComponent(threadId)}/messages?${params}`, signal));
      if (!Array.isArray(data.messages)) fail('Histórico da conversa inválido.');
      const items = data.messages.map(message => ({
        id: String(message.id || ''),
        threadId,
        fromMe: message.role === 'owner',
        role: message.role,
        text: typeof message.text === 'string' ? message.text : '',
        mediaType: message.media?.mime ? String(message.media.mime).split('/')[0] : null,
        media: message.media || null,
        deleted: message.deleted === true,
        internal: message.internal === true,
        conflicted: false,
        simulated: false,
        ack: Number.isInteger(message.ack) ? message.ack : (message.role === 'owner' ? 1 : 0),
        delivered: message.role === 'owner' && Number.isInteger(message.ack) && message.ack >= 2,
        messageAt: message.at,
        timestampSource: 'provider',
        dispatchState: null,
        reaction: null,
        edited: false,
        starred: false,
        replyTo: null,
        origins: Array.isArray(message.origins) && message.origins.length ? message.origins : [{ instanceId, name: 'Chip', crmVisible: true }],
        originCount: 1,
        originsTruncated: false
      }));
      return {
        conversation: data.conversation || null,
        items,
        total: data.total,
        hasMore: data.hasMore === true,
        nextCursor: data.nextBefore || null
      };
    }
  };
}
