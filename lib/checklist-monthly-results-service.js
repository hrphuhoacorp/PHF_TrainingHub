'use strict';
/*
 * PHF Checklist — Monthly Result Baseline (Phase 2, 2026-08-18) — Supabase
 * boundary. Lớp mỏng bọc quanh bảng checklist_monthly_results (scripts/
 * PHF_CHECKLIST_MONTHLY_RESULTS_1.56.0.sql, CHƯA CHẠY) + employee_profiles
 * (BUSINESS DECISION: nguồn eligibility duy nhất cho baseline, KHÔNG phải
 * checklist_employee_assignments). Logic phân loại/validate 100% nằm ở
 * lib/checklist-monthly-results.js (thuần JS, không DB) - file này CHỈ fetch
 * dữ liệu thật rồi gọi lại logic đó, đúng nguyên tắc phân lớp đã dùng cho
 * lib/checklist-template-retroactive-service.js.
 *
 * Admin-only cho MỌI hàm. Không có route/UI nào gọi các hàm này trong batch
 * này (xem báo cáo — Admin UI DEFERRED).
 */
require('dotenv').config();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { buildPreviewBatch, buildConfirmRows } = require('./checklist-monthly-results');

const hasEnv = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const db = hasEnv ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } }) : null;

function t(v) { return String(v == null ? '' : v).trim(); }
function fail(message, code, statusCode) { const e = new Error(message); e.statusCode = statusCode || 400; e.code = code; throw e; }
function ensureAdmin(session) { if (!session || session.role !== 'admin') fail('Chỉ Admin được vận hành nhập lịch sử điểm Checklist theo tháng.', 'CHECKLIST_MONTHLY_RESULT_ADMIN_REQUIRED', 403); }
function requireDb() { if (!db) fail('Supabase chưa được cấu hình.', 'SUPABASE_NOT_CONFIGURED', 503); }
function actorOf(session) { return { id: t(session.account?.id || session.sub), name: t(session.account?.name || session.email) }; }

/* loadActiveEmployeeIndex — BUSINESS DECISION Phase 2: employee_profiles là
 * nguồn eligibility DUY NHẤT (KHÔNG phải checklist_employee_assignments,
 * khác với listMonthly() hiện có trong lib/checklist-monthly.js — CỐ Ý
 * không tái dùng nguồn đó, xem báo cáo Phase 1/2). Chỉ đọc, KHÔNG ghi. */
async function loadActiveEmployeeIndex() {
  const { data, error } = await db.from('employee_profiles')
    .select('employee_code,full_name,employment_status')
    .order('full_name', { ascending: true }).limit(5000);
  if (error) throw error;
  const index = new Map();
  (data || []).forEach(row => {
    const code = t(row.employee_code).toUpperCase();
    if (!code) return;
    index.set(code, { employeeCode: code, employeeName: t(row.full_name), employmentStatus: t(row.employment_status) });
  });
  return index;
}

/* loadExistingResultIndex — chỉ đọc các period_month THẬT SỰ xuất hiện
 * trong batch đang preview/confirm (không tải toàn bảng, tránh full-scan
 * không cần thiết khi bảng lớn dần theo thời gian). */
async function loadExistingResultIndex(periodMonths) {
  const months = [...new Set((periodMonths || []).map(t).filter(Boolean))];
  const index = new Map();
  if (!months.length) return index;
  const { data, error } = await db.from('checklist_monthly_results')
    .select('employee_code,period_month,source').in('period_month', months);
  if (error) throw error;
  (data || []).forEach(row => index.set(t(row.employee_code).toUpperCase() + '|' + t(row.period_month), { source: t(row.source) }));
  return index;
}

/*
 * previewMonthlyResultImport(session, {rows}) — rows: [{employeeCode,
 * employeeName, periodMonth, rawValue}, ...] ĐÃ được parse sẵn từ Excel bởi
 * caller (parsing file .xlsx thật KHÔNG thuộc phạm vi batch này). Trả về
 * preview đầy đủ + batchId để dùng lại ở bước confirm (chỉ mang tính liên
 * kết audit - KHÔNG phải cơ chế bảo mật; confirm luôn tự revalidate lại từ
 * đầu, xem confirmMonthlyResultImport()).
 */
async function previewMonthlyResultImport(session, input = {}) {
  ensureAdmin(session); requireDb();
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) fail('Thiếu dữ liệu để xem trước.', 'CHECKLIST_MONTHLY_RESULT_INPUT_REQUIRED');
  if (rows.length > 2000) fail('Chỉ xem trước tối đa 2000 dòng mỗi lượt.', 'CHECKLIST_MONTHLY_RESULT_TOO_MANY');
  const [employeeIndex, existingIndex] = await Promise.all([
    loadActiveEmployeeIndex(),
    loadExistingResultIndex(rows.map(r => r && r.periodMonth))
  ]);
  const preview = buildPreviewBatch(rows, employeeIndex, existingIndex);
  return { batchId: crypto.randomUUID(), ...preview };
}

/*
 * confirmMonthlyResultImport(session, {rows, source, batchId}) — PRIMITIVE
 * dùng chung cho cả 4 loại source. KHÔNG gọi trực tiếp cho nhiệm vụ T01-07
 * baseline - dùng confirmBaselineImport() bên dưới (source bị khoá cứng).
 * REVALIDATE TOÀN BỘ: tự build lại preview từ dữ liệu THẬT hiện tại (không
 * tin preview đã tính ở lần gọi trước, phòng race condition/dữ liệu đã đổi
 * giữa preview và confirm) - CHỈ ghi nếu revalidate ra đúng 100% READY.
 */
async function confirmMonthlyResultImport(session, input = {}) {
  ensureAdmin(session); requireDb();
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) fail('Thiếu dữ liệu để xác nhận nhập.', 'CHECKLIST_MONTHLY_RESULT_INPUT_REQUIRED');
  const source = t(input.source);
  const batchId = t(input.batchId) || crypto.randomUUID();
  const actor = actorOf(session);

  const [employeeIndex, existingIndex] = await Promise.all([
    loadActiveEmployeeIndex(),
    loadExistingResultIndex(rows.map(r => r && r.periodMonth))
  ]);
  const revalidated = buildPreviewBatch(rows, employeeIndex, existingIndex);
  const notReady = revalidated.rows.filter(r => r.status !== 'READY');
  if (notReady.length) {
    fail(
      'Dữ liệu đã thay đổi hoặc chưa hợp lệ kể từ lần xem trước - ' + notReady.length + ' dòng không còn ở trạng thái READY. Vui lòng xem trước lại trước khi xác nhận.',
      'CHECKLIST_MONTHLY_RESULT_REVALIDATION_FAILED', 409
    );
  }
  const insertRows = buildConfirmRows(revalidated.rows, { source, batchId, actorId: actor.id, actorName: actor.name });

  const { data, error } = await db.from('checklist_monthly_results').insert(insertRows).select('id,employee_code,period_month,result_state,score,source');
  if (error) {
    if (String(error.code) === '23505') fail('Một hoặc nhiều dòng đã có kết quả authoritative cho đúng nhân sự/tháng đó (trùng ngay lúc ghi) - không ghi đè.', 'CHECKLIST_MONTHLY_RESULT_CONFLICT', 409);
    throw error;
  }
  return { batchId, source, inserted: (data || []).length, rows: data || [] };
}

/*
 * confirmBaselineImport(session, {rows, batchId}) — entrypoint DUY NHẤT
 * cho nhiệm vụ T01-07: source LUÔN LÀ 'BASELINE_IMPORT', bất kể input có
 * chứa trường source gì hay không - client KHÔNG THỂ spoof SYSTEM_LIVE/
 * MANUAL_IMPORT/TRANSITION_IMPORT qua đường này dù cố tình gửi kèm.
 */
async function confirmBaselineImport(session, input = {}) {
  return confirmMonthlyResultImport(session, { ...input, source: 'BASELINE_IMPORT' });
}

module.exports = {
  previewMonthlyResultImport,
  confirmMonthlyResultImport,
  confirmBaselineImport,
  loadActiveEmployeeIndex,
  loadExistingResultIndex
};
