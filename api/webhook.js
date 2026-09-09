const { WebhookSignatureValidator } = require('mercadopago');
const { json, mpHeaders } = require('./_utils');

function bodyObject(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body || {};
}

function dataIdFromRequest(req, body = {}) {
  const queryId = req.query?.['data.id']
    || req.query?.data_id
    || (req.query?.data && typeof req.query.data === 'object' ? req.query.data.id : '')
    || '';
  return String(queryId || body.data?.id || '').trim();
}

function validateSignature(req, body) {
  const secret = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim();
  if (!secret) throw new Error('MERCADOPAGO_WEBHOOK_SECRET não configurado.');

  WebhookSignatureValidator.validate({
    xSignature: String(req.headers['x-signature'] || '').trim(),
    xRequestId: String(req.headers['x-request-id'] || '').trim(),
    dataId: dataIdFromRequest(req, body),
    secret
  });
}

async function fetchPayment(id) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, { headers: mpHeaders() });
  if (!response.ok) throw new Error(`Falha ao consultar pagamento ${id}`);
  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });
  const body = bodyObject(req);

  try {
    validateSignature(req, body);
  } catch (error) {
    console.warn('Webhook signature rejected', { name: error?.name || 'Error' });
    return json(res, 401, { error: 'Assinatura inválida.' });
  }

  try {
    if (body.type !== 'payment') return json(res, 200, { received: true });
    const paymentId = dataIdFromRequest(req, body);
    if (!paymentId) return json(res, 200, { received: true });

    // O simulador oficial usa live_mode=false e ID fictício.
    if (body.live_mode === false) return json(res, 200, { received: true, simulated: true });

    // Em produção, consultamos o pagamento na API oficial antes de confirmar o recebimento.
    const payment = await fetchPayment(paymentId);
    const reservationId = String(payment.external_reference || '');
    if (reservationId && !/^TR-\d{4}-[A-F0-9]{6}$/.test(reservationId)) {
      return json(res, 200, { received: true, ignored: true });
    }

    // Não é necessário gravar em banco próprio: o painel e o retorno consultam
    // a situação diretamente no Mercado Pago, que é a fonte de verdade.
    return json(res, 200, { received: true, paymentStatus: payment.status || null });
  } catch (error) {
    console.error('Webhook processing error', error);
    return json(res, 500, { error: 'Falha ao processar notificação.' });
  }
};
