'use strict';

const {
  assertSameOrigin,
  assertJsonContentType,
  assertContentLength
} = require('../../lib/request-guard');
const { requireSession } = require('../../lib/auth');
const { send, sendError, requestBody } = require('../../lib/api-response');
const {
  listConversations, getConversation, createConversation, appendMessages, deleteConversation
} = require('../../lib/ai-conversations');

/* PHF AI - Lich su hoi thoai (Batch C), Vercel serverless function. Mo cho
   ca 3 role giong /api/ai/chat. 1 endpoint, dispatch theo body.action -
   dung pattern "action string trong body" da co san trong repo (vd
   /api/data?smokeChecklist=1), tranh mo them nhieu route/file moi. Moi
   action tu doi chieu quyen so huu (account_id) trong
   lib/ai-conversations.js - o day KHONG tu quyet dinh quyen. */
const ACTIONS = {
  list: listConversations,
  get: getConversation,
  create: createConversation,
  append: appendMessages,
  delete: deleteConversation
};

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { ok: false, error: 'Phương thức không được hỗ trợ.', code: 'METHOD_NOT_ALLOWED' });
    }
    assertSameOrigin(req);
    assertJsonContentType(req);
    assertContentLength(req);

    const session = await requireSession(req, ['admin', 'manager', 'learner']);
    const body = requestBody(req);
    const action = String(body.action || '').trim();
    const run = ACTIONS[action];
    if (!run) return send(res, 400, { ok: false, error: 'Hành động không hợp lệ.', code: 'AI_CONVERSATION_ACTION_INVALID' });

    const result = await run(session, body);
    return send(res, 200, { ok: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};
