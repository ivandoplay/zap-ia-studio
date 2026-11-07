import test from 'node:test';
import assert from 'node:assert/strict';
import {expandCampaignText, campaignWindowOpen, createCampaignRunner} from '../src/campaigns/runner.js';
import {createDraftSecrets, vaultKeyFromEnv} from '../src/draftSecrets.js';

const OWNER = '28f17e53-1ab8-4ec7-8556-666df0d4add6';
const CAMP = '11111111-1111-4111-8111-111111111111';
const DEST = '22222222-2222-4222-8222-222222222222';

// ── plano → texto ──────────────────────────────────────────────────────────────
test('expande variável do destinatário e mantém o texto aprovado', () => {
  const block = {tipo: 'texto', modo: 'fixo', textos: ['Olá {{nome}}, tudo bem?']};
  assert.equal(expandCampaignText(block, {nome: 'Jefferson'}), 'Olá Jefferson, tudo bem?');
});

test('rotacao escolhe uma variação de forma determinística pelo random injetado', () => {
  const block = {tipo: 'texto', modo: 'rotacao', textos: ['A', 'B', 'C']};
  assert.equal(expandCampaignText(block, {}, () => 0), 'A');
  assert.equal(expandCampaignText(block, {}, () => 0.99), 'C');
});

test('bloco sem texto e mensagem que fica vazia são recusados', () => {
  assert.throws(() => expandCampaignText({tipo: 'texto', textos: []}), /texto aprovado/);
  assert.throws(() => expandCampaignText({tipo: 'texto', textos: ['{{nome}}']}, {}), /ficou vazia/);
});

// ── janela de horário ──────────────────────────────────────────────────────────
test('respeita dias e horário do rascunho no fuso da conta', () => {
  const draft = {fuso: 'America/Fortaleza', dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00'};
  // 2026-11-06 é sexta; 12:00 em Fortaleza (UTC-3).
  assert.equal(campaignWindowOpen(draft, new Date('2026-11-06T15:00:00Z')).open, true);
  assert.equal(campaignWindowOpen(draft, new Date('2026-11-06T23:00:00Z')).open, false);
  // 2026-11-08 é domingo: fora dos dias.
  assert.equal(campaignWindowOpen(draft, new Date('2026-11-08T15:00:00Z')).open, false);
});

// ── execução ───────────────────────────────────────────────────────────────────
function fakeClient({draft, recipients}) {
  const calls = [];
  const sent = [];
  const api = {
    from(table) {
      const q = {
        _op: null,
        select: () => q,
        update: values => { q._op = ['update', values]; return q; },
        eq: () => q,
        maybeSingle: async () => {
          if (table === 'ienvia_campaign_drafts') {
            if (q._op?.[0] === 'update') { calls.push(['draft.update', q._op[1]]); return {data: {id: CAMP, revision: 2}, error: null}; }
            return {data: {id: CAMP, revision: 1, document: draft}, error: null};
          }
          return {data: null, error: null};
        },
        then: (resolve, reject) => {
          if (table === 'ienvia_campanha_destinatarios') { calls.push(['recipient.update', q._op?.[1]]); return Promise.resolve({data: null, error: null}).then(resolve, reject); }
          return Promise.resolve({data: null, error: null}).then(resolve, reject);
        }
      };
      return q;
    },
    rpc: () => {
      const p = Promise.resolve({data: {items: recipients}, error: null});
      p.abortSignal = () => p;
      return p;
    }
  };
  return {client: api, calls, sent};
}

test('executa a campanha de texto pelo chip escolhido e grava progresso', async () => {
  const draft = {
    status: 'pronta', fuso: 'America/Fortaleza', dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '23:59',
    intervalo_min_ms: 0, lote_min: 10, enviados: 0,
    plano: {blocos: [{id: 'b1', tipo: 'texto', modo: 'fixo', textos: ['Oi {{nome}}']}]}
  };
  const {client, calls} = fakeClient({draft, recipients: [
    {destinatario_id: DEST, telefone: '558699999999', nome: 'Ana', enviado: false},
    {destinatario_id: '33333333-3333-4333-8333-333333333333', telefone: '558688888888', nome: 'Bia', enviado: true}
  ]});
  const sent = [];
  const runner = createCampaignRunner({
    client,
    maxPerRun: 5,
    now: () => new Date('2026-11-06T15:00:00Z'),
    transport: {sendText: async (userId, chatId, text) => { sent.push({userId, chatId, text}); return {key: {id: 'wamid_1'}}; }}
  });
  const out = await runner.run({ownerId: OWNER, campaignId: CAMP, slotId: 'slot_1'});
  assert.equal(out.executed, 1);
  assert.equal(out.failed, 0);
  assert.equal(sent[0].chatId, 'slot_1::558699999999@s.whatsapp.net');
  assert.equal(sent[0].text, 'Oi Ana');
  const update = calls.find(c => c[0] === 'draft.update');
  assert.equal(update[1].document.enviados, 1);
  assert.equal(update[1].document.status, 'concluida');
});

test('fora do horário não envia nada e diz o motivo', async () => {
  const draft = {status: 'pronta', fuso: 'America/Fortaleza', dias: [1], inicio: '08:00', fim: '09:00', plano: {blocos: [{tipo: 'texto', textos: ['x']}]}};
  const {client} = fakeClient({draft, recipients: [{destinatario_id: DEST, telefone: '558699999999', enviado: false}]});
  let touched = false;
  const runner = createCampaignRunner({client, now: () => new Date('2026-11-06T15:00:00Z'), transport: {sendText: async () => { touched = true; return {key: {id: 'x'}}; }}});
  const out = await runner.run({ownerId: OWNER, campaignId: CAMP, slotId: 'slot_1'});
  assert.equal(out.executed, 0);
  assert.equal(out.blocked, 'fora_dos_dias');
  assert.equal(touched, false);
});

test('erro do provedor não reenvia e entra em falhas', async () => {
  const draft = {status: 'pronta', fuso: 'America/Fortaleza', dias: [0,1,2,3,4,5,6], inicio: '00:00', fim: '23:59', intervalo_min_ms: 0, plano: {blocos: [{tipo: 'texto', textos: ['Oi']}]}};
  const {client} = fakeClient({draft, recipients: [{destinatario_id: DEST, telefone: '558699999999', enviado: false}]});
  let attempts = 0;
  const runner = createCampaignRunner({client, now: () => new Date('2026-11-06T15:00:00Z'), transport: {sendText: async () => { attempts += 1; throw Object.assign(new Error('sem id'), {code: 'CAMPAIGN_UNCONFIRMED'}); }}});
  const out = await runner.run({ownerId: OWNER, campaignId: CAMP, slotId: 'slot_1'});
  assert.equal(out.executed, 0);
  assert.equal(out.failed, 1);
  assert.equal(attempts, 1);
});

test('exige chip válido e destinatário com telefone plausível', async () => {
  const draft = {status: 'pronta', dias: [0,1,2,3,4,5,6], inicio: '00:00', fim: '23:59', plano: {blocos: [{tipo: 'texto', textos: ['Oi']}]}};
  const {client} = fakeClient({draft, recipients: [{destinatario_id: DEST, telefone: '123', enviado: false}]});
  const runner = createCampaignRunner({client, now: () => new Date('2026-11-06T15:00:00Z'), transport: {sendText: async () => ({key: {id: 'x'}})}});
  await assert.rejects(() => runner.run({ownerId: OWNER, campaignId: CAMP, slotId: 'chip_9'}), /chip que vai enviar/);
  const out = await runner.run({ownerId: OWNER, campaignId: CAMP, slotId: 'slot_1'});
  assert.equal(out.failed, 1);
  assert.equal(out.executed, 0);
});

// ── mídia ─────────────────────────────────────────────────────────────────────
// Regressão: o bloco de imagem/áudio era recusado com CAMPAIGN_MEDIA_PENDING porque o
// runner não tinha de onde tirar o arquivo. Agora usa a MESMA ponte da conversa
// (sendMedia/sendVoice) com o link assinado da biblioteca privada.
const baseDraft = bloco => ({
  status: 'pronta', fuso: 'America/Fortaleza', dias: [0,1,2,3,4,5,6], inicio: '00:00', fim: '23:59',
  intervalo_min_ms: 0, lote_min: 10, enviados: 0, plano: {blocos: [bloco]}
});
const ARQUIVO = '44444444-4444-4444-8444-444444444444';
const PASTA = '55555555-5555-4555-8555-555555555555';

test('campanha de imagem envia o arquivo da pasta pelo mesmo caminho da conversa', async () => {
  const {client} = fakeClient({draft: baseDraft({id: 'b1', tipo: 'imagem', pastaId: PASTA, selecao: 'sequencial'}), recipients: [
    {destinatario_id: DEST, telefone: '558699999999', nome: 'Ana', enviado: false}
  ]});
  const enviados = [];
  const pedidos = [];
  const runner = createCampaignRunner({
    client,
    now: () => new Date('2026-11-06T15:00:00Z'),
    transport: {sendText: async () => ({key: {id: 'x'}}), sendMedia: async (userId, chatId, opts) => { enviados.push({chatId, ...opts}); return {key: {id: 'img_1'}}; }},
    mediaProvider: async query => {
      pedidos.push(query);
      if (query.arquivoId) return {url: 'https://storage.test/sign/foto.jpg?token=abc'};
      return [{arquivoId: ARQUIVO, pastaId: PASTA, nome: 'foto.jpg', mime: 'image/jpeg', tamanho: 1000}];
    }
  });
  const out = await runner.run({ownerId: OWNER, campaignId: CAMP, slotId: 'slot_1'});
  assert.equal(out.executed, 1);
  assert.equal(pedidos[0].folderId, PASTA, 'a pasta vem do bloco do rascunho');
  assert.equal(pedidos[1].arquivoId, ARQUIVO, 'o link é assinado só do arquivo escolhido');
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].type, 'image');
  assert.equal(enviados[0].url, 'https://storage.test/sign/foto.jpg?token=abc');
  assert.equal(enviados[0].mimeType, 'image/jpeg');
  assert.match(out.results[0].providerMessageId, /img_1/);
});

test('campanha de áudio: nota de voz vai normalizada e anexo leva duração', async () => {
  // Áudio real: o conversor do painel antigo executa ffmpeg, então um OGG sintético
  // seria rejeitado (mesma lição do teste da nota de voz em evolution-api-cloud).
  const {execFileSync} = await import('node:child_process');
  const {readFileSync} = await import('node:fs');
  const bin = (await import('ffmpeg-static')).default;
  execFileSync(bin, ['-v','error','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','0.4','-c:a','libopus','-f','ogg','/tmp/teste-campanha-voz.ogg','-y']);
  const oggFake = readFileSync('/tmp/teste-campanha-voz.ogg');
  for (const notaVoz of [true, false]) {
    const {client} = fakeClient({draft: baseDraft({id: 'b1', tipo: 'audio', pastaId: PASTA, selecao: 'sequencial', notaVoz}), recipients: [
      {destinatario_id: DEST, telefone: '558699999999', nome: 'Ana', enviado: false}
    ]});
    const vozes = [];
    const anexos = [];
    const runner = createCampaignRunner({
      client,
      now: () => new Date('2026-11-06T15:00:00Z'),
      transport: {
        sendText: async () => ({key: {id: 'x'}}),
        sendVoice: async (userId, chatId, url) => { vozes.push({chatId, url}); return {key: {id: 'voz_1'}}; },
        sendMedia: async (userId, chatId, opts) => { anexos.push({chatId, ...opts}); return {key: {id: 'anexo_1'}}; }
      },
      mediaProvider: async query => query.arquivoId
        ? {url: 'https://storage.test/sign/voz.ogg?token=abc'}
        : [{arquivoId: ARQUIVO, pastaId: PASTA, nome: 'voz.ogg', mime: 'audio/ogg', tamanho: 66}]
    });
    // O download do arquivo para a nota de voz vai pelo link assinado.
    globalThis.fetch = async () => ({ok: true, arrayBuffer: async () => oggFake.buffer.slice(oggFake.byteOffset, oggFake.byteOffset + oggFake.length)});
    const out = await runner.run({ownerId: OWNER, campaignId: CAMP, slotId: 'slot_1'});
    assert.equal(out.executed, 1, notaVoz ? 'nota de voz enviada' : 'áudio anexo enviado');
    if (notaVoz) {
      assert.equal(vozes.length, 1);
      assert.ok(vozes[0].url.startsWith('data:audio/ogg;base64,'), 'a nota de voz sai como OGG');
      assert.equal(anexos.length, 0);
    } else {
      assert.equal(anexos.length, 1);
      assert.equal(anexos[0].type, 'audio');
      assert.equal(anexos[0].url, 'https://storage.test/sign/voz.ogg?token=abc');
      assert.equal(vozes.length, 0);
    }
  }
});

// ── cofre ─────────────────────────────────────────────────────────────────────
test('cofre só existe com chave de 32 bytes; hex e base64 são aceitos', () => {
  assert.equal(vaultKeyFromEnv({}), null);
  assert.equal(vaultKeyFromEnv({AI_DRAFT_VAULT_KEY: 'curta'}), null);
  assert.equal(vaultKeyFromEnv({AI_DRAFT_VAULT_KEY: 'a'.repeat(64)})?.length, 32);
  assert.equal(vaultKeyFromEnv({AI_DRAFT_VAULT_KEY: Buffer.alloc(32, 7).toString('base64')})?.length, 32);
  const semCofre = createDraftSecrets({});
  assert.equal(semCofre.available, false);
  assert.throws(() => semCofre.requireVault(), /AI_DRAFT_VAULT_KEY/);
  const comCofre = createDraftSecrets({AI_DRAFT_VAULT_KEY: 'b'.repeat(64)});
  assert.equal(comCofre.available, true);
  const envelope = comCofre.requireVault().seal('gemini', 'chave-sintetica-de-teste-123', OWNER);
  assert.equal(comCofre.requireVault().open('gemini', envelope, OWNER), 'chave-sintetica-de-teste-123');
});

test('PIN é selado e verificado, sem guardar o PIN em claro', async () => {
  const secrets = createDraftSecrets({AI_DRAFT_VAULT_KEY: 'c'.repeat(64)});
  const protector = secrets.requirePin();
  const verifier = await protector.seal('582731', OWNER);
  assert.equal(await protector.verify('582731', verifier, OWNER), true);
  assert.equal(await protector.verify('000000', verifier, OWNER), false);
  assert.equal(JSON.stringify(verifier).includes('582731'), false);
});
