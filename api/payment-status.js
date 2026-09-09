const { getFirestore } = require('./_firebase');
const { json, mpHeaders, mapMpStatus } = require('./_utils');

function publicReservation(data) {
  return {
    id: data.id,
    tripTitle: data.tripTitle,
    tripDate: data.tripDate,
    variantName: data.variantName,
    quantity: data.quantity,
    seats: data.seats,
    amount: data.amount,
    paymentMethod: data.paymentMethod,
    status: data.status,
    customerName: data.customer?.name || ''
  };
}

async function reconcilePayment(db, reservationId, paymentId) {
  if (!paymentId || !/^\d+$/.test(String(paymentId))) return;
  const docRef = db.collection('reservations').doc(reservationId);
  const reservationDoc = await docRef.get();
  if (!reservationDoc.exists) return;

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, { headers: mpHeaders() });
  if (!response.ok) return;
  const payment = await response.json();
  if (String(payment.external_reference || '') !== String(reservationId)) return;

  const reservation = reservationDoc.data();
  const status = mapMpStatus(payment.status);
  const expected = Number(reservation.amount || 0);
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
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });
  try {
    const reservationId = String(req.query?.reservation || '').trim();
    const paymentId = String(req.query?.payment_id || '').trim();
    if (!/^TR-\d{4}-[A-F0-9]{6}$/.test(reservationId)) return json(res, 400, { error: 'Reserva inválida.' });

    const db = getFirestore();
    const doc = await db.collection('reservations').doc(reservationId).get();
    if (!doc.exists) return json(res, 404, { error: 'Reserva não encontrada.' });

    if (paymentId) await reconcilePayment(db, reservationId, paymentId);
    const fresh = await db.collection('reservations').doc(reservationId).get();
    return json(res, 200, { reservation: publicReservation(fresh.data()) });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Não foi possível consultar o pagamento.' });
  }
};
