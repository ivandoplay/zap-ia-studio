/**
 * Durable ingress boundary for Evolution webhooks.
 *
 * `repository.persistEventAndOutbox(tenantId, event)` must be one database
 * transaction: insert an idempotent event, apply its CRM projection when
 * supported, and enqueue a user-scoped notification. Provider ACK is returned
 * only after this durable operation succeeds. No AI call or message send belongs
 * in this request path.
 */
import { normalizeEvolutionEvent } from './evolutionEvent.js';

export async function ingestEvolutionWebhook(payload, { resolveTenant, repository } = {}) {
  if (typeof resolveTenant !== 'function') throw new TypeError('resolveTenant is required.');
  if (!repository || typeof repository.persistEventAndOutbox !== 'function') {
    throw new TypeError('A durable repository is required.');
  }

  const events = normalizeEvolutionEvent(payload);
  let tenantId;
  try {
    tenantId = await resolveTenant(events[0].instanceName);
  } catch (error) {
    throw Object.assign(new Error('Evolution instance is not mapped to a CRM tenant.'), { code: 'UNKNOWN_INSTANCE', cause: error });
  }
  if (!tenantId) throw Object.assign(new Error('Evolution instance is not mapped to a CRM tenant.'), { code: 'UNKNOWN_INSTANCE' });

  let inserted = 0;
  let duplicates = 0;
  for (const event of events) {
    // Must complete before acknowledging the provider. The repository owns the
    // transaction, idempotency constraint and durable outbox semantics.
    const result = await repository.persistEventAndOutbox(tenantId, event);
    if (result?.inserted) inserted += 1;
    else duplicates += 1;
  }

  return { ok: true, accepted: events.length, inserted, duplicates };
}
