const crypto = require('crypto');
const { json } = require('./_utils');
const { createSessionToken, sessionCookie } = require('./_auth');

const ADMIN_SALT = 'b04b4a29b8ab3186de3d1ddfcc8eef2f';
const ADMIN_HASH = 'f410064601ce53291185d5c605860a96f53cf73c1e4017dd0cfabc7b3bc9bbab';

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
