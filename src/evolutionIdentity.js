// Identidade compartilhada entre consultas, envios e ingresso de eventos.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function evolutionInstanceIdentity(name, env = process.env) {
  if (typeof name !== 'string' || name.length > 200) return null;
  const canonical = name.match(/^zap-ia-([0-9a-f-]{36})-(slot_[1-3])$/i);
  if (canonical && UUID.test(canonical[1])) return { userId: canonical[1].toLowerCase(), slotId: canonical[2].toLowerCase() };
  let map;
  try { map = JSON.parse(env.EVOLUTION_INSTANCE_USERS || '{}'); } catch { return null; }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const entry = Object.hasOwn(map, name) ? map[name] : null;
  const legacySlot = name.match(/^zap-ia-(slot_[1-3])$/)?.[1];
  const userId = typeof entry === 'string' ? entry : entry?.userId || (legacySlot ? env.EVOLUTION_DEFAULT_USER_ID : null);
  const slotId = entry?.slotId || legacySlot;
  // Nomes personalizados devem declarar também o chip: nunca colidir silenciosamente com slot_1.
  return UUID.test(userId || '') && /^slot_[1-3]$/.test(slotId || '') ? { userId: userId.toLowerCase(), slotId } : null;
}
export function evolutionBoolean(value) {
  return value === true || value === 'true' || value === 1;
}
export function evolutionTimestamp(value, fallback = Date.now()) {
  const n = Number(value);
  const date = value === undefined || value === null || value === '' ? new Date(fallback)
    : Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString();
}
export function evolutionAck(value) {
  if (typeof value === 'number' || /^\d+$/.test(String(value ?? ''))) {
    const n = Number(value); return n >= 4 ? 3 : n === 3 ? 2 : n === 2 ? 1 : 0;
  }
  const status = String(value || '').toUpperCase();
  return ['READ', 'PLAYED'].includes(status) ? 3 : ['DELIVERY_ACK', 'DELIVERED'].includes(status) ? 2 : ['SERVER_ACK', 'SENT'].includes(status) ? 1 : 0;
}
export function unwrapEvolutionMessage(message = {}) {
  let current = message;
  for (let i = 0; i < 6; i++) {
    const nested = current.ephemeralMessage?.message || current.viewOnceMessage?.message || current.viewOnceMessageV2?.message || current.documentWithCaptionMessage?.message;
    if (!nested) break;
    current = nested;
  }
  return current;
}
