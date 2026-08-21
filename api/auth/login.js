'use strict';

const {
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength
} = require('../_lib/request-guard');
const { login, cookieHeader } = require('../_lib/auth');
const { send, sendError, requestBody } = require('../_lib/api-response');
const { assertLoginAllowed, recordLoginFailure, clearLoginFailures } = require('../_lib/production-hardening');

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
    assertLoginAllowed(req, body.email);
    const result = await login(body.email, body.password);
    if (!result.ok) {
      const attempt=recordLoginFailure(req, body.email);
      if (attempt.blockedUntil && attempt.blockedUntil > Date.now()) res.setHeader('Retry-After', String(Math.ceil((attempt.blockedUntil-Date.now())/1000)));
      return send(res, attempt.blockedUntil && attempt.blockedUntil > Date.now() ? 429 : 401, {ok:false,error:'Email hoặc mật khẩu chưa đúng, hoặc đăng nhập tạm thời bị giới hạn.',code:attempt.blockedUntil && attempt.blockedUntil > Date.now()?'LOGIN_RATE_LIMITED':'LOGIN_INVALID'});
    }

    clearLoginFailures(req, body.email);
    res.setHeader('Set-Cookie', cookieHeader(result.token));
    return send(res, 200, {ok:true,user:result.user});
  } catch (error) {
    return sendError(res, error);
  }
};
