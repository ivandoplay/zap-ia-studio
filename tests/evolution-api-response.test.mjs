import assert from 'node:assert/strict';
import { assertEvolutionApiAccepted } from '../src/evolutionApiResponse.js';

const accepted = { status: 'success', data: { id: 'provider-msg-1' } };
assert.equal(assertEvolutionApiAccepted(accepted), accepted);
assert.throws(() => assertEvolutionApiAccepted({ ok: false, error: 'Número indisponível' }), /Número indisponível/);
assert.throws(() => assertEvolutionApiAccepted({ success: false, message: 'Falha simulada' }), /Falha simulada/);
assert.throws(() => assertEvolutionApiAccepted({ data: { status: 'error', error: { message: 'Rejeitado' } } }), /Rejeitado/);
assert.throws(() => assertEvolutionApiAccepted({ status: 'failed' }), /rejeitou a solicitação/);
console.log('OK: falhas de aplicação em HTTP 2xx são rejeitadas; aceitação não implica entrega.');
