'use strict';

const { assertSameOrigin } = require('../../lib/request-guard');
const { clearCookieHeader } = require('../../lib/auth');
const { send, sendError } = require('../../lib/api-response');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, {ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});
    }
    assertSameOrigin(req);
    res.setHeader('Set-Cookie', clearCookieHeader());
    return send(res, 200, {ok:true});
  } catch (error) {
    return sendError(res, error);
  }
};
