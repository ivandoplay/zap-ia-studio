const CONTACT_PAGE_SIZE = 1000;
const CHAT_PAGE_SIZE = 200;
const CONTACT_MAX_PAGES = 8;
const CHAT_MAX_PAGES = 8;
const HISTORY_SAMPLE_SIZE = 10;

function contactRows(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['contacts', 'data', 'response']) if (Array.isArray(body?.[key])) return body[key];
  return null;
}

function chatRows(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['chats', 'data', 'response']) if (Array.isArray(body?.[key])) return body[key];
  return null;
}

function messageRows(body) {
  const rows = body?.messages?.records || body?.data?.messages?.records || body?.records;
  return Array.isArray(rows) ? rows : null;
}

function isDirectJid(value) {
  return Boolean(value) && !/@(g\.us|broadcast|newsletter)$/i.test(value);
}

function contactJid(row = {}) {
  const raw = String(row.remoteJid || row.id || row.wuid || '').trim();
  if (raw.includes('@')) return isDirectJid(raw) ? raw : '';
  const number = String(row.number || row.phoneNumber || raw).replace(/\D/g, '');
  const jid = number ? `${number}@s.whatsapp.net` : '';
  return isDirectJid(jid) ? jid : '';
}

function chatJid(row = {}) {
  const value = String(row.remoteJid || row.lastMessage?.key?.remoteJid || row.lastMessage?.remoteJid || '').trim();
  return isDirectJid(value) ? value : '';
}

function safeTimestamp(value) {
  if (value === undefined || value === null || value === '') return false;
  const n = Number(value);
  const date = Number.isFinite(n) ? new Date(n < 1_000_000_000_000 ? n * 1000 : n) : new Date(value);
  return !Number.isNaN(date.getTime());
}

async function scanPages({ slotId, kind, pageSize, maxPages, readPage, rowsFrom }) {
  const rows = [];
  let pagesRead = 0;
  let complete = false;
  let errorCategory = null;
  let statusCode = null;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await readPage(slotId, { take: pageSize, skip: page * pageSize });
    if (!response?.ok) {
      errorCategory = response?.errorCategory || 'endpoint_error';
      statusCode = Number(response?.statusCode) || null;
      break;
    }
    const batch = rowsFrom(response.data);
    if (!batch) {
      errorCategory = 'invalid_response_shape';
      break;
    }
    pagesRead += 1;
    rows.push(...batch);
    if (batch.length < pageSize) {
      complete = true;
      break;
    }
  }
  return {
    ok: !errorCategory,
    errorCategory,
    statusCode,
    pagesRead,
    pageSize,
    complete,
    capped: !errorCategory && !complete && pagesRead === maxPages,
    recordsRead: rows.length,
    rows,
    kind,
  };
}

function summarizeContacts(scan) {
  if (!scan.ok) return { ok: false, errorCategory: scan.errorCategory, statusCode: scan.statusCode, pagesRead: scan.pagesRead };
  const ids = scan.rows.map(contactJid).filter(Boolean);
  const unique = new Set(ids);
  return {
    ok: true,
    recordsRead: scan.recordsRead,
    uniqueIdentities: unique.size,
    duplicateRows: Math.max(0, ids.length - unique.size),
    validJidRows: ids.length,
    namedRows: scan.rows.filter((row) => Boolean(String(row.pushName || row.name || row.verifiedName || '').trim())).length,
    profilePictureRows: scan.rows.filter((row) => Boolean(row.profilePictureUrl || row.profilePicUrl)).length,
    pagesRead: scan.pagesRead,
    pageSize: scan.pageSize,
    complete: scan.complete,
    capped: scan.capped,
  };
}

function summarizeChats(scan) {
  if (!scan.ok) return { ok: false, errorCategory: scan.errorCategory, statusCode: scan.statusCode, pagesRead: scan.pagesRead };
  const ids = scan.rows.map(chatJid).filter(Boolean);
  const unique = new Set(ids);
  return {
    ok: true,
    recordsRead: scan.recordsRead,
    uniqueIdentities: unique.size,
    duplicateRows: Math.max(0, ids.length - unique.size),
    validJidRows: ids.length,
    namedRows: scan.rows.filter((row) => Boolean(String(row.pushName || row.name || row.lastMessagePushName || row.lastMessage?.pushName || '').trim())).length,
    pagesRead: scan.pagesRead,
    pageSize: scan.pageSize,
    complete: scan.complete,
    capped: scan.capped,
  };
}

function summarizeMessages(response) {
  if (!response?.ok) return { ok: false, errorCategory: response?.errorCategory || 'endpoint_error', statusCode: Number(response?.statusCode) || null };
  const rows = messageRows(response.data);
  if (!rows) return { ok: false, errorCategory: 'invalid_response_shape', statusCode: null };
  const messageTypes = {};
  const allowedTypes = new Set(['conversation', 'extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage', 'locationMessage', 'contactMessage', 'reactionMessage', 'protocolMessage', 'buttonsResponseMessage', 'listResponseMessage', 'unknown']);
  for (const row of rows) {
    const rawType = String(row?.messageType || (row?.message && Object.keys(row.message).find((key) => /Message$/.test(key))) || 'unknown');
    const type = allowedTypes.has(rawType) ? rawType : 'other';
    messageTypes[type] = (messageTypes[type] || 0) + 1;
  }
  return {
    ok: true,
    sampleSize: rows.length,
    recordsWithProviderId: rows.filter((row) => Boolean(row?.key?.id || row?.id)).length,
    recordsWithValidTimestamp: rows.filter((row) => safeTimestamp(row?.messageTimestamp || row?.timestamp)).length,
    fromMeCount: rows.filter((row) => Boolean(row?.key?.fromMe ?? row?.fromMe)).length,
    messageTypes,
  };
}

/**
 * Read-only, bounded diagnostic. The callbacks must use only provider lookup
 * endpoints. Raw rows stay in memory for aggregation and are never returned.
 */
export async function runReadOnlyEvolutionDiagnostics({ slots, readConnection, readContactsPage, readChatsPage, readMessageSample }) {
  const slotResults = await Promise.all((Array.isArray(slots) ? slots : []).map(async (slotId) => {
    const connection = await readConnection(slotId);
    if (!connection?.ok) {
      return {
        slotId,
        instanceFound: connection?.instanceFound !== false,
        connection: 'unknown',
        connectionErrorCategory: connection?.errorCategory || 'connection_error',
        connectionStatusCode: Number(connection?.statusCode) || null,
        contacts: { ok: false, skipped: true, errorCategory: 'connection_unavailable' },
        chats: { ok: false, skipped: true, errorCategory: 'connection_unavailable' },
        historySample: { ok: false, skipped: true, errorCategory: 'connection_unavailable' },
        internalJids: [],
      };
    }
    if (!connection.instanceFound) {
      return {
        slotId,
        instanceFound: false,
        connection: 'not_found',
        connectionErrorCategory: 'instance_not_found',
        contacts: { ok: false, skipped: true, errorCategory: 'instance_not_found' },
        chats: { ok: false, skipped: true, errorCategory: 'instance_not_found' },
        historySample: { ok: false, skipped: true, errorCategory: 'instance_not_found' },
        internalJids: [],
      };
    }
    const state = String(connection.state || '').toLowerCase();
    if (state !== 'open') {
      return {
        slotId,
        instanceFound: true,
        connection: state === 'close' ? 'disconnected' : state === 'connecting' ? 'connecting' : 'unknown',
        connectionErrorCategory: null,
        contacts: { ok: false, skipped: true, errorCategory: 'instance_not_connected' },
        chats: { ok: false, skipped: true, errorCategory: 'instance_not_connected' },
        historySample: { ok: false, skipped: true, errorCategory: 'instance_not_connected' },
        internalJids: [],
      };
    }

    const [contactScan, chatScan] = await Promise.all([
      scanPages({ slotId, kind: 'contacts', pageSize: CONTACT_PAGE_SIZE, maxPages: CONTACT_MAX_PAGES, readPage: readContactsPage, rowsFrom: contactRows }),
      scanPages({ slotId, kind: 'chats', pageSize: CHAT_PAGE_SIZE, maxPages: CHAT_MAX_PAGES, readPage: readChatsPage, rowsFrom: chatRows }),
    ]);
    const contactSummary = summarizeContacts(contactScan);
    const chatSummary = summarizeChats(chatScan);
    const firstChatJid = chatScan.rows.map(chatJid).find(Boolean) || '';
    const messageResponse = firstChatJid
      ? await readMessageSample(slotId, firstChatJid, { take: HISTORY_SAMPLE_SIZE, skip: 0 })
      : { ok: false, errorCategory: 'no_conversations_to_sample', statusCode: null };
    const historySummary = firstChatJid
      ? summarizeMessages(messageResponse)
      : { ok: true, skipped: true, reason: 'no_conversations_to_sample' };
    const internalJids = [
      ...contactScan.rows.map(contactJid),
      ...chatScan.rows.map(chatJid),
    ].filter(Boolean);

    return {
      slotId,
      instanceFound: true,
      connection: 'connected',
      connectionErrorCategory: null,
      contacts: contactSummary,
      chats: chatSummary,
      historySample: historySummary,
      internalJids,
    };
  }));

  const jidSlots = new Map();
  for (const result of slotResults) {
    for (const jid of new Set(result.internalJids || [])) {
      if (!jidSlots.has(jid)) jidSlots.set(jid, new Set());
      jidSlots.get(jid).add(result.slotId);
    }
  }
  const crossSlotIdentityOverlap = [...jidSlots.values()].filter((seenSlots) => seenSlots.size > 1).length;
  const publicSlots = slotResults.map(({ internalJids: _internal, ...safe }) => safe);
  const endpointsOk = publicSlots.every((slot) =>
    (slot.contacts.ok || slot.contacts.skipped) && (slot.chats.ok || slot.chats.skipped) && (slot.historySample.ok || slot.historySample.skipped)
  );
  const foundCount = publicSlots.filter((slot) => slot.instanceFound).length;
  const connectedCount = publicSlots.filter((slot) => slot.connection === 'connected').length;

  return {
    ok: endpointsOk && connectedCount > 0,
    ...(!foundCount ? { errorCategory: 'no_owned_instances' } : connectedCount === 0 ? { errorCategory: 'no_connected_instances' } : {}),
    ownedInstanceCount: foundCount,
    connectedInstanceCount: connectedCount,
    readOnly: true,
    scope: 'owned_instances_only',
    limits: { contactsMaxPagesPerInstance: CONTACT_MAX_PAGES, contactsPageSize: CONTACT_PAGE_SIZE, chatsMaxPagesPerInstance: CHAT_MAX_PAGES, chatsPageSize: CHAT_PAGE_SIZE, historySamplePerInstance: HISTORY_SAMPLE_SIZE },
    crossSlotIdentityOverlap,
    slots: publicSlots,
  };
}
