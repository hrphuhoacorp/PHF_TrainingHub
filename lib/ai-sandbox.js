'use strict';

/* PHF AI Sandbox v1 - module doc lap, dung chung cho ca hai runtime
   (api/ai/chat.js tren Vercel va nhanh /api/ai/chat trong server.js) de
   khong lech logic. KHONG doc/ghi Supabase, KHONG tool/action, KHONG luu
   lich su hoi thoai - chi nhan messages tu client, goi DeepSeek, tra ve
   text. Xem TRACE report cho boi canh day du. */

const { RequestError } = require('./request-guard');

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
// deepseek-chat/deepseek-reasoner (legacy id) da retire 2026-07-24. Model manh
// nhat hien tai phu hop sandbox/reasoning la deepseek-v4-pro (xem trace).
const DEEPSEEK_MODEL = String(process.env.PHF_DEEPSEEK_MODEL || 'deepseek-v4-pro').trim();
const REQUEST_TIMEOUT_MS = 30000;
const MAX_OUTPUT_TOKENS = 1024;

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_INPUT_CHARS = 20000;
const ALLOWED_ROLES = new Set(['user', 'assistant']);

const SYSTEM_PROMPT =
  'Bạn là trợ lý AI thử nghiệm của PHF HR.\n' +
  'Bạn hỗ trợ phân tích, giải thích và đưa ra đề xuất.\n' +
  'Bạn không có quyền truy cập hoặc thay đổi dữ liệu hệ thống.\n' +
  'Không được tuyên bố rằng bạn đã sửa, lưu, duyệt hoặc thực hiện\n' +
  'thao tác trên PHF HR nếu hệ thống không cung cấp tool tương ứng.';

// Rate limit rieng cho AI Sandbox, tach biet loginAttempts trong
// lib/production-hardening.js de giu module boundary doc lap.
const requestLog = new Map();
const RATE_WINDOW_MS = Number(process.env.PHF_AI_RATE_WINDOW_MS || 5 * 60 * 1000);
const RATE_MAX_REQUESTS = Number(process.env.PHF_AI_RATE_MAX_REQUESTS || 20);
const inflightBySession = new Set();

function cleanupRateLog(now) {
  for (const [key, row] of requestLog.entries()) {
    if (now - row.firstAt > RATE_WINDOW_MS) requestLog.delete(key);
  }
}

function assertRateAllowed(sessionId) {
  const now = Date.now();
  cleanupRateLog(now);
  const key = String(sessionId || 'unknown');
  const row = requestLog.get(key);
  if (!row || now - row.firstAt > RATE_WINDOW_MS) {
    requestLog.set(key, { count: 1, firstAt: now });
    return;
  }
  row.count += 1;
  if (row.count > RATE_MAX_REQUESTS) {
    throw new RequestError('Bạn đã gửi quá nhiều câu hỏi AI trong thời gian ngắn. Vui lòng thử lại sau ít phút.', 429, 'AI_RATE_LIMITED');
  }
}

// Chong double-submit: 1 phien chi duoc 1 request AI dang xu ly cung luc.
function assertNotInflight(sessionId) {
  const key = String(sessionId || 'unknown');
  if (inflightBySession.has(key)) {
    throw new RequestError('Câu hỏi trước vẫn đang được xử lý. Vui lòng đợi phản hồi.', 409, 'AI_REQUEST_IN_PROGRESS');
  }
  inflightBySession.add(key);
}
function releaseInflight(sessionId) {
  inflightBySession.delete(String(sessionId || 'unknown'));
}

function validateChatMessages(rawMessages) {
  if (!Array.isArray(rawMessages) || !rawMessages.length) {
    throw new RequestError('Vui lòng nhập câu hỏi trước khi gửi.', 400, 'MESSAGES_REQUIRED');
  }
  if (rawMessages.length > MAX_MESSAGES) {
    throw new RequestError('Cuộc trò chuyện quá dài. Vui lòng bắt đầu cuộc trò chuyện mới.', 400, 'MESSAGES_TOO_MANY');
  }

  let totalChars = 0;
  const cleaned = rawMessages.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new RequestError(`Tin nhắn thứ ${index + 1} không hợp lệ.`, 400, 'MESSAGE_INVALID');
    }
    const role = String(item.role || '').trim().toLowerCase();
    if (!ALLOWED_ROLES.has(role)) {
      throw new RequestError('Chỉ được gửi tin nhắn với vai trò user hoặc assistant.', 400, 'MESSAGE_ROLE_INVALID');
    }
    const content = String(item.content || '').trim();
    if (!content) {
      throw new RequestError(`Tin nhắn thứ ${index + 1} không có nội dung.`, 400, 'MESSAGE_CONTENT_REQUIRED');
    }
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new RequestError(`Tin nhắn thứ ${index + 1} vượt quá ${MAX_MESSAGE_CHARS} ký tự.`, 400, 'MESSAGE_TOO_LONG');
    }
    totalChars += content.length;
    return { role, content };
  });

  if (totalChars > MAX_TOTAL_INPUT_CHARS) {
    throw new RequestError('Tổng độ dài cuộc trò chuyện vượt quá giới hạn cho phép.', 400, 'MESSAGES_TOO_LARGE');
  }
  if (cleaned[cleaned.length - 1].role !== 'user') {
    throw new RequestError('Tin nhắn cuối cùng phải là câu hỏi của người dùng.', 400, 'MESSAGE_LAST_MUST_BE_USER');
  }
  return cleaned;
}

async function callDeepSeek(cleanedMessages) {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) {
    const error = new RequestError('Dịch vụ AI chưa được cấu hình trên máy chủ này.', 503, 'AI_NOT_CONFIGURED');
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...cleanedMessages],
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: false
      })
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new RequestError('Dịch vụ AI phản hồi quá lâu. Vui lòng thử lại.', 504, 'AI_TIMEOUT');
    }
    console.error('[PHF AI Sandbox] upstream network error:', error && error.message ? error.message : error);
    throw new RequestError('Không thể kết nối dịch vụ AI lúc này. Vui lòng thử lại sau.', 503, 'AI_SERVICE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    console.error('[PHF AI Sandbox] upstream status', response.status);
    if (response.status === 429) {
      throw new RequestError('Dịch vụ AI đang quá tải. Vui lòng thử lại sau ít phút.', 429, 'AI_RATE_LIMITED');
    }
    if (response.status === 401 || response.status === 403) {
      throw new RequestError('Dịch vụ AI chưa thể xác thực. Vui lòng báo Admin kỹ thuật.', 503, 'AI_SERVICE_UNAVAILABLE');
    }
    throw new RequestError('Dịch vụ AI chưa thể xử lý yêu cầu lúc này. Vui lòng thử lại sau.', 502, 'AI_SERVICE_UNAVAILABLE');
  }

  let payload = {};
  try { payload = await response.json(); }
  catch (error) {
    console.error('[PHF AI Sandbox] upstream returned non-JSON response');
    throw new RequestError('Dịch vụ AI trả về dữ liệu không hợp lệ.', 502, 'AI_SERVICE_UNAVAILABLE');
  }

  const reply = String(payload?.choices?.[0]?.message?.content || '').trim();
  if (!reply) {
    throw new RequestError('Dịch vụ AI không trả về nội dung. Vui lòng thử lại.', 502, 'AI_EMPTY_RESPONSE');
  }
  return reply;
}

async function runChatSandbox(sessionId, rawMessages) {
  const cleaned = validateChatMessages(rawMessages);
  assertRateAllowed(sessionId);
  assertNotInflight(sessionId);
  try {
    const reply = await callDeepSeek(cleaned);
    return { reply, model: DEEPSEEK_MODEL };
  } finally {
    releaseInflight(sessionId);
  }
}

module.exports = {
  DEEPSEEK_MODEL,
  runChatSandbox,
  validateChatMessages
};
