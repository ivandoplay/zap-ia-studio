// Cálculos puros de janelas; não programam timers nem enviam mensagens.
const DIAS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function minutos(valor) {
  if (typeof valor !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(valor)) throw new Error('Horário inválido.');
  return Number(valor.slice(0,2))*60+Number(valor.slice(3));
}
function compilar(config) {
  if (!config || typeof config.fuso !== 'string' || !Array.isArray(config.dias) || config.dias.length===0 || config.dias.some(d=>!Number.isInteger(d)||d<0||d>6)) throw new Error('Dias ou fuso inválidos.');
  const inicio=minutos(config.inicio), fim=minutos(config.fim);
  if (inicio===fim) throw new Error('Janela inválida: início e fim iguais.');
  let formato;
  try { formato=new Intl.DateTimeFormat('en-US',{timeZone:config.fuso,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}); }
  catch { throw new Error('Fuso horário inválido.'); }
  return {inicio,fim,dias:new Set(config.dias),formato};
}
function validarTempo(timestamp) {
  if (!Number.isSafeInteger(timestamp) || timestamp<0 || timestamp>8640000000000000) throw new Error('Instante inválido.');
}
function permitido(c, timestamp) {
  const partes=c.formato.formatToParts(timestamp);
  const valor=tipo=>partes.find(p=>p.type===tipo)?.value;
  const dia=DIAS.indexOf(valor('weekday')), hora=Number(valor('hour'))*60+Number(valor('minute'));
  if (dia<0 || !Number.isFinite(hora)) throw new Error('Data local inválida.');
  if (c.inicio<c.fim) return c.dias.has(dia) && hora>=c.inicio && hora<c.fim;
  return (c.dias.has(dia) && hora>=c.inicio) || (c.dias.has((dia+6)%7) && hora<c.fim);
}
export function estaNaJanela(config, timestamp) {
  validarTempo(timestamp);return permitido(compilar(config),timestamp);
}
export function proximaJanela(config, timestamp) {
  validarTempo(timestamp);const c=compilar(config);
  if (permitido(c,timestamp)) return timestamp;
  let atual=Math.ceil(timestamp/60000)*60000;
  // A semana completa, mais margem para mudança de horário de verão.
  const limite=Math.min(8640000000000000,timestamp+9*24*60*60000);
  for (;atual<=limite;atual+=60000) if (permitido(c,atual)) return atual;
  throw new Error('Não foi possível localizar próxima janela válida.');
}
