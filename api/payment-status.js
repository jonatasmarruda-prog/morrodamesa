const { json } = require('./_utils');
const { findPreference, findPayment, normalizeReservation, reservationPattern } = require('./_mpstore');

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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });
  try {
    const reservationId = String(req.query?.reservation || '').trim();
    if (!reservationPattern(reservationId)) return json(res, 400, { error: 'Reserva inválida.' });

    const [preference, payment] = await Promise.all([
      findPreference(reservationId),
      findPayment(reservationId)
    ]);

    if (!preference) return json(res, 404, { error: 'Reserva não encontrada.' });
    const reservation = normalizeReservation(preference, payment);
    return json(res, 200, { reservation: publicReservation(reservation) });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Não foi possível consultar o pagamento.' });
  }
};
