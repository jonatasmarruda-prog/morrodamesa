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
  if (method === 'pix') {
    // Deixa somente bank_transfer, que no Brasil corresponde ao Pix.
    return ['credit_card', 'debit_card', 'prepaid_card', 'ticket', 'atm', 'account_money', 'digital_currency'];
  }
  // No fluxo de cartão, deixa somente cartão de crédito.
  return ['bank_transfer', 'ticket', 'atm', 'account_money', 'digital_currency', 'debit_card', 'prepaid_card'];
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

function pixResponse(payment, preference, reservationId, amount, seats, expiresAt, reused = false) {
  const tx = pixTransactionData(payment);
  return {
    reservationId,
    preferenceId: preference?.id || null,
    paymentId: payment?.id ? String(payment.id) : null,
    paymentMode: 'pix_direct',
    status: payment?.status || 'pending',
    amount,
    seats,
    expiresAt: expiresAt || preference?.expiration_date_to || null,
    reused,
    pix: {
      qrCode: tx.qr_code || '',
      qrCodeBase64: tx.qr_code_base64 || '',
      ticketUrl: tx.ticket_url || ''
    }
  };
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
    headers: mpHeaders({ 'X-Idempotency-Key': `${requestId || id}-pix` }),
    body: JSON.stringify(body)
  });
  const payment = await response.json().catch(() => ({}));

  if (!response.ok || !payment.id) {
    const detail = payment.message || payment.error || 'Falha ao gerar PIX.';
    const error = new Error(detail);
    error.mp = payment;
    throw error;
  }
  return payment;
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

    let preference = await findPreference(id).catch(() => null);
    const preferenceActive = Boolean(
      preference?.id && (!preference.expiration_date_to || new Date(preference.expiration_date_to).getTime() > Date.now())
    );

    if (preferenceActive) {
      if (paymentMethod === 'card' && preference.init_point) {
        return json(res, 200, {
          reservationId: id,
          preferenceId: preference.id,
          paymentMode: 'checkout_pro',
          checkoutUrl: preference.init_point,
          amount: Number(preference.metadata?.amount || total),
          seats: Number(preference.metadata?.seats || seats),
          expiresAt: preference.expiration_date_to || null,
          reused: true
        });
      }

      if (paymentMethod === 'pix') {
        const existingPayment = await findPayment(id).catch(() => null);
        if (existingPayment?.id) {
          const tx = pixTransactionData(existingPayment);
          if (existingPayment.status === 'approved' || tx.qr_code || tx.ticket_url) {
            return json(res, 200, pixResponse(
              existingPayment,
              preference,
              id,
              Number(preference.metadata?.amount || total),
              Number(preference.metadata?.seats || seats),
              preference.expiration_date_to || null,
              true
            ));
          }
        }
      }
    }

    if (!preferenceActive) {
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
          excluded_payment_types: exclusionsFor(paymentMethod).map((typeId) => ({ id: typeId })),
          installments: paymentMethod === 'card' ? 12 : 1
        },
        metadata
      };

      const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: mpHeaders({ 'X-Idempotency-Key': requestId || id }),
        body: JSON.stringify(preferencePayload)
      });
      preference = await mpResponse.json().catch(() => ({}));

      if (!mpResponse.ok || !preference.id) {
        console.error('Mercado Pago preference error', preference);
        return json(res, 502, { error: 'Não foi possível iniciar o pagamento. Tente novamente.' });
      }

      let fits = null;
      for (const delay of [250, 750, 1500, 2500]) {
        await sleep(delay);
        try {
          fits = await reservationFitsCapacity(trip.id, id, trip.capacity);
          if (fits === true || fits === false) break;
        } catch (error) {
          console.warn('Post-create capacity check failed', error?.message || error);
        }
      }

      if (fits !== true) {
        await expirePreference(preference.id).catch((error) => console.warn('Could not expire unverified preference', error?.message || error));
        return json(res, fits === false ? 409 : 503, {
          error: fits === false
            ? 'As últimas vagas foram ocupadas por outra reserva neste instante. Nenhuma cobrança foi concluída.'
            : 'Não foi possível confirmar a reserva com segurança agora. Tente novamente em alguns segundos.'
        });
      }
    }

    if (paymentMethod === 'card') {
      if (!preference.init_point) return json(res, 502, { error: 'Checkout de cartão indisponível agora.' });
      return json(res, 201, {
        reservationId: id,
        preferenceId: preference.id,
        paymentMode: 'checkout_pro',
        checkoutUrl: preference.init_point,
        amount: total,
        seats,
        expiresAt: preference.expiration_date_to || null
      });
    }

    const expiresAt = preference.expiration_date_to
      ? new Date(preference.expiration_date_to)
      : new Date(Date.now() + 30 * 60 * 1000);
    const baseUrl = appUrl();
    let payment;
    try {
      payment = await createPixPayment({
        id,
        total,
        trip,
        variant,
        customer,
        baseUrl,
        expiresAt,
        metadata: preference.metadata || {},
        requestId
      });
    } catch (error) {
      console.error('PIX creation failed', error.mp || error);
      await expirePreference(preference.id).catch(() => {});
      return json(res, 502, {
        error: 'Não foi possível gerar o PIX. Confirme se há uma chave Pix cadastrada na conta Mercado Pago e tente novamente.'
      });
    }

    const tx = pixTransactionData(payment);
    if (!tx.qr_code && !tx.ticket_url && payment.status !== 'approved') {
      await expirePreference(preference.id).catch(() => {});
      return json(res, 502, { error: 'O Mercado Pago não retornou o código PIX. Tente novamente.' });
    }

    return json(res, 201, pixResponse(
      payment,
      preference,
      id,
      total,
      seats,
      preference.expiration_date_to || expiresAt.toISOString(),
      false
    ));
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message || 'Erro interno ao criar a reserva.' });
  }
};
