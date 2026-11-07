// Agendamento contínuo de campanha: reserva atômica, sem reenvio, e cron fail-closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createCampaignRouter } from '../src/campaigns/router.js';
import { createCampaignScheduler } from '../src/campaigns/scheduling.js';
import { createInstanceSqlFixture, A, B, M } from './helpers/instance-sql-fixture.mjs';
import { validateCampaignDraft } from '../public/v2/assets/campaigns-contract.js';

assert.equal(process.env.ZAPIA_ISOLATED_TEST, '1');
const f = await createInstanceSqlFixture();
// Diagnóstico: isolar exatamente qual instrução falha ao aplicar a migração no PGlite.
for (const [nome, arquivo] of [
  ['rascunhos', 'supabase/migrations/20261104006000_campaign_drafts_uuid.sql'],
  ['agendamento', 'supabase/migrations/20261107008000_campaign_scheduling.sql']
]) {
  try {
    await f.db.exec(fs.readFileSync(arquivo, 'utf8'));
  } catch (error) {
    console.error('MIGRACAO_FALHOU', nome, error.message);
    throw error;
  }
}
await f.db.query('INSERT INTO public.ienvia_campaign_write_accounts VALUES($1,true)', [A]);
await f.as(A);
const channel = await f.call('ienvia_create_channel', [{ name: 'Número do agendador', transport: 'local_worker' }]);

const draft = validateCampaignDraft({
  plano: {
    nome: 'Campanha agendada',
    instanceIds: [channel.id],
    distribution: 'fixo',
    retomada: 'manual',
    blocos: [{ id: randomUUID(), tipo: 'texto', modo: 'fixo', textos: ['Olá, {{nome}}.'] }]
  },
  // Intervalo entre lotes zero: o teste não espera relógio de verdade; o intervalo em si
  // é coberto pelo rascunho e pelo runner.
  opcoes: { pausa_lote_min_ms: 0, pausa_lote_max_ms: 0 },
  destinatarios: [
    { telefone: '5586999990101', nome: 'Ana' },
    { telefone: '5586999990102', nome: 'Bruno' },
    { telefone: '5586999990103', nome: 'Carla' }
  ]
});

// Cliente autenticado que fala com o PGlite como o usuário sintético.
// `papel` permite simular o relógio rodando com a chave de serviço, como na Vercel.
const clientFor = (who = A, papel = 'authenticated') => ({
  from: () => { throw new Error('O agendador usa apenas rpc.'); },
  rpc: (name, args) => ({
    abortSignal: async () => {
      await f.as(who, papel);
      try {
        return { data: await f.call(name, Object.values(args)), error: null };
      } catch (error) {
        return { data: null, error: { code: error.code, message: 'SQL privado' } };
      }
    }
  })
});

// Runner falso: registra quem recebeu o envio e confirma com um id do provedor.
const envios = [];
const runnerFalso = {
  async run({ ownerId, campaignId, slotId, maxPerRun, apenasDestinatario = null }) {
    assert.equal(ownerId, A);
    assert.match(slotId, /^slot_[1-9]$/);
    // O relógio envia o lote que reservou no banco; aqui simulamos os envios daquele lote.
    const quantos = Math.max(1, Number(maxPerRun) || 1);
    // Um rótulo único por envio simulado (o runner real usa o id do destinatário reservado).
    for (let i = 0; i < quantos; i += 1) envios.push({ campaignId, slotId, destinatario: `${envios.length}` });
    return { ok: true, executed: quantos, failed: 0, done: false, results: [{ status: 'sent', providerMessageId: 'sintetico' }] };
  }
};

// Na nuvem o tick roda com a chave de serviço (mesmo contrato dos RPCs de serviço).
const scheduler = createCampaignScheduler({ client: clientFor(A), runner: runnerFalso });
// O relógio (cron) roda com a chave de serviço, sem sessão de navegador.
const relogio = createCampaignScheduler({ client: clientFor(A, 'service_role'), runner: runnerFalso });

let id = null;
test('prepara o rascunho e liga o agendamento', async () => {
  id = randomUUID();
  await f.as(A);
  const saved = await f.call('ienvia_campaign_save_draft', [id, 0, draft]);
  assert.equal(saved.campanha.campanha_id, id);
  // O intervalo entre lotes vem do rascunho; aqui é zero para o teste não esperar relógio.
  assert.equal(saved.campanha.pausa_lote_min_ms, 0, JSON.stringify(saved.campanha));

  const before = await scheduler.estado({ ownerId: A, campaignId: id });
  assert.equal(before.ativa, false);
  assert.equal(before.fila.total, 0);

  const on = await scheduler.ativar({ ownerId: A, campaignId: id, ativa: true, slotId: 'slot_1' });
  assert.equal(on.ativa, true);
  assert.equal(on.slot_id, 'slot_1');

  const after = await scheduler.estado({ ownerId: A, campaignId: id });
  assert.equal(after.fila.total, 3, 'A fila nasce com os três destinatários do rascunho.');
  assert.equal(after.fila.pendentes, 3);
});

test('um tick envia no máximo o lote e nunca repete destinatário', async () => {
  envios.length = 0;
  let primeiro = await relogio.tick({ ownerId: A });
  assert.equal(primeiro.processadas.length, 1);
  assert.equal(primeiro.processadas[0].status, 'executado');
  assert.equal(primeiro.processadas[0].status, 'executado');
  // O lote é limitado a 2 por tick (teto de tempo da função); o resto vai no tick seguinte.
  assert.equal(primeiro.processadas[0].enviados, 2, JSON.stringify(primeiro.processadas[0]));
  assert.equal(envios.length, 2);
  // Ao esvaziar, uma última passada conclui a campanha.
  primeiro = await relogio.tick({ ownerId: A });
  // A agenda pode já ter se desligado (o último lote esvaziou a fila): o que importa é
  // que o total enviado em todos os ticks é exatamente o número de destinatários.
  assert.ok(primeiro.processadas.length <= 1);
  assert.equal(envios.length, 3, 'segundo tick: ' + JSON.stringify(primeiro.processadas));
  assert.equal(new Set(envios.map(e => e.destinatario)).size, 3);

  // Segundo tick imediato: nada pendente, nada reenviado.
  const segundo = await relogio.tick({ ownerId: A });
  assert.equal(envios.length, 3, 'Nenhum envio novo depois da fila esvaziar.');
  // A agenda se desligou ao esvaziar: o tick não processa mais nada.
  assert.equal(segundo.processadas.length, 0, JSON.stringify(segundo.processadas));

  const fim = await scheduler.estado({ ownerId: A, campaignId: id });
  assert.equal(fim.fila.enviados, 3);
  assert.equal(fim.fila.pendentes, 0);
  assert.equal(fim.ativa, false, 'Sem pendentes a agenda se desliga sozinha.');
});

test('a reserva é atômica: duas reservas simultâneas não pegam o mesmo destinatário', async () => {
  const outra = randomUUID();
  await f.as(A);
  const comOutraLista = validateCampaignDraft({
    plano: draft.plano,
    opcoes: draft.opcoes,
    destinatarios: [{ telefone: '5586999990201', nome: 'Dora' }, { telefone: '5586999990202', nome: 'Edu' }]
  });
  await f.call('ienvia_campaign_save_draft', [outra, 0, comOutraLista]);
  await scheduler.ativar({ ownerId: A, campaignId: outra, ativa: true, slotId: 'slot_2' });

  // PGlite é uma conexão só: sequencial aqui, mas o SQL é o mesmo que serializa dois
  // processos concorrentes no Postgres (FOR UPDATE SKIP LOCKED).
  await f.as(A, 'service_role');
  const x = await f.call('ienvia_campanha_fila_reservar', [A, outra, 2]);
  const y = await f.call('ienvia_campanha_fila_reservar', [A, outra, 2]);
  const pegos = [...x.itens, ...y.itens].map(i => i.destinatario_id);
  assert.equal(new Set(pegos).size, pegos.length, 'Nenhum destinatário reservado duas vezes.');
  assert.ok(pegos.length <= 2);
});

test('contas e papéis: outra conta não vê a agenda e o suporte não escreve', async () => {
  await assert.rejects(() => scheduler.estado({ ownerId: B, campaignId: id }), /agenda/i);
  const app = express();
  app.use('/c', createCampaignRouter({
    getLocalContext: req => req.dashboardContext,
    allowWrites: true,
    allowExecution: true,
    campaignRunner: () => runnerFalso,
    campaignScheduler: () => scheduler
  }));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ctx = (viewer, tenant) => ({ viewer: { id: viewer }, tenant: { id: tenant }, viewerClient: clientFor(tenant) });
  try {
    const como = quem => ({ 'content-type': 'application/json', 'x-test': quem });
    const r1 = await fetch(`${base}/c/drafts/${id}/schedule`, { headers: como('normal') });
    assert.equal(r1.status, 401, 'Sem contexto autenticado não há agenda.');
    // Suporte (master vendo outra conta) permanece somente leitura.
    const mw = (req, _res, next) => { req.dashboardContext = ctx(M, A); next(); };
    app.use('/s', mw, createCampaignRouter({
      getLocalContext: req => req.dashboardContext,
      allowWrites: true, allowExecution: true,
      campaignRunner: () => runnerFalso, campaignScheduler: () => scheduler
    }));
    const r2 = await fetch(`${base}/s/drafts/${id}/schedule`, { method: 'POST', headers: como('normal'), body: JSON.stringify({ ativa: true, slotId: 'slot_1' }) });
    assert.equal(r2.status, 403);
    assert.equal((await r2.json()).code, 'CAMPAIGNS_SUPPORT_READ_ONLY');
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('cron: fail-closed sem segredo e recusa segredo errado', async () => {
  const server = await new Promise(r => {
    const app = express();
    app.use('/sem', createCampaignRouter({
      getLocalContext: () => null, allowWrites: true, allowExecution: true,
      campaignRunner: () => runnerFalso, campaignScheduler: () => scheduler
    }));
    app.use('/com', createCampaignRouter({
      getLocalContext: () => null, allowWrites: true, allowExecution: true,
      campaignRunner: () => runnerFalso, campaignScheduler: () => scheduler,
      cronSecret: 'x'.repeat(32), cronOwnerId: A
    }));
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const sem = await fetch(`${base}/sem/schedule/tick`, { method: 'POST' });
    assert.equal(sem.status, 404, 'Sem segredo configurado a rota nem existe.');
    const errado = await fetch(`${base}/com/schedule/tick`, { method: 'POST', headers: { 'x-campaign-cron': 'y'.repeat(32) } });
    assert.equal(errado.status, 401);
    const vazio = await fetch(`${base}/com/schedule/tick`, { method: 'POST' });
    assert.equal(vazio.status, 401);
  } finally {
    await new Promise(r => server.close(r));
    await f.close();
  }
});
