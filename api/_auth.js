const crypto = require('crypto');

const COOKIE_NAME = 'trilheiros_admin';
const MAX_AGE_SECONDS = 60 * 60;
const SESSION_VERSION = 2;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) throw new Error('Segredo de sessão administrativa não configurado.');
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

function createSessionToken() {
  const payload = JSON.stringify({ role: 'admin', v: SESSION_VERSION, exp: Date.now() + MAX_AGE_SECONDS * 1000 });
  const encoded = b64url(payload);
  return `${encoded}.${sign(encoded)}`;
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, item) => {
    const idx = item.indexOf('=');
    if (idx > -1) acc[item.slice(0, idx).trim()] = decodeURIComponent(item.slice(idx + 1).trim());
    return acc;
  }, {});
}

function verifySession(req) {
  try {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return false;
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) return false;
    const expected = sign(encoded);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return payload.role === 'admin' && payload.v === SESSION_VERSION && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE_SECONDS}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

module.exports = { createSessionToken, verifySession, sessionCookie, clearSessionCookie };
