/**
 * Normaliza falhas de aplicação devolvidas em HTTP 2xx pelo Evolution API.
 * Um HTTP bem-sucedido significa apenas que a API aceitou a requisição;
 * não é confirmação de entrega ao WhatsApp.
 */
export function assertEvolutionApiAccepted(data) {
  const body = data && typeof data === 'object' ? data : {};
  const nested = body.data && typeof body.data === 'object' ? body.data : {};
  const status = String(body.status ?? nested.status ?? '').toLowerCase();
  const errorValue = body.error ?? nested.error;
  const errorText = typeof errorValue === 'string'
    ? errorValue
    : (typeof errorValue?.message === 'string' ? errorValue.message : '');
  const explicitlyRejected = body.ok === false
    || body.success === false
    || nested.ok === false
    || nested.success === false
    || body.status === false
    || nested.status === false
    || ['error', 'failed', 'failure', 'rejected'].includes(status)
    || Boolean(errorText);

  if (explicitlyRejected) {
    const message = errorText || (typeof body.message === 'string' ? body.message : '') || 'A Evolution API rejeitou a solicitação.';
    throw Object.assign(new Error(message), { statusCode: 502 });
  }

  return data;
}
