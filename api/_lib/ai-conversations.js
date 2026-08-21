'use strict';

/* PHF AI - Lich su hoi thoai (Batch C). Nguon luu: bang moi
   ai_conversations/ai_conversation_messages (xem
   scripts/PHF_AI_CONVERSATIONS_1.45.sql - PHAI chay migration nay tren
   Supabase truoc khi module nay hoat dong). Day la tinh nang MOI hoan
   toan - lib/ai-sandbox.js truoc gio KHONG luu lich su server-side.

   QUYEN RIENG TU: moi ham o day tu doi chieu account_id cua ban ghi voi
   actorId(session) cua CHINH nguoi dang goi - KHONG co nhanh nao cho admin
   doc lich su cua tai khoan khac chi vi la admin (dung yeu cau "Admin
   khong mac dinh duoc doc chat nhan vien"). KHONG luu system prompt/tool
   registry/secret vao day - chi luu role/content/result/actions cua tung
   tin nhan (dung nhung gi da hien thi cho nguoi dung, xem lib/ai-sandbox.js
   SYSTEM_PROMPT khong bao gio di qua day). */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const okEnv = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = okEnv
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const CONVERSATIONS = 'ai_conversations';
const MESSAGES = 'ai_conversation_messages';
const MAX_TITLE_SOURCE_CHARS = 48;
const MAX_LIST_LIMIT = 50;
const DEFAULT_LIST_LIMIT = 50;
const MAX_MESSAGES_PER_CALL = 20;
const MAX_MESSAGE_CONTENT_CHARS = 4000; // dong bo voi lib/ai-sandbox.js MAX_MESSAGE_CHARS
const MAX_MESSAGES_RETURNED = 500;

// getConversation() sap xep tin nhan CHI theo created_at (khong co cot thu
// tu rieng - tranh them migration khi chua thuc su can). Neu 2 tin nhan
// cung 1 luot (user+assistant) chen cung 1 created_at, thu tu tra ve giua
// cac lan doc co the khong on dinh. Lech moi tin nhan trong cung 1 batch
// insert 1ms de dam bao thu tu ghi = thu tu doc lai, khong doi schema.
function sequencedIso(baseMs, index) { return new Date(baseMs + index).toISOString(); }
function t(value) { return String(value == null ? '' : value).trim(); }
function fail(message, statusCode = 400, code = 'AI_CONVERSATION_INVALID') { const e = new Error(message); e.statusCode = statusCode; e.code = code; throw e; }
function ensureDb() { if (!supabase) fail('Supabase chưa được cấu hình để lưu lịch sử hội thoại.', 503, 'SUPABASE_NOT_CONFIGURED'); }
function actorId(session) { return t(session?.account?.id || session?.sub); }

// Tieu de tu sinh: thuat toan local don gian tu cau dau, KHONG goi them
// model rieng (tranh tang chi phi/do phuc tap nhu yeu cau).
function deriveTitle(firstUserContent) {
  const text = t(firstUserContent).replace(/\s+/g, ' ');
  if (!text) return 'Cuộc trò chuyện mới';
  if (text.length <= MAX_TITLE_SOURCE_CHARS) return text;
  let cut = text.slice(0, MAX_TITLE_SOURCE_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > 20) cut = cut.slice(0, lastSpace);
  return cut + '…';
}

function cleanMessagesInput(rawMessages) {
  const list = Array.isArray(rawMessages) ? rawMessages.slice(0, MAX_MESSAGES_PER_CALL) : [];
  return list.map(m => {
    const role = t(m && m.role).toLowerCase();
    if (role !== 'user' && role !== 'assistant') fail('Vai trò tin nhắn không hợp lệ.', 400, 'AI_CONVERSATION_MESSAGE_ROLE_INVALID');
    const content = t(m && m.content).slice(0, MAX_MESSAGE_CONTENT_CHARS);
    return {
      role,
      content,
      result: m && m.result && typeof m.result === 'object' && !Array.isArray(m.result) ? m.result : null,
      actions: Array.isArray(m && m.actions) ? m.actions : null
    };
  }).filter(m => m.content);
}

async function listConversations(session, input = {}) {
  ensureDb();
  const owner = actorId(session);
  if (!owner) fail('Tài khoản không hợp lệ.', 403, 'AI_CONVERSATION_OWNER_REQUIRED');
  const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number(input.limit) || DEFAULT_LIST_LIMIT));
  const search = t(input.search).toLowerCase();

  const { data, error } = await supabase.from(CONVERSATIONS)
    .select('id,title,message_count,created_at,updated_at')
    .eq('account_id', owner)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  let rows = data || [];
  if (search) rows = rows.filter(r => t(r.title).toLowerCase().includes(search));

  return {
    conversations: rows.map(r => ({
      id: r.id,
      title: r.title || 'Cuộc trò chuyện mới',
      messageCount: r.message_count || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  };
}

async function getConversation(session, input = {}) {
  ensureDb();
  const owner = actorId(session);
  const id = t(input.id);
  if (!id) fail('Thiếu mã cuộc trò chuyện.', 400, 'AI_CONVERSATION_ID_REQUIRED');

  const convRes = await supabase.from(CONVERSATIONS).select('id,title,account_id,message_count,created_at,updated_at').eq('id', id).maybeSingle();
  if (convRes.error) throw convRes.error;
  const conv = convRes.data;
  if (!conv || conv.account_id !== owner) fail('Không tìm thấy cuộc trò chuyện.', 404, 'AI_CONVERSATION_NOT_FOUND');

  const msgRes = await supabase.from(MESSAGES).select('role,content,result,actions,created_at')
    .eq('conversation_id', id).order('created_at', { ascending: true }).limit(MAX_MESSAGES_RETURNED);
  if (msgRes.error) throw msgRes.error;

  return {
    id: conv.id,
    title: conv.title || 'Cuộc trò chuyện mới',
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
    messages: (msgRes.data || []).map(m => ({ role: m.role, content: m.content, result: m.result || null, actions: m.actions || null }))
  };
}

async function createConversation(session, input = {}) {
  ensureDb();
  const owner = actorId(session);
  if (!owner) fail('Tài khoản không hợp lệ.', 403, 'AI_CONVERSATION_OWNER_REQUIRED');
  const messages = cleanMessagesInput(input.messages);
  if (!messages.length) fail('Cần ít nhất 1 tin nhắn để tạo cuộc trò chuyện.', 400, 'AI_CONVERSATION_MESSAGES_REQUIRED');

  const firstUser = messages.find(m => m.role === 'user');
  const title = deriveTitle(firstUser ? firstUser.content : '');
  const baseMs = Date.now();
  const nowIso = new Date(baseMs).toISOString();

  const insertConv = await supabase.from(CONVERSATIONS)
    .insert({ account_id: owner, title, message_count: messages.length, created_at: nowIso, updated_at: nowIso })
    .select('id,title,message_count,created_at,updated_at').single();
  if (insertConv.error) throw insertConv.error;
  const conv = insertConv.data;

  const rows = messages.map((m, i) => ({ conversation_id: conv.id, role: m.role, content: m.content, result: m.result, actions: m.actions, created_at: sequencedIso(baseMs, i) }));
  const insertMsgs = await supabase.from(MESSAGES).insert(rows);
  if (insertMsgs.error) throw insertMsgs.error;

  return { id: conv.id, title: conv.title, messageCount: conv.message_count, createdAt: conv.created_at, updatedAt: conv.updated_at };
}

async function appendMessages(session, input = {}) {
  ensureDb();
  const owner = actorId(session);
  const id = t(input.id);
  if (!id) fail('Thiếu mã cuộc trò chuyện.', 400, 'AI_CONVERSATION_ID_REQUIRED');
  const messages = cleanMessagesInput(input.messages);
  if (!messages.length) fail('Không có tin nhắn để lưu.', 400, 'AI_CONVERSATION_MESSAGES_REQUIRED');

  const convRes = await supabase.from(CONVERSATIONS).select('id,account_id,message_count').eq('id', id).maybeSingle();
  if (convRes.error) throw convRes.error;
  const conv = convRes.data;
  if (!conv || conv.account_id !== owner) fail('Không tìm thấy cuộc trò chuyện.', 404, 'AI_CONVERSATION_NOT_FOUND');

  const baseMs = Date.now();
  const nowIso = new Date(baseMs).toISOString();
  const rows = messages.map((m, i) => ({ conversation_id: id, role: m.role, content: m.content, result: m.result, actions: m.actions, created_at: sequencedIso(baseMs, i) }));
  const insertMsgs = await supabase.from(MESSAGES).insert(rows);
  if (insertMsgs.error) throw insertMsgs.error;

  const nextCount = (conv.message_count || 0) + messages.length;
  const updateConv = await supabase.from(CONVERSATIONS)
    .update({ message_count: nextCount, updated_at: nowIso }).eq('id', id)
    .select('id,title,message_count,updated_at').single();
  if (updateConv.error) throw updateConv.error;

  return { id: updateConv.data.id, title: updateConv.data.title, messageCount: updateConv.data.message_count, updatedAt: updateConv.data.updated_at };
}

async function deleteConversation(session, input = {}) {
  ensureDb();
  const owner = actorId(session);
  const id = t(input.id);
  if (!id) fail('Thiếu mã cuộc trò chuyện.', 400, 'AI_CONVERSATION_ID_REQUIRED');

  const convRes = await supabase.from(CONVERSATIONS).select('id,account_id').eq('id', id).maybeSingle();
  if (convRes.error) throw convRes.error;
  const conv = convRes.data;
  if (!conv || conv.account_id !== owner) fail('Không tìm thấy cuộc trò chuyện.', 404, 'AI_CONVERSATION_NOT_FOUND');

  const del = await supabase.from(CONVERSATIONS).delete().eq('id', id);
  if (del.error) throw del.error;
  return { deleted: true, id };
}

module.exports = { listConversations, getConversation, createConversation, appendMessages, deleteConversation };
