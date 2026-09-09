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
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TR-${new Date().getFullYear()}-${suffix}`;
}

function mpHeaders() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error('Mercado Pago não configurado.');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
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

module.exports = { json, onlyDigits, money, reservationId, mpHeaders, appUrl, mapMpStatus };
