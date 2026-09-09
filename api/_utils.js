const crypto = require('crypto');

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function money(value) {
  return Math.round(Number(value) * 100) / 100;
}

function reservationId() {
  const suffix = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `TR-${new Date().getFullYear()}-${suffix}`;
}

function reservationIdFromRequest(requestId) {
  const raw = String(requestId || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(raw)) return reservationId();
  const suffix = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12).toUpperCase();
  return `TR-${new Date().getFullYear()}-${suffix}`;
}

function mercadoPagoToken() {
  return String(process.env.MERCADOPAGO_ACCESS_TOKEN || '').trim();
}

function mercadoPagoTokenMode() {
  const token = mercadoPagoToken();
  if (!token) return 'missing';
  if (token.startsWith('TEST-')) return 'test';
  return 'production';
}

function mpHeaders(extra = {}) {
  const token = mercadoPagoToken();
  if (!token) throw new Error('Mercado Pago não configurado.');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

function appUrl() {
  const url = (process.env.APP_URL || '').replace(/\/$/, '');
  if (!url) throw new Error('APP_URL não configurada.');
  return url;
}

function mapMpStatus(status) {
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'refunded' || status === 'charged_back') return 'refunded';
  return 'pending';
}

module.exports = {
  json,
  onlyDigits,
  money,
  reservationId,
  reservationIdFromRequest,
  mercadoPagoToken,
  mercadoPagoTokenMode,
  mpHeaders,
  appUrl,
  mapMpStatus
};
