'use strict';

const {
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength
} = require('../../lib/request-guard');
const { requireSession } = require('../../lib/auth');
const { send, sendError, requestBody } = require('../../lib/api-response');
const { runChatSandbox } = require('../../lib/ai-sandbox');

/* PHF AI Sandbox v1 - Vercel serverless function. Admin-only, khong
   Supabase, khong tool/action. Logic dung chung voi nhanh /api/ai/chat
   trong server.js qua lib/ai-sandbox.js de hai runtime khong lech nhau. */
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, {ok:false,error:'Phương thức không được hỗ trợ.',code:'METHOD_NOT_ALLOWED'});
    }
    assertSameOrigin(req);
    assertJsonContentType(req);
    assertContentLength(req);

    const session = await requireSession(req, ['admin']);
    const body = requestBody(req);
    const result = await runChatSandbox(session.sub, body.messages);
    return send(res, 200, {ok:true,reply:result.reply});
  } catch (error) {
    return sendError(res, error);
  }
};
