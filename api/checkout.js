const { getTrip, getVariant } = require('./_catalog');
const { json, onlyDigits, money, reservationId, mpHeaders, appUrl } = require('./_utils');
const { usedSeatsForTrip } = require('./_mpstore');

function validateCustomer(customer = {}) {
  const name = String(customer.name || '').trim();
  const email = String(customer.email || '').trim().toLowerCase();
  const phone = onlyDigits(customer.phone);
  const cpf = onlyDigits(customer.cpf);

  if (name.length < 3) throw new Error('Informe o nome completo.');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Informe um e-mail válido.');
  if (phone.length < 10) throw new Error('Informe um WhatsApp válido.');
  if (cpf.length !== 11) throw new Error('Informe um CPF válido.');

  return { name, email, phone, cpf };
}

function exclusionsFor(method) {
  if (method === 'pix') return ['credit_card', 'debit_card', 'prepaid_card', 'ticket', 'atm'];
  return ['bank_transfer', 'ticket', 'atm'];
}

function splitPhone(phone) {
  const digits = onlyDigits(phone);
  if (digits.length < 10) return { area_code: '', number: digits };
  return { area_code: digits.slice(0, 2), number: digits.slice(2) };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const trip = getTrip(body.tripId);
    const variant = getVariant(trip, body.variantId);
    const paymentMethod = body.paymentMethod === 'card' ? 'card' : 'pix';
    const quantity = Math.max(1, Math.min(10, Number.parseInt(body.quantity, 10) || 1));
    const customer = validateCustomer(body.customer);

    if (!trip || !variant) return json(res, 400, { error: 'Passeio ou opção inválida.' });

    const seatsPerUnit = Math.max(1, Number(variant.seatsPerUnit || 1));
    const seats = seatsPerUnit * quantity;
    const unitPrice = paymentMethod === 'card' ? variant.cardPrice : variant.pixPrice;
    const total = money(unitPrice * quantity);

    // A ocupação é calculada diretamente a partir das preferências e pagamentos do Mercado Pago.
    const used = await usedSeatsForTrip(trip.id).catch((error) => {
      console.warn('Capacity lookup failed; checkout continues without blocking', error?.message || error);
      return 0;
    });
    if (used + seats > trip.capacity) {
      return json(res, 409, { error: 'Não há vagas suficientes disponíveis para esta quantidade.' });
    }

    const id = reservationId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    const baseUrl = appUrl();
    const names = customer.name.split(/\s+/);
    const phone = splitPhone(customer.phone);

    const preference = {
      items: [{
        id: `${trip.id}-${variant.id}`,
        title: `${trip.title} - ${variant.name}`,
        description: `${trip.date} • ${trip.location}`,
        category_id: 'tourism',
        currency_id: 'BRL',
        quantity,
        unit_price: Number(unitPrice)
      }],
      payer: {
        name: names.shift() || customer.name,
        surname: names.join(' '),
        email: customer.email,
        phone,
        identification: { type: 'CPF', number: customer.cpf }
      },
      external_reference: id,
      statement_descriptor: 'TRILHEIROS',
      notification_url: `${baseUrl}/api/webhook`,
      back_urls: {
        success: `${baseUrl}/?retorno=sucesso&reserva=${encodeURIComponent(id)}`,
        pending: `${baseUrl}/?retorno=pendente&reserva=${encodeURIComponent(id)}`,
        failure: `${baseUrl}/?retorno=falha&reserva=${encodeURIComponent(id)}`
      },
      auto_return: 'approved',
      expires: true,
      expiration_date_from: now.toISOString(),
      expiration_date_to: expiresAt.toISOString(),
      payment_methods: {
        excluded_payment_types: exclusionsFor(paymentMethod).map((typeId) => ({ id: typeId })),
        installments: paymentMethod === 'card' ? 12 : 1
      },
      metadata: {
        reservation_id: id,
        trip_id: trip.id,
        trip_title: trip.title,
        trip_date: trip.date,
        location: trip.location,
        variant_id: variant.id,
        variant_name: variant.name,
        payment_choice: paymentMethod,
        quantity,
        seats_per_unit: seatsPerUnit,
        seats,
        unit_price: Number(unitPrice),
        amount: total
      }
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: mpHeaders(),
      body: JSON.stringify(preference)
    });
    const mp = await mpResponse.json().catch(() => ({}));

    if (!mpResponse.ok || !mp.id || !mp.init_point) {
      console.error('Mercado Pago preference error', mp);
      return json(res, 502, { error: 'Não foi possível iniciar o pagamento. Tente novamente.' });
    }

    return json(res, 201, {
      reservationId: id,
      preferenceId: mp.id,
      checkoutUrl: mp.init_point,
      amount: total,
      seats,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || 'Erro interno ao criar a reserva.' });
  }
};
