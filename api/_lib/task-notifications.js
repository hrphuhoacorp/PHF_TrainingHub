'use strict';

/*
 * PHF Task Notification (Cross-department V1) — thông báo nội bộ RIÊNG của
 * PHF Task, hiện chỉ phục vụ đúng 1 event: quản lý phòng nhận được thông báo
 * khi Task liên phòng ban được publish (KHÔNG phải approval request).
 *
 * KHÓA SCOPE (đã chốt): KHÔNG dùng chung system_notifications/
 * checklist_notifications/knl_notifications — bảng task_notifications RIÊNG
 * của Task, xem scripts/PHF_TASK_CROSS_DEPARTMENT_NOTIFICATION_1.72.0.sql
 * (CHƯA apply Production). Kỹ thuật THAM KHẢO trực tiếp
 * api/_lib/knl-notifications.js (emit/dedupe/read-unread/safe failure) —
 * KHÔNG import/gọi hàm của file đó, domain hoàn toàn độc lập.
 *
 * "Notification follows permission scope" — file này KHÔNG tự quyết định AI
 * được nhận thông báo; recipient luôn được caller (task-core.js publishTask())
 * resolve xong dựa trên quan hệ manager_of_primary + MANAGER_VIEW_ACTOR_TYPES
 * đã canonical trong task-permissions.js — KHÔNG heuristic theo title/chức
 * danh, KHÔNG tự mở rộng recipient.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const db = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const TABLE = 'task_notifications';
const MIGRATION = 'scripts/PHF_TASK_CROSS_DEPARTMENT_NOTIFICATION_1.72.0.sql';
const EVENT_CODES = new Set(['TASK_CROSS_DEPARTMENT_ASSIGNED']);
const PRIORITIES = new Set(['Trung bình', 'Cao', 'Khẩn']);

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function fail(message, statusCode = 400, errorCode = 'TASK_NOTIFICATION_INVALID') { const error = new Error(message); error.statusCode = statusCode; error.code = errorCode; throw error; }
function ensureDb() { if (!db) fail('Supabase chưa được cấu hình cho Thông báo PHF Task.', 503, 'SUPABASE_NOT_CONFIGURED'); }
function isMissingSchema(error) {
  if (!error) return false;
  const errCode = text(error.code), message = text(error.message);
  return errCode === 'PGRST205' || errCode === '42P01' || /Could not find the table|relation .* does not exist|schema cache/i.test(message);
}
function throwDb(error) {
  if (!error) return;
  if (isMissingSchema(error)) fail('Schema Thông báo PHF Task chưa được cài đặt. Hãy chạy ' + MIGRATION + '.', 503, 'TASK_NOTIFICATION_SCHEMA_MISSING');
  throw error;
}

function actor(session) {
  return {
    id: text(session?.account?.id || session?.sub) || null,
    employeeCode: code(session?.employeeCode || session?.employee_code || session?.account?.employeeCode || session?.account?.employee_code)
  };
}

function publicNotification(row) {
  return {
    id: row.id,
    eventCode: row.event_code || '',
    taskId: row.task_id || '',
    title: row.title || '',
    message: row.message || '',
    priority: row.priority || 'Trung bình',
    targetPath: row.target_path || '',
    createdAt: row.created_at || '',
    readAt: row.read_at || '',
    status: row.read_at ? 'read' : 'new'
  };
}

/* emitTaskNotification — GHI thẳng, không có rule editor bật/tắt. recipients:
 * [{accountId?, employeeCode?}]. Trùng identity trong CÙNG lượt gọi tự dedupe
 * còn 1 dòng. Trùng identity GIỮA CÁC lượt gọi (publish retry/idempotency
 * replay — mục 11/CASE F) dedupe bằng dedupe_key (unique index) + upsert
 * ignoreDuplicates — không throw, không tạo dòng thứ 2. */
async function emitTaskNotification(eventCode, input = {}) {
  ensureDb();
  eventCode = code(eventCode);
  if (!EVENT_CODES.has(eventCode)) return { created: 0, skipped: 'event' };
  const taskId = text(input.taskId || input.task_id);
  const message = text(input.message);
  if (!message) return { created: 0, skipped: 'message' };
  const recipients = Array.isArray(input.recipients) ? input.recipients : (input.recipient ? [input.recipient] : []);
  const priority = PRIORITIES.has(text(input.priority)) ? text(input.priority) : 'Trung bình';
  const targetPath = text(input.targetPath || input.target_path) || null;
  const title = text(input.title) || eventCode;
  const dedupeBase = text(input.dedupeKey || input.dedupe_key) || (eventCode + '|' + taskId);
  const now = new Date().toISOString();

  const rows = [];
  const seenIdentity = new Set();
  for (const recipient of recipients || []) {
    const accountId = text(recipient && (recipient.accountId || recipient.account_id));
    const employeeCode = code(recipient && (recipient.employeeCode || recipient.employee_code));
    if (!accountId && !employeeCode) continue;
    const identityKey = employeeCode || accountId;
    if (seenIdentity.has(identityKey)) continue;
    seenIdentity.add(identityKey);
    rows.push({
      recipient_account_id: accountId || null,
      recipient_employee_code: employeeCode || null,
      event_code: eventCode,
      task_id: taskId || null,
      title, message, target_path: targetPath, priority,
      dedupe_key: dedupeBase + '|' + identityKey,
      created_at: now
    });
  }
  if (!rows.length) return { created: 0, skipped: 'recipient' };

  const result = await db.from(TABLE).upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id');
  throwDb(result.error);
  return { created: (result.data || []).length };
}

/* emitTaskNotificationSafe — BẮT BUỘC dùng ở call site (publishTask() trong
 * task-core.js): notification là side-effect SAU publish thành công — lỗi
 * emit (schema chưa apply 1.72.0, mất kết nối, v.v.) KHÔNG BAO GIỜ được làm
 * hỏng response publish đã thành công thật — chỉ log, không rollback. */
async function emitTaskNotificationSafe(eventCode, input) {
  try { return await emitTaskNotification(eventCode, input); }
  catch (error) { console.warn('[PHF Task Notification] emit thất bại (bỏ qua, không ảnh hưởng publish):', error && error.message ? error.message : error); return { created: 0, error: true }; }
}

async function listMyTaskNotifications(session, { limit = 50 } = {}) {
  ensureDb();
  const a = actor(session);
  if (!a.id && !a.employeeCode) fail('Tài khoản chưa liên kết định danh PHF Task.', 409, 'TASK_NOTIFICATION_IDENTITY_NOT_LINKED');
  const filters = [];
  if (a.id) filters.push('recipient_account_id.eq.' + a.id);
  if (a.employeeCode) filters.push('recipient_employee_code.eq.' + a.employeeCode);
  const result = await db.from(TABLE).select('*').or(filters.join(',')).order('created_at', { ascending: false }).limit(Math.min(100, Math.max(1, Number(limit) || 50)));
  throwDb(result.error);
  const rows = (result.data || []).map(publicNotification);
  return { notifications: rows, unreadCount: rows.filter(row => !row.readAt).length };
}

function scopeQueryToActor(query, a) {
  if (a.id && a.employeeCode) return query.or('recipient_account_id.eq.' + a.id + ',recipient_employee_code.eq.' + a.employeeCode);
  if (a.id) return query.eq('recipient_account_id', a.id);
  return query.eq('recipient_employee_code', a.employeeCode);
}

async function markTaskNotificationRead(session, input = {}) {
  ensureDb();
  const a = actor(session);
  if (!a.id && !a.employeeCode) fail('Tài khoản chưa liên kết định danh PHF Task.', 409, 'TASK_NOTIFICATION_IDENTITY_NOT_LINKED');
  const ids = [...new Set((Array.isArray(input.ids) ? input.ids : [input.id]).map(text).filter(Boolean))].slice(0, 100);
  if (!ids.length) fail('Chưa chọn thông báo cần đánh dấu.', 400, 'TASK_NOTIFICATION_ID_REQUIRED');
  let query = db.from(TABLE).update({ read_at: new Date().toISOString() }).in('id', ids);
  query = scopeQueryToActor(query, a);
  const result = await query;
  throwDb(result.error);
  return { marked: ids.length };
}

async function markAllTaskNotificationsRead(session) {
  ensureDb();
  const a = actor(session);
  if (!a.id && !a.employeeCode) fail('Tài khoản chưa liên kết định danh PHF Task.', 409, 'TASK_NOTIFICATION_IDENTITY_NOT_LINKED');
  let query = db.from(TABLE).update({ read_at: new Date().toISOString() }).is('read_at', null);
  query = scopeQueryToActor(query, a);
  const result = await query;
  throwDb(result.error);
  return { marked: true };
}

module.exports = {
  emitTaskNotification,
  emitTaskNotificationSafe,
  listMyTaskNotifications,
  markTaskNotificationRead,
  markAllTaskNotificationsRead,
  isMissingSchema,
  // exported for tests only
  publicNotification, EVENT_CODES
};
