import { normalizeEvolutionApiHistoryRecords } from './evolutionApiCloud.js';

/** Merge a page of provider history into the user's CRM without creating unread alerts. */
export function mergeEvolutionApiHistoryPage(storage, chatId, response, { page = 1, pageSize = 50 } = {}) {
  const currentPage = Math.max(1, Math.floor(Number(response?.messages?.currentPage || page) || 1));
  const records = normalizeEvolutionApiHistoryRecords(response, chatId);
  const keyBefore = storage.findSiblingContactKey(chatId) || chatId;
  const before = storage.data.contacts[keyBefore];
  const seen = new Set((before?.messages || []).map((message) => String(message.waMsgId || '')));
  let added = 0;

  for (const message of records) {
    if (!seen.has(message.waMsgId)) added += 1;
    storage.appendContactMessage(chatId, message, { historical: true, deferSave: true });
    seen.add(message.waMsgId);
  }

  const totalPages = Number(response?.messages?.pages || response?.data?.messages?.pages) || 0;
  const rawRecords = Array.isArray(response?.messages?.records) ? response.messages.records
    : Array.isArray(response?.data?.messages?.records) ? response.data.messages.records
      : Array.isArray(response?.records) ? response.records : [];
  const hasMore = totalPages > 0 ? currentPage < totalPages : rawRecords.length >= pageSize;
  const nextPage = hasMore ? currentPage + 1 : currentPage;
  const finalKey = storage.findSiblingContactKey(chatId) || chatId;
  const contact = storage.upsertContact(finalKey, {
    evolutionApiHistoryNextPage: nextPage,
    evolutionApiHistoryComplete: !hasMore,
    evolutionApiHistoryLastPageAt: new Date().toISOString(),
  }, { deferSave: true });
  storage.saveSoon?.();

  return { contact, countAdded: added, importedCount: records.length, hasMore, nextPage, page: currentPage, totalPages };
}
