// Agendamento contínuo de campanha: um "tick" processa o próximo lote de cada campanha
// cuja hora chegou. Não reimplementa envio — delega ao mesmo `run` do runner, que já
// respeita intervalo, janela de horário e reserva por destinatário.
//
// Garantias (as mesmas do resto do motor, nada novo em cima):
//  - a fila é durável e a reserva é atômica no banco (FOR UPDATE SKIP LOCKED);
//  - reexecutar o tick nunca reenvia para quem já foi reservado;
//  - erro no meio não repete envio: a etapa fica registrada e a agenda mostra o motivo;
//  - desligar é imediato: `ativa=false` e o próximo tick não pega a campanha.
import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT = /^slot_[1-9]$/;
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

// Uma chamada de RPC autenticada, com validação de dono na resposta.
export function createCampaignScheduler({ client, runner, runnerFor = null, maxCampanhas = 5, servico = false } = {}) {
  if (!client || typeof client.rpc !== 'function') throw new TypeError('Cliente autenticado obrigatório.');
  const call = async (ownerId, name, args) => {
    const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(8000));
    if (error) {
      // O código do banco é preservado: 42501 (sem permissão) e 55000 (não homologado)
      // precisam chegar ao cliente como recusa, não como falha genérica.
      const status = error.code === '42501' ? 403 : error.code === '40001' ? 409 : error.code === 'P0002' ? 404 : error.code === '22023' ? 400 : 503;
      const code = error.code === '42501' ? 'CAMPAIGN_SCHEDULE_FORBIDDEN' : error.code === '55000' ? 'CAMPAIGN_SCHEDULE_DISABLED' : 'CAMPAIGN_SCHEDULE_UNAVAILABLE';
      throw fail(status, code, status === 503 ? 'Não foi possível consultar a agenda agora.' : 'O agendamento não foi autorizado para esta conta.');
    }
    if (!data || data.ownerId !== ownerId) throw fail(503, 'CAMPAIGN_SCHEDULE_INVALID', 'Resposta de agenda inválida.');
    return data;
  };
  const runFor = campaignId => (typeof runnerFor === 'function' ? runnerFor(campaignId) : runner);
  // Lista de pendentes pelo caminho de serviço (usada só quando o relógio roda sem sessão).
  const pendentesDe = async ({ ownerId, campaignId, limite }) => {
    const d = await call(ownerId, 'ienvia_campanha_fila_pendentes', { p_owner: ownerId, p_id: campaignId, p_limite: limite });
    return Array.isArray(d.destinatarios) ? d.destinatarios : [];
  };
  const n = v => Math.max(0, Math.min(25, Number(v) || 0));

  // O relógio roda com a chave de serviço (sem sessão): a fila usa RPCs de serviço e o
  // runner é injetado lendo o mesmo rascunho pelo cliente privilegiado.
  async function estado({ ownerId, campaignId }) {
    if (!UUID.test(ownerId) || !UUID.test(campaignId)) throw fail(400, 'CAMPAIGN_SCHEDULE_INPUT', 'Campanha inválida.');
    const d = await call(ownerId, 'ienvia_campanha_agenda_estado', { p_owner: ownerId, p_id: campaignId });
    return { ...d, fila: { ...d.fila, total: n(d.fila?.total), enviados: n(d.fila?.enviados), falhas: n(d.fila?.falhas), pendentes: n(d.fila?.pendentes) } };
  }

  async function ativar({ ownerId, campaignId, ativa = true, slotId = null, inicioEm = null }) {
    if (!UUID.test(ownerId) || !UUID.test(campaignId)) throw fail(400, 'CAMPAIGN_SCHEDULE_INPUT', 'Campanha inválida.');
    if (ativa === true && !SLOT.test(String(slotId || ''))) throw fail(400, 'CAMPAIGN_SCHEDULE_INPUT', 'Escolha o chip que vai enviar.');
    const inicio = inicioEm ? new Date(inicioEm) : null;
    if (inicio && !Number.isFinite(inicio.getTime())) throw fail(400, 'CAMPAIGN_SCHEDULE_INPUT', 'Data de início inválida.');
    const d = await call(ownerId, 'ienvia_campanha_agenda_ativar', {
      p_owner: ownerId,
      p_id: campaignId,
      p_ativa: ativa === true,
      p_slot: ativa === true ? slotId : null,
      p_inicio: ativa === true ? (inicio ? inicio.toISOString() : null) : null
    });
    return d;
  }

  // Um tick: para cada campanha vencida, reserva o lote no banco e envia aquelas etapas.
  // `enviado` na fila é a reserva — o envio usa exatamente aquela lista, nunca a lista do rascunho.
  async function tick({ ownerId, limite = maxCampanhas } = {}) {
    if (!UUID.test(ownerId)) throw fail(401, 'CAMPAIGN_SCHEDULE_AUTH', 'Entre na sua conta.');
    const vencidas = await call(ownerId, 'ienvia_campanha_agenda_vencidas', { p_owner: ownerId, p_limite: Math.max(1, Math.min(25, Number(limite) || 5)) });
    // A agenda (uma linha por campanha) dá o chip, o lote e o "não repetir antes da hora":
    // o relógio não inventa esses valores nem depende do chamador.
    const agenda = async campaignId => call(ownerId, 'ienvia_campanha_agenda_servico', { p_owner: ownerId, p_id: campaignId });
    const agora = Date.now();
    const podeRodar = a => a && a.ativa === true && Number.isFinite(Date.parse(a.proxima_em)) && Date.parse(a.proxima_em) <= agora;
    const processadas = [];
    for (const item of Array.isArray(vencidas.itens) ? vencidas.itens : []) {
      if (!UUID.test(item.campanha_id) || !SLOT.test(item.slot_id)) continue;
      const campaignId = item.campanha_id;
      const ag = await agenda(campaignId).catch(() => null);
      if (!podeRodar(ag)) { processadas.push({ campaignId, status: 'adiada' }); continue; }
      const chip = String(ag.slot_id || '');
      if (!SLOT.test(chip)) { processadas.push({ campaignId, status: 'sem_chip' }); continue; }
      const executor = runFor(campaignId);
      if (!executor || typeof executor.run !== 'function') {
        processadas.push({ campaignId, status: 'sem_executor' });
        continue;
      }
      // Um lote por vez, respeitando o teto da agenda. O relógio roda a cada minuto e a
      // função da Vercel tem 60s: reservar pouco é o que garante que nada fica pela metade.
      const reserva = await call(ownerId, 'ienvia_campanha_fila_reservar', {
        p_owner: ownerId,
        p_id: campaignId,
        p_limite: Math.max(1, Math.min(2, Number(ag.lote) || 5))
      });
      const itens = Array.isArray(reserva.itens) ? reserva.itens : [];
      if (!itens.length) {
        // Nada pendente: conclui a agenda para o cron parar de chamar.
        await call(ownerId, 'ienvia_campanha_agenda_reagendar', { p_owner: ownerId, p_id: campaignId, p_espera_ms: 0, p_resultado: { at: new Date().toISOString(), motivo: 'sem_pendentes' } });
        processadas.push({ campaignId, status: 'sem_pendentes' });
        continue;
      }
      // A reserva feita no banco é a lista exata deste lote: o runner envia uma vez por
      // etapa e a fila já impede que outro tick pegue os mesmos destinatários. Se o envio
      // recusar COM CERTEZA (lista vazia/erro de contrato), devolvemos a reserva.
      let enviados = 0;
      let falhas = 0;
      let motivo = null;
      try {
        const out = await executor.run({ ownerId, campaignId, slotId: chip, maxPerRun: itens.length });
        enviados = Math.max(0, Math.min(itens.length, Number(out?.executed) || 0));
        falhas = Math.max(0, Number(out?.failed) || 0);
        // O motivo da falha vem do próprio runner: é o que permite diagnosticar sem adivinhar.
        motivo = (Array.isArray(out?.results) ? out.results.find(r => r && r.status === 'failed')?.code : null) || out?.blocked || motivo;
      } catch (error) {
        // Falha de contrato ANTES de qualquer envio (lista vazia, janela fechada, plano
        // inválido): nada saiu e a reserva volta para a fila. Se houve tentativa de envio,
        // o erro não é "nada saiu" — a etapa fica como está e aparece no resumo.
        const nadaSaiu = ['CAMPAIGN_MEDIA_PENDING', 'CAMPAIGN_TEXT_EMPTY', 'CAMPAIGN_BLOCK_INVALID', 'CAMPAIGN_NOT_EXECUTABLE'].includes(error?.code);
        if (nadaSaiu) {
          // Um lote reservado sem envio volta inteiro: nada saiu, então nada pode ficar
          // marcado como enviado nem se perder.
          await call(ownerId, 'ienvia_campanha_fila_liberar', { p_owner: ownerId, p_id: campaignId, p_motivo: error.code }).catch(() => {});
        }
        falhas = itens.length;
        motivo = error?.code || 'send_failed';
      }
      // O intervalo entre lotes vem do próprio rascunho; sem ele, espera o padrão do produto.
      // Intervalo do rascunho, sem tropeçar no zero: só usamos o padrão quando o valor
      // não é um número válido.
      const bruto = Number(ag.intervalo_lote_ms);
      const intervalo = Number.isFinite(bruto) && bruto >= 0
        ? Math.min(604800000, Math.round(bruto))
        : 20000;
      const out = await call(ownerId, 'ienvia_campanha_agenda_reagendar', {
        p_owner: ownerId,
        p_id: campaignId,
        p_espera_ms: intervalo,
        p_resultado: { at: new Date().toISOString(), executados: enviados, falhas }
      });
      processadas.push({ campaignId, status: 'executado', enviados, falhas, proximaEm: out.proxima_em, ativa: out.ativa, restantes: out.restantes });
    }
    return { ok: true, tickId: randomUUID(), processadas, at: new Date().toISOString() };
  }

  return Object.freeze({ estado, ativar, tick, pendentesDe, servico: servico === true });
}
