const { json } = require('./_utils');
const { verifySession } = require('./_auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });
  if (!verifySession(req)) return json(res, 401, { error: 'Não autorizado.' });

  const status = {
    mercadoPago: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
    webhook: Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET),
    firebase: Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY),
    appUrl: Boolean(process.env.APP_URL),
    adminSession: Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET)
  };

  return json(res, 200, {
    status,
    readyForPayments: status.mercadoPago && status.webhook && status.firebase && status.appUrl && status.adminSession
  });
};
