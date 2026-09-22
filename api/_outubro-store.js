const crypto = require('crypto');
const { mpHeaders, money } = require('./_utils');

const EVENT_KEY = 'outubro-rosa-2026-10-18-v2';
const CAPACITY = 100;
const PRICE_ENTRY = 30;
const PRICE_SHIRT = 75;

async function mpGet(path) {
  const r = await fetch('https://api.mercadopago.com' + path, { headers: mpHeaders() });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || 'Falha ao consultar reservas.');
  return data;
}

async function mpPost(path, body) {
  const r = await fetch('https://api.mercadopago.com' + path, {
    method: 'POST',
    headers: mpHeaders(),
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || 'Falha ao criar reserva.');
  return data;
}

async function mpPut(path, body) {
  const r = await fetch('https://api.mercadopago.com' + path, {
    method: 'PUT',
    headers: mpHeaders(),
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || 'Falha ao atualizar reserva.');
  return data;
}

function reservationId(clientId) {
  const raw = String(clientId || crypto.randomUUID());
  const suffix = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 10).toUpperCase();
  return 'OR-2026-' + suffix;
}

function cleanParticipants(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 10) throw new Error('Escolha de 1 a 10 participantes.');
  return input.map((p, i) => {
    const name = String(p.name || '').trim().replace(/\s+/g, ' ');
    const option = p.option === 'shirt' ? 'shirt' : 'entry';
    const model = option === 'shirt' ? String(p.model || '').trim() : '';
    const size = option === 'shirt' ? String(p.size || '').trim().toUpperCase() : '';
    if (name.length < 3) throw new Error('Informe o nome completo da participante ' + (i + 1) + '.');
    if (option === 'shirt' && !['Camiseta Tradicional','Babylook'].includes(model)) throw new Error('Modelo inválido na participante ' + (i + 1) + '.');
    if (option === 'shirt' && !['PP','P','M','G','GG'].includes(size)) throw new Error('Tamanho inválido na participante ' + (i + 1) + '.');
    return {
      id: 'P' + (i + 1),
      name,
      option,
      model,
      size,
      price: option === 'shirt' ? PRICE_SHIRT : PRICE_ENTRY
    };
  });
}

function encodeParticipants(ps) {
  return Buffer.from(JSON.stringify(ps), 'utf8').toString('base64url');
}

function decodeParticipants(value) {
  try { return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8')); }
  catch { return []; }
}

async function getPreference(id) {
  try { return await mpGet('/checkout/preferences/' + encodeURIComponent(id)); }
  catch { return null; }
}

async function findPreferenceByExternalReference(externalReference) {
  const data = await mpGet('/checkout/preferences/search?external_reference=' + encodeURIComponent(externalReference) + '&limit=10');
  const found = (data.elements || []).find(x => String(x.external_reference || '') === String(externalReference));
  return found?.id ? getPreference(found.id) : null;
}

async function listOutubroPreferences() {
  const summaries = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const data = await mpGet('/checkout/preferences/search?limit=50&offset=' + offset);
    const els = Array.isArray(data.elements) ? data.elements : [];
    summaries.push(...els.filter(x => String(x.external_reference || '').startsWith('OR-2026-')));
    if (els.length < 50) break;
    offset += els.length;
  }
  const details = [];
  for (let i = 0; i < summaries.length; i += 10) {
    const batch = await Promise.all(summaries.slice(i, i + 10).map(x => getPreference(x.id)));
    details.push(...batch.filter(Boolean));
  }
  return details.filter(p => String(p.metadata?.event_key || '') === EVENT_KEY);
}

function normalize(pref) {
  const md = pref.metadata || {};
  const participants = decodeParticipants(md.participants_b64);
  const status = String(md.admin_status || 'pending');
  const quantity = participants.length || Number(md.quantity || 0);
  const total = participants.reduce((s,p)=>s+Number(p.price||0),0) || Number(md.total || 0);
  return {
    id: String(pref.external_reference || md.reservation_id || ''),
    preferenceId: String(pref.id || ''),
    createdAt: pref.date_created || md.created_at || null,
    paymentMethod: String(md.payment_method || 'PIX'),
    status,
    quantity,
    total: money(total),
    participants
  };
}

function occupies(status) {
  return status === 'pending' || status === 'confirmed';
}

async function stats() {
  const rows = (await listOutubroPreferences()).map(normalize);
  let pending=0, confirmed=0;
  rows.forEach(r => {
    if (r.status === 'pending') pending += r.quantity;
    if (r.status === 'confirmed') confirmed += r.quantity;
  });
  const reserved = pending + confirmed;
  return { total: CAPACITY, pending, confirmed, reserved, available: Math.max(0, CAPACITY - reserved) };
}

async function createReservation({clientId, participants, paymentMethod}) {
  const ps = cleanParticipants(participants);
  const id = reservationId(clientId);
  const existing = await findPreferenceByExternalReference(id);
  const total = ps.reduce((s,p)=>s+p.price,0);
  const now = new Date().toISOString();

  if (existing && String(existing.metadata?.event_key || '') === EVENT_KEY) {
    const current = normalize(existing);
    if (current.status === 'confirmed') return current;
    const before = await stats();
    const capacityForEdit = before.available + (occupies(current.status) ? current.quantity : 0);
    if (ps.length > capacityForEdit) throw new Error('Não há vagas suficientes disponíveis.');
    const metadata = {
      ...(existing.metadata || {}),
      admin_status: 'pending',
      payment_method: String(paymentMethod || 'PIX').toUpperCase(),
      participants_b64: encodeParticipants(ps),
      quantity: ps.length,
      total: money(total),
      updated_at: now
    };
    const updated = await mpPut('/checkout/preferences/' + encodeURIComponent(existing.id), { metadata });
    return normalize(updated);
  }

  const before = await stats();
  if (ps.length > before.available) throw new Error('Não há vagas suficientes disponíveis.');

  const pref = await mpPost('/checkout/preferences', {
    items: [{
      id: 'outubro-rosa-reserva',
      title: 'Trilha Outubro Rosa - Reserva',
      description: '18/10/2026 - Mirante da Janela',
      category_id: 'tourism',
      currency_id: 'BRL',
      quantity: 1,
      unit_price: money(total)
    }],
    external_reference: id,
    metadata: {
      event_key: EVENT_KEY,
      reservation_id: id,
      admin_status: 'pending',
      payment_method: String(paymentMethod || 'PIX').toUpperCase(),
      participants_b64: encodeParticipants(ps),
      quantity: ps.length,
      total: money(total),
      created_at: now
    }
  });
  return normalize(pref);
}

async function updateStatus(reservationIdValue, status) {
  if (!['confirmed','cancelled'].includes(status)) throw new Error('Status inválido.');
  const pref = await findPreferenceByExternalReference(reservationIdValue);
  if (!pref || String(pref.metadata?.event_key || '') !== EVENT_KEY) throw new Error('Reserva não encontrada.');
  const metadata = { ...(pref.metadata || {}), admin_status: status, updated_at: new Date().toISOString() };
  if (status === 'confirmed') metadata.confirmed_at = new Date().toISOString();
  if (status === 'cancelled') metadata.cancelled_at = new Date().toISOString();
  const updated = await mpPut('/checkout/preferences/' + encodeURIComponent(pref.id), { metadata });
  return normalize(updated);
}

async function removeParticipant(reservationIdValue, participantId) {
  const pref = await findPreferenceByExternalReference(reservationIdValue);
  if (!pref || String(pref.metadata?.event_key || '') !== EVENT_KEY) throw new Error('Reserva não encontrada.');
  const current = decodeParticipants(pref.metadata?.participants_b64);
  const next = current.filter(p => String(p.id) !== String(participantId));
  if (next.length === current.length) throw new Error('Participante não encontrada.');
  const total = next.reduce((s,p)=>s+Number(p.price||0),0);
  const status = next.length ? String(pref.metadata?.admin_status || 'pending') : 'cancelled';
  const metadata = {
    ...(pref.metadata || {}),
    participants_b64: encodeParticipants(next),
    quantity: next.length,
    total: money(total),
    admin_status: status,
    updated_at: new Date().toISOString()
  };
  const updated = await mpPut('/checkout/preferences/' + encodeURIComponent(pref.id), { metadata });
  return normalize(updated);
}

async function adminData() {
  const reservations = (await listOutubroPreferences()).map(normalize).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
  const s = { total: CAPACITY, pending:0, confirmed:0, reserved:0, available:CAPACITY };
  reservations.forEach(r=>{
    if(r.status==='pending') s.pending += r.quantity;
    if(r.status==='confirmed') s.confirmed += r.quantity;
  });
  s.reserved = s.pending + s.confirmed;
  s.available = Math.max(0, CAPACITY - s.reserved);

  const shirts = [];
  reservations.filter(r=>r.status==='confirmed').forEach(r=>{
    r.participants.filter(p=>p.option==='shirt').forEach(p=>shirts.push({
      reservationId:r.id, name:p.name, model:p.model, size:p.size, quantity:1
    }));
  });
  const counts = {};
  shirts.forEach(sx=>{
    const k=sx.model+'|'+sx.size;
    counts[k]=(counts[k]||0)+1;
  });
  return { reservations, stats:s, shirts, shirtCounts:counts, totalShirts:shirts.length };
}

module.exports = {
  CAPACITY,
  createReservation,
  stats,
  adminData,
  updateStatus,
  removeParticipant
};