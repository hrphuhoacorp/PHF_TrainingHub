'use strict';

const { requireSession, updateAccountByAdmin, clearCookieHeader } = require('../../../lib/auth');
const { send, sendError, readJson, assertPost } = require('../../../lib/api-response');

module.exports = async function handler(req, res) {
  try {
    assertPost(req);
    const session = await requireSession(req, ['admin']);
    const body = await readJson(req);
    const user = await updateAccountByAdmin(body.accountId, body.account || body);
    const reauthRequired = String(session.sub || '') === String(user.id || '') &&
      (session.email !== user.email || session.role !== user.role || user.status !== 'active');
    if (reauthRequired) res.setHeader('Set-Cookie', clearCookieHeader());
    return send(res, 200, {ok:true,user,reauthRequired});
  } catch (error) {
    return sendError(res, error);
  }
};
