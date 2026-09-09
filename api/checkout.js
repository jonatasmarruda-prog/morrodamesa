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
  findPayment,
  reservationFitsCapacity,
  expirePreference,
  cancelPayment
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

function exclusionsForCard() {
  return ['bank_transfer', 'ticket', 'atm', 'account_money', 'debit_card', 'prepaid_card'];
}

function splitPhone(phone) {
  const digits = onlyDigits(phone);
  if (digits.length < 10) return { area_code: '', number: digits };
  return { area_code: digits.slice(0, 2), number: digits.slice(2) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pixTransactionData(payment = {}) {
  return payment.point_of_interaction?.transaction_data || {};
}

function pixResponse(payment, reservationId, amount, seats, expiresAt, reused = false) {
  const tx = pixTransactionData(payment);
  return {
    reservationId,
    paymentId: payment?.id ? String(payment.id) : null,
    paymentMode: 'pix_direct',
    status: payment?.status || 'pending',
    amount,
    seats,
    expiresAt: expiresAt || payment?.date_of_expiration || null,
    reused,
    pix: {
      qrCode: tx.qr_code || '',
      qrCodeBase64: tx.qr_code_base64 || '',
      ticketUrl: tx.ticket_url || ''
    }
  };
}

function safeMpMessage(data = {}) {
  const cause = Array.isArray(data.cause) && data.cause.length ? data.cause[0] : null;
  return String(cause?.description || cause?.code || data.message || data.error || '').trim();
}

async function createPixPayment({ id, total, trip, variant, customer, baseUrl, expiresAt, metadata, requestId }) {
  const names = customer.name.split(/\s+/);
  const firstName = names.shift() || customer.name;
  const lastName = names.join(' ');

  const body = {
    transaction_amount: Number(total),
    description: `${trip.title} - ${variant.name}`,
    payment_method_id: 'pix',
    external_reference: id,
    notification_url: `${baseUrl}/api/webhook`,
    date_of_expiration: expiresAt.toISOString(),
    payer: {
      email: customer.email,
      first_name: firstName,
      last_name: lastName,
      identification: { type: 'CPF', number: customer.cpf }
    },
    metadata
  };

  const response = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: mpHeaders({ 'X-Idempotency-Key': requestId || id }),
    body: JSON.stringify(body)
  });
  const payment = await response.json().catch(() => ({}));

  if (!response.ok || !payment.id) {
    const detail = safeMpMessage(payment);
    const error = new Error(detail || 'O Mercado Pago recusou a criação do PIX.');
    error.mp = payment;
    error.status = response.status;
    throw error;
  }
  return payment;
}

async function ensureCapacityAfterCreate(tripId, reservationId, capacity) {
  for (const delay of [300, 800, 1600, 2500]) {
    await sleep(delay);
    try {
      const fits = await reservationFitsCapacity(tripId, reservationId, capacity);
      if (fits === true || fits === false) return fits;
    } catch (error) {
      console.warn('Post-create capacity check failed', error?.message || error);
    }
  }
  return null;
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
    const baseUrl = appUrl();

    // Idempotência: se a mesma tentativa já gerou um PIX ou checkout ativo, reutiliza.
    if (paymentMethod === 'pix') {
      const existingPayment = await findPayment(id).catch(() => null);
      if (existingPayment?.id) {
        const tx = pixTransactionData(existingPayment);
        const stillUsable = existingPayment.status === 'approved' || existingPayment.status === 'pending';
        if (stillUsable && (existingPayment.status === 'approved' || tx.qr_code || tx.ticket_url)) {
          return json(res, 200, pixResponse(
            existingPayment,
            id,
            Number(existingPayment.metadata?.amount || total),
            Number(existingPayment.metadata?.seats || seats),
            existingPayment.date_of_expiration || null,
            true
          ));
        }
      }
    } else {
      const existingPreference = await findPreference(id).catch(() => null);
      if (existingPreference?.id && existingPreference?.init_point) {
        const active = !existingPreference.expiration_date_to || new Date(existingPreference.expiration_date_to).getTime() > Date.now();
        if (active) {
          return json(res, 200, {
            reservationId: id,
            preferenceId: existingPreference.id,
            paymentMode: 'checkout_pro',
            checkoutUrl: existingPreference.init_point,
            amount: Number(existingPreference.metadata?.amount || total),
            seats: Number(existingPreference.metadata?.seats || seats),
            expiresAt: existingPreference.expiration_date_to || null,
            reused: true
          });
        }
      }
    }

    // Falha fechada: se a ocupação não puder ser consultada, a venda não inicia.
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
    const metadata = {
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
    };

    // PIX direto: não cria preferência Checkout Pro.
    if (paymentMethod === 'pix') {
      let payment;
      try {
        payment = await createPixPayment({ id, total, trip, variant, customer, baseUrl, expiresAt, metadata, requestId });
      } catch (error) {
        console.error('Mercado Pago PIX creation error', error.mp || error);
        const detail = String(error.message || '').trim();
        const lower = detail.toLowerCase();
        const pixHint = lower.includes('pix') || lower.includes('bank') || lower.includes('collector')
          ? ' Verifique também se sua conta Mercado Pago possui uma chave PIX cadastrada e habilitada para receber.'
          : '';
        return json(res, 502, {
          error: `Não foi possível gerar o PIX no Mercado Pago${detail ? `: ${detail}` : '.'}${pixHint}`
        });
      }

      const fits = await ensureCapacityAfterCreate(trip.id, id, trip.capacity);
      if (fits !== true) {
        await cancelPayment(payment.id).catch((error) => console.warn('Could not cancel overflow PIX', error?.message || error));
        if (fits === false) {
          return json(res, 409, { error: 'As últimas vagas foram ocupadas por outra reserva neste instante. O PIX gerado foi cancelado.' });
        }
        return json(res, 503, { error: 'Não foi possível validar a reserva após gerar o PIX. A tentativa foi cancelada por segurança. Tente novamente.' });
      }

      const tx = pixTransactionData(payment);
      if (payment.status !== 'approved' && !tx.qr_code && !tx.ticket_url) {
        await cancelPayment(payment.id).catch(() => {});
        return json(res, 502, {
          error: 'O Mercado Pago criou a cobrança, mas não devolveu o QR Code/PIX Copia e Cola. Confirme se há uma chave PIX cadastrada na conta Mercado Pago.'
        });
      }

      return json(res, 201, pixResponse(payment, id, total, seats, expiresAt.toISOString()));
    }

    // Cartão continua usando Checkout Pro.
    const names = customer.name.split(/\s+/);
    const phone = splitPhone(customer.phone);
    const preferencePayload = {
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
        excluded_payment_types: exclusionsForCard().map((typeId) => ({ id: typeId })),
        installments: 12
      },
      metadata
    };

    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: mpHeaders(),
      body: JSON.stringify(preferencePayload)
    });
    const preference = await mpResponse.json().catch(() => ({}));

    if (!mpResponse.ok || !preference.id || !preference.init_point) {
      console.error('Mercado Pago preference error', preference);
      const detail = safeMpMessage(preference);
      return json(res, 502, {
        error: `Não foi possível iniciar o pagamento com cartão${detail ? `: ${detail}` : '.'}`
      });
    }

    const fits = await ensureCapacityAfterCreate(trip.id, id, trip.capacity);
    if (fits !== true) {
      await expirePreference(preference.id).catch((error) => console.warn('Could not expire overflow preference', error?.message || error));
      if (fits === false) {
        return json(res, 409, { error: 'As últimas vagas foram ocupadas por outra reserva neste instante. Nenhuma cobrança foi concluída.' });
      }
      return json(res, 503, { error: 'Não foi possível validar a reserva após criar o checkout. A tentativa foi encerrada por segurança. Tente novamente.' });
    }

    return json(res, 201, {
      reservationId: id,
      preferenceId: preference.id,
      paymentMode: 'checkout_pro',
      checkoutUrl: preference.init_point,
      amount: total,
      seats,
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || 'Erro interno ao criar a reserva.' });
  }
};
