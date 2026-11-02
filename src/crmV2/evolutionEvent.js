import { createHash } from 'node:crypto';

const EVENT_KIND = new Map([
  ['MESSAGE', 'message.upsert'],
  ['MESSAGE_RECEIVED', 'message.upsert'],
  ['MESSAGES_UPSERT', 'message.upsert'],
  ['SEND_MESSAGE', 'message.upsert'],
  ['MESSAGES_SET', 'message.snapshot'],
  ['MESSAGES_UPDATE', 'message.update'],
  ['MESSAGES_EDITED', 'message.edit'],
  ['MESSAGES_DELETE', 'message.delete'],
  ['HISTORY_SYNC', 'message.snapshot'],
  ['HISTORYSYNC', 'message.snapshot'],
  ['CONTACTS_SET', 'contact.snapshot'],
  ['CONTACTS_UPSERT', 'contact.upsert'],
  ['CONTACTS_UPDATE', 'contact.update'],
  ['CHATS_SET', 'conversation.snapshot'],
  ['CHATS_UPSERT', 'conversation.upsert'],
  ['CHATS_UPDATE', 'conversation.update'],
  ['CHATS_DELETE', 'conversation.delete'],
  ['CONNECTION_UPDATE', 'connection.update'],
]);

function normalizeEventName(value) {
  return String(value || 'UNKNOWN')
    .trim()
    .toUpperCase()
    .replace(/[.\s-]+/g, '_');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function eventInstance(payload) {
  const value = payload?.instance;
  if (typeof value === 'string') return value.trim();
  return String(value?.data?.instance || value?.instanceName || payload?.instanceName || '').trim();
}

function eventData(payload) {
  return payload?.instance?.data || payload?.data || {};
}

function recordsFor(data, eventName) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (['MESSAGES_SET', 'CONTACTS_SET', 'CHATS_SET'].includes(eventName)) {
    const pluralKey = eventName.startsWith('MESSAGES') ? 'messages' : eventName.startsWith('CONTACTS') ? 'contacts' : 'chats';
    if (Array.isArray(data?.[pluralKey])) return data[pluralKey];
  }
  if (['HISTORY_SYNC', 'HISTORYSYNC'].includes(eventName)) {
    const messages = data?.messages || data?.Messages || data?.history || data?.History;
    if (Array.isArray(messages)) return messages;
    const conversations = data?.conversations || data?.Conversations;
    if (Array.isArray(conversations)) {
      return conversations.flatMap((conversation) => {
        const chatId = conversation.id || conversation.chat || conversation.Info?.Chat || conversation.Jid;
        const nested = conversation.messages || conversation.Messages || [];
        return nested.map((message) => ({ ...message, _chat: message._chat || chatId }));
      });
    }
  }
  if (eventName === 'MESSAGES_DELETE' && Array.isArray(data?.keys)) return data.keys.map((key) => ({ key }));
  return [data];
}

function messageKey(record = {}) {
  return record.key || record.data?.key || record.Info?.Key || record.info?.Key || {};
}

function chatIdentity(record, key) {
  const info = record.Info || record.info || {};
  const value = key.remoteJid || key.remoteJID || record.remoteJid || record.chat || record._chat || info.Chat || info.Sender;
  return String(value || '').trim();
}

function messageIdentity(record, key) {
  const info = record.Info || record.info || {};
  const value = key.id || record.id || info.ID || info.Id;
  return String(value || '').trim();
}

function updateStatus(record = {}) {
  return record.update?.status ?? record.status ?? record.ack ?? record.data?.status ?? record.data?.update?.status ?? null;
}

function normalizeTimestamp(record = {}) {
  const info = record.Info || record.info || {};
  const raw = record.messageTimestamp ?? record.timestamp ?? record.messageTimestampMs ?? info.Timestamp ?? info.TimestampMS ?? null;
  if (raw === null || raw === '') return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeFingerprintRecord(record = {}) {
  // Remove bulky/secret transport-only fields from the dedupe fingerprint.
  const copy = structuredClone(record && typeof record === 'object' ? record : {});
  delete copy.base64;
  if (copy.data && typeof copy.data === 'object') delete copy.data.base64;
  return copy;
}

function makeDedupeKey(event) {
  const identity = {
    instanceName: event.instanceName,
    eventName: event.eventName,
    chatId: event.chatId,
    messageId: event.messageId,
    status: event.eventName === 'MESSAGES_UPDATE' ? event.status : null,
    timestamp: event.messageId ? null : event.timestamp,
    fingerprint: event.messageId ? null : event.fingerprint,
  };
  return createHash('sha256').update(stableJson(identity)).digest('hex');
}

/** Normalize Evolution webhook payload variants to one CRM-internal event per record. */
export function normalizeEvolutionEvent(payload = {}) {
  const instanceName = eventInstance(payload);
  if (!instanceName) throw Object.assign(new Error('Evolution event is missing its instance name.'), { code: 'INVALID_INSTANCE' });

  const eventName = normalizeEventName(payload?.event || payload?.data?.event || payload?.instance?.data?.event);
  const kind = EVENT_KIND.get(eventName) || 'event.unhandled';
  const data = eventData(payload);
  const records = recordsFor(data, eventName);

  return records.map((recordValue) => {
    const record = recordValue && typeof recordValue === 'object' ? recordValue : { value: recordValue };
    const key = messageKey(record);
    const chatId = chatIdentity(record, key);
    const messageId = messageIdentity(record, key);
    const status = updateStatus(record);
    const message = record.message || record.Message || record.data?.message || record.data?.Message || null;
    const fromMeValue = key.fromMe ?? key.IsFromMe ?? record.fromMe ?? record.IsFromMe ?? record.Info?.IsFromMe ?? record.info?.IsFromMe;
    const timestamp = normalizeTimestamp(record);
    const event = {
      schemaVersion: 1,
      instanceName,
      eventName,
      kind,
      chatId: chatId || null,
      messageId: messageId || null,
      fromMe: fromMeValue === undefined ? null : Boolean(fromMeValue),
      status: status === undefined ? null : status,
      timestamp,
      providerKey: key,
      message,
      fingerprint: createHash('sha256').update(stableJson(safeFingerprintRecord(record))).digest('hex'),
    };
    event.dedupeKey = makeDedupeKey(event);
    return event;
  });
}
