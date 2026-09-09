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

function reservationPattern(value) {
  return /^TR-\d{4}-[A-F0-9]{6}$/.test(String(value || ''));
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

async function listPreferenceDetails(limit = 50) {
  const search = await mpGet(`/checkout/preferences/search?limit=${Math.max(1, Math.min(50, limit))}`);
  const elements = Array.isArray(search.elements) ? search.elements : [];
  const details = await Promise.all(elements.map(async (item) => {
    try {
      if (item.external_reference && item.payer && Array.isArray(item.items) && item.items.length) return item;
      return await getPreferenceById(item.id);
    } catch {
      return null;
    }
  }));
  return details.filter((pref) => pref && reservationPattern(pref.external_reference));
}

async function listPayments(limit = 100) {
  const rows = [];
  let offset = 0;
  while (rows.length < limit) {
    const pageSize = Math.min(50, limit - rows.length);
    const search = await mpGet(`/v1/payments/search?sort=date_created&criteria=desc&limit=${pageSize}&offset=${offset}`);
    const results = Array.isArray(search.results) ? search.results : [];
    rows.push(...results);
    if (results.length < pageSize) break;
    offset += pageSize;
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
  const metadata = pref.metadata || {};
  const item = pref.items?.[0] || {};
  const expected = Number(metadata.amount || preferenceAmount(pref) || 0);
  const paid = payment ? Number(payment.transaction_amount || 0) : 0;
  const amountMatches = !payment || Math.abs(expected - paid) < 0.01;
  let status = payment ? mapMpStatus(payment.status) : 'pending';
  if (status === 'approved' && !amountMatches) status = 'review';
  if (!payment && pref.expiration_date_to && new Date(pref.expiration_date_to).getTime() < Date.now()) status = 'cancelled';

  const payer = pref.payer || {};
  const fullName = [payer.name, payer.surname].filter(Boolean).join(' ').trim();
  const paymentChoice = String(metadata.payment_choice || '');
  const paymentMethod = paymentChoice === 'card' || paymentChoice === 'pix'
    ? paymentChoice
    : (payment?.payment_type_id === 'credit_card' ? 'card' : (payment?.payment_method_id === 'pix' ? 'pix' : ''));

  return {
    id: String(pref.external_reference || ''),
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
    createdAt: pref.date_created || null,
    approvedAt: payment?.date_approved || null,
    updatedAt: payment?.date_last_updated || pref.date_created || null,
    expiresAt: pref.expiration_date_to || null
  };
}

async function listReservations(limit = 50) {
  const [preferences, payments] = await Promise.all([
    listPreferenceDetails(limit),
    listPayments(Math.max(limit, 50))
  ]);
  const latestPayment = new Map();
  for (const payment of payments) {
    const key = String(payment.external_reference || '');
    if (!latestPayment.has(key)) latestPayment.set(key, payment);
  }
  return preferences
    .map((pref) => normalizeReservation(pref, latestPayment.get(String(pref.external_reference || '')) || null))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function usedSeatsForTrip(tripId) {
  const rows = await listReservations(50);
  return rows.reduce((total, row) => {
    if (row.tripId !== tripId) return total;
    const activePending = row.status === 'pending' && (!row.expiresAt || new Date(row.expiresAt).getTime() > Date.now());
    if (row.status === 'approved' || row.status === 'review' || activePending) return total + Number(row.seats || 1);
    return total;
  }, 0);
}

module.exports = {
  findPreference,
  findPayment,
  listReservations,
  normalizeReservation,
  usedSeatsForTrip,
  reservationPattern
};
