'use strict';
/*
 * Regression test — Báo cáo → Tổng hợp, mở rộng "Từ tháng/Đến tháng"
 * (getChecklistMonthlyReport(), lib/checklist-reports.js, 2026-08-19).
 *
 * Khoá đúng các quyết định nghiệp vụ ĐÃ CHỐT:
 * - Điểm trung bình: bình quân theo employee-month (flatten), KHÔNG bình
 *   quân của bình quân từng tháng.
 * - Hoàn thành: numerator/denominator vẫn hoàn toàn theo checklist_monthly_
 *   forms (reviewed/locked có final_score) - monthly_result KHÔNG được coi
 *   là hoàn thành tự đánh giá/thẩm định, kể cả khi nó override Điểm cuối.
 * - checklist_monthly_results (SCORED) override Điểm cuối bất kể phiếu có
 *   tồn tại/trạng thái gì; fallback đúng "done" cũ khi không có monthly_result.
 * - Vi phạm: sum theo occurred_date trong đúng khoảng [from,to].
 * - Quá hạn (overdueApplied theo lịch sử phiếu): hoạt động cho MỌI tháng
 *   trong range, không chỉ tháng cuối.
 * - Gợi ý đào tạo (repeatSuggestions): neo theo Đến tháng, KHÔNG đổi theo độ
 *   rộng range (giữ nguyên hành vi cũ).
 * - Phạm vi quyền (Manager) không mở rộng theo range.
 * - Không N+1: đúng 1 lượt query cho mỗi bảng, không lặp theo tháng/nhân viên.
 * - Tương thích ngược 100% khi chỉ truyền {month} (fromMonth=toMonth=month).
 *
 * Cùng convention mock-Supabase (chặn @supabase/supabase-js qua Module._load)
 * với scripts/test-checklist-score-period-report-backend.js. Không kết nối
 * DB thật, không ghi gì xuống store.
 *
 * Chạy: node scripts/test-checklist-summary-report-range-2026-08.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

const BH = 'Bán hàng', KHO = 'Kho vận';
const TEMPLATE_SNAPSHOT = { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } };

function person(code, name, department, branch) {
  return { employee_key: code.toLowerCase(), employee_id: 'id-' + code.toLowerCase(), employee_code: code, employee_name: name, department, title: 'Nhân viên', branch, manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-01-01' };
}
function form(id, code, name, period, status, department, branch, finalScore, extra) {
  return Object.assign({ id, period_month: period, employee_code: code, employee_name: name, department, title: 'Nhân viên', branch, status, template_id: 'nv-ban-hang', template_version: 'BH-1.0', template_snapshot: TEMPLATE_SNAPSHOT, checklist_score: 100, self_total_score: 90, review_total_score: 90, final_score: finalScore, self_submitted_at: '2026-01-01T00:00:00Z', review_submitted_at: '2026-01-01T00:00:00Z', reviewer_code: '', reviewer_name: '', admin_exception_open: false }, extra || {});
}

const store = {
  checklist_monthly_periods: [{ period_month: '2026-08', status: '' }],
  checklist_employee_assignments: [
    person('PHF001', 'Một', BH, 'Ngô Quyền'),
    person('PHF002', 'Hai', BH, 'Phú Lợi'),
    person('PHF003', 'Ba', BH, 'Ngô Quyền'),
    person('PHF004', 'Bốn', BH, 'Ngô Quyền'),
    person('PHF005', 'Năm', BH, 'Ngô Quyền'),
    person('PHF006', 'Sáu', BH, 'Ngô Quyền'),
    person('PHF007', 'Bảy', BH, 'Ngô Quyền'),
    person('PHF008', 'Tám', BH, 'Ngô Quyền'),
    person('PHF009', 'Chín', BH, 'Ngô Quyền'),
    person('PHF010', 'Mười', BH, 'Ngô Quyền'),
    // PHF099 thuộc Kho vận - dùng cho test phạm vi quyền Manager (ngoài scope).
    person('PHF099', 'Kho', KHO, 'Ngô Quyền')
  ],
  checklist_monthly_forms: [
    // -- Nhóm A: employee-month weighted average (2026-01..2026-02) --
    form('F-001-01', 'PHF001', 'Một', '2026-01', 'reviewed', BH, 'Ngô Quyền', 100),
    form('F-002-02', 'PHF002', 'Hai', '2026-02', 'reviewed', BH, 'Phú Lợi', 0),
    form('F-003-02', 'PHF003', 'Ba', '2026-02', 'reviewed', BH, 'Ngô Quyền', 0),
    form('F-004-02', 'PHF004', 'Bốn', '2026-02', 'reviewed', BH, 'Ngô Quyền', 0),
    // -- Nhóm B: monthly_result override/fallback/SCORED=0/result-only (2026-03) --
    form('F-005-03', 'PHF005', 'Năm', '2026-03', 'reviewed', BH, 'Ngô Quyền', 70), // sẽ bị override bởi monthly_result=95
    form('F-006-03', 'PHF006', 'Sáu', '2026-03', 'reviewed', BH, 'Ngô Quyền', 88), // KHÔNG có monthly_result -> giữ nguyên (fallback)
    form('F-007-03', 'PHF007', 'Bảy', '2026-03', 'waiting_review', BH, 'Ngô Quyền', null), // monthly_result SCORED=0, form CHƯA hoàn thành
    // PHF008: KHÔNG có phiếu tháng 03 - chỉ có monthly_result (result-only, không có trong "forms").
    // -- Nhóm C: quá hạn nhiều tháng (2026-05..2026-06) --
    form('F-010-05', 'PHF010', 'Mười', '2026-05', 'reviewed', BH, 'Ngô Quyền', 60),
    form('F-010-06', 'PHF010', 'Mười', '2026-06', 'reviewed', BH, 'Ngô Quyền', 65),
    // -- Nhóm D: cross-year (2025-12..2026-01) --
    form('F-001-1212', 'PHF001', 'Một', '2025-12', 'reviewed', BH, 'Ngô Quyền', 77),
    // Manager scope: PHF099 (Kho vận) - Manager Bán hàng KHÔNG được thấy. Đặt ở tháng 06 (nằm
    // trong range test #17 [01..06] nhưng NGOÀI range test #8 [01..02]) để không lẫn vào phép
    // tính bình quân employee-month của test #8 (admin thấy TOÀN công ty, kể cả Kho vận).
    form('F-099-06', 'PHF099', 'Kho', '2026-06', 'reviewed', KHO, 'Ngô Quyền', 50)
  ],
  checklist_monthly_form_history: [
    { form_id: 'F-010-05', action: 'apply_self_overdue_policy', after_data: { policyMode: 'zero', scoreSource: 'auto' }, changed_at: '2026-05-20T00:00:00Z', changed_by_name: 'Hệ thống', reason: '' },
    { form_id: 'F-010-06', action: 'apply_self_overdue_policy', after_data: { policyMode: 'zero', scoreSource: 'auto' }, changed_at: '2026-06-20T00:00:00Z', changed_by_name: 'Hệ thống', reason: '' }
  ],
  checklist_monthly_results: [
    { employee_code: 'PHF005', period_month: '2026-03', result_state: 'SCORED', score: 95 },
    { employee_code: 'PHF007', period_month: '2026-03', result_state: 'SCORED', score: 0 },
    { employee_code: 'PHF008', period_month: '2026-03', result_state: 'SCORED', score: 82 },
    { employee_code: 'PHF009', period_month: '2026-03', result_state: 'NO_ASSESSMENT', score: null }
  ],
  checklist_violation_records: [
    // Trong range 2026-05..2026-06.
    { id: 'V-1', employee_code: 'PHF010', employee_name: 'Mười', criterion_code: 'HQCV-TEST', criterion_name: 'Tiêu chí test', criterion_group: 'Vận hành', points: 5, occurred_date: '2026-05-10', record_status: 'official', is_test: false },
    { id: 'V-2', employee_code: 'PHF010', employee_name: 'Mười', criterion_code: 'HQCV-TEST', criterion_name: 'Tiêu chí test', criterion_group: 'Vận hành', points: 3, occurred_date: '2026-06-15', record_status: 'official', is_test: false },
    // Ngoài range (tháng 7) - KHÔNG được tính khi range là 05..06.
    { id: 'V-3', employee_code: 'PHF010', employee_name: 'Mười', criterion_code: 'HQCV-TEST', criterion_name: 'Tiêu chí test', criterion_group: 'Vận hành', points: 9, occurred_date: '2026-07-01', record_status: 'official', is_test: false }
  ],
  checklist_permission_grants: [],
  checklist_repeat_violation_policies: []
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
  or() { return this; }
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
const reportsLib = require(path.join(__dirname, '..', 'api', '_lib', 'checklist-reports.js'));
Module._load = originalLoad;

const ADMIN_SESSION = { role: 'admin', account: { id: 'admin-1', name: 'Test Admin' }, sub: 'admin-1' };
// Manager Bán hàng: view_scope theo department 'Bán hàng' - không thấy PHF099 (Kho vận).
const MANAGER_SESSION = { role: 'manager', account: { id: 'mgr-1', name: 'Quản lý BH' }, sub: 'mgr-1', employeeCode: 'MGR001' };
store.checklist_permission_grants.push({ id: 'g-1', account_id: 'mgr-1', employee_code: 'MGR001', employee_name: 'Quản lý BH', preset_code: 'TRUONG_BO_PHAN', capabilities: { view_reports: true }, view_scope: { type: 'department', values: [BH] }, review_scope: { type: 'none', values: [] }, record_scope: { type: 'none', values: [] }, export_scope: { type: 'none', values: [] }, effective_from: '2026-01-01', effective_to: null, reason: '', is_active: true, updated_at: '2026-01-01T00:00:00Z', updated_by_name: '' });

const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS: ' + name); }
  catch (err) { results.push({ name, pass: false }); console.log('FAIL: ' + name + '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
}

async function main() {
  console.log('=== Regression test: getChecklistMonthlyReport() Từ tháng/Đến tháng ===\n');

  // 1. Tương thích ngược 100% khi chỉ truyền {month}.
  const legacy = await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { month: '2026-01' });
  const rangeEquivalent = await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2026-01', toMonth: '2026-01' });
  await record('1. {month} tương đương {fromMonth=toMonth=month}: cùng số phiếu, cùng scoreEntries', async () => {
    assert.strictEqual(legacy.forms.length, rangeEquivalent.forms.length);
    assert.strictEqual(legacy.scoreEntries.length, rangeEquivalent.scoreEntries.length);
    assert.strictEqual(legacy.month, '2026-01'); assert.strictEqual(legacy.fromMonth, '2026-01'); assert.strictEqual(legacy.toMonth, '2026-01');
  });

  // 2-3. Range 3/6/12 tháng - không lỗi, đúng số tháng nhận vào.
  await record('2. Range 3 tháng (2026-01..2026-03) không lỗi, forms trải đúng 3 tháng', async () => {
    const r = await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2026-01', toMonth: '2026-03' });
    const months = new Set(r.forms.map(f => f.periodMonth));
    assert.ok(months.has('2026-01') && months.has('2026-02') && months.has('2026-03'));
  });
  await record('3. Range 6 tháng (2026-01..2026-06) không lỗi', async () => {
    const r = await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2026-01', toMonth: '2026-06' });
    assert.ok(r.forms.some(f => f.periodMonth === '2026-06'));
  });
  await record('4. Range 12 tháng (2025-09..2026-08) không lỗi (đúng biên, không reject)', async () => {
    await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2025-09', toMonth: '2026-08' });
  });

  // 5. Cross-year.
  await record('5. Range cross-year (2025-12..2026-01) lấy đúng cả 2 phía năm', async () => {
    const r = await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2025-12', toMonth: '2026-01' });
    const months = new Set(r.forms.map(f => f.periodMonth));
    assert.ok(months.has('2025-12'), 'phải có tháng 12/2025');
    assert.ok(months.has('2026-01'), 'phải có tháng 01/2026');
  });

  // 6. from>to bị reject.
  await record('6. fromMonth>toMonth bị reject đúng mã CHECKLIST_REPORT_RANGE_INVALID', async () => {
    await assert.rejects(
      () => reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2026-05', toMonth: '2026-01' }),
      err => err.code === 'CHECKLIST_REPORT_RANGE_INVALID'
    );
  });

  // 7. >12 tháng bị reject.
  await record('7. Range >12 tháng bị reject đúng mã CHECKLIST_REPORT_RANGE_TOO_WIDE', async () => {
    await assert.rejects(
      () => reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2026-01', toMonth: '2027-02' }),
      err => err.code === 'CHECKLIST_REPORT_RANGE_TOO_WIDE'
    );
  });

  // 8. Điểm trung bình bình quân theo employee-month (KHÔNG bình quân của bình quân từng tháng).
  await record('8. Điểm trung bình = bình quân employee-month (25), KHÔNG phải bình quân 2 tháng (50)', async () => {
    const r = await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2026-01', toMonth: '2026-02' });
    const values = r.scoreEntries.map(x => x.finalScore).sort((a, b) => a - b);
    assert.deepStrictEqual(values, [0, 0, 0, 100]);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    assert.strictEqual(avg, 25, 'employee-month weighted phải ra 25, không phải 50 (bình quân 2 tháng)');
  });

  // 9-12. monthly_result override / fallback / SCORED=0 / result-only.
  const groupB = await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2026-03', toMonth: '2026-03' });
  const byCode = code => groupB.forms.find(f => f.employeeCode === code);
  const scoreByCode = code => groupB.scoreEntries.find(x => x.employeeCode === code);
  await record('9. monthly_result SCORED override Điểm cuối trên "forms" (PHF005: 70 -> 95)', async () => {
    assert.strictEqual(byCode('PHF005').finalScore, 95);
    assert.strictEqual(byCode('PHF005').resultState, 'SCORED');
  });
  await record('9b. scoreEntries dùng đúng giá trị override (95), KHÔNG dùng final_score gốc của form (70)', async () => {
    assert.strictEqual(scoreByCode('PHF005').finalScore, 95);
  });
  await record('10. KHÔNG có monthly_result -> fallback final_score gốc của form (PHF006: 88)', async () => {
    assert.strictEqual(byCode('PHF006').finalScore, 88);
    assert.strictEqual(byCode('PHF006').resultState, null);
    assert.strictEqual(scoreByCode('PHF006').finalScore, 88);
  });
  await record('11. SCORED=0 được TÍNH (không bị coi như rỗng/loại bỏ) - PHF007 override 0 dù phiếu waiting_review', async () => {
    assert.strictEqual(byCode('PHF007').finalScore, 0);
    assert.notStrictEqual(byCode('PHF007').finalScore, null);
    assert.ok(scoreByCode('PHF007'), 'PHF007 phải có mặt trong scoreEntries');
    assert.strictEqual(scoreByCode('PHF007').finalScore, 0);
  });
  await record('12. Hoàn thành vẫn theo form-based: PHF007 (waiting_review) KHÔNG được monthly_result=0 "làm giả" thành hoàn thành', async () => {
    const completed = groupB.forms.filter(f => f.finalScore != null && ['reviewed', 'locked'].includes(f.status));
    assert.ok(!completed.some(f => f.employeeCode === 'PHF007'), 'PHF007 không được tính vào numerator hoàn thành dù finalScore đã bị override != null');
  });
  await record('13. monthly_result-only (PHF008, KHÔNG có phiếu tháng 03) KHÔNG xuất hiện trong "forms" (đúng denominator hoàn thành = chỉ phiếu thật)', async () => {
    assert.strictEqual(byCode('PHF008'), undefined, 'PHF008 không có phiếu -> không được xuất hiện trong forms/denominator hoàn thành');
  });
  await record('13b. monthly_result-only (PHF008) VẪN xuất hiện trong scoreEntries (Điểm trung bình không bỏ sót)', async () => {
    const entry = scoreByCode('PHF008');
    assert.ok(entry, 'PHF008 phải có trong scoreEntries dù không có phiếu');
    assert.strictEqual(entry.finalScore, 82);
  });
  await record('14. monthly_result KHÔNG phải SCORED (PHF009: NO_ASSESSMENT) KHÔNG được đưa vào scoreEntries', async () => {
    assert.strictEqual(scoreByCode('PHF009'), undefined);
  });

  // 15. Vi phạm theo đúng khoảng ngày, periodMonth đúng từng dòng (không hardcode 1 tháng).
  const groupC = await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2026-05', toMonth: '2026-06' });
  await record('15. Vi phạm trong range (05..06) được tính đủ, đúng periodMonth theo occurred_date', async () => {
    const v1 = groupC.violations.find(v => v.id === 'V-1'), v2 = groupC.violations.find(v => v.id === 'V-2');
    assert.ok(v1 && v2, 'phải có cả V-1 (tháng 05) và V-2 (tháng 06)');
    assert.strictEqual(v1.periodMonth, '2026-05');
    assert.strictEqual(v2.periodMonth, '2026-06');
  });
  await record('15b. Vi phạm NGOÀI range (tháng 07) KHÔNG được tính khi range là 05..06', async () => {
    assert.ok(!groupC.violations.some(v => v.id === 'V-3'));
  });

  // 16. Quá hạn (overdueApplied) hoạt động cho MỌI tháng trong range, không chỉ tháng cuối.
  await record('16. overdueApplied đúng cho CẢ tháng 05 và tháng 06 (không chỉ neo tháng cuối range)', async () => {
    const f05 = groupC.forms.find(f => f.id === 'F-010-05'), f06 = groupC.forms.find(f => f.id === 'F-010-06');
    assert.strictEqual(f05.overdueApplied, true);
    assert.strictEqual(f06.overdueApplied, true);
  });

  // 17. Phạm vi quyền Manager không mở rộng theo range.
  await record('17. Manager (view_scope=department Bán hàng): KHÔNG thấy PHF099 (Kho vận) dù range rộng', async () => {
    const r = await reportsLib.getChecklistMonthlyReport(MANAGER_SESSION, { fromMonth: '2026-01', toMonth: '2026-06' });
    assert.ok(!r.forms.some(f => f.employeeCode === 'PHF099'));
    assert.ok(!r.scoreEntries.some(x => x.employeeCode === 'PHF099'), 'monthly_results cũng phải scoped đúng - không rò rỉ điểm ngoài phạm vi qua scoreEntries');
  });
  await record('17b. Manager vẫn thấy đúng nhân sự trong phạm vi (Bán hàng)', async () => {
    const r = await reportsLib.getChecklistMonthlyReport(MANAGER_SESSION, { fromMonth: '2026-01', toMonth: '2026-06' });
    assert.ok(r.forms.some(f => f.employeeCode === 'PHF001'));
  });

  // 18. Gợi ý đào tạo neo theo Đến tháng - KHÔNG đổi theo độ rộng range.
  await record('18. repeatSuggestions/repeatPolicy neo theo Đến tháng - độ rộng range không ảnh hưởng', async () => {
    const wide = await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2026-01', toMonth: '2026-06' });
    const narrow = await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2026-06', toMonth: '2026-06' });
    assert.deepStrictEqual(wide.repeatSuggestions, narrow.repeatSuggestions, 'cùng Đến tháng (06) -> cùng kết quả gợi ý đào tạo bất kể Từ tháng khác nhau');
    assert.deepStrictEqual(wide.repeatPolicy, narrow.repeatPolicy);
  });

  // 19. Không N+1 - đúng 1 lượt query mỗi bảng cho toàn range, không lặp theo tháng/nhân viên.
  await record('19. Không N+1: đúng 1 lượt checklist_monthly_results cho range 12 tháng', async () => {
    queryLog.length = 0;
    await reportsLib.getChecklistMonthlyReport(ADMIN_SESSION, { fromMonth: '2025-09', toMonth: '2026-08' });
    assert.strictEqual(queryLog.filter(t => t === 'checklist_monthly_results').length, 1);
    assert.strictEqual(queryLog.filter(t => t === 'checklist_monthly_forms').length, 2, 'formsQuery + trendQuery, không lặp theo tháng');
    assert.strictEqual(queryLog.filter(t => t === 'checklist_violation_records').length, 2, 'violationsQuery + repeatQuery, không lặp theo tháng');
  });

  // === Audit gap (2026-08-19): panel "Tình trạng xử lý ghi nhận lỗi" (getChecklistViolationWorkflowSummary) ===
  // Trước đây CHỈ nhận 1 tháng (luôn là Đến tháng của range đang chọn trên Tổng hợp) dù toàn màn
  // đã hiển thị theo khoảng - dễ hiểu lầm số liệu đại diện cả range. Mở rộng CÙNG pattern, tái sử
  // dụng ĐÚNG V-1 (2026-05-10, official)/V-2 (2026-06-15, official)/V-3 (2026-07-01, official) đã
  // seed cho nhóm C ở trên (KHÔNG cần checklist_violation_tasks - task=undefined vẫn được tính vào
  // total/official/cancelled, chỉ bỏ qua phân loại waiting/overdue chi tiết).
  await record('20. Workflow summary tương thích ngược 100% khi chỉ truyền {month}', async () => {
    const r = await reportsLib.getChecklistViolationWorkflowSummary(ADMIN_SESSION, { month: '2026-08' });
    assert.strictEqual(r.month, '2026-08'); assert.strictEqual(r.fromMonth, '2026-08'); assert.strictEqual(r.toMonth, '2026-08');
  });
  await record('21. Workflow summary theo ĐÚNG range (05..06): total=2 (V-1+V-2), không chỉ neo tháng cuối (06 riêng chỉ có V-2)', async () => {
    const range = await reportsLib.getChecklistViolationWorkflowSummary(ADMIN_SESSION, { fromMonth: '2026-05', toMonth: '2026-06' });
    const singleToMonthOnly = await reportsLib.getChecklistViolationWorkflowSummary(ADMIN_SESSION, { fromMonth: '2026-06', toMonth: '2026-06' });
    assert.strictEqual(range.summary.total, 2, 'range 05..06 phải gồm cả V-1 (05) và V-2 (06)');
    assert.strictEqual(singleToMonthOnly.summary.total, 1, 'chỉ tháng 06 riêng thì chỉ có V-2 - chứng minh version cũ (neo Đến tháng) đã bỏ sót V-1');
  });
  await record('21b. Vi phạm NGOÀI range (V-3, tháng 07) không được tính khi range là 05..06', async () => {
    const range = await reportsLib.getChecklistViolationWorkflowSummary(ADMIN_SESSION, { fromMonth: '2026-05', toMonth: '2026-06' });
    assert.strictEqual(range.summary.official, 2);
  });
  await record('22. Workflow summary reject from>to đúng mã CHECKLIST_REPORT_RANGE_INVALID', async () => {
    await assert.rejects(
      () => reportsLib.getChecklistViolationWorkflowSummary(ADMIN_SESSION, { fromMonth: '2026-06', toMonth: '2026-05' }),
      err => err.code === 'CHECKLIST_REPORT_RANGE_INVALID'
    );
  });
  await record('23. Workflow summary reject range >12 tháng đúng mã CHECKLIST_REPORT_RANGE_TOO_WIDE', async () => {
    await assert.rejects(
      () => reportsLib.getChecklistViolationWorkflowSummary(ADMIN_SESSION, { fromMonth: '2026-01', toMonth: '2027-02' }),
      err => err.code === 'CHECKLIST_REPORT_RANGE_TOO_WIDE'
    );
  });
  await record('24. Workflow summary không N+1: đúng 1 lượt checklist_violation_records cho range 12 tháng', async () => {
    queryLog.length = 0;
    await reportsLib.getChecklistViolationWorkflowSummary(ADMIN_SESSION, { fromMonth: '2025-09', toMonth: '2026-08' });
    assert.strictEqual(queryLog.filter(t => t === 'checklist_violation_records').length, 1);
  });

  const failed = results.filter(r => !r.pass);
  console.log('\n=== Kết quả ===');
  console.log(results.length - failed.length + '/' + results.length + ' bước PASS.');
  console.log('\nToàn bộ chạy trên mock trong bộ nhớ — không có ghi nào xuống database thật.');
  console.log('Chạy thủ công khi cần: node scripts/test-checklist-summary-report-range-2026-08.js');
  if (failed.length) process.exit(1);
}

main();
