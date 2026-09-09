const { json, mercadoPagoTokenMode, mpHeaders } = require('./_utils');

async function mpGet(path) {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    headers: mpHeaders()
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });

  const result = {
    ok: false,
    production: mercadoPagoTokenMode() === 'production',
    apiReachable: false,
    pixAvailable: false,
    creditCardAvailable: false,
    debitCardAvailable: false,
    accountMoneyAvailable: false,
    site: null,
    activeMethods: [],
    notes: []
  };

  try {
    const [{ response: methodsResponse, data: methods }, { response: meResponse, data: me }] = await Promise.all([
      mpGet('/v1/payment_methods'),
      mpGet('/users/me')
    ]);

    result.apiReachable = methodsResponse.ok && meResponse.ok;
    result.site = me?.site_id || null;

    if (Array.isArray(methods)) {
      const active = methods.filter((m) => !m.status || m.status === 'active');
      result.activeMethods = active.map((m) => ({ id: m.id, type: m.payment_type_id })).slice(0, 50);
      result.pixAvailable = active.some((m) => m.id === 'pix' || m.payment_type_id === 'bank_transfer');
      result.creditCardAvailable = active.some((m) => m.payment_type_id === 'credit_card');
      result.debitCardAvailable = active.some((m) => m.payment_type_id === 'debit_card');
      result.accountMoneyAvailable = active.some((m) => m.payment_type_id === 'account_money');
    }

    if (!result.pixAvailable) result.notes.push('PIX não aparece como meio disponível para esta conta/credencial.');
    if (!result.creditCardAvailable) result.notes.push('Cartão de crédito não aparece como meio disponível para esta conta/credencial.');
    if (result.site && result.site !== 'MLB') result.notes.push(`A conta está associada ao site ${result.site}, não ao Brasil (MLB).`);

    result.ok = result.production && result.apiReachable && (result.pixAvailable || result.creditCardAvailable);
    return json(res, 200, result);
  } catch (error) {
    return json(res, 200, {
      ...result,
      error: error.message || 'Falha no diagnóstico do Mercado Pago.'
    });
  }
};
