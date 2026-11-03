// O motor local não possui a chave da Evolution API: ele pede o envio ao painel
// na nuvem usando a sessão do próprio titular. Nenhuma chave sai do servidor e o
// conteúdo enviado é exatamente o material já reservado no checkpoint da campanha.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOTS = ['slot_1', 'slot_2', 'slot_3'];

function origemDoPainel(valor) {
  const url = new URL(valor);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Origem do painel inválida.');
  }
  return url.origin;
}

export function criarCanalCampanhaEvolution({ client, userId, panelUrl, fetcher = globalThis.fetch, ttlMs = 15000, agora = Date.now } = {}) {
  if (!client?.auth || !UUID.test(userId) || typeof fetcher !== 'function' || !Number.isSafeInteger(ttlMs) || ttlMs < 1000) {
    throw new Error('Canal Evolution inválido.');
  }
  const painel = origemDoPainel(panelUrl);

  let snapshot = { slots: {}, expiraEm: 0 };
  let consultaEmCurso = null;

  async function accessToken() {
    const sessao = await client.auth.getSession();
    const token = sessao?.data?.session?.access_token;
    if (sessao?.error || typeof token !== 'string' || !token || sessao.data.session.user?.id !== userId) {
      throw new Error('A sessão do titular não está disponível para a Evolution API.');
    }
    return token;
  }

  async function lerSlots() {
    if (agora() < snapshot.expiraEm) return snapshot.slots;
    if (consultaEmCurso) return consultaEmCurso;
    consultaEmCurso = (async () => {
      const token = await accessToken();
      let resposta;
      try {
        resposta = await fetcher(`${painel}/api/evolution-cloud/status`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        // Rede instável: reaproveita a última leitura conhecida enquanto houver uma.
        if (snapshot.expiraEm !== 0) return snapshot.slots;
        throw new Error('Não foi possível consultar os chips da Evolution API.');
      }
      let corpo;
      try { corpo = await resposta.json(); } catch { corpo = null; }
      if (!resposta.ok || corpo?.ok !== true || typeof corpo.slots !== 'object' || corpo.slots === null) {
        if (snapshot.expiraEm !== 0) return snapshot.slots;
        throw new Error('Não foi possível consultar os chips da Evolution API.');
      }
      const slots = {};
      for (const slotId of SLOTS) {
        const item = corpo.slots[slotId];
        if (!item || typeof item !== 'object') continue;
        slots[slotId] = { status: item.status === 'connected' ? 'connected' : String(item.status || 'disconnected') };
      }
      snapshot = { slots, expiraEm: agora() + ttlMs };
      return slots;
    })().finally(() => { consultaEmCurso = null; });
    return consultaEmCurso;
  }

  return {
    // As três saídas são distintas de propósito: conectado, ausente e indisponível.
    async disponivel(slotId) {
      if (!SLOTS.includes(slotId)) return false;
      const slots = await lerSlots();
      return slots[slotId]?.status === 'connected';
    },

    async enviar({ campanhaId, destinatarioId, etapa, tentativaId } = {}) {
      if (!UUID.test(campanhaId) || !UUID.test(destinatarioId) || !UUID.test(tentativaId) ||
          !Number.isSafeInteger(etapa) || etapa < 0 || etapa >= 100) {
        throw new Error('Etapa de campanha inválida.');
      }
      const token = await accessToken();
      let resposta;
      try {
        resposta = await fetcher(`${painel}/api/campaigns/${campanhaId}/steps/send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ destinatarioId, etapa, tentativaId }),
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(55000),
        });
      } catch {
        // Sem resposta não é prova de não envio: o executor marca a etapa como incerta.
        throw new Error('Não foi possível concluir o envio pela Evolution API.');
      }
      let corpo;
      try { corpo = await resposta.json(); } catch { corpo = null; }
      if (corpo?.ok === true && typeof corpo.messageId === 'string' && corpo.messageId) {
        return { status: 'aceita', messageId: corpo.messageId };
      }
      // Erro explícito do servidor significa que a mensagem não foi entregue ao chip.
      const erro = new Error(typeof corpo?.error === 'string' ? corpo.error : 'A Evolution API não aceitou o envio.');
      erro.semEnvio = true;
      throw erro;
    },
  };
}
