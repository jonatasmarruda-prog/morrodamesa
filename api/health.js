const { json, mpHeaders } = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });

  const configured = {
    mercadoPago: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
    webhook: Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET),
    appUrl: Boolean(process.env.APP_URL)
  };

  let mercadoPagoApi = false;
  if (configured.mercadoPago) {
    try {
      const response = await fetch('https://api.mercadopago.com/checkout/preferences/search?limit=1', { headers: mpHeaders() });
      mercadoPagoApi = response.ok;
    } catch {
      mercadoPagoApi = false;
    }
  }

  return json(res, 200, {
    ok: configured.mercadoPago && configured.webhook && configured.appUrl && mercadoPagoApi,
    configured,
    mercadoPagoApi,
    reservationsSource: 'Mercado Pago',
    firebaseRequired: false
  });
};
