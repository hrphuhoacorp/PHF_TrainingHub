'use strict';

const { assertSameOrigin } = require('../_lib/request-guard');
const { clearCookieHeader, readSession } = require('../_lib/auth');
const { send, sendError } = require('../_lib/api-response');
const { auditEmit } = require('../_lib/audit-emit');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, {ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});
    }
    assertSameOrigin(req);
    // Resolve who is logging out BEFORE the cookie is cleared (best-effort).
    let session = null;
    try { session = await readSession(req); } catch (_e) { session = null; }
    res.setHeader('Set-Cookie', clearCookieHeader());
    await auditEmit(req, session, {
      module: 'auth', action: 'AUTH_LOGOUT', result: 'success',
      object_type: 'account',
      object_id: session && session.account && session.account.id,
      object_label: session && session.account && session.account.email,
      metadata: { provider: (session && session.account && session.account.authProvider) || 'unknown' },
    });
    return send(res, 200, {ok:true});
  } catch (error) {
    return sendError(res, error);
  }
};
