const { trips } = require('./_catalog');
const { json } = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Método não permitido.' });
  return json(res, 200, { trips });
};
