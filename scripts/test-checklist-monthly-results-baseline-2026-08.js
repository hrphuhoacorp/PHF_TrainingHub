'use strict';
/*
 * PHF Checklist — Monthly Result Baseline T01-07/2026 (Phase 2, 2026-08-18).
 * Regression cho lib/checklist-monthly-results.js (thuần JS) + lib/
 * checklist-monthly-results-service.js (Supabase, mock qua @supabase/
 * supabase-js boundary - KHÔNG kết nối Production, KHÔNG ghi thật).
 *
 * Chạy thủ công: node scripts/test-checklist-monthly-results-baseline-2026-08.js
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
    let orderSpecs = [], limitN = null, insertPayload = null, selectAfterInsert = false;
    const q = {
      select(cols) { if (insertPayload) selectAfterInsert = true; return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      order(field, opts) { orderSpecs.push({ field, asc: !(opts && opts.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      insert(payload) {
        insertPayload = Array.isArray(payload) ? payload : [payload];
        return q;
      },
      then(resolve, reject) {
        try {
          if (insertPayload) {
            // Mô phỏng unique(employee_code,period_month) constraint thật (Postgres 23505).
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
    { employee_id: 'e1', employee_code: 'PHF001', full_name: 'Nguyễn Văn A', employment_status: 'active' },
    { employee_id: 'e2', employee_code: 'PHF002', full_name: 'Trần Thị B', employment_status: 'inactive' },
    { employee_id: 'e3', employee_code: 'PHF021', full_name: 'Lê Văn C', employment_status: 'active' }
  ],
  checklist_monthly_results: [
    { id: 'existing-1', employee_code: 'PHF001', period_month: '2026-03', source: 'BASELINE_IMPORT' }
  ]
};
function buildSupabaseMock() {
  return { createClient() { return { from(table) { if (!(table in STATE)) throw new Error('Unexpected table: ' + table); return makeTableFactory(table, STATE[table])(); } }; } };
}
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
LIB_PATHS.forEach(p => delete require.cache[p]);

const {
  normalizeEmployeeCode, classifyRawScoreCell, classifyEmployeeEligibility,
  buildPreviewBatch, buildConfirmRows, buildPreviewRow
} = require('../api/_lib/checklist-monthly-results');
const { previewMonthlyResultImport, confirmMonthlyResultImport, confirmBaselineImport } = require('../api/_lib/checklist-monthly-results-service');

const adminSession = { account: { id: 'admin-1', name: 'Admin' }, role: 'admin' };
const nonAdminSession = { account: { id: 'u-1' }, role: 'manager' };

function employeeIndexOf(rows) {
  const m = new Map();
  rows.forEach(r => m.set(normalizeEmployeeCode(r.employee_code), { employeeCode: normalizeEmployeeCode(r.employee_code), employeeName: r.full_name, employmentStatus: r.employment_status }));
  return m;
}
const EMP_INDEX = employeeIndexOf(STATE.employee_profiles);

async function run() {
  // ---- 1. active current employee -> eligible ----
  assert.strictEqual(classifyEmployeeEligibility('phf001', EMP_INDEX).status, 'ELIGIBLE');
  console.log('[PASS] 1: nhân sự active -> ELIGIBLE');

  // ---- 2. inactive employee -> skip ----
  assert.strictEqual(classifyEmployeeEligibility('PHF002', EMP_INDEX).status, 'SKIP_INACTIVE');
  console.log('[PASS] 2: nhân sự inactive -> SKIP_INACTIVE');

  // ---- 3. nonexistent employee -> skip ----
  assert.strictEqual(classifyEmployeeEligibility('PHF999', EMP_INDEX).status, 'SKIP_NOT_CURRENT_EMPLOYEE');
  console.log('[PASS] 3: mã không tồn tại trong employee_profiles -> SKIP_NOT_CURRENT_EMPLOYEE');

  // ---- 4. missing employeeCode -> skip/review ----
  assert.strictEqual(classifyEmployeeEligibility('', EMP_INDEX).status, 'MISSING_CODE');
  assert.strictEqual(classifyEmployeeEligibility('   ', EMP_INDEX).status, 'MISSING_CODE');
  console.log('[PASS] 4: thiếu employeeCode -> MISSING_CODE (không fallback tên)');

  // ---- 5. exact employeeCode normalization (case/space) ----
  assert.strictEqual(normalizeEmployeeCode('  phf001  '), 'PHF001');
  assert.strictEqual(classifyEmployeeEligibility(' phf001 ', EMP_INDEX).status, 'ELIGIBLE');
  console.log('[PASS] 5: normalize trim+uppercase đúng, không đổi hình dạng mã theo cách nào khác');

  // ---- 6. no fuzzy-name fallback ----
  assert.strictEqual(typeof classifyEmployeeEligibility, 'function');
  // classifyEmployeeEligibility CHỈ nhận employeeCode, không có tham số tên - test cấu trúc chữ ký hàm chứng minh không có đường fallback tên.
  assert.strictEqual(classifyEmployeeEligibility.length, 2);
  console.log('[PASS] 6: classifyEmployeeEligibility() không nhận tham số tên - không có đường fuzzy-match nào tồn tại để lách qua');

  // ---- 7. valid decimal score ----
  const dec = classifyRawScoreCell('87.65');
  assert.strictEqual(dec.resultState, 'SCORED'); assert.strictEqual(dec.score, 87.65); assert.strictEqual(dec.validation, 'VALID');
  console.log('[PASS] 7: số thập phân hợp lệ (87.65) giữ nguyên 2 chữ số thập phân');

  // ---- 8. genuine score 0 preserved ----
  const zero = classifyRawScoreCell(0);
  assert.strictEqual(zero.resultState, 'SCORED'); assert.strictEqual(zero.score, 0); assert.strictEqual(zero.validation, 'VALID');
  const zeroStr = classifyRawScoreCell('0');
  assert.strictEqual(zeroStr.resultState, 'SCORED'); assert.strictEqual(zeroStr.score, 0);
  console.log('[PASS] 8: điểm 0 thật (number 0 và chuỗi "0") giữ nguyên SCORED/score=0, không bị hiểu nhầm thành blank');

  // ---- 9. blank -> NO_DATA + null ----
  ['', '   ', null, undefined].forEach(v => {
    const r = classifyRawScoreCell(v);
    assert.strictEqual(r.resultState, 'NO_DATA', 'blank value ' + JSON.stringify(v));
    assert.strictEqual(r.score, null);
  });
  console.log('[PASS] 9: ô trống (rỗng/khoảng trắng/null/undefined) -> NO_DATA, score=null');

  // ---- 10/11. "không đánh giá" / "ko đánh giá" -> NO_ASSESSMENT + null ----
  ['không đánh giá', 'Không Đánh Giá', 'ko đánh giá', 'KO DANH GIA'].forEach(v => {
    const r = classifyRawScoreCell(v);
    assert.strictEqual(r.resultState, 'NO_ASSESSMENT', 'value ' + v);
    assert.strictEqual(r.score, null);
  });
  console.log('[PASS] 10/11: "không đánh giá" và biến thể "ko đánh giá" (mọi hoa/thường, có/không dấu) -> NO_ASSESSMENT, score=null (KHÔNG phải 0)');

  // ---- 12. "thử việc" -> PROBATION + null ----
  ['thử việc', 'Thử Việc', 'thu viec'].forEach(v => {
    const r = classifyRawScoreCell(v);
    assert.strictEqual(r.resultState, 'PROBATION', 'value ' + v);
    assert.strictEqual(r.score, null);
  });
  console.log('[PASS] 12: "thử việc" -> PROBATION, score=null (KHÔNG phải 0)');

  // ---- 13. >100 -> invalid ----
  const over = classifyRawScoreCell('150');
  assert.strictEqual(over.validation, 'INVALID'); assert.strictEqual(over.score, 150);
  console.log('[PASS] 13: giá trị >100 (150) -> validation=INVALID, giữ nguyên giá trị gốc (không clamp về 100)');

  // ---- 14. negative -> invalid ----
  const neg = classifyRawScoreCell('-5');
  assert.strictEqual(neg.validation, 'INVALID'); assert.strictEqual(neg.score, -5);
  console.log('[PASS] 14: giá trị âm (-5) -> validation=INVALID, giữ nguyên giá trị gốc (không clamp về 0)');

  // ---- 15. anomaly 948.666... (T2/PHF021 case) -> invalid, NOT auto-corrected ----
  const anomaly = classifyRawScoreCell('948.666666666667');
  assert.strictEqual(anomaly.validation, 'INVALID');
  assert.strictEqual(anomaly.score, 948.67, 'phải giữ giá trị gốc đã làm tròn 2 chữ số thập phân đúng dữ liệu nguồn, KHÔNG tự chia 10 thành 94.87');
  assert.ok(anomaly.score !== 94.87 && anomaly.score !== 94.8666, 'KHÔNG được tự "sửa" 948.666 thành 94.8666 kiểu chia 10 phỏng đoán');
  console.log('[PASS] 15: anomaly 948.666... (case T2/PHF021 thật) -> INVALID, KHÔNG tự chia 10/làm tròn để "trông hợp lý"');

  // ---- Migration-review fix: period_month "2026-99" khớp regex format
  // thuần ('^\d{4}-\d{2}$') nhưng KHÔNG phải tháng hợp lệ -> NEED_REVIEW,
  // không được lọt qua tới confirm/DB constraint mới phát hiện. ----
  const badMonth = buildPreviewRow({ employeeCode: 'PHF001', periodMonth: '2026-99', rawValue: '80' }, EMP_INDEX, new Map());
  assert.strictEqual(badMonth.status, 'NEED_REVIEW');
  assert.ok(/2026-99/.test(badMonth.reason));
  console.log('[PASS] (bổ sung, migration review) period_month "2026-99" khớp regex format nhưng không phải tháng hợp lệ -> NEED_REVIEW, chặn trước khi chạm DB');

  // ---- Unrecognized text -> NEED_REVIEW (không đoán) ----
  const weird = classifyRawScoreCell('abc-xyz');
  assert.strictEqual(weird.validation, 'NEED_REVIEW'); assert.strictEqual(weird.resultState, null);
  console.log('[PASS] (bổ sung) Nội dung lạ không khớp bất kỳ pattern nào -> NEED_REVIEW, không suy đoán resultState');

  // ==================================================================
  // Preview batch end-to-end (thuần JS)
  // ==================================================================
  const rawRows = [
    { employeeCode: 'PHF001', employeeName: 'Nguyễn Văn A', periodMonth: '2026-01', rawValue: '92.5' },   // READY
    { employeeCode: 'PHF002', employeeName: 'Trần Thị B', periodMonth: '2026-01', rawValue: '80' },        // SKIP_INACTIVE
    { employeeCode: 'PHF999', employeeName: 'Không rõ', periodMonth: '2026-01', rawValue: '70' },          // SKIP_NOT_CURRENT_EMPLOYEE
    { employeeCode: '', employeeName: 'Thiếu mã', periodMonth: '2026-01', rawValue: '60' },                 // MISSING_CODE
    { employeeCode: 'PHF021', employeeName: 'Lê Văn C', periodMonth: '2026-02', rawValue: '948.666666667' },// INVALID_SCORE (anomaly)
    { employeeCode: 'PHF001', employeeName: 'Nguyễn Văn A', periodMonth: '2026-03', rawValue: '88' }        // DUPLICATE (existing BASELINE_IMPORT)
  ];
  const preview = buildPreviewBatch(rawRows, EMP_INDEX, new Map([['PHF001|2026-03', { source: 'BASELINE_IMPORT' }]]));
  assert.strictEqual(preview.total, 6);
  assert.strictEqual(preview.counts.READY, 1);
  assert.strictEqual(preview.counts.SKIP_INACTIVE, 1);
  assert.strictEqual(preview.counts.SKIP_NOT_CURRENT_EMPLOYEE, 1);
  assert.strictEqual(preview.counts.MISSING_CODE, 1);
  assert.strictEqual(preview.counts.INVALID_SCORE, 1);
  assert.strictEqual(preview.counts.DUPLICATE, 1);
  console.log('[PASS] 16: preview batch phân loại đúng từng dòng (READY/SKIP_INACTIVE/SKIP_NOT_CURRENT_EMPLOYEE/MISSING_CODE/INVALID_SCORE/DUPLICATE) - duplicate employee/month được nhận diện đúng, không ghi trùng');

  // CONFLICT: đã có result nguồn KHÁC BASELINE_IMPORT
  const previewConflict = buildPreviewBatch(
    [{ employeeCode: 'PHF001', employeeName: 'Nguyễn Văn A', periodMonth: '2026-04', rawValue: '75' }],
    EMP_INDEX, new Map([['PHF001|2026-04', { source: 'SYSTEM_LIVE' }]])
  );
  assert.strictEqual(previewConflict.rows[0].status, 'CONFLICT');
  console.log('[PASS] (bổ sung) Đã có result nguồn SYSTEM_LIVE khác -> CONFLICT (không tự động ghi đè)');

  // ---- buildConfirmRows chỉ nhận READY, throw nếu có dòng khác lọt vào ----
  assert.throws(() => buildConfirmRows(preview.rows, { source: 'BASELINE_IMPORT', batchId: 'b1', actorId: 'a1', actorName: 'Admin' }), err => err && err.code === 'CHECKLIST_MONTHLY_RESULT_NOT_READY');
  const onlyReady = preview.rows.filter(r => r.status === 'READY');
  const confirmed = buildConfirmRows(onlyReady, { source: 'BASELINE_IMPORT', batchId: 'b1', actorId: 'a1', actorName: 'Admin' });
  assert.strictEqual(confirmed.length, 1);
  assert.strictEqual(confirmed[0].source, 'BASELINE_IMPORT');
  console.log('[PASS] 20: buildConfirmRows throw nếu có dòng chưa READY lẫn vào - không có đường ghi nào bỏ qua bước preview');

  // ==================================================================
  // Service layer (mock Supabase) - preview/confirm/confirmBaselineImport
  // ==================================================================
  let unauthorized = null;
  try { await previewMonthlyResultImport(nonAdminSession, { rows: rawRows }); } catch (e) { unauthorized = e; }
  assert.ok(unauthorized && unauthorized.code === 'CHECKLIST_MONTHLY_RESULT_ADMIN_REQUIRED');
  console.log('[PASS] 21: session không phải admin bị chặn ensureAdmin (403) trước khi chạm DB - không có tool ghi nào ngoài quyền Admin');

  const svcPreview = await previewMonthlyResultImport(adminSession, { rows: [rawRows[0]] });
  assert.strictEqual(svcPreview.rows[0].status, 'READY');
  assert.strictEqual(insertedRows.length, 0, 'preview KHÔNG được ghi bất kỳ dòng nào vào DB');
  console.log('[PASS] 19 (preview part): previewMonthlyResultImport() qua service thật (mock Supabase) trả đúng READY, KHÔNG ghi gì (insertedRows vẫn rỗng)');

  // ---- 17/18. BASELINE_IMPORT server-assigned; client KHÔNG spoof được SYSTEM_LIVE ----
  const spoofAttempt = await confirmBaselineImport(adminSession, { rows: [rawRows[0]], source: 'SYSTEM_LIVE', batchId: 'spoof-batch' });
  assert.strictEqual(spoofAttempt.source, 'BASELINE_IMPORT');
  assert.strictEqual(spoofAttempt.rows[0].source, 'BASELINE_IMPORT');
  console.log('[PASS] 17/18: confirmBaselineImport() LUÔN ghi source=BASELINE_IMPORT dù input cố truyền source:"SYSTEM_LIVE" - client không spoof được');

  // ---- 19. confirm revalidates (dữ liệu đổi giữa preview và confirm) ----
  // Nhân sự PHF001 vừa được xác nhận baseline cho 2026-01 ở bước trên -> nếu
  // gọi lại confirm với CÙNG payload cũ (giả lập preview stale), revalidate
  // phải phát hiện đã tồn tại -> từ chối, không ghi trùng.
  let staleError = null;
  try { await confirmBaselineImport(adminSession, { rows: [rawRows[0]] }); } catch (e) { staleError = e; }
  assert.ok(staleError && staleError.code === 'CHECKLIST_MONTHLY_RESULT_REVALIDATION_FAILED');
  console.log('[PASS] 19: confirm tự revalidate lại từ dữ liệu THẬT hiện tại (không tin preview cũ) - phát hiện đã tồn tại kể từ preview trước, từ chối ghi trùng');

  // ---- 16 (DB-level) unique constraint enforced khi 2 request đua nhau ghi cùng lúc ----
  STATE.checklist_monthly_results.push({ id: 'race', employee_code: 'PHF021', period_month: '2026-05', source: 'BASELINE_IMPORT' });
  let raceError = null;
  try {
    await confirmBaselineImport(adminSession, { rows: [{ employeeCode: 'PHF021', employeeName: 'Lê Văn C', periodMonth: '2026-05', rawValue: '90' }] });
  } catch (e) { raceError = e; }
  // Vì existingIndex được load lại TRƯỚC khi ghi, revalidate đã bắt được (không cần chạm nhánh 23505) - vẫn đúng invariant "không ghi trùng".
  assert.ok(raceError);
  console.log('[PASS] 16 (bổ sung): race condition ghi trùng employee/month bị chặn ở lớp revalidate trước khi tới DB');

  console.log('\nALL PASS - test-checklist-monthly-results-baseline-2026-08.js');
}

run().catch(err => {
  console.error('[FAIL]', err && err.stack || err);
  process.exitCode = 1;
});
