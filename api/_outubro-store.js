const crypto = require('crypto');
const { mpHeaders, money } = require('./_utils');

const EVENT_KEY = 'outubro-rosa-2026-10-18-v3';
const CAPACITY = 100;
const PRICE_ENTRY = 30;
const PRICE_SHIRT = 75;
const HOLD_MINUTES = 30;
const SHIRT_CUTOFF_UTC = Date.parse('2026-10-06T03:59:59Z');

async function mpGet(path) {
  const r = await fetch('https://api.mercadopago.com' + path, { headers: mpHeaders() });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || 'Falha ao consultar o Mercado Pago.');
  return data;
}

async function mpPost(path, body, idempotencyKey = '') {
  const headers = mpHeaders(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {});
  const r = await fetch('https://api.mercadopago.com' + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || 'Falha ao iniciar pagamento.');
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
  const suffix = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12).toUpperCase();
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
    if (option === 'shirt' && Date.now() > SHIRT_CUTOFF_UTC) throw new Error('O prazo para solicitar camiseta foi encerrado.');
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

function encodeAudit(items) {
  return Buffer.from(JSON.stringify(items.slice(-20)), 'utf8').toString('base64url');
}

function decodeAudit(value) {
  try { return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8')); }
  catch { return []; }
}

function publicName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts[parts.length - 1].charAt(0).toUpperCase() + '.';
}

async function getPreference(id) {
  try { return await mpGet('/checkout/preferences/' + encodeURIComponent(id)); }
  catch { return null; }
}

async function findPreferenceByExternalReference(externalReference) {
  const data = await mpGet('/checkout/preferences/search?external_reference=' + encodeURIComponent(externalReference) + '&limit=20');
  const found = (data.elements || [])
    .filter(x => String(x.external_reference || '') === String(externalReference))
    .sort((a,b)=>new Date(b.date_created||0)-new Date(a.date_created||0))[0];
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

  const valid = details.filter(p => {
    const key=String(p.metadata?.event_key || '');
    return key === EVENT_KEY || key === 'outubro-rosa-2026-10-18-v2';
  });

  // Uma mesma pessoa pode ter gerado mais de uma preferência ao editar dados
  // ou trocar a forma de pagamento. Para capacidade e relatórios, cada
  // external_reference representa uma única reserva e deve ser contada só uma vez.
  const byReference = new Map();
  valid.forEach(pref => {
    const ref = String(pref.external_reference || pref.metadata?.reservation_id || pref.id || '');
    const previous = byReference.get(ref);
    if (!previous || new Date(pref.date_created || 0) >= new Date(previous.date_created || 0)) {
      byReference.set(ref, pref);
    }
  });
  return [...byReference.values()];
}

async function listOutubroPayments() {
  const rows = [];
  let offset = 0;
  for (let page=0; page<20; page++) {
    const data = await mpGet('/v1/payments/search?sort=date_created&criteria=desc&limit=50&offset=' + offset);
    const results = Array.isArray(data.results) ? data.results : [];
    rows.push(...results.filter(p => String(p.external_reference || '').startsWith('OR-2026-')));
    if (results.length < 50) break;
    offset += results.length;
  }
  const map = new Map();
  rows.forEach(p=>{
    const key=String(p.external_reference || '');
    if(!map.has(key)) map.set(key,p);
  });
  return map;
}

function legacyExpiresAt(pref) {
  const md = pref.metadata || {};
  if (pref.expiration_date_to) return pref.expiration_date_to;
  const created = pref.date_created || md.created_at;
  if (!created) return null;
  return new Date(new Date(created).getTime() + HOLD_MINUTES*60*1000).toISOString();
}

function normalize(pref, payment = null) {
  const md = pref.metadata || {};
  const participants = decodeParticipants(md.participants_b64);
  const adminStatus = String(md.admin_status || '');
  const quantity = participants.length || Number(md.quantity || 0);
  const expected = participants.reduce((s,p)=>s+Number(p.price||0),0) || Number(md.total || 0);
  const paid = Number(payment?.transaction_amount || 0);
  const amountMatches = !payment || Math.abs(expected-paid) < 0.01;
  const expiresAt = legacyExpiresAt(pref);
  let status = 'pending';

  if (adminStatus === 'cancelled') status = 'cancelled';
  else if (payment?.status === 'approved' && amountMatches) status = 'confirmed';
  else if (payment?.status === 'approved' && !amountMatches && md.adjusted_after_payment === true) status = 'confirmed';
  else if (payment?.status === 'approved' && !amountMatches) status = 'review';
  else if (['rejected','cancelled','refunded','charged_back'].includes(payment?.status)) status = 'cancelled';
  else if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) status = 'cancelled';
  else if (adminStatus === 'confirmed') status = 'confirmed'; // legado

  return {
    id: String(pref.external_reference || md.reservation_id || ''),
    preferenceId: String(pref.id || ''),
    createdAt: pref.date_created || md.created_at || null,
    updatedAt: payment?.date_last_updated || md.updated_at || pref.date_created || null,
    approvedAt: payment?.date_approved || md.confirmed_at || null,
    expiresAt,
    paymentMethod: String(md.payment_method || md.payment_choice || 'PIX').toUpperCase(),
    paymentId: payment?.id ? String(payment.id) : '',
    mpStatus: String(payment?.status || 'pending'),
    status,
    quantity,
    total: money(expected),
    amountPaid: paid || null,
    participants,
    audit: decodeAudit(md.audit_b64)
  };
}

function occupies(status) {
  return status === 'pending' || status === 'confirmed' || status === 'review';
}

async function allRows() {
  const [prefs,payments]=await Promise.all([listOutubroPreferences(),listOutubroPayments()]);
  return prefs.map(pref=>normalize(pref,payments.get(String(pref.external_reference||''))||null));
}

async function stats() {
  const rows = await allRows();
  let pending=0, confirmed=0, review=0;
  const confirmedParticipants = [];
  const publicParticipants = [];

  rows.forEach(r => {
    if (r.status === 'pending') pending += r.quantity;
    if (r.status === 'review') review += r.quantity;
    if (r.status === 'confirmed') confirmed += r.quantity;

    if (occupies(r.status)) {
      r.participants.forEach(p => {
        const displayName = publicName(p.name);
        if (displayName) publicParticipants.push(displayName);
      });
    }

    if (r.status === 'confirmed') {
      r.participants.forEach(p => {
        const displayName = publicName(p.name);
        if (displayName) confirmedParticipants.push(displayName);
      });
    }
  });

  confirmedParticipants.sort((a,b)=>a.localeCompare(b,'pt-BR'));
  publicParticipants.sort((a,b)=>a.localeCompare(b,'pt-BR'));

  const reserved = pending + confirmed + review;
  return {
    total: CAPACITY,
    pending,
    confirmed,
    review,
    reserved,
    available: Math.max(0, CAPACITY - reserved),
    soldOut: reserved >= CAPACITY,
    confirmedParticipants,
    publicParticipants,
    publicCount: reserved
  };
}

async function reservationFitsCapacity(reservationIdValue) {
  const rows=(await allRows())
    .filter(r=>occupies(r.status))
    .sort((a,b)=>{
      const ap=a.status==='confirmed'?0:(a.status==='review'?1:2);
      const bp=b.status==='confirmed'?0:(b.status==='review'?1:2);
      if(ap!==bp) return ap-bp;
      const dt=new Date(a.createdAt||0)-new Date(b.createdAt||0);
      return dt || String(a.id).localeCompare(String(b.id));
    });
  let occupied=0;
  for(const row of rows){
    occupied += Number(row.quantity||0);
    if(row.id===reservationIdValue) return occupied <= CAPACITY;
  }
  return false;
}

async function expirePreference(preferenceId) {
  if (!preferenceId) return;
  const now = new Date();
  const current = await getPreference(preferenceId).catch(()=>null);
  const metadata = {
    ...(current?.metadata || {}),
    admin_status:'cancelled',
    cancelled_at:now.toISOString(),
    updated_at:now.toISOString()
  };
  await mpPut('/checkout/preferences/' + encodeURIComponent(preferenceId), {
    expires:true,
    expiration_date_from: now.toISOString(),
    expiration_date_to: new Date(now.getTime()+1000).toISOString(),
    metadata
  });
}

async function startCheckout({clientId, participants, paymentMethod, returnBaseUrl}) {
  const ps=cleanParticipants(participants);
  const method=String(paymentMethod||'PIX').toUpperCase()==='CARTÃO'?'CARTÃO':'PIX';
  const id=reservationId(clientId);
  const existing=await findPreferenceByExternalReference(id);

  if(existing){
    const payments=await listOutubroPayments();
    const current=normalize(existing,payments.get(id)||null);
    const active=occupies(current.status);
    if(current.status==='confirmed') return {reservation:current,checkoutUrl:'',alreadyPaid:true};

    if(active){
      const sameParticipants=JSON.stringify(current.participants||[])===JSON.stringify(ps);
      const sameMethod=String(current.paymentMethod||'').toUpperCase()===method;
      if(sameParticipants && sameMethod && existing.init_point){
        return {reservation:current,checkoutUrl:existing.init_point,reused:true};
      }

      // A pessoa voltou para editar ou trocou a forma de pagamento.
      // Expira a tentativa anterior antes de criar a nova, para não prender vagas duplicadas.
      await expirePreference(existing.id).catch(()=>{});
    }
  }

  const before=await stats();
  if(ps.length>before.available) throw new Error(before.available<=0?'Vagas esgotadas.':'Não há vagas suficientes disponíveis.');

  const total=money(ps.reduce((sum,p)=>sum+p.price,0));
  const now=new Date();
  const expiresAt=new Date(now.getTime()+HOLD_MINUTES*60*1000);
  const audit=[{at:now.toISOString(),action:'RESERVA_CRIADA',detail:method}];
  const metadata={
    event_key:EVENT_KEY,
    reservation_id:id,
    admin_status:'pending',
    payment_method:method,
    participants_b64:encodeParticipants(ps),
    quantity:ps.length,
    total,
    created_at:now.toISOString(),
    audit_b64:encodeAudit(audit)
  };

  const excluded = method==='PIX'
    ? [{id:'credit_card'},{id:'debit_card'},{id:'ticket'}]
    : [{id:'bank_transfer'},{id:'ticket'}];

  const base=String(returnBaseUrl||'https://jonatasmarruda-prog.github.io/morrodamesa/outubro-rosa-2026/').replace(/\/$/,'')+'/';
  const body={
    items:[{
      id:'outubro-rosa-2026',
      title:'Outubro Rosa - Mirante da Janela',
      description:ps.length+' participante(s) • 18/10/2026',
      category_id:'tourism',
      currency_id:'BRL',
      quantity:1,
      unit_price:total
    }],
    external_reference:id,
    notification_url:'https://trilheiros-reservas.vercel.app/api/webhook',
    back_urls:{
      success:base+'?retorno=sucesso&reserva='+encodeURIComponent(id),
      pending:base+'?retorno=pendente&reserva='+encodeURIComponent(id),
      failure:base+'?retorno=falha&reserva='+encodeURIComponent(id)
    },
    auto_return:'approved',
    expires:true,
    expiration_date_from:now.toISOString(),
    expiration_date_to:expiresAt.toISOString(),
    payment_methods:{
      excluded_payment_types:excluded,
      installments:12,
      ...(method==='PIX'?{default_payment_method_id:'pix'}:{})
    },
    metadata
  };

  const pref=await mpPost('/checkout/preferences',body);
  if(!pref.id || !pref.init_point) throw new Error('O Mercado Pago não retornou o link de pagamento.');

  // A disponibilidade já foi validada antes da criação. Não fazemos uma
  // segunda leitura imediata aqui porque a busca de preferências do Mercado Pago
  // pode levar alguns instantes para refletir a reserva recém-criada, gerando
  // falso aviso de últimas vagas.
  const row=normalize(pref,null);
  return {reservation:row,checkoutUrl:pref.init_point,expiresAt:expiresAt.toISOString()};
}

async function reservationById(id) {
  const pref=await findPreferenceByExternalReference(id);
  if(!pref) return null;
  const payments=await listOutubroPayments();
  return normalize(pref,payments.get(String(id))||null);
}

async function updateStatus(reservationIdValue, status) {
  if (!['confirmed','cancelled'].includes(status)) throw new Error('Status inválido.');
  const pref = await findPreferenceByExternalReference(reservationIdValue);
  if (!pref) throw new Error('Reserva não encontrada.');
  const md=pref.metadata||{};
  const audit=decodeAudit(md.audit_b64);
  audit.push({at:new Date().toISOString(),action:status==='cancelled'?'CANCELADA_ADMIN':'CONFIRMADA_ADMIN'});
  const metadata = {
    ...md,
    admin_status: status,
    audit_b64:encodeAudit(audit),
    updated_at:new Date().toISOString()
  };
  if(status==='cancelled') metadata.cancelled_at=new Date().toISOString();
  const updated=await mpPut('/checkout/preferences/'+encodeURIComponent(pref.id),{metadata});
  if(status==='cancelled') await expirePreference(pref.id).catch(()=>{});
  const payments=await listOutubroPayments();
  return normalize(updated,payments.get(reservationIdValue)||null);
}

async function removeParticipant(reservationIdValue, participantId) {
  const pref=await findPreferenceByExternalReference(reservationIdValue);
  if(!pref) throw new Error('Reserva não encontrada.');
  const md=pref.metadata||{};
  const current=decodeParticipants(md.participants_b64);
  const removed=current.find(p=>String(p.id)===String(participantId));
  const next=current.filter(p=>String(p.id)!==String(participantId));
  if(!removed) throw new Error('Participante não encontrada.');
  const audit=decodeAudit(md.audit_b64);
  audit.push({at:new Date().toISOString(),action:'PARTICIPANTE_EXCLUIDA',detail:removed.name});
  const total=money(next.reduce((s,p)=>s+Number(p.price||0),0));
  const payments=await listOutubroPayments();
  const currentPayment=payments.get(reservationIdValue)||null;
  const wasPaid=currentPayment?.status==='approved';
  const metadata={
    ...md,
    participants_b64:encodeParticipants(next),
    quantity:next.length,
    total,
    admin_status:next.length?(wasPaid?'confirmed':String(md.admin_status||'pending')):'cancelled',
    adjusted_after_payment: Boolean(next.length && wasPaid),
    audit_b64:encodeAudit(audit),
    updated_at:new Date().toISOString()
  };
  const updated=await mpPut('/checkout/preferences/'+encodeURIComponent(pref.id),{metadata});
  if(!next.length) await expirePreference(pref.id).catch(()=>{});
  return normalize(updated,payments.get(reservationIdValue)||null);
}

async function adminData() {
  const reservations=(await allRows()).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0));
  const s={total:CAPACITY,pending:0,confirmed:0,review:0,reserved:0,available:CAPACITY};
  reservations.forEach(r=>{
    if(r.status==='pending') s.pending+=r.quantity;
    if(r.status==='confirmed') s.confirmed+=r.quantity;
    if(r.status==='review') s.review+=r.quantity;
  });
  s.reserved=s.pending+s.confirmed+s.review;
  s.available=Math.max(0,CAPACITY-s.reserved);

  const shirts=[];
  reservations.filter(r=>occupies(r.status)).forEach(r=>{
    r.participants.filter(p=>p.option==='shirt').forEach(p=>shirts.push({
      reservationId:r.id,
      name:p.name,
      model:p.model,
      size:p.size,
      quantity:1,
      status:r.status,
      paymentMethod:r.paymentMethod
    }));
  });
  shirts.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
  const counts={};
  shirts.forEach(sx=>{
    const k=sx.model+'|'+sx.size;
    counts[k]=(counts[k]||0)+1;
  });
  return {reservations,stats:s,shirts,shirtCounts:counts,totalShirts:shirts.length};
}

module.exports={
  CAPACITY,HOLD_MINUTES,SHIRT_CUTOFF_UTC,
  cleanParticipants,startCheckout,reservationById,
  stats,adminData,updateStatus,removeParticipant
};