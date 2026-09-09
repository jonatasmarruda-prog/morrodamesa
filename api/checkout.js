const { getFirestore } = require('./_firebase');
const { getTrip, getVariant } = require('./_catalog');
const { json, onlyDigits, money, reservationId, mpHeaders, appUrl } = require('./_utils');

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

async function heldSeats(db, tripId) {
  const snap = await db.collection('reservations').where('tripId', '==', tripId).get();
  const now = Date.now();
  let total = 0;
  snap.forEach((doc) => {
    const row = doc.data();
    const activePending = row.status === 'pending' && new Date(row.expiresAt || 0).getTime() > now;
    if (row.status === 'approved' || activePending) total += Number(row.seats || 1);
  });
  return total;
}

function exclusionsFor(method) {
  if (method === 'pix') {
    return ['credit_card', 'debit_card', 'prepaid_card', 'ticket', 'atm'];
  }
  return ['bank_transfer', 'ticket', 'atm'];
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

    const unitPrice = paymentMethod === 'card' ? variant.cardPrice : variant.pixPrice;
    const total = money(unitPrice * quantity);
    const db = getFirestore();
    const used = await heldSeats(db, trip.id);
    if (used + quantity > trip.capacity) {
      return json(res, 409, { error: 'Não há vagas suficientes disponíveis para esta quantidade.' });
    }

    const id = reservationId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    const baseUrl = appUrl();

    const reservation = {
      id,
      tripId: trip.id,
      tripTitle: trip.title,
      tripDate: trip.date,
      location: trip.location,
      variantId: variant.id,
      variantName: variant.name,
      quantity,
      seats: quantity,
      unitPrice,
      amount: total,
      paymentMethod,
      status: 'pending',
      mpStatus: 'pending',
      mpPaymentId: null,
      mpPreferenceId: null,
      customer,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    await db.collection('reservations').doc(id).set(reservation);

    const names = customer.name.split(/\s+/);
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
        excluded_payment_types: exclusionsFor(paymentMethod).map((id) => ({ id })),
        installments: paymentMethod === 'card' ? 12 : 1
      },
      metadata: {
        reservation_id: id,
        trip_id: trip.id,
        variant_id: variant.id,
        payment_choice: paymentMethod
      }
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: mpHeaders(),
      body: JSON.stringify(preference)
    });
    const mp = await mpResponse.json();

    if (!mpResponse.ok || !mp.id || !mp.init_point) {
      await db.collection('reservations').doc(id).update({
        status: 'checkout_error',
        updatedAt: new Date().toISOString(),
        error: mp.message || 'Erro ao criar checkout.'
      });
      console.error('Mercado Pago preference error', mp);
      return json(res, 502, { error: 'Não foi possível iniciar o pagamento. Tente novamente.' });
    }

    await db.collection('reservations').doc(id).update({
      mpPreferenceId: mp.id,
      updatedAt: new Date().toISOString()
    });

    return json(res, 201, {
      reservationId: id,
      checkoutUrl: mp.init_point,
      amount: total,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || 'Erro interno ao criar a reserva.' });
  }
};
