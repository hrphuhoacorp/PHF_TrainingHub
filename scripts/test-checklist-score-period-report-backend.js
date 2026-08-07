'use strict';
/*
 * Regression test — getChecklistScorePeriodReport() (Dashboard "Điểm
 * Checklist" · tab "Theo kỳ", build 1432→1433). Điểm mấu chốt cần khoá:
 *
 * - self_total_score/review_total_score được ghi ngay khi LƯU NHÁP (trước
 *   submit) nên "có số trong DB" không đồng nghĩa "đã thật sự tự đánh/thẩm
 *   định" — hàm phải gate theo self_saved_at/self_submitted_at (tương ứng
 *   review) và trả null khi CHƯA từng lưu, kể cả khi cột DB có sẵn một số 0
 *   mặc định nào đó. self=0 (đã lưu, giá trị 0) phải giữ nguyên 0, không
 *   thành null/"—".
 * - Nhân sự thuộc phạm vi hiện tại nhưng KHÔNG có phiếu ở một kỳ vẫn xuất
 *   hiện (hasForm:false, mọi điểm null) thay vì biến mất khỏi bảng.
 * - Snapshot department/branch trên phiếu không bị current org (assignment)
 *   ghi đè khi phiếu tồn tại.
 * - Range validation: from>to và range>12 kỳ bị reject.
 * - Không N×M query: đúng 2 câu query (forms + violations) cho toàn bộ
 *   range, không lặp theo từng nhân viên/kỳ.
 *
 * Cùng convention mock-Supabase (chặn @supabase/supabase-js qua Module._load)
 * với scripts/test-checklist-monthly-current-org-backend.js. Không kết nối
 * DB thật, không ghi gì xuống store.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu - chỉ chạy thủ công:
 *   node scripts/test-checklist-score-period-report-backend.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

const BH = 'Bộ phận bán hàng';
const TEMPLATE_SNAPSHOT = { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } };

const store = {
  checklist_monthly_forms: [
    // PHF001: kỳ 07 đã KHÓA (locked) - self=0 THẬT (đã tự đánh, kết quả 0), review có, final có.
    { id: 'F-001-07', period_month: '2026-07', employee_code: 'PHF001', employee_name: 'Nguyễn Văn A', department: BH, title: 'Nhân viên', branch: 'Ngô Quyền', status: 'locked', template_id: 'nv-ban-hang', template_version: 'BH-1.0', template_snapshot: TEMPLATE_SNAPSHOT, checklist_score: 100, self_total_score: 0, review_total_score: 85, final_score: 56.67, self_saved_at: '2026-07-05T00:00:00Z', self_submitted_at: '2026-07-05T00:00:00Z', review_saved_at: '2026-07-06T00:00:00Z', review_submitted_at: '2026-07-06T00:00:00Z', reviewer_name: 'Trưởng ca A', checklist_review_score: 100, self_answers: {}, review_answers: {} },
    // PHF001: kỳ 08 - CHỈ lưu nháp tự đánh giá (self_saved_at có, self_submitted_at KHÔNG), chưa đụng review.
    { id: 'F-001-08', period_month: '2026-08', employee_code: 'PHF001', employee_name: 'Nguyễn Văn A', department: BH, title: 'Nhân viên', branch: 'Ngô Quyền', status: 'waiting_self', template_id: 'nv-ban-hang', template_version: 'BH-1.0', template_snapshot: TEMPLATE_SNAPSHOT, checklist_score: 100, self_total_score: 40, review_total_score: null, final_score: null, self_saved_at: '2026-08-03T00:00:00Z', self_submitted_at: '', review_saved_at: '', review_submitted_at: '', reviewer_name: 'Trưởng ca A', checklist_review_score: null, self_answers: { 'HQCV-TEST': { value: 4 } }, review_answers: {} },
    // PHF002: kỳ 08 - CHƯA đụng gì tới self/review (form vừa tạo, draft) dù self_total_score cột có sẵn giá trị rác 0 -> vẫn phải null.
    { id: 'F-002-08', period_month: '2026-08', employee_code: 'PHF002', employee_name: 'Trần Thị B', department: BH, title: 'Nhân viên', branch: 'Phú Lợi', status: 'draft', template_id: 'nv-ban-hang', template_version: 'BH-1.0', template_snapshot: TEMPLATE_SNAPSHOT, checklist_score: 100, self_total_score: 0, review_total_score: 0, final_score: null, self_saved_at: '', self_submitted_at: '', review_saved_at: '', review_submitted_at: '', reviewer_name: '', checklist_review_score: null, self_answers: {}, review_answers: {} }
    // PHF002 KHÔNG có phiếu kỳ 07 (cố tình bỏ trống để test "không có phiếu").
  ],
  checklist_employee_assignments: [
    // Current org của PHF001 đã đổi branch (Ngô Quyền -> Lái Thiêu) SAU khi 2 phiếu trên đã tồn tại - snapshot trên phiếu KHÔNG được ghi đè.
    { employee_key: 'phf001', employee_id: 'id-phf001', employee_code: 'PHF001', employee_name: 'Nguyễn Văn A', department: BH, title: 'Nhân viên', branch: 'Lái Thiêu', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-08-01' },
    { employee_key: 'phf002', employee_id: 'id-phf002', employee_code: 'PHF002', employee_name: 'Trần Thị B', department: BH, title: 'Nhân viên', branch: 'Phú Lợi', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-01-01' }
  ],
  checklist_violation_records: [
    { employee_code: 'PHF002', points: 5, occurred_date: '2026-08-10' }
  ],
  checklist_permission_grants: []
};

class FakeQuery {
  constructor(table, log) { this.table = table; this.filters = []; this._limit = null; this._single = null; if (log) log.push(table); }
  select() { return this; }
  eq(col, val) { this.filters.push(row => String(row[col]) === String(val)); return this; }
  neq(col, val) { this.filters.push(row => String(row[col]) !== String(val)); return this; }
  in(col, vals) { const set = new Set((vals || []).map(String)); this.filters.push(row => set.has(String(row[col]))); return this; }
  gte(col, val) { this.filters.push(row => String(row[col]) >= String(val)); return this; }
  lte(col, val) { this.filters.push(row => String(row[col]) <= String(val)); return this; }
  lt(col, val) { this.filters.push(row => String(row[col]) < String(val)); return this; }
  order() { return this; }
  limit(n) { this._limit = n; return this; }
  range() { return this; }
  maybeSingle() { this._single = 'maybe'; return this; }
  single() { this._single = 'strict'; return this; }
  _rows() {
    let rows = clone(store[this.table] || []);
    this.filters.forEach(f => { rows = rows.filter(f); });
    if (this._limit != null) rows = rows.slice(0, this._limit);
    return rows;
  }
  then(resolve, reject) {
    const rows = this._rows();
    if (this._single === 'maybe') return Promise.resolve({ data: rows[0] || null, error: null }).then(resolve, reject);
    if (this._single === 'strict') return Promise.resolve(rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'No rows found' } }).then(resolve, reject);
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  }
}

const queryLog = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@supabase/supabase-js') {
    return { createClient: () => ({ from: (table) => new FakeQuery(table, queryLog), rpc: () => Promise.resolve({ data: { ok: true }, error: null }) }) };
  }
  return originalLoad.apply(this, arguments);
};
const reportsLib = require(path.join(__dirname, '..', 'lib', 'checklist-reports.js'));
Module._load = originalLoad;

const ADMIN_SESSION = { role: 'admin', account: { id: 'admin-1', name: 'Test Admin' }, sub: 'admin-1' };

const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('✓ PASS -', name); }
  catch (err) { results.push({ name, pass: false }); console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
}

async function main() {
  console.log('=== Regression test: getChecklistScorePeriodReport() ===\n');

  queryLog.length = 0;
  const r = await reportsLib.getChecklistScorePeriodReport(ADMIN_SESSION, { fromMonth: '2026-07', toMonth: '2026-08' });
  const p001 = r.employees.find(e => e.employeeCode === 'PHF001');
  const p002 = r.employees.find(e => e.employeeCode === 'PHF002');

  await record('7. self/review/final lấy đúng persisted fields (form đã locked, self=0/review=85/final=56.67)', async () => {
    assert.strictEqual(p001.periods['2026-07'].selfTotalScore, 0);
    assert.strictEqual(p001.periods['2026-07'].reviewTotalScore, 85);
    assert.strictEqual(p001.periods['2026-07'].finalScore, 56.67);
  });

  await record('8. self=0 (đã lưu thật - self_saved_at có) hiển thị SỐ 0, không thành null/"—"', async () => {
    assert.strictEqual(p001.periods['2026-07'].selfTotalScore, 0);
    assert.notStrictEqual(p001.periods['2026-07'].selfTotalScore, null);
  });

  await record('8b. self đã lưu nháp (self_saved_at có, chưa submit) vẫn trả SỐ thật (40), không phải null', async () => {
    assert.strictEqual(p001.periods['2026-08'].selfTotalScore, 40);
  });

  await record('9. review CHƯA từng đụng (review_saved_at/submitted_at đều rỗng) -> null dù DB có cột review_total_score=null sẵn', async () => {
    assert.strictEqual(p001.periods['2026-08'].reviewTotalScore, null);
  });

  await record('9b. form draft hoàn toàn chưa đụng self/review (cột DB có rác self_total_score=0/review_total_score=0) -> vẫn phải null, KHÔNG lộ số rác', async () => {
    assert.strictEqual(p002.periods['2026-08'].selfTotalScore, null, 'self_saved_at rỗng -> phải null dù cột DB=0');
    assert.strictEqual(p002.periods['2026-08'].reviewTotalScore, null, 'review_saved_at rỗng -> phải null dù cột DB=0');
  });

  await record('10. final null (form chưa khóa xong) -> null, không phải 0', async () => {
    assert.strictEqual(p001.periods['2026-08'].finalScore, null);
    assert.strictEqual(p002.periods['2026-08'].finalScore, null);
  });

  await record('11. không có phiếu ở kỳ đó (PHF002 kỳ 07) -> hasForm=false, mọi điểm null, employee vẫn xuất hiện trong danh sách', async () => {
    const cell = p002.periods['2026-07'];
    assert.strictEqual(cell.hasForm, false);
    assert.strictEqual(cell.checklistScore, null);
    assert.strictEqual(cell.selfTotalScore, null);
    assert.strictEqual(cell.reviewTotalScore, null);
    assert.strictEqual(cell.finalScore, null);
  });

  await record('12. snapshot department/branch trên phiếu KHÔNG bị current org (assignment đã đổi Lái Thiêu) ghi đè', async () => {
    assert.strictEqual(p001.periods['2026-07'].branch, 'Ngô Quyền', 'phiếu kỳ 07 phải giữ snapshot Ngô Quyền dù current đã là Lái Thiêu');
    assert.strictEqual(p001.periods['2026-08'].branch, 'Ngô Quyền');
  });

  await record('12b. Kỳ không có phiếu dùng CURRENT org làm placeholder (không có snapshot để hiển thị)', async () => {
    assert.strictEqual(p002.periods['2026-07'].branch, 'Phú Lợi', 'không có phiếu kỳ 07 -> dùng current branch của assignment');
  });

  await record('13. from > to bị reject', async () => {
    let threw = false;
    try { await reportsLib.getChecklistScorePeriodReport(ADMIN_SESSION, { fromMonth: '2026-08', toMonth: '2026-07' }); }
    catch (e) { threw = true; assert.strictEqual(e.code, 'CHECKLIST_REPORT_RANGE_INVALID'); }
    assert.ok(threw, 'phải throw khi from > to');
  });

  await record('14. range > 12 kỳ bị reject', async () => {
    let threw = false;
    try { await reportsLib.getChecklistScorePeriodReport(ADMIN_SESSION, { fromMonth: '2025-01', toMonth: '2026-08' }); }
    catch (e) { threw = true; assert.strictEqual(e.code, 'CHECKLIST_REPORT_RANGE_TOO_WIDE'); }
    assert.ok(threw, 'phải throw khi range > 12 tháng (2025-01 -> 2026-08 = 20 tháng)');
  });

  await record('14b. range = đúng 12 kỳ được chấp nhận (biên hợp lệ)', async () => {
    const r12 = await reportsLib.getChecklistScorePeriodReport(ADMIN_SESSION, { fromMonth: '2025-09', toMonth: '2026-08' });
    assert.strictEqual(r12.periods.length, 12);
  });

  await record('18. không duplicate employee - mỗi mã NV chỉ 1 entry trong employees[]', async () => {
    const codes = r.employees.map(e => e.employeeCode);
    assert.strictEqual(new Set(codes).size, codes.length);
  });

  await record('19. không N×M query - đúng 2 câu query (forms + violations) cho toàn bộ range/nhân viên, không lặp theo từng người', async () => {
    queryLog.length = 0;
    await reportsLib.getChecklistScorePeriodReport(ADMIN_SESSION, { fromMonth: '2026-07', toMonth: '2026-08' });
    assert.strictEqual(queryLog.filter(t => t === 'checklist_monthly_forms').length, 1, 'chỉ 1 query forms cho cả range, không lặp theo nhân viên/kỳ');
    assert.strictEqual(queryLog.filter(t => t === 'checklist_violation_records').length, 1, 'chỉ 1 query violations cho cả range, không lặp theo nhân viên/kỳ');
  });

  await record('Filter department/branch/query hoạt động (giống pattern getChecklistCurrentScoreReport)', async () => {
    const filtered = await reportsLib.getChecklistScorePeriodReport(ADMIN_SESSION, { fromMonth: '2026-08', toMonth: '2026-08', branch: 'Phú Lợi' });
    assert.strictEqual(filtered.employees.length, 1);
    assert.strictEqual(filtered.employees[0].employeeCode, 'PHF002');
  });

  await record('Không ghi đè checklist_monthly_forms (chỉ đọc)', async () => {
    const before = JSON.stringify(store.checklist_monthly_forms);
    await reportsLib.getChecklistScorePeriodReport(ADMIN_SESSION, { fromMonth: '2026-07', toMonth: '2026-08' });
    assert.strictEqual(JSON.stringify(store.checklist_monthly_forms), before);
  });

  const failed = results.filter(r => !r.pass);
  console.log('\n=== Kết quả ===');
  console.log(results.length - failed.length + '/' + results.length + ' bước PASS.');
  if (failed.length) process.exit(1);
}

main();
