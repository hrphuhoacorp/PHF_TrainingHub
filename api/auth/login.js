'use strict';

const {
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength
} = require('../../lib/request-guard');
const { login, cookieHeader } = require('../../lib/auth');
const { send, sendError, requestBody } = require('../../lib/api-response');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, {ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});
    }
    assertSameOrigin(req);
    assertJsonContentType(req);
    assertContentLength(req);

    const body = requestBody(req);
    const result = await login(body.email, body.password);
    if (!result.ok) {
      return send(res, 401, {ok:false,error:'Email hoặc mật khẩu chưa đúng.',code:'LOGIN_INVALID'});
    }

    res.setHeader('Set-Cookie', cookieHeader(result.token));
    return send(res, 200, {ok:true,user:result.user});
  } catch (error) {
    return sendError(res, error);
  }
};
