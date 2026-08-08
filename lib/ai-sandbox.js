'use strict';

/* PHF AI Sandbox - module doc lap, dung chung cho ca hai runtime
   (api/ai/chat.js tren Vercel va nhanh /api/ai/chat trong server.js) de
   khong lech logic, va dung chung cho ca /admin/ai-sandbox lan floating
   assistant o frontend (cung endpoint, cung orchestration).

   Module nay CHI lo phan giao tiep DeepSeek (validate input, goi API,
   timeout, rate limit, ghep tool-calling 2 luot). Toan bo danh sach tool
   duoc phep + adapter thuc thi + cach dung thanh structured result nam o
   lib/ai-tool-registry.js (TOOL REGISTRY duy nhat) - o day khong tu thuc
   thi hay dinh nghia tool nao ngoai registry do.

   KHONG luu lich su hoi thoai server-side - chi nhan messages tu client
   moi luot. Xem TRACE report cho boi canh nguon du lieu/quyen tung tool. */

const { RequestError } = require('./request-guard');
const { AI_TOOLS, executeToolCall, buildStructuredResult } = require('./ai-tool-registry');

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
// deepseek-chat/deepseek-reasoner (legacy id) da retire 2026-07-24. Model manh
// nhat hien tai phu hop sandbox/reasoning la deepseek-v4-pro (xem trace).
const DEEPSEEK_MODEL = String(process.env.PHF_DEEPSEEK_MODEL || 'deepseek-v4-pro').trim();
const REQUEST_TIMEOUT_MS = 30000;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_TOOL_CALLS_PER_TURN = 3;

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_INPUT_CHARS = 20000;
const ALLOWED_ROLES = new Set(['user', 'assistant']);

const SYSTEM_PROMPT =
  'Bạn là trợ lý AI thử nghiệm của PHF HR.\n' +
  'Bạn hỗ trợ phân tích, giải thích và đưa ra đề xuất.\n' +
  'Bạn không có quyền truy cập hoặc thay đổi dữ liệu hệ thống.\n' +
  'Không được tuyên bố rằng bạn đã sửa, lưu, duyệt hoặc thực hiện\n' +
  'thao tác trên PHF HR nếu hệ thống không cung cấp tool tương ứng.\n\n' +
  'Bạn có các tool đọc dữ liệu Checklist, Nhân sự và Khung năng lực (KNL)\n' +
  'của PHF HR. Khi câu hỏi cần dữ liệu thật (điểm số, danh sách, hồ sơ,\n' +
  'lỗi vi phạm...), hãy gọi đúng tool phù hợp thay vì tự suy đoán hay tự\n' +
  'tính toán. Chỉ trả lời dựa trên dữ liệu tool trả về - không tự bịa tên\n' +
  'người, mã nhân viên, điểm số, phòng ban, chi nhánh hay bất kỳ số liệu\n' +
  'nào khác. Nếu tool trả về danh sách rỗng, found:false, hoặc trường nào\n' +
  'đó là null (ví dụ dữ liệu đánh giá năng lực KNL chưa tồn tại), hãy nói\n' +
  'rõ hiện chưa có/chưa đủ dữ liệu, không suy diễn hay ước lượng thay thế.\n' +
  'Khi có thể, nêu thời điểm dữ liệu (asOf) mà tool cung cấp. Dữ liệu dạng\n' +
  'danh sách/bảng/hồ sơ sau khi gọi tool đã được giao diện hiển thị riêng\n' +
  'thành thẻ dữ liệu - phần trả lời bằng chữ của bạn chỉ cần một câu nhận\n' +
  'xét/tóm tắt ngắn gọn, KHÔNG lặp lại toàn bộ danh sách bằng bảng ký tự\n' +
  'Markdown hay liệt kê lại từng dòng.';

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

// Goi thap nhat toi DeepSeek chat completions - dung chung cho ca luot
// khong-tool va cac luot co tool-calling.
async function requestDeepSeekCompletion(messages, options) {
  const apiKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) {
    throw new RequestError('Dịch vụ AI chưa được cấu hình trên máy chủ này.', 503, 'AI_NOT_CONFIGURED');
  }
  const opts = options || {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    const body = {
      model: DEEPSEEK_MODEL,
      messages,
      max_tokens: MAX_OUTPUT_TOKENS,
      stream: false
    };
    if (opts.tools) { body.tools = opts.tools; body.tool_choice = 'auto'; }
    response = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
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

  const message = payload?.choices?.[0]?.message;
  if (!message) {
    throw new RequestError('Dịch vụ AI không trả về nội dung. Vui lòng thử lại.', 502, 'AI_EMPTY_RESPONSE');
  }
  return message;
}

async function callDeepSeekWithTools(session, cleanedMessages) {
  const baseMessages = [{ role: 'system', content: SYSTEM_PROMPT }, ...cleanedMessages];

  const firstMessage = await requestDeepSeekCompletion(baseMessages, { tools: AI_TOOLS });
  const toolCalls = Array.isArray(firstMessage.tool_calls) ? firstMessage.tool_calls.slice(0, MAX_TOOL_CALLS_PER_TURN) : [];

  if (!toolCalls.length) {
    const reply = String(firstMessage.content || '').trim();
    if (!reply) throw new RequestError('Dịch vụ AI không trả về nội dung. Vui lòng thử lại.', 502, 'AI_EMPTY_RESPONSE');
    return { reply, result: null };
  }

  // result structured = tool GOI THANH CONG dau tien (khong loi) trong luot
  // nay - du 1 turn co the goi nhieu tool, UI Batch 1 chi render 1 card
  // chinh de tranh qua tai giao dien; narrative text van tong hop het.
  let structuredResult = null;
  const toolResultMessages = [];
  for (const call of toolCalls) {
    const toolName = String(call?.function?.name || '');
    const toolPayload = await executeToolCall(session, call);
    if (!structuredResult) {
      const built = buildStructuredResult(toolName, toolPayload);
      if (built) structuredResult = built;
    }
    toolResultMessages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: JSON.stringify(toolPayload)
    });
  }

  // Luot 2 KHONG gui lai tools -> buoc model tra loi bang text, tranh vong
  // lap tool-calling khong gioi han.
  const secondMessage = await requestDeepSeekCompletion(
    [...baseMessages, firstMessage, ...toolResultMessages],
    {}
  );
  const finalReply = String(secondMessage.content || '').trim();
  if (!finalReply) throw new RequestError('Dịch vụ AI không trả về nội dung. Vui lòng thử lại.', 502, 'AI_EMPTY_RESPONSE');
  return { reply: finalReply, result: structuredResult };
}

async function runChatSandbox(session, rawMessages) {
  const sessionId = session && (session.sub || session.id) || 'unknown';
  const cleaned = validateChatMessages(rawMessages);
  assertRateAllowed(sessionId);
  assertNotInflight(sessionId);
  try {
    const { reply, result } = await callDeepSeekWithTools(session, cleaned);
    return { reply, result, model: DEEPSEEK_MODEL };
  } finally {
    releaseInflight(sessionId);
  }
}

module.exports = {
  DEEPSEEK_MODEL,
  runChatSandbox,
  validateChatMessages
};
