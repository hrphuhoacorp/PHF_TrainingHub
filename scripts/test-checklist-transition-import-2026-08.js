'use strict';
/*
 * PHF Checklist — T08/2026 Transition Import (2026-08-19).
 * Regression cho lib/checklist-monthly-results.js (LT/NQ guard, DUPLICATE/
 * CONFLICT_SYSTEM_LIVE) + lib/checklist-monthly-results-service.js
 * (previewTransitionImport/confirmTransitionImport, mock Supabase - KHÔNG
 * kết nối Production, KHÔNG ghi thật).
 *
 * Chạy thủ công: node scripts/test-checklist-transition-import-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');
const LIB_PATHS = ['../api/_lib/checklist-monthly-results', '../api/_lib/checklist-monthly-results-service'].map(p => require.resolve(p));

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
const insertedRows = [];
function makeTableFactory(tableName, rows) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null, insertPayload = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      order(field, opts) { orderSpecs.push({ field, asc: !(opts && opts.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      insert(payload) { insertPayload = Array.isArray(payload) ? payload : [payload]; return q; },
      then(resolve, reject) {
        try {
          if (insertPayload) {
            for (const row of insertPayload) {
              const dup = rows.some(r => r.employee_code === row.employee_code && r.period_month === row.period_month);
              if (dup) { resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }); return; }
            }
            insertPayload.forEach(row => { const saved = { id: 'row-' + (rows.length + 1), ...row }; rows.push(saved); insertedRows.push(saved); });
            resolve({ data: clone(insertPayload.map((row, i) => ({ id: 'row-inserted-' + i, employee_code: row.employee_code, period_month: row.period_month, result_state: row.result_state, score: row.score, source: row.source }))), error: null });
            return;
          }
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          orderSpecs.forEach(spec => { matched = matched.slice().sort((a, b) => { const av = a[spec.field], bv = b[spec.field]; return (av < bv ? -1 : av > bv ? 1 : 0) * (spec.asc ? 1 : -1); }); });
          if (limitN != null) matched = matched.slice(0, limitN);
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

const STATE = {
  employee_profiles: [
    { employee_code: 'PHF001', full_name: 'Nguyễn Văn A', employment_status: 'active', branch: 'Phú Lợi' },
    { employee_code: 'PHF002', full_name: 'Trần Thị B', employment_status: 'inactive', branch: 'Phú Lợi' },
    { employee_code: 'PHF030', full_name: 'Đỗ Văn Ba Mươi', employment_status: 'active', branch: 'Phú Lợi' },
    { employee_code: 'PHF010', full_name: 'Lê Văn Lái Thiêu', employment_status: 'active', branch: 'Lái Thiêu' },
    { employee_code: 'PHF020', full_name: 'Phạm Thị Ngô Quyền', employment_status: 'active', branch: 'Ngô Quyền' }
  ],
  checklist_monthly_results: [
    { id: 'r-transition', employee_code: 'PHF001', period_month: '2026-08', source: 'TRANSITION_IMPORT' },
    { id: 'r-live', employee_code: 'PHF010', period_month: '2026-08', source: 'SYSTEM_LIVE' }
  ]
};
function buildSupabaseMock() {
  return { createClient() { return { from(table) { if (!(table in STATE)) throw new Error('Unexpected table: ' + table); return makeTableFactory(table, STATE[table])(); } }; } };
}
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
LIB_PATHS.forEach(p => delete require.cache[p]);

const { classifyEmployeeEligibility, classifyRawScoreCell, buildPreviewRow, buildPreviewBatch, TRANSITION_LIVE_BRANCHES } = require('../api/_lib/checklist-monthly-results');
const {
  previewMonthlyResultImport, confirmMonthlyResultImport,
  previewTransitionImport, confirmTransitionImport, T08_TRANSITION_PERIOD_MONTH
} = require('../api/_lib/checklist-monthly-results-service');

function employeeIndexOf(rows) {
  const m = new Map();
  rows.forEach(r => m.set(r.employee_code, { employeeCode: r.employee_code, employeeName: r.full_name, employmentStatus: r.employment_status, branch: r.branch }));
  return m;
}
const EMP_INDEX = employeeIndexOf(STATE.employee_profiles);
const adminSession = { account: { id: 'admin-1', name: 'Admin' }, role: 'admin' };
const managerSession = { account: { id: 'mgr-1', name: 'Manager' }, role: 'manager' };

let passes = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { passes++; console.log('PASS: ' + msg); } }

async function main() {
  console.log('=== T08 Transition Import ===\n');
  const TR = { source: 'TRANSITION_IMPORT' };

  // ---- A/B/C. Branch-based classification ----
  check(TRANSITION_LIVE_BRANCHES.has('Lái Thiêu') && TRANSITION_LIVE_BRANCHES.has('Ngô Quyền'), 'sanity: TRANSITION_LIVE_BRANCHES chứa đúng 2 chi nhánh canonical');
  const rowPL = buildPreviewRow({ employeeCode: 'PHF001', periodMonth: '2026-08', rawValue: '85' }, EMP_INDEX, new Map(), TR);
  check(rowPL.status === 'READY', 'A: Phú Lợi active -> READY, thực tế=' + rowPL.status);
  const rowLT = buildPreviewRow({ employeeCode: 'PHF010', periodMonth: '2026-08', rawValue: '85' }, EMP_INDEX, new Map(), TR);
  check(rowLT.status === 'SKIP_LT_NQ_LIVE', 'B: Lái Thiêu active -> SKIP_LT_NQ_LIVE, thực tế=' + rowLT.status);
  const rowNQ = buildPreviewRow({ employeeCode: 'PHF020', periodMonth: '2026-08', rawValue: '85' }, EMP_INDEX, new Map(), TR);
  check(rowNQ.status === 'SKIP_LT_NQ_LIVE', 'C: Ngô Quyền active -> SKIP_LT_NQ_LIVE, thực tế=' + rowNQ.status);

  // ---- guard is source-specific: KHÔNG áp dụng cho BASELINE_IMPORT ----
  const rowLtBaseline = buildPreviewRow({ employeeCode: 'PHF010', periodMonth: '2026-08', rawValue: '85' }, EMP_INDEX, new Map(), { source: 'BASELINE_IMPORT' });
  check(rowLtBaseline.status === 'READY', 'guard chỉ áp dụng cho TRANSITION_IMPORT - Lái Thiêu vẫn READY khi source=BASELINE_IMPORT, thực tế=' + rowLtBaseline.status);

  // ---- D/E/F. eligibility (không đổi, tái dùng nguyên vẹn) ----
  check(classifyEmployeeEligibility('PHF002', EMP_INDEX).status === 'SKIP_INACTIVE', 'D: inactive -> SKIP_INACTIVE');
  check(classifyEmployeeEligibility('PHF999', EMP_INDEX).status === 'SKIP_NOT_CURRENT_EMPLOYEE', 'E: không tồn tại -> SKIP_NOT_CURRENT_EMPLOYEE');
  check(classifyEmployeeEligibility('', EMP_INDEX).status === 'MISSING_CODE', 'F: thiếu employeeCode -> MISSING_CODE');

  // ---- G/H/I/J/K. score/state (không đổi, tái dùng nguyên vẹn) ----
  check(classifyRawScoreCell('87.65').resultState === 'SCORED' && classifyRawScoreCell('87.65').score === 87.65, 'G: decimal hợp lệ -> SCORED');
  const zero = classifyRawScoreCell(0);
  check(zero.resultState === 'SCORED' && zero.score === 0, 'H: điểm 0 thật -> SCORED score=0 (không phải NO_DATA)');
  check(classifyRawScoreCell('không đánh giá').resultState === 'NO_ASSESSMENT', 'I: "không đánh giá" -> NO_ASSESSMENT');
  check(classifyRawScoreCell('thử việc').resultState === 'PROBATION', 'J: "thử việc" -> PROBATION');
  check(classifyRawScoreCell('').resultState === 'NO_DATA', 'K: blank -> NO_DATA');
  check(classifyRawScoreCell('150').validation === 'INVALID', 'L: >100 -> INVALID');

  // ---- M. same TRANSITION source -> DUPLICATE ----
  const rowDup = buildPreviewRow({ employeeCode: 'PHF001', periodMonth: '2026-08', rawValue: '90' }, EMP_INDEX, new Map([['PHF001|2026-08', { source: 'TRANSITION_IMPORT' }]]), TR);
  check(rowDup.status === 'DUPLICATE', 'M: existing TRANSITION_IMPORT + new TRANSITION_IMPORT -> DUPLICATE, thực tế=' + rowDup.status);

  // ---- baseline behavior unchanged: BASELINE existing + BASELINE new -> DUPLICATE (không truyền source = mặc định BASELINE_IMPORT) ----
  const rowDupBaseline = buildPreviewRow({ employeeCode: 'PHF001', periodMonth: '2026-03', rawValue: '90' }, EMP_INDEX, new Map([['PHF001|2026-03', { source: 'BASELINE_IMPORT' }]]));
  check(rowDupBaseline.status === 'DUPLICATE', 'không đổi hành vi baseline: existing BASELINE_IMPORT + không truyền source -> vẫn DUPLICATE, thực tế=' + rowDupBaseline.status);

  // ---- N. existing SYSTEM_LIVE + TRANSITION_IMPORT -> CONFLICT_SYSTEM_LIVE ----
  const rowConflictLive = buildPreviewRow({ employeeCode: 'PHF010', periodMonth: '2026-08', rawValue: '90' }, EMP_INDEX, new Map([['PHF010|2026-08', { source: 'SYSTEM_LIVE' }]]), TR);
  // PHF010 là Lái Thiêu nên LT/NQ guard sẽ chặn trước - dùng nhân sự Phú Lợi khác để test đúng nhánh CONFLICT_SYSTEM_LIVE độc lập với guard branch.
  check(rowConflictLive.status === 'SKIP_LT_NQ_LIVE', 'sanity: PHF010 (Lái Thiêu) bị LT/NQ guard chặn TRƯỚC khi tới bước check existing result');
  const rowConflictLive2 = buildPreviewRow({ employeeCode: 'PHF001', periodMonth: '2026-08', rawValue: '90' }, EMP_INDEX, new Map([['PHF001|2026-08', { source: 'SYSTEM_LIVE' }]]), TR);
  check(rowConflictLive2.status === 'CONFLICT_SYSTEM_LIVE', 'N: existing SYSTEM_LIVE (nhân sự Phú Lợi) + TRANSITION_IMPORT -> CONFLICT_SYSTEM_LIVE, thực tế=' + rowConflictLive2.status);

  // ---- legacy default (không truyền source) + existing SYSTEM_LIVE -> vẫn CONFLICT thường, KHÔNG phải CONFLICT_SYSTEM_LIVE (không đổi hành vi baseline) ----
  const rowLegacyConflict = buildPreviewRow({ employeeCode: 'PHF001', periodMonth: '2026-08', rawValue: '90' }, EMP_INDEX, new Map([['PHF001|2026-08', { source: 'SYSTEM_LIVE' }]]));
  check(rowLegacyConflict.status === 'CONFLICT', 'không đổi hành vi baseline: existing SYSTEM_LIVE + không truyền source -> vẫn CONFLICT (không phải CONFLICT_SYSTEM_LIVE), thực tế=' + rowLegacyConflict.status);

  // ---- O. other source clash (existing MANUAL_IMPORT + TRANSITION_IMPORT) -> CONFLICT ----
  const rowOtherConflict = buildPreviewRow({ employeeCode: 'PHF001', periodMonth: '2026-08', rawValue: '90' }, EMP_INDEX, new Map([['PHF001|2026-08', { source: 'MANUAL_IMPORT' }]]), TR);
  check(rowOtherConflict.status === 'CONFLICT', 'O: existing MANUAL_IMPORT + TRANSITION_IMPORT -> CONFLICT thường, thực tế=' + rowOtherConflict.status);

  // ---- batch-level counts include new statuses ----
  const batch = buildPreviewBatch([
    { employeeCode: 'PHF001', periodMonth: '2026-08', rawValue: '85' },
    { employeeCode: 'PHF010', periodMonth: '2026-08', rawValue: '85' },
    { employeeCode: 'PHF020', periodMonth: '2026-08', rawValue: '85' }
  ], EMP_INDEX, new Map(), TR);
  check(batch.counts.READY === 1 && batch.counts.SKIP_LT_NQ_LIVE === 2, 'buildPreviewBatch tổng hợp đúng counts (1 READY Phú Lợi, 2 SKIP_LT_NQ_LIVE)');

  // ==================================================================
  // Service layer (mock Supabase) — previewTransitionImport/confirmTransitionImport
  // ==================================================================
  check(T08_TRANSITION_PERIOD_MONTH === '2026-08', 'sanity: hằng số kỳ T08 đúng 2026-08');

  // ---- X. non-Admin denied before data access ----
  let unauthorized = null;
  try { await previewTransitionImport(managerSession, { rows: [{ employeeCode: 'PHF001', rawValue: '85' }] }); } catch (e) { unauthorized = e; }
  check(unauthorized && unauthorized.code === 'CHECKLIST_MONTHLY_RESULT_ADMIN_REQUIRED', 'X: manager (non-admin) bị chặn ensureAdmin trước khi chạm DB');

  // ---- W. authenticated Admin route works; Q. preview is read-only ----
  // Dùng PHF030 (Phú Lợi, chưa có result nào cho 2026-08) cho các test service-level
  // dưới đây - PHF001 đã có sẵn TRANSITION_IMPORT trong STATE seed (dùng cho test M ở trên).
  const preview1 = await previewTransitionImport(adminSession, { rows: [{ employeeCode: 'PHF030', rawValue: '85' }] });
  check(preview1.rows[0].status === 'READY', 'W: Admin gọi previewTransitionImport thành công, READY');
  check(insertedRows.length === 0, 'Q: preview KHÔNG ghi bất kỳ dòng nào vào DB (insertedRows vẫn rỗng)');

  // ---- 10. periodMonth server-controlled: file gửi kỳ khác vẫn bị ép về 2026-08 ----
  const previewForcedMonth = await previewTransitionImport(adminSession, { rows: [{ employeeCode: 'PHF030', periodMonth: '2099-01', rawValue: '85' }] });
  check(previewForcedMonth.rows[0].periodMonth === '2026-08', 'periodMonth trong file bị bỏ qua/ép về 2026-08 (server/context controlled), thực tế=' + previewForcedMonth.rows[0].periodMonth);

  // ---- LT/NQ excluded qua đúng service preview thật (không chỉ hàm thuần JS) ----
  const previewLtNq = await previewTransitionImport(adminSession, { rows: [{ employeeCode: 'PHF010', rawValue: '85' }, { employeeCode: 'PHF020', rawValue: '85' }] });
  check(previewLtNq.rows.every(r => r.status === 'SKIP_LT_NQ_LIVE'), 'LT/NQ bị loại đúng qua previewTransitionImport() thật (không chỉ unit test hàm thuần JS)');
  check(previewLtNq.counts.SKIP_LT_NQ_LIVE === 2, 'summary counts phản ánh đúng SKIP_LT_NQ_LIVE=2');

  // ---- P. source cannot be spoofed by client (preview + confirm) ----
  const previewSpoof = await previewTransitionImport(adminSession, { rows: [{ employeeCode: 'PHF030', rawValue: '85' }], source: 'SYSTEM_LIVE' });
  check(previewSpoof.rows[0].status === 'READY', 'P: client cố truyền source:"SYSTEM_LIVE" vào previewTransitionImport bị bỏ qua hoàn toàn - vẫn phân loại đúng theo TRANSITION_IMPORT (PHF030 vốn không có conflict) READY');

  // ---- Y. no write before explicit confirm; R. confirm revalidates ----
  const confirmed1 = await confirmTransitionImport(adminSession, { rows: [{ employeeCode: 'PHF030', rawValue: '85' }] });
  check(confirmed1.source === 'TRANSITION_IMPORT', 'P: confirmTransitionImport luôn ghi source=TRANSITION_IMPORT');
  check(confirmed1.rows[0].period_month === '2026-08', 'confirmed row đúng period_month=2026-08 (server controlled)');
  check(insertedRows.length === 1 && insertedRows[0].source === 'TRANSITION_IMPORT', 'Y: chỉ ghi DB SAU confirm tường minh (đúng 1 dòng, đúng source)');

  // ---- R. confirm revalidates: gọi lại confirm với CÙNG dòng vừa ghi (giả lập preview cũ/stale) -> phải bị chặn, không ghi trùng ----
  let staleError = null;
  try { await confirmTransitionImport(adminSession, { rows: [{ employeeCode: 'PHF030', rawValue: '85' }] }); } catch (e) { staleError = e; }
  check(staleError && staleError.code === 'CHECKLIST_MONTHLY_RESULT_REVALIDATION_FAILED', 'R: confirm tự revalidate lại từ dữ liệu THẬT - phát hiện PHF030|2026-08 đã ghi (DUPLICATE), từ chối ghi lại');
  check(insertedRows.length === 1, 'sau lần confirm bị từ chối, vẫn chỉ có đúng 1 dòng đã ghi trước đó (không ghi thêm)');

  // ---- S. no partial write on revalidation failure: batch trộn 1 READY (Phú Lợi mới) + 1 SKIP_LT_NQ_LIVE (Lái Thiêu) -> reject TOÀN BỘ, không ghi phần READY ----
  const insertedBefore = insertedRows.length;
  let mixedError = null;
  try {
    await confirmTransitionImport(adminSession, { rows: [
      { employeeCode: 'PHF020', rawValue: '92' }, // Ngô Quyền -> sẽ bị SKIP_LT_NQ_LIVE ở bước revalidate
      { employeeCode: 'PHF002', rawValue: '77' }  // inactive -> SKIP_INACTIVE
    ] });
  } catch (e) { mixedError = e; }
  check(mixedError && mixedError.code === 'CHECKLIST_MONTHLY_RESULT_REVALIDATION_FAILED', 'S: batch có dòng không READY (LT/NQ + inactive) -> confirm reject TOÀN BỘ, không best-effort một phần');
  check(insertedRows.length === insertedBefore, 'S: không có dòng nào bị ghi một phần khi revalidation thất bại (all-or-nothing)');

  console.log('\n' + passes + ' assertions passed.');
}

main().catch(err => { console.error('[FAIL]', err && err.stack || err); process.exitCode = 1; });
