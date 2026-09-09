const crypto = require('crypto');
const { json } = require('./_utils');
const { createSessionToken, sessionCookie } = require('./_auth');

function safeTextEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected || !safeTextEqual(body.password, expected)) return json(res, 401, { error: 'Senha incorreta.' });
  const token = createSessionToken();
  res.setHeader('Set-Cookie', sessionCookie(token));
  return json(res, 200, { ok: true });
};
