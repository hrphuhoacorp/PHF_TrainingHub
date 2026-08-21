'use strict';

const { readSession } = require('../_lib/auth');
const { send, sendError } = require('../_lib/api-response');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return send(res, 405, {ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});
    }
    const session = await readSession(req);
    return send(res, 200, {
      ok:true,
      authenticated:!!session,
      user:session ? session.account : null
    });
  } catch (error) {
    return sendError(res, error);
  }
};
