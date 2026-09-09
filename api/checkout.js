const { getTrip, getVariant } = require('./_catalog');
const { json, onlyDigits, money, reservationIdFromRequest, mercadoPagoTokenMode, mpHeaders, appUrl } = require('./_utils');
const { usedSeatsForTrip, findPreference, findPayment, reservationFitsCapacity, expirePreference, cancelPayment } = require('./_mpstore');

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

function splitPhone(phone) {
  const d = onlyDigits(phone);
  return d.length >= 10 ? { area_code: d.slice(0, 2), number: d.slice(2) } : { area_code: '', number: d };
}

function pixTx(payment = {}) {
  return payment.point_of_interaction?.transaction_data || {};
}

function pixPayload(payment, id, amount, seats, expiresAt, reused = false) {
  const tx = pixTx(payment);
  return {
    reservationId: id,
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

function mpMessage(data = {}) {
  const cause = Array.isArray(data.cause) ? data.cause[0] : null;
  return String(cause?.description || cause?.code || data.message || data.error || '').trim();
}

async function postMp(path, body, idempotencyKey) {
  const headers = mpHeaders(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {});
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function checkCapacity(tripId, reservationId, capacity) {
  for (const wait of [300, 800, 1600, 2500]) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      const fits = await reservationFitsCapacity(tripId, reservationId, capacity);
      if (fits === true || fits === false) return fits;
    } catch (error) {
      console.warn('Capacity recheck failed', error?.message || error);
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });

  try {
    if (mercadoPagoTokenMode() !== 'production') {
      return json(res, 503, { error: 'O Mercado Pago ainda não está com credencial de produção.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const trip = getTrip(body.tripId);
    const variant = getVariant(trip, body.variantId);
    if (!trip || !variant) return json(res, 400, { error: 'Passeio ou opção inválida.' });

    const method = body.paymentMethod === 'card' ? 'card' : 'pix';
    const quantity = Math.max(1, Math.min(10, parseInt(body.quantity, 10) || 1));
    const customer = validateCustomer(body.customer);
    const requestId = String(body.requestId || '').trim();
    const id = reservationIdFromRequest(requestId);
    const seatsPerUnit = Math.max(1, Number(variant.seatsPerUnit || 1));
    const seats = seatsPerUnit * quantity;
    const unitPrice = method === 'card' ? variant.cardPrice : variant.pixPrice;
    const total = money(unitPrice * quantity);
    const baseUrl = appUrl();

    if (method === 'pix') {
      const existing = await findPayment(id).catch(() => null);
      if (existing?.id && ['pending', 'approved'].includes(existing.status)) {
        const tx = pixTx(existing);
        if (existing.status === 'approved' || tx.qr_code || tx.ticket_url) {
          return json(res, 200, pixPayload(
            existing,
            id,
            Number(existing.metadata?.amount || total),
            Number(existing.metadata?.seats || seats),
            existing.date_of_expiration,
            true
          ));
        }
      }
    } else {
      const existing = await findPreference(id).catch(() => null);
      if (existing?.id && existing?.init_point) {
        const active = !existing.expiration_date_to || new Date(existing.expiration_date_to).getTime() > Date.now();
        if (active) {
          return json(res, 200, {
            reservationId: id,
            preferenceId: existing.id,
            paymentMode: 'checkout_pro',
            checkoutUrl: existing.init_point,
            amount: Number(existing.metadata?.amount || total),
            seats: Number(existing.metadata?.seats || seats),
            expiresAt: existing.expiration_date_to,
            reused: true
          });
        }
      }
    }

    let used;
    try {
      used = await usedSeatsForTrip(trip.id);
    } catch {
      return json(res, 503, { error: 'Não foi possível confirmar as vagas agora. Tente novamente em alguns segundos.' });
    }
    if (used + seats > trip.capacity) return json(res, 409, { error: 'Não há vagas suficientes disponíveis.' });

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
      payment_choice: method,
      quantity,
      seats_per_unit: seatsPerUnit,
      seats,
      unit_price: Number(unitPrice),
      amount: total
    };

    if (method === 'pix') {
      const names = customer.name.split(/\s+/);
      const paymentBody = {
        transaction_amount: Number(total),
        description: `${trip.title} - ${variant.name}`,
        payment_method_id: 'pix',
        external_reference: id,
        notification_url: `${baseUrl}/api/webhook`,
        date_of_expiration: expiresAt.toISOString(),
        payer: {
          email: customer.email,
          first_name: names.shift() || customer.name,
          last_name: names.join(' '),
          identification: { type: 'CPF', number: customer.cpf }
        },
        metadata
      };

      const { response, data: payment } = await postMp('/v1/payments', paymentBody, `${requestId || id}-pix`);
      if (!response.ok || !payment.id) {
        const detail = mpMessage(payment);
        return json(res, 502, { error: `Não foi possível gerar o PIX${detail ? `: ${detail}` : '.'}` });
      }

      const fits = await checkCapacity(trip.id, id, trip.capacity);
      if (fits !== true) {
        await cancelPayment(payment.id).catch(() => {});
        return json(res, fits === false ? 409 : 503, {
          error: fits === false ? 'As últimas vagas foram ocupadas. O PIX foi cancelado.' : 'Não foi possível validar a reserva. O PIX foi cancelado por segurança.'
        });
      }

      const tx = pixTx(payment);
      if (payment.status !== 'approved' && !tx.qr_code && !tx.ticket_url) {
        await cancelPayment(payment.id).catch(() => {});
        return json(res, 502, { error: 'O Mercado Pago não retornou o QR Code/PIX Copia e Cola. Confirme se há uma chave PIX cadastrada na conta.' });
      }

      return json(res, 201, pixPayload(payment, id, total, seats, expiresAt.toISOString()));
    }

    const names = customer.name.split(/\s+/);
    const preferenceBody = {
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
        phone: splitPhone(customer.phone),
        identification: { type: 'CPF', number: customer.cpf }
      },
      external_reference: id,
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
      payment_methods: { installments: 12 },
      metadata
    };

    const { response, data: preference } = await postMp('/checkout/preferences', preferenceBody);
    if (!response.ok || !preference.id || !preference.init_point) {
      const detail = mpMessage(preference);
      return json(res, 502, { error: `Não foi possível iniciar o pagamento com cartão${detail ? `: ${detail}` : '.'}` });
    }

    const fits = await checkCapacity(trip.id, id, trip.capacity);
    if (fits !== true) {
      await expirePreference(preference.id).catch(() => {});
      return json(res, fits === false ? 409 : 503, {
        error: fits === false ? 'As últimas vagas foram ocupadas. O checkout foi encerrado.' : 'Não foi possível validar a reserva. Tente novamente.'
      });
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
