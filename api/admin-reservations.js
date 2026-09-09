const { verifySession } = require('./_auth');
const { json } = require('./_utils');
const { listReservations } = require('./_mpstore');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });
  if (!verifySession(req)) return json(res, 401, { error: 'Não autorizado.' });

  try {
    const rows = await listReservations(50);
    const summary = rows.reduce((acc, row) => {
      if (row.status === 'approved') {
        acc.approved += 1;
        acc.revenue += Number(row.amountPaid ?? row.amount ?? 0);
        acc.seats += Number(row.seats || 1);
      } else if (row.status === 'pending') {
        acc.pending += 1;
      }
      return acc;
    }, { approved: 0, pending: 0, revenue: 0, seats: 0, total: rows.length });

    return json(res, 200, { rows, summary, source: 'mercadopago' });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Não foi possível carregar as reservas do Mercado Pago.' });
  }
};
