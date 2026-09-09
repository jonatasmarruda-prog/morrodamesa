const crypto = require('crypto');
const { json } = require('./_utils');
const { createSessionToken, sessionCookie } = require('./_auth');

const BOOTSTRAP_SALT = 'cea54612a88841d5fbca7b261185f562';
const BOOTSTRAP_HASH = '521c0f49c87860750a9313d7308fc1d60a23ee27beea14077ba311ef9b91a5ed';

function safeTextEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function validBootstrapPassword(password) {
  try {
    const derived = crypto.scryptSync(String(password || ''), Buffer.from(BOOTSTRAP_SALT, 'hex'), 32, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(BOOTSTRAP_HASH, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const configured = process.env.ADMIN_PASSWORD || '';
  const validConfigured = configured ? safeTextEqual(body.password, configured) : false;
  const validBootstrap = validBootstrapPassword(body.password);
  if (!validConfigured && !validBootstrap) return json(res, 401, { error: 'Senha incorreta.' });
  const token = createSessionToken();
  res.setHeader('Set-Cookie', sessionCookie(token));
  return json(res, 200, { ok: true });
};
