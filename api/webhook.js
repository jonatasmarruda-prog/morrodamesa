const { WebhookSignatureValidator } = require('mercadopago');
const { getFirestore } = require('./_firebase');
const { json, mpHeaders, mapMpStatus } = require('./_utils');

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

  const xSignature = String(req.headers['x-signature'] || '').trim();
  const xRequestId = String(req.headers['x-request-id'] || '').trim();
  const dataId = dataIdFromRequest(req, body);

  WebhookSignatureValidator.validate({
    xSignature,
    xRequestId,
    dataId,
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
    console.warn('Webhook signature rejected', {
      name: error?.name || 'Error',
      signatureHeader: Boolean(req.headers['x-signature']),
      requestIdHeader: Boolean(req.headers['x-request-id']),
      dataIdPresent: Boolean(dataIdFromRequest(req, body)),
      secretConfigured: Boolean(String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim())
    });
    return json(res, 401, {
      error: 'Assinatura inválida.',
      signatureHeader: Boolean(req.headers['x-signature']),
      requestIdHeader: Boolean(req.headers['x-request-id']),
      dataIdPresent: Boolean(dataIdFromRequest(req, body)),
      secretConfigured: Boolean(String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim())
    });
  }

  try {
    if (body.type !== 'payment') return json(res, 200, { received: true });

    const paymentId = dataIdFromRequest(req, body);
    if (!paymentId) return json(res, 200, { received: true });

    // O simulador oficial usa live_mode=false e um ID fictício.
    // A assinatura já foi validada pelo SDK oficial, então confirmamos o recebimento.
    if (body.live_mode === false) {
      return json(res, 200, { received: true, simulated: true });
    }

    const payment = await fetchPayment(paymentId);
    const reservationId = String(payment.external_reference || '');
    if (!/^TR-\d{4}-[A-F0-9]{6}$/.test(reservationId)) return json(res, 200, { received: true });

    const db = getFirestore();
    const docRef = db.collection('reservations').doc(reservationId);
    const doc = await docRef.get();
    if (!doc.exists) return json(res, 200, { received: true });

    const data = doc.data();
    const status = mapMpStatus(payment.status);
    const expected = Number(data.amount || 0);
    const paid = Number(payment.transaction_amount || 0);
    const amountMatches = Math.abs(expected - paid) < 0.01;
    const finalStatus = status === 'approved' && !amountMatches ? 'review' : status;

    await docRef.update({
      status: finalStatus,
      mpStatus: payment.status || status,
      mpStatusDetail: payment.status_detail || null,
      mpPaymentId: String(payment.id),
      paymentTypeId: payment.payment_type_id || null,
      paymentMethodId: payment.payment_method_id || null,
      installments: payment.installments || 1,
      amountPaid: paid,
      amountMatches,
      approvedAt: payment.date_approved || null,
      updatedAt: new Date().toISOString()
    });

    return json(res, 200, { received: true });
  } catch (error) {
    console.error('Webhook processing error', error);
    return json(res, 500, { error: 'Falha ao processar notificação.' });
  }
};
