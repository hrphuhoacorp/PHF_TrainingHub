'use strict';
/*
 * Hotfix "Theo kỳ" (2026-08-18) — Điểm cuối nay đọc lớp KẾT QUẢ AUTHORITATIVE
 * checklist_monthly_results khi có, thay vì chỉ suy diễn từ checklist_monthly_forms
 * (getChecklistScorePeriodReport(), lib/checklist-reports.js). Không đổi:
 * - permission/scope (vẫn getChecklistReportAccess() + access.people như cũ)
 * - self/review/checklistScore (vẫn đọc form như cũ, hoặc null nếu không có form)
 * - Phiếu đánh giá tháng / self-review workflow / khóa / violations / score engine
 *
 * Cùng convention mock-Supabase (chặn @supabase/supabase-js qua Module._load) với
 * scripts/test-checklist-score-period-report-backend.js. Không kết nối DB thật.
 *
 * Chạy: node scripts/test-checklist-period-monthly-results-2026-08.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

const BH = 'Bộ phận bán hàng';
const TEMPLATE_SNAPSHOT = { version: { definition: { totalRows: [[1, 'HQCV-TEST', 'Tiêu chí test', 10, 'điểm', 100, 'Không']] } } };

const store = {
  checklist_monthly_forms: [
    // PHF084/2026-07: shell rỗng (waiting_self, chưa ai đụng self/review) NHƯNG monthly_result đã
    // có SCORED=0 - đúng tình huống thật trên Production (T07 có 33 shell form khởi tạo song song
    // baseline). finalScore PHẢI lấy từ monthly_result=0, KHÔNG suy diễn từ form.final_score (null).
    { id: 'F-084-07', period_month: '2026-07', employee_code: 'PHF084', employee_name: 'Nguyễn Văn Tám Tư', department: BH, title: 'Nhân viên', branch: 'Ngô Quyền', status: 'waiting_self', template_id: 'nv-ban-hang', template_version: 'BH-1.0', template_snapshot: TEMPLATE_SNAPSHOT, checklist_score: 100, self_total_score: null, review_total_score: null, final_score: null, self_saved_at: '', self_submitted_at: '', review_saved_at: '', review_submitted_at: '', reviewer_name: '', checklist_review_score: null, self_answers: {}, review_answers: {} },
    // PHF060/2026-07: workflow LIVE thật, đã khóa, KHÔNG có monthly_result nào cho kỳ này -
    // finalScore phải giữ NGUYÊN hành vi cũ (form.final_score), không bị hotfix này đụng vào.
    { id: 'F-060-07', period_month: '2026-07', employee_code: 'PHF060', employee_name: 'Lê Thị Sáu Mươi', department: BH, title: 'Nhân viên', branch: 'Ngô Quyền', status: 'locked', template_id: 'nv-ban-hang', template_version: 'BH-1.0', template_snapshot: TEMPLATE_SNAPSHOT, checklist_score: 100, self_total_score: 90, review_total_score: 92, final_score: 91.33, self_saved_at: '2026-07-05T00:00:00Z', self_submitted_at: '2026-07-05T00:00:00Z', review_saved_at: '2026-07-06T00:00:00Z', review_submitted_at: '2026-07-06T00:00:00Z', reviewer_name: 'Trưởng ca', checklist_review_score: 100, self_answers: {}, review_answers: {} }
  ],
  checklist_employee_assignments: [
    { employee_key: 'phf084', employee_id: 'id-phf084', employee_code: 'PHF084', employee_name: 'Nguyễn Văn Tám Tư', department: BH, title: 'Nhân viên', branch: 'Ngô Quyền', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-01-01' },
    { employee_key: 'phf018', employee_id: 'id-phf018', employee_code: 'PHF018', employee_name: 'Trần Thị Mười Tám', department: BH, title: 'Nhân viên', branch: 'Phú Lợi', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-01-01' },
    { employee_key: 'phf091', employee_id: 'id-phf091', employee_code: 'PHF091', employee_name: 'Phạm Văn Chín Mốt', department: BH, title: 'Nhân viên', branch: 'Ngô Quyền', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-07-01' },
    { employee_key: 'phf092', employee_id: 'id-phf092', employee_code: 'PHF092', employee_name: 'Võ Thị Chín Hai', department: BH, title: 'Nhân viên', branch: 'Phú Lợi', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-07-01' },
    { employee_key: 'phf060', employee_id: 'id-phf060', employee_code: 'PHF060', employee_name: 'Lê Thị Sáu Mươi', department: BH, title: 'Nhân viên', branch: 'Ngô Quyền', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', effective_date: '2026-01-01' }
  ],
  checklist_violation_records: [],
  checklist_permission_grants: [
    { id: 'g1', account_id: 'mgr-1', employee_code: 'PHF900', preset_code: 'TRUONG_BO_PHAN', capabilities: { view_reports: true, export_data: false }, view_scope: { type: 'department', values: [BH] }, review_scope: { type: 'none', values: [] }, record_scope: { type: 'none', values: [] }, export_scope: { type: 'none', values: [] }, effective_from: '2026-01-01', effective_to: null, reason: 'seed', is_active: true, updated_at: '2026-01-01', updated_by_name: '' }
  ],
  checklist_monthly_results: [
    { employee_code: 'PHF084', period_month: '2026-07', result_state: 'SCORED', score: 0, source: 'BASELINE_IMPORT' },
    { employee_code: 'PHF018', period_month: '2026-04', result_state: 'NO_ASSESSMENT', score: null, source: 'BASELINE_IMPORT' },
    { employee_code: 'PHF091', period_month: '2026-07', result_state: 'PROBATION', score: null, source: 'BASELINE_IMPORT' },
    { employee_code: 'PHF092', period_month: '2026-07', result_state: 'NO_DATA', score: null, source: 'BASELINE_IMPORT' },
    { employee_code: 'PHF018', period_month: '2026-01', result_state: 'SCORED', score: 88, source: 'BASELINE_IMPORT' }
  ]
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
  or(expr) {
    const clauses = String(expr || '').split(',');
    this.filters.push(row => clauses.some(clause => {
      const m = clause.match(/^([a-z_]+)\.(eq|is|gte)\.(.*)$/i);
      if (!m) return false;
      const [, field, op, val] = m;
      if (op === 'is' && val === 'null') return row[field] == null || row[field] === '';
      if (op === 'eq') return String(row[field]) === String(val);
      if (op === 'gte') return String(row[field]) >= String(val);
      return false;
    }));
    return this;
  }
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
const MANAGER_SESSION = { role: 'manager', account: { id: 'mgr-1', name: 'Trưởng bộ phận' }, sub: 'mgr-1' };

const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS:', name); }
  catch (err) { results.push({ name, pass: false }); process.exitCode = 1; console.log('FAIL:', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
}

async function main() {
  console.log('=== Hotfix "Theo kỳ" - Điểm cuối đọc checklist_monthly_results ===\n');

  queryLog.length = 0;
  const r = await reportsLib.getChecklistScorePeriodReport(ADMIN_SESSION, { fromMonth: '2026-01', toMonth: '2026-07' });
  const p084 = r.employees.find(e => e.employeeCode === 'PHF084');
  const p018 = r.employees.find(e => e.employeeCode === 'PHF018');
  const p091 = r.employees.find(e => e.employeeCode === 'PHF091');
  const p092 = r.employees.find(e => e.employeeCode === 'PHF092');
  const p060 = r.employees.find(e => e.employeeCode === 'PHF060');

  await record('A: T01-T07 baseline xuất hiện trong Theo kỳ cho cả 4 mã nhân sự đặc biệt', () => {
    assert.ok(p084 && p018 && p091 && p092, 'cả 4 nhân sự phải xuất hiện trong employees[]');
  });

  await record('B: PHF084/2026-07 SCORED=0 -> Điểm cuối = 0 (số 0 thật, không phải null) dù form là shell rỗng', () => {
    const cell = p084.periods['2026-07'];
    assert.strictEqual(cell.resultState, 'SCORED');
    assert.strictEqual(cell.finalScore, 0);
    assert.notStrictEqual(cell.finalScore, null);
  });

  await record('C: PHF018/2026-04 NO_ASSESSMENT -> resultState đúng, finalScore=null (frontend hiển thị "Không đánh giá")', () => {
    const cell = p018.periods['2026-04'];
    assert.strictEqual(cell.resultState, 'NO_ASSESSMENT');
    assert.strictEqual(cell.finalScore, null);
  });

  await record('D: PHF091/2026-07 PROBATION -> resultState đúng, finalScore=null (frontend hiển thị "Thử việc")', () => {
    const cell = p091.periods['2026-07'];
    assert.strictEqual(cell.resultState, 'PROBATION');
    assert.strictEqual(cell.finalScore, null);
  });

  await record('E: PHF092/2026-07 NO_DATA -> resultState đúng, finalScore=null (frontend hiển thị "—")', () => {
    const cell = p092.periods['2026-07'];
    assert.strictEqual(cell.resultState, 'NO_DATA');
    assert.strictEqual(cell.finalScore, null);
  });

  await record('F: baseline không có form (PHF018/091/092) -> Tự đánh giá=null, Thẩm định=null, Điểm cuối vẫn lấy monthly_result (không giả lập workflow)', () => {
    [p018.periods['2026-04'], p091.periods['2026-07'], p092.periods['2026-07']].forEach(cell => {
      assert.strictEqual(cell.hasForm, false);
      assert.strictEqual(cell.selfTotalScore, null);
      assert.strictEqual(cell.reviewTotalScore, null);
    });
  });

  await record('F2: baseline CÓ shell form rỗng (PHF084/07, waiting_self, chưa ai đụng) -> Tự đánh/Thẩm định vẫn null (form thật sự trống), Điểm cuối lấy monthly_result=0, KHÔNG suy diễn từ form.final_score', () => {
    const cell = p084.periods['2026-07'];
    assert.strictEqual(cell.hasForm, true, 'shell form vẫn tồn tại trong checklist_monthly_forms - không bị ẩn đi');
    assert.strictEqual(cell.selfTotalScore, null);
    assert.strictEqual(cell.reviewTotalScore, null);
    assert.strictEqual(cell.finalScore, 0, 'Điểm cuối PHẢI lấy monthly_result=0, không phải form.final_score (null)');
  });

  await record('G: monthly_result KHÔNG tồn tại cho employee/month (PHF060/07, workflow live thật đã khóa) -> hành vi cũ giữ nguyên, finalScore=form.final_score', () => {
    const cell = p060.periods['2026-07'];
    assert.strictEqual(cell.resultState, null, 'không có monthly_result -> resultState null, không bị hotfix đụng vào');
    assert.strictEqual(cell.finalScore, 91.33);
    assert.strictEqual(cell.selfTotalScore, 90);
    assert.strictEqual(cell.reviewTotalScore, 92);
  });

  await record('G2: tháng hoàn toàn không có form và không có monthly_result -> hasForm=false, mọi điểm null như hành vi cũ (không regression)', () => {
    const cell = p060.periods['2026-01'];
    assert.strictEqual(cell.hasForm, false);
    assert.strictEqual(cell.resultState, null);
    assert.strictEqual(cell.finalScore, null);
  });

  await record('J: permission/scope không regression - Manager (view_scope=department Bộ phận bán hàng) vẫn chỉ thấy đúng phạm vi, monthly_result không mở rộng quyền', async () => {
    const mgrResult = await reportsLib.getChecklistScorePeriodReport(MANAGER_SESSION, { fromMonth: '2026-01', toMonth: '2026-07' });
    assert.ok(mgrResult.employees.every(e => ['PHF084', 'PHF018', 'PHF091', 'PHF092', 'PHF060'].includes(e.employeeCode)));
    assert.strictEqual(mgrResult.employees.length, 5, 'manager thấy đúng 5 người trong phạm vi department - không ai bị lộ/ẩn sai do hotfix');
  });

  await record('K: không N+1 - đúng 1 câu query checklist_monthly_results cho toàn bộ range/nhân viên', async () => {
    queryLog.length = 0;
    await reportsLib.getChecklistScorePeriodReport(ADMIN_SESSION, { fromMonth: '2026-01', toMonth: '2026-07' });
    assert.strictEqual(queryLog.filter(t => t === 'checklist_monthly_results').length, 1, 'chỉ 1 query monthly_results, không lặp theo nhân viên/kỳ');
    assert.strictEqual(queryLog.filter(t => t === 'checklist_monthly_forms').length, 1, 'forms vẫn chỉ 1 query như cũ');
    assert.strictEqual(queryLog.filter(t => t === 'checklist_violation_records').length, 1, 'violations vẫn chỉ 1 query như cũ');
  });

  const passed = results.filter(r => r.pass).length, total = results.length;
  console.log('\n' + passed + '/' + total + ' bước PASS.');
  if (passed !== total) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
