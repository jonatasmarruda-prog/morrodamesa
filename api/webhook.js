const crypto = require('crypto');
const { getFirestore } = require('./_firebase');
const { json, mpHeaders, mapMpStatus } = require('./_utils');

function safeEqualHex(a, b) {
  try {
    const left = String(a || '').trim();
    const right = String(b || '').trim();
    if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
    const x = Buffer.from(left, 'hex');
    const y = Buffer.from(right, 'hex');
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch {
    return false;
  }
}

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

function validSignature(req, body) {
  const secret = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim();
  if (!secret) return false;

  const xSignature = String(req.headers['x-signature'] || '').trim();
  const xRequestId = String(req.headers['x-request-id'] || '').trim();
  const dataId = dataIdFromRequest(req, body);
  if (!xSignature || !xRequestId || !dataId) return false;

  let ts = '';
  let v1 = '';
  xSignature.split(',').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 'ts') ts = value;
    if (key === 'v1') v1 = value;
  });
  if (!ts || !v1) return false;

  // Mercado Pago assina exatamente o data.id recebido. Não alterar maiúsculas/minúsculas.
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return safeEqualHex(expected, v1);
}

async function fetchPayment(id) {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(id)}`, { headers: mpHeaders() });
  if (!response.ok) throw new Error(`Falha ao consultar pagamento ${id}`);
  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });

  try {
    const body = bodyObject(req);
    if (!validSignature(req, body)) {
      return json(res, 401, {
        error: 'Assinatura inválida.',
        signatureHeader: Boolean(req.headers['x-signature']),
        requestIdHeader: Boolean(req.headers['x-request-id']),
        dataIdPresent: Boolean(dataIdFromRequest(req, body)),
        secretConfigured: Boolean(String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim())
      });
    }

    if (body.type !== 'payment') return json(res, 200, { received: true });

    const paymentId = dataIdFromRequest(req, body);
    if (!paymentId) return json(res, 200, { received: true });

    // O simulador oficial envia live_mode=false e um Data ID fictício.
    // Após validar a assinatura, basta confirmar o recebimento com HTTP 200.
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
    console.error('Webhook error', error);
    return json(res, 500, { error: 'Falha ao processar notificação.' });
  }
};
