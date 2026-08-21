'use strict';

/*
 * KNL Notification (Phase N1) — thông báo nội bộ RIÊNG của module KNL, hiện
 * chỉ phục vụ workflow "Đề xuất nâng bậc" (lib/knl-grade-proposals.js).
 *
 * KHÓA SCOPE (đã chốt trong batch): KHÔNG dùng chung bảng
 * checklist_notifications, KHÔNG tích hợp notification global/PHF Hub,
 * KHÔNG hiện ở Checklist. Bảng knl_notifications là bảng RIÊNG của KNL — xem
 * scripts/PHF_KNL_NOTIFICATIONS_1.64.0.sql. File này có thể THAM KHẢO pattern
 * kỹ thuật của lib/checklist-notifications.js (emit/dedupe/read-unread/safe
 * failure) nhưng KHÔNG import/gọi bất kỳ hàm nào của file đó — domain hoàn
 * toàn độc lập.
 *
 * "Notification follows permission + workflow scope" (business rule đã
 * chốt): file này KHÔNG tự quyết định AI được nhận thông báo — luôn nhận
 * recipients đã được lib/knl-grade-proposals.js resolve xong (dựa trên
 * resolveApprovalChain()/grantsByCode sống, đúng actor cần xử lý hoặc đúng
 * final approver có capabilities.approve). File này chỉ lo emit/list/
 * mark-read/dedupe — KHÔNG tự mở rộng recipient, KHÔNG tự suy diễn quyền.
 *
 * Payload KHÔNG BAO GIỜ được caller truyền field tiền lương (base_salary/
 * hqcv/allowance/income) — Phase N1 chủ động không đưa income vào bất kỳ
 * notification nào để tránh leakage (đúng chỉ đạo).
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const db = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const TABLE = 'knl_notifications';
const MIGRATION = 'scripts/PHF_KNL_NOTIFICATIONS_1.64.0.sql';
const EVENT_CODES = new Set(['GRADE_PROPOSAL_ACTION_REQUIRED', 'GRADE_PROPOSAL_APPROVED', 'GRADE_PROPOSAL_REJECTED', 'GRADE_PROPOSAL_WITHDRAWN', 'GRADE_PROPOSAL_REASSIGNED']);
const PRIORITIES = new Set(['Trung bình', 'Cao', 'Khẩn']);

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function fail(message, statusCode = 400, errorCode = 'KNL_NOTIFICATION_INVALID') { const error = new Error(message); error.statusCode = statusCode; error.code = errorCode; throw error; }
function ensureDb() { if (!db) fail('Supabase chưa được cấu hình cho Thông báo KNL.', 503, 'SUPABASE_NOT_CONFIGURED'); }
function throwDb(error) {
  if (!error) return;
  const errCode = text(error.code), message = text(error.message);
  if (errCode === 'PGRST205' || errCode === '42P01' || /Could not find the table|relation .* does not exist|schema cache/i.test(message)) {
    fail('Schema Thông báo KNL chưa được cài đặt. Hãy chạy ' + MIGRATION + '.', 503, 'KNL_NOTIFICATION_SCHEMA_MISSING');
  }
  throw error;
}
/* actor() — CÙNG identity fix đã áp dụng ở lib/knl-grade-proposals.js:actor()
 * (employeeCode PHẢI đọc từ session.employeeCode/session.account.employeeCode
 * — KHÔNG session.employeeId, khác hệ mã). Recipient list khi list/markRead
 * PHẢI resolve từ actor hiện tại (session), KHÔNG cho client truyền
 * employee_code tuỳ ý (đúng yêu cầu security). */
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
    proposalId: row.proposal_id || '',
    title: row.title || '',
    message: row.message || '',
    priority: row.priority || 'Trung bình',
    targetPath: row.target_path || '',
    createdAt: row.created_at || '',
    readAt: row.read_at || '',
    status: row.read_at ? 'read' : 'new'
  };
}

/* emitKnlNotification — GHI thẳng (không có bảng "rule" bật/tắt như
 * Checklist — Phase N1 không làm rule editor). recipients: [{accountId?,
 * employeeCode?}]. Trùng identity TRONG CÙNG 1 lượt gọi (vd creator===subject)
 * tự dedupe còn 1 dòng duy nhất ngay tại đây — caller không cần tự lọc.
 * Trùng identity GIỮA CÁC lượt gọi (retry/double emit) dedupe bằng
 * dedupe_key (unique index) + upsert ignoreDuplicates — không throw, không
 * tạo dòng thứ 2. */
async function emitKnlNotification(eventCode, input = {}) {
  ensureDb();
  eventCode = code(eventCode);
  if (!EVENT_CODES.has(eventCode)) return { created: 0, skipped: 'event' };
  const proposalId = text(input.proposalId || input.proposal_id);
  const message = text(input.message);
  if (!message) return { created: 0, skipped: 'message' };
  const recipients = Array.isArray(input.recipients) ? input.recipients : (input.recipient ? [input.recipient] : []);
  const priority = PRIORITIES.has(text(input.priority)) ? text(input.priority) : 'Trung bình';
  const targetPath = text(input.targetPath || input.target_path) || null;
  const title = text(input.title) || eventCode;
  const dedupeBase = text(input.dedupeKey || input.dedupe_key) || (eventCode + '|' + proposalId);
  const now = new Date().toISOString();

  const rows = [];
  const seenIdentity = new Set();
  for (const recipient of recipients || []) {
    const accountId = text(recipient && (recipient.accountId || recipient.account_id));
    const employeeCode = code(recipient && (recipient.employeeCode || recipient.employee_code));
    if (!accountId && !employeeCode) continue;
    const identityKey = employeeCode || accountId; // ưu tiên employee_code làm khoá canonical (đúng yêu cầu "không dùng display name làm khóa")
    if (seenIdentity.has(identityKey)) continue;
    seenIdentity.add(identityKey);
    rows.push({
      recipient_account_id: accountId || null,
      recipient_employee_code: employeeCode || null,
      event_code: eventCode,
      proposal_id: proposalId || null,
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

/* emitKnlNotificationSafe — bắt buộc dùng ở call site trong
 * lib/knl-grade-proposals.js (notification là side-effect SAU transition
 * thành công): lỗi emit (schema chưa cài, mất kết nối, v.v.) KHÔNG BAO GIỜ
 * được văng lên làm hỏng response proposal đã transition thành công —
 * chỉ log, không rollback, không đổi response. */
async function emitKnlNotificationSafe(eventCode, input) {
  try { return await emitKnlNotification(eventCode, input); }
  catch (error) { console.warn('[KNL Notification] emit thất bại (bỏ qua, không ảnh hưởng proposal):', error && error.message ? error.message : error); return { created: 0, error: true }; }
}

/* listMyKnlNotifications — recipient LUÔN resolve từ session hiện tại
 * (actor()), KHÔNG nhận employee_code/account_id từ client — chặn đọc
 * notification của người khác (yêu cầu security bắt buộc). */
async function listMyKnlNotifications(session, { limit = 50 } = {}) {
  ensureDb();
  const a = actor(session);
  if (!a.id && !a.employeeCode) fail('Tài khoản chưa liên kết định danh KNL.', 409, 'KNL_NOTIFICATION_IDENTITY_NOT_LINKED');
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

async function markKnlNotificationRead(session, input = {}) {
  ensureDb();
  const a = actor(session);
  if (!a.id && !a.employeeCode) fail('Tài khoản chưa liên kết định danh KNL.', 409, 'KNL_NOTIFICATION_IDENTITY_NOT_LINKED');
  const ids = [...new Set((Array.isArray(input.ids) ? input.ids : [input.id]).map(text).filter(Boolean))].slice(0, 100);
  if (!ids.length) fail('Chưa chọn thông báo cần đánh dấu.', 400, 'KNL_NOTIFICATION_ID_REQUIRED');
  let query = db.from(TABLE).update({ read_at: new Date().toISOString() }).in('id', ids);
  query = scopeQueryToActor(query, a); // scope theo actor -> không đánh dấu được thông báo của người khác dù biết id
  const result = await query;
  throwDb(result.error);
  return { marked: ids.length };
}

async function markAllKnlNotificationsRead(session) {
  ensureDb();
  const a = actor(session);
  if (!a.id && !a.employeeCode) fail('Tài khoản chưa liên kết định danh KNL.', 409, 'KNL_NOTIFICATION_IDENTITY_NOT_LINKED');
  let query = db.from(TABLE).update({ read_at: new Date().toISOString() }).is('read_at', null);
  query = scopeQueryToActor(query, a);
  const result = await query;
  throwDb(result.error);
  return { marked: true };
}

module.exports = {
  emitKnlNotification,
  emitKnlNotificationSafe,
  listMyKnlNotifications,
  markKnlNotificationRead,
  markAllKnlNotificationsRead,
  // exported for tests only
  publicNotification, EVENT_CODES
};
