'use strict';

const {
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength
} = require('../../lib/request-guard');
const { requireSession } = require('../../lib/auth');
const { send, sendError, requestBody } = require('../../lib/api-response');
const { runChatSandbox } = require('../../lib/ai-sandbox');

/* PHF AI Sandbox - Vercel serverless function. Admin-only. AI co the doc
   (KHONG ghi) diem Checklist qua 1 tool whitelist trong lib/ai-sandbox.js/
   lib/ai-checklist-tools.js. Logic dung chung voi nhanh /api/ai/chat trong
   server.js qua lib/ai-sandbox.js de hai runtime khong lech nhau. */
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
    const result = await runChatSandbox(session, body.messages);
    return send(res, 200, {ok:true,reply:result.reply});
  } catch (error) {
    return sendError(res, error);
  }
};
