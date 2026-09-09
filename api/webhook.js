const crypto = require('crypto');
const { getFirestore } = require('./_firebase');
const { json, mpHeaders, mapMpStatus } = require('./_utils');

function safeEqualHex(a, b) {
  try {
    const x = Buffer.from(String(a || ''), 'hex');
    const y = Buffer.from(String(b || ''), 'hex');
    return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch {
    return false;
  }
}

function validSignature(req) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return false;
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  const rawId = req.query?.['data.id'] || req.query?.data_id || '';
  const dataId = String(rawId || '').toLowerCase();
  if (!xSignature || !xRequestId || !dataId) return false;

  let ts = '';
  let v1 = '';
  String(xSignature).split(',').forEach((part) => {
    const [key, value] = part.split('=', 2).map((v) => v?.trim());
    if (key === 'ts') ts = value || '';
    if (key === 'v1') v1 = value || '';
  });
  if (!ts || !v1) return false;

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
    if (!validSignature(req)) return json(res, 401, { error: 'Assinatura inválida.' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (body.type !== 'payment') return json(res, 200, { received: true });

    const paymentId = body.data?.id || req.query?.['data.id'] || req.query?.data_id;
    if (!paymentId) return json(res, 200, { received: true });

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
