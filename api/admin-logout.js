const { json } = require('./_utils');
const { clearSessionCookie } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Set-Cookie', clearSessionCookie());
  return json(res, 200, { ok: true });
};
