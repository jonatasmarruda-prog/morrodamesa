const { getTrip, getVariant } = require('./_catalog');
const {
  json,
  onlyDigits,
  money,
  reservationIdFromRequest,
  mercadoPagoTokenMode,
  mpHeaders,
  appUrl
} = require('./_utils');
const {
  usedSeatsForTrip,
  findPreference,
  reservationFitsCapacity,
  expirePreference
} = require('./_mpstore');

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });

  try {
    if (mercadoPagoTokenMode() !== 'production') {
      return json(res, 503, {
        error: 'O sistema ainda está com credencial de teste do Mercado Pago. Ative o Access Token de produção antes de vender.'
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const trip = getTrip(body.tripId);
    const variant = getVariant(trip, body.variantId);
    const paymentMethod = body.paymentMethod === 'card' ? 'card' : 'pix';
    const quantity = Math.max(1, Math.min(10, Number.parseInt(body.quantity, 10) || 1));
    const customer = validateCustomer(body.customer);
    const requestId = String(body.requestId || '').trim();

    if (!trip || !variant) return json(res, 400, { error: 'Passeio ou opção inválida.' });

    const seatsPerUnit = Math.max(1, Number(variant.seatsPerUnit || 1));
    const seats = seatsPerUnit * quantity;
    const unitPrice = paymentMethod === 'card' ? variant.cardPrice : variant.pixPrice;
    const total = money(unitPrice * quantity);
    const id = reservationIdFromRequest(requestId);

    // Se o navegador reenviar a mesma tentativa, devolvemos a preferência já criada
    // em vez de gerar uma segunda cobrança/reserva.
    const existing = await findPreference(id).catch(() => null);
    if (existing?.id && existing?.init_point) {
      const notExpired = !existing.expiration_date_to || new Date(existing.expiration_date_to).getTime() > Date.now();
      if (notExpired) {
        return json(res, 200, {
          reservationId: id,
          preferenceId: existing.id,
          checkoutUrl: existing.init_point,
          amount: Number(existing.metadata?.amount || total),
          seats: Number(existing.metadata?.seats || seats),
          expiresAt: existing.expiration_date_to || null,
          reused: true
        });
      }
    }

    // Falha fechada: se não for possível confirmar a ocupação no Mercado Pago,
    // não vendemos. Isso evita assumir zero vagas em caso de indisponibilidade.
    let used;
    try {
      used = await usedSeatsForTrip(trip.id);
    } catch (error) {
      console.error('Capacity lookup failed', error);
      return json(res, 503, {
        error: 'Não foi possível confirmar as vagas agora. Aguarde alguns segundos e tente novamente.'
      });
    }

    if (used + seats > trip.capacity) {
      return json(res, 409, { error: 'Não há vagas suficientes disponíveis para esta quantidade.' });
    }

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
        request_id: requestId || id,
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
      headers: mpHeaders({ 'X-Idempotency-Key': requestId || id }),
      body: JSON.stringify(preference)
    });
    const mp = await mpResponse.json().catch(() => ({}));

    if (!mpResponse.ok || !mp.id || !mp.init_point) {
      console.error('Mercado Pago preference error', mp);
      return json(res, 502, { error: 'Não foi possível iniciar o pagamento. Tente novamente.' });
    }

    // Segunda conferência após a criação da preferência. Em disputa pelas últimas
    // vagas, a reserva que ultrapassar a capacidade é expirada antes do pagamento.
    let fits = null;
    for (const delay of [250, 750, 1500]) {
      await sleep(delay);
      try {
        fits = await reservationFitsCapacity(trip.id, id, trip.capacity);
        if (fits === true || fits === false) break;
      } catch (error) {
        console.warn('Post-create capacity check failed', error?.message || error);
      }
    }

    if (fits === false) {
      await expirePreference(mp.id).catch((error) => console.warn('Could not expire overflow preference', error?.message || error));
      return json(res, 409, {
        error: 'As últimas vagas foram ocupadas por outra reserva neste instante. Nenhuma cobrança foi concluída.'
      });
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
