'use strict';

const {
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength
} = require('../_lib/request-guard');
const { login, cookieHeader } = require('../_lib/auth');
const { send, sendError, requestBody } = require('../_lib/api-response');
const { assertLoginAllowed, recordLoginFailure, clearLoginFailures } = require('../_lib/production-hardening');
const { auditEmit } = require('../_lib/audit-emit');

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
      const rateLimited = !!(attempt.blockedUntil && attempt.blockedUntil > Date.now());
      if (rateLimited) res.setHeader('Retry-After', String(Math.ceil((attempt.blockedUntil-Date.now())/1000)));
      // Audit: safe fields only — attempted email + failure category. Never the password.
      await auditEmit(req, null, {
        module: 'auth', action: 'AUTH_LOGIN_FAILURE', result: rateLimited ? 'blocked' : 'failure',
        object_type: 'account', object_label: String(body.email || '').toLowerCase().slice(0, 200),
        metadata: { provider: 'password', reason: rateLimited ? 'LOGIN_RATE_LIMITED' : (result.code || 'LOGIN_INVALID') },
        actor: { actor_name: String(body.email || '').toLowerCase().slice(0, 200) || null },
      });
      return send(res, rateLimited ? 429 : 401, {ok:false,error:'Email hoặc mật khẩu chưa đúng, hoặc đăng nhập tạm thời bị giới hạn.',code:rateLimited?'LOGIN_RATE_LIMITED':'LOGIN_INVALID'});
    }

    clearLoginFailures(req, body.email);
    res.setHeader('Set-Cookie', cookieHeader(result.token));
    await auditEmit(req, { account: result.user }, {
      module: 'auth', action: 'AUTH_LOGIN_SUCCESS', result: 'success',
      object_type: 'account', object_id: result.user && result.user.id, object_label: result.user && result.user.email,
      metadata: { provider: 'password', role: result.user && result.user.role },
    });
    return send(res, 200, {ok:true,user:result.user});
  } catch (error) {
    return sendError(res, error);
  }
};
