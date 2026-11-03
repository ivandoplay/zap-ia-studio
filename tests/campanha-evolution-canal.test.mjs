import test from 'node:test';
import assert from 'node:assert/strict';
import { criarCanalCampanhaEvolution } from '../src/campanhaCanalEvolution.js';

const uid = '11111111-1111-4111-8111-111111111111';
const cid = '22222222-2222-4222-8222-222222222222';
const did = '33333333-3333-4333-8333-333333333333';
const tid = '44444444-4444-4444-8444-444444444444';
const painel = 'https://painel.exemplo.com';

function cliente(sessao = { access_token: 'token-ficticio', user: { id: uid } }) {
  return { auth: { async getSession() { return sessao ? { data: { session: sessao }, error: null } : { data: { session: null }, error: null }; } } };
}
function resposta(corpo, ok = true) { return { ok, async json() { return corpo; } }; }

test('lê os chips do painel por slot e reaproveita a leitura por alguns segundos', async () => {
  let chamadas = 0;
  const fetcher = async (url, init) => {
    chamadas += 1;
    assert.equal(url, `${painel}/api/evolution-cloud/status`);
    assert.equal(init.headers.Authorization, 'Bearer token-ficticio');
    return resposta({ ok: true, available: true, slots: { slot_1: { status: 'disconnected' }, slot_2: { status: 'connected' } } });
  };
  const canal = criarCanalCampanhaEvolution({ client: cliente(), userId: uid, panelUrl: painel, fetcher });
  assert.equal(await canal.disponivel('slot_2'), true);
  assert.equal(await canal.disponivel('slot_1'), false);
  assert.equal(await canal.disponivel('slot_3'), false, 'slot ausente não é chip disponível');
  assert.equal(await canal.disponivel('slot_9'), false, 'slot inválido nunca é disponível');
  assert.equal(await canal.disponivel('slot_2'), true);
  assert.equal(chamadas, 1, 'a leitura deve ser reaproveitada');
});

test('envia a etapa reservada ao painel e devolve aceite com identificador', async () => {
  let enviado;
  const fetcher = async (url, init) => {
    enviado = { url, init };
    return resposta({ ok: true, provider: 'evolution_api', slotId: 'slot_2', messageId: 'msg-ficticia' });
  };
  const canal = criarCanalCampanhaEvolution({ client: cliente(), userId: uid, panelUrl: painel, fetcher });
  const r = await canal.enviar({ campanhaId: cid, destinatarioId: did, etapa: 0, tentativaId: tid });
  assert.deepEqual(r, { status: 'aceita', messageId: 'msg-ficticia' });
  assert.equal(enviado.url, `${painel}/api/campaigns/${cid}/steps/send`);
  assert.equal(enviado.init.method, 'POST');
  assert.equal(enviado.init.headers.Authorization, 'Bearer token-ficticio');
  assert.deepEqual(JSON.parse(enviado.init.body), { destinatarioId: did, etapa: 0, tentativaId: tid });
});

test('recusa explícita do painel não vira aceite', async () => {
  const fetcher = async () => resposta({ ok: false, error: 'Este chip está desconectado na Evolution API.' }, false);
  const canal = criarCanalCampanhaEvolution({ client: cliente(), userId: uid, panelUrl: painel, fetcher });
  await assert.rejects(() => canal.enviar({ campanhaId: cid, destinatarioId: did, etapa: 0, tentativaId: tid }), /desconectado/);
});

test('falha de rede no envio é lançada para o executor marcar como incerta', async () => {
  const fetcher = async () => { throw new Error('rede'); };
  const canal = criarCanalCampanhaEvolution({ client: cliente(), userId: uid, panelUrl: painel, fetcher });
  await assert.rejects(() => canal.enviar({ campanhaId: cid, destinatarioId: did, etapa: 0, tentativaId: tid }), /Não foi possível concluir o envio/);
});

test('sem snapshots anteriores, a consulta indisponível falha de forma visível', async () => {
  const fetcher = async () => { throw new Error('rede'); };
  const canal = criarCanalCampanhaEvolution({ client: cliente(), userId: uid, panelUrl: painel, fetcher });
  await assert.rejects(() => canal.disponivel('slot_1'), /Não foi possível consultar os chips/);
});

test('depois da primeira leitura, uma queda de rede reaproveita o último estado conhecido', async () => {
  let falhar = false;
  const fetcher = async () => {
    if (falhar) throw new Error('rede');
    return resposta({ ok: true, slots: { slot_1: { status: 'connected' } } });
  };
  let agora = 1_000_000;
  const canal = criarCanalCampanhaEvolution({ client: cliente(), userId: uid, panelUrl: painel, fetcher, agora: () => agora });
  assert.equal(await canal.disponivel('slot_1'), true);
  falhar = true;
  agora += 60_000;
  assert.equal(await canal.disponivel('slot_1'), true, 'estado anterior evita pausar por oscilação');
});

test('valida origem do painel, sessão e identificadores antes de qualquer chamada', async () => {
  assert.throws(() => criarCanalCampanhaEvolution({ client: cliente(null), userId: uid, panelUrl: 'http://inseguro.exemplo.com' }), /Origem do painel inválida/);
  assert.throws(() => criarCanalCampanhaEvolution({ client: {}, userId: uid, panelUrl: painel }), /Canal Evolution inválido/);
  const semSessao = criarCanalCampanhaEvolution({ client: cliente(null), userId: uid, panelUrl: painel, fetcher: async () => resposta({ ok: true, slots: {} }) });
  await assert.rejects(() => semSessao.disponivel('slot_1'), /sessão do titular/);
  const canal = criarCanalCampanhaEvolution({ client: cliente(), userId: uid, panelUrl: painel, fetcher: async () => { throw new Error('não deveria chamar'); } });
  await assert.rejects(() => canal.enviar({ campanhaId: 'x', destinatarioId: did, etapa: 0, tentativaId: tid }), /Etapa de campanha inválida/);
});
