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
    || body.error === true
    || nested.error === true
    || nested.ok === false
    || nested.success === false
    || body.status === false
    || nested.status === false
    || (Number.isFinite(Number(body.status)) && Number(body.status) >= 400)
    || (Number.isFinite(Number(nested.status)) && Number(nested.status) >= 400)
    || ['error', 'failed', 'failure', 'rejected'].includes(status)
    || Boolean(errorText);

  if (explicitlyRejected) {
    const message = errorText || (typeof body.message === 'string' ? body.message : '') || 'A Evolution API rejeitou a solicitação.';
    throw Object.assign(new Error(message), { statusCode: 502 });
  }

  return data;
}

/** Só um identificador do provedor permite classificar um envio como aceito. */
export function requireEvolutionMessageId(data) {
  assertEvolutionApiAccepted(data);
  const id = data?.key?.id || data?.data?.key?.id || data?.data?.id || data?.id;
  if (typeof id !== 'string' || !id.trim() || id.length > 300) {
    throw Object.assign(new Error('Envio incerto: a Evolution API não retornou um identificador. Confira a conversa antes de reenviar.'), { statusCode: 502, deliveryUncertain: true });
  }
  return data;
}
