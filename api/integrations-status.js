const { json, mercadoPagoTokenMode } = require('./_utils');
const { verifySession } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });
  if (!verifySession(req)) return json(res, 401, { error: 'Não autorizado.' });

  const productionCredential = mercadoPagoTokenMode() === 'production';
  const status = {
    mercadoPago: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
    mercadoPagoProduction: productionCredential,
    webhook: Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET),
    reservations: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
    appUrl: Boolean(process.env.APP_URL),
    adminSession: Boolean(process.env.ADMIN_SESSION_SECRET || process.env.MERCADOPAGO_WEBHOOK_SECRET)
  };

  return json(res, 200, {
    status,
    architecture: 'mercadopago-as-source-of-truth',
    readyForPayments: status.mercadoPago && status.mercadoPagoProduction && status.webhook && status.reservations && status.appUrl && status.adminSession
  });
};
