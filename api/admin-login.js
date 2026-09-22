const crypto = require('crypto');
const { json } = require('./_utils');
const { createSessionToken, sessionCookie } = require('./_auth');

const ADMIN_SALT = '81a45b88b10c69a9a55ca02898e1dc24';
const ADMIN_HASH = '55856c8bd93eb51cd61bc68236562c88d1f6ecc1065d8bfab7b38b702e572fae';

function validAdminPassword(password) {
  try {
    const derived = crypto.scryptSync(String(password || ''), Buffer.from(ADMIN_SALT, 'hex'), 32, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(ADMIN_HASH, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Método não permitido.' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  if (!validAdminPassword(body.password)) return json(res, 401, { error: 'Senha incorreta.' });
  const token = createSessionToken();
  res.setHeader('Set-Cookie', sessionCookie(token));
  return json(res, 200, { ok: true });
};
