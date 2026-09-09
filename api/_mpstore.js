const { mpHeaders, mapMpStatus, money } = require('./_utils');

async function mpGet(path) {
  const response = await fetch(`https://api.mercadopago.com${path}`, { headers: mpHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Mercado Pago respondeu ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function mpPut(path, body) {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    method: 'PUT',
    headers: mpHeaders(),
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Mercado Pago respondeu ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function reservationPattern(value) {
  return /^TR-\d{4}-[A-F0-9]{6,12}$/.test(String(value || ''));
}

async function getPreferenceById(id) {
  if (!id) return null;
  return mpGet(`/checkout/preferences/${encodeURIComponent(id)}`);
}

async function findPreference(reservationId) {
  const search = await mpGet(`/checkout/preferences/search?external_reference=${encodeURIComponent(reservationId)}&limit=10`);
  const elements = Array.isArray(search.elements) ? search.elements : [];
  const found = elements.find((item) => String(item.external_reference || '') === reservationId) || elements[0];
  if (!found?.id) return null;
  return getPreferenceById(found.id);
}

async function findPayment(reservationId) {
  const search = await mpGet(`/v1/payments/search?external_reference=${encodeURIComponent(reservationId)}&sort=date_created&criteria=desc&limit=10`);
  const results = Array.isArray(search.results) ? search.results : [];
  return results.find((p) => String(p.external_reference || '') === reservationId) || null;
}

async function searchPreferenceSummaries(max = 500) {
  const rows = [];
  let offset = 0;
  const cappedMax = Math.max(1, Math.min(1000, Number(max) || 500));

  while (rows.length < cappedMax) {
    const pageSize = Math.min(50, cappedMax - rows.length);
    const search = await mpGet(`/checkout/preferences/search?limit=${pageSize}&offset=${offset}`);
    const elements = Array.isArray(search.elements) ? search.elements : [];
    rows.push(...elements);
    if (!elements.length) break;

    const next = Number(search.next_offset);
    if (Number.isFinite(next) && next > offset) offset = next;
    else offset += elements.length;

    const total = Number(search.total);
    if (Number.isFinite(total) && offset >= total) break;
    if (elements.length < pageSize) break;
  }

  return rows.filter((pref) => reservationPattern(pref.external_reference));
}

async function listPreferenceDetails(max = 500) {
  const summaries = await searchPreferenceSummaries(max);
  const details = [];
  const chunkSize = 10;

  for (let i = 0; i < summaries.length; i += chunkSize) {
    const chunk = summaries.slice(i, i + chunkSize);
    const fetched = await Promise.all(chunk.map(async (item) => {
      try {
        if (item.external_reference && item.payer && Array.isArray(item.items) && item.items.length && item.metadata) return item;
        return await getPreferenceById(item.id);
      } catch {
        return null;
      }
    }));
    details.push(...fetched.filter(Boolean));
  }

  return details.filter((pref) => reservationPattern(pref.external_reference));
}

async function listPayments(max = 500) {
  const rows = [];
  let offset = 0;
  const cappedMax = Math.max(1, Math.min(1000, Number(max) || 500));

  while (rows.length < cappedMax) {
    const pageSize = Math.min(50, cappedMax - rows.length);
    const search = await mpGet(`/v1/payments/search?sort=date_created&criteria=desc&limit=${pageSize}&offset=${offset}`);
    const results = Array.isArray(search.results) ? search.results : [];
    rows.push(...results);
    if (results.length < pageSize) break;
    offset += results.length;
  }

  return rows.filter((payment) => reservationPattern(payment.external_reference));
}

function phoneFromPayer(payer = {}) {
  const area = String(payer.phone?.area_code || '').replace(/\D/g, '');
  const number = String(payer.phone?.number || '').replace(/\D/g, '');
  return `${area}${number}`;
}

function preferenceAmount(pref) {
  return money((pref.items || []).reduce((sum, item) => sum + (Number(item.unit_price || 0) * Number(item.quantity || 1)), 0));
}

function normalizeReservation(pref, payment = null) {
  const metadata = pref.metadata || payment?.metadata || {};
  const item = pref.items?.[0] || {};
  const expected = Number(metadata.amount || preferenceAmount(pref) || payment?.transaction_amount || 0);
  const paid = payment ? Number(payment.transaction_amount || 0) : 0;
  const amountMatches = !payment || Math.abs(expected - paid) < 0.01;
  let status = payment ? mapMpStatus(payment.status) : 'pending';
  if (status === 'approved' && !amountMatches) status = 'review';
  if (!payment && pref.expiration_date_to && new Date(pref.expiration_date_to).getTime() < Date.now()) status = 'cancelled';

  const payer = pref.payer || payment?.payer || {};
  const fullName = [payer.name, payer.surname].filter(Boolean).join(' ').trim();
  const paymentChoice = String(metadata.payment_choice || '');
  const paymentMethod = paymentChoice === 'card' || paymentChoice === 'pix'
    ? paymentChoice
    : (payment?.payment_type_id === 'credit_card' ? 'card' : (payment?.payment_method_id === 'pix' ? 'pix' : ''));

  return {
    id: String(pref.external_reference || payment?.external_reference || ''),
    tripId: String(metadata.trip_id || ''),
    tripTitle: String(metadata.trip_title || item.title || '').replace(/\s+-\s+[^-]+$/, ''),
    tripDate: String(metadata.trip_date || ''),
    location: String(metadata.location || ''),
    variantId: String(metadata.variant_id || ''),
    variantName: String(metadata.variant_name || '').trim() || String(item.title || '').split(' - ').slice(1).join(' - '),
    quantity: Number(metadata.quantity || item.quantity || 1),
    seatsPerUnit: Number(metadata.seats_per_unit || 1),
    seats: Number(metadata.seats || metadata.quantity || item.quantity || 1),
    unitPrice: Number(metadata.unit_price || item.unit_price || 0),
    amount: expected,
    paymentMethod,
    status,
    mpStatus: payment?.status || 'pending',
    mpStatusDetail: payment?.status_detail || null,
    mpPaymentId: payment?.id ? String(payment.id) : null,
    mpPreferenceId: pref.id || null,
    paymentTypeId: payment?.payment_type_id || null,
    paymentMethodId: payment?.payment_method_id || null,
    installments: Number(payment?.installments || 1),
    amountPaid: payment ? paid : null,
    amountMatches,
    customer: {
      name: fullName || payer.email || 'Cliente',
      email: String(payer.email || ''),
      phone: phoneFromPayer(payer),
      cpf: String(payer.identification?.number || '')
    },
    createdAt: pref.date_created || payment?.date_created || null,
    approvedAt: payment?.date_approved || null,
    updatedAt: payment?.date_last_updated || pref.date_created || null,
    expiresAt: pref.expiration_date_to || null
  };
}

async function listReservations(max = 500) {
  const [preferences, payments] = await Promise.all([
    listPreferenceDetails(max),
    listPayments(max)
  ]);

  const latestPayment = new Map();
  for (const payment of payments) {
    const key = String(payment.external_reference || '');
    if (!latestPayment.has(key)) latestPayment.set(key, payment);
  }

  const rows = preferences.map((pref) => normalizeReservation(
    pref,
    latestPayment.get(String(pref.external_reference || '')) || null
  ));

  return rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function rowOccupiesSeat(row) {
  const activePending = row.status === 'pending' && (!row.expiresAt || new Date(row.expiresAt).getTime() > Date.now());
  return row.status === 'approved' || row.status === 'review' || activePending;
}

async function usedSeatsForTrip(tripId) {
  const rows = await listReservations(500);
  return rows.reduce((total, row) => {
    if (row.tripId !== tripId || !rowOccupiesSeat(row)) return total;
    return total + Number(row.seats || 1);
  }, 0);
}

async function reservationFitsCapacity(tripId, reservationId, capacity) {
  const rows = (await listReservations(500))
    .filter((row) => row.tripId === tripId && rowOccupiesSeat(row))
    .sort((a, b) => {
      const aPaid = a.status === 'approved' || a.status === 'review' ? 0 : 1;
      const bPaid = b.status === 'approved' || b.status === 'review' ? 0 : 1;
      if (aPaid !== bPaid) return aPaid - bPaid;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });

  let occupied = 0;
  let found = false;
  for (const row of rows) {
    occupied += Number(row.seats || 1);
    if (row.id === reservationId) {
      found = true;
      return occupied <= Number(capacity || 0);
    }
  }
  return found ? false : null;
}

async function expirePreference(preferenceId) {
  if (!preferenceId) return;
  const now = new Date();
  const end = new Date(now.getTime() + 1000);
  await mpPut(`/checkout/preferences/${encodeURIComponent(preferenceId)}`, {
    expires: true,
    expiration_date_from: now.toISOString(),
    expiration_date_to: end.toISOString()
  });
}

module.exports = {
  findPreference,
  findPayment,
  listReservations,
  normalizeReservation,
  usedSeatsForTrip,
  reservationFitsCapacity,
  expirePreference,
  reservationPattern
};
