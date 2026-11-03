import test from 'node:test';
import assert from 'node:assert/strict';
import { conectarMotorCampanhas } from '../src/campanhaIntegracaoMotor.js';

const uid = '11111111-1111-4111-8111-111111111111';
const cid = '22222222-2222-4222-8222-222222222222';
const bid = '33333333-3333-4333-8333-333333333333';
const did = '44444444-4444-4444-8444-444444444444';
const wid = '55555555-5555-4555-8555-555555555555';
const bloco = { id: bid, tipo: 'texto', modo: 'fixo', textos: ['Olá {{nome}}'] };
const plano = { nome: 'A', chips: ['slot_2'], modoChips: 'fixo', retomada: 'manual', blocos: [bloco] };

function bancoFalso() {
  const chamadas = [];
  const client = {
    from(t) {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return {
            data: t === 'ienvia_campanhas_controle'
              ? { owner_id: uid, campanha_id: cid, revisao: 1, plano }
              : { owner_id: uid, campanha_id: cid, revisao: 1, destinatario_id: did, telefone: '5586981234567', nome: 'Bia', campos: {}, ordem: 1, etapa: 0, bloco_config: bloco },
            error: null,
          };
        },
      };
    },
    async rpc(nome, args) {
      chamadas.push(nome);
      if (nome === 'ienvia_reservar_worker_campanha') {
        return { data: [{ campanha_id: cid, destinatario_id: did, etapa: 0, tentativa_id: args.p_tentativa, status: 'em_envio', material: args.p_material }], error: null };
      }
      if (nome === 'ienvia_confirmar_etapa') {
        return { data: [{ campanha_id: cid, destinatario_id: did, etapa: 0, tentativa_id: args.p_tentativa, status: 'confirmada' }], error: null };
      }
      if (nome === 'ienvia_marcar_etapa_incerta') {
        return { data: [{ campanha_id: cid, destinatario_id: did, etapa: 0, tentativa_id: args.p_tentativa, status: 'incerta' }], error: null };
      }
      if (nome === 'ienvia_registrar_falha_campanha') return { data: [{ owner_id: uid, campanha_id: cid }], error: null };
      throw new Error(`RPC inesperada: ${nome}`);
    },
  };
  return { client, chamadas };
}

function motorDe({ client, slot, canalEvolution, registrar = () => {} }) {
  return conectarMotorCampanhas({
    client, userId: uid, workerId: wid, deviceId: 'teste',
    whatsapp: { slots: { slot_1: { slotId: 'slot_1', status: 'disconnected', sock: null }, slot_2: slot }, isAnyOwnSlotPhone: () => false },
    storage: { isContactIgnored: () => false },
    sessaoAtiva: () => true,
    carregarArquivo: async () => {},
    converterVoz: async () => {},
    registrar,
    canalEvolution,
  });
}

test('envia pela Evolution quando o chip não tem socket local', async () => {
  const { client, chamadas } = bancoFalso();
  const enviados = [];
  let registrado = null;
  const canalEvolution = {
    async disponivel(slotId) { assert.equal(slotId, 'slot_2'); return true; },
    async enviar({ campanhaId, destinatarioId, etapa, tentativaId }) {
      enviados.push({ campanhaId, destinatarioId, etapa, tentativaId });
      return { status: 'aceita', messageId: 'msg-evolution-1' };
    },
  };
  const m = motorDe({
    client,
    slot: { slotId: 'slot_2', status: 'disconnected', sock: null },
    canalEvolution,
    registrar: (info) => { registrado = info; },
  });
  const r = await m.processar(cid);
  m.parar();
  assert.equal(r.status, 'confirmada');
  assert.deepEqual(chamadas, ['ienvia_reservar_worker_campanha', 'ienvia_confirmar_etapa']);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].campanhaId, cid);
  assert.equal(enviados[0].destinatarioId, did);
  assert.equal(enviados[0].etapa, 0);
  assert.match(enviados[0].tentativaId, /^[0-9a-f-]{36}$/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(registrado?.enviado?.key?.id, 'msg-evolution-1', 'a mensagem aceita entra no histórico');
  assert.equal(registrado?.acao?.slotId, 'slot_2');
});

test('o socket local tem prioridade e a Evolution não é chamada', async () => {
  const { client } = bancoFalso();
  let enviadosEvolution = 0;
  let enviadosSocket = 0;
  const slot = { slotId: 'slot_2', status: 'connected', sock: { async sendMessage() { enviadosSocket += 1; return { key: { id: 'msg-local' } }; } } };
  const m = motorDe({
    client,
    slot,
    canalEvolution: {
      async disponivel() { throw new Error('não deveria consultar a Evolution com socket vivo'); },
      async enviar() { enviadosEvolution += 1; return { status: 'aceita', messageId: 'x' }; },
    },
  });
  const r = await m.processar(cid);
  m.parar();
  assert.equal(r.status, 'confirmada');
  assert.equal(enviadosSocket, 1);
  assert.equal(enviadosEvolution, 0);
});

test('sem canal disponível não reserva nem envia e a campanha não pausa', async () => {
  const { client, chamadas } = bancoFalso();
  let enviados = 0;
  const m = motorDe({
    client,
    slot: { slotId: 'slot_2', status: 'disconnected', sock: null },
    canalEvolution: { async disponivel() { return false; }, async enviar() { enviados += 1; return { status: 'aceita', messageId: 'x' }; } },
  });
  const r = await m.processar(cid);
  m.parar();
  assert.equal(r.status, 'indisponivel');
  assert.equal(enviados, 0);
  assert.deepEqual(chamadas, [], 'nada é reservado sem chip disponível');
});

test('falha de envio pela Evolution deixa a etapa incerta em vez de reenviar', async () => {
  const { client, chamadas } = bancoFalso();
  const m = motorDe({
    client,
    slot: { slotId: 'slot_2', status: 'disconnected', sock: null },
    canalEvolution: {
      async disponivel() { return true; },
      async enviar() { throw new Error('sem resposta da Evolution'); },
    },
  });
  const r = await m.processar(cid);
  m.parar();
  assert.equal(r.status, 'incerta');
  assert.deepEqual(chamadas, ['ienvia_reservar_worker_campanha', 'ienvia_marcar_etapa_incerta']);
});

test('canal Evolution inválido impede iniciar o motor', () => {
  const { client } = bancoFalso();
  assert.throws(() => motorDe({ client, slot: { slotId: 'slot_2', status: 'disconnected' }, canalEvolution: { disponivel() {} } }), /Canal Evolution inválido/);
});
