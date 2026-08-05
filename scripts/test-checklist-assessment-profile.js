'use strict';
/*
 * Regression Test
 * Checklist Monthly — getChecklistAssessmentProfile (UX-01 Batch 1, self-view only)
 * In-memory only
 * No Production Database
 * Safe for future verification
 *
 * Kiểm tra getChecklistAssessmentProfile (lib/checklist-monthly.js) — API nền cho
 * "Hồ sơ đánh giá của tôi": tiêu chuẩn kỳ đã có phiếu đọc đúng template_snapshot
 * (không đọc active template/current_version), kỳ chưa có phiếu trả "expected"
 * bằng đúng logic effective_date, chưa có assignment trả "unassigned", điểm kỳ
 * hiện tại dùng đúng withScoreSummary()/refreshUnlockedChecklistScore() hiện có
 * (không tính công thức riêng, không lộ điểm giả khi chưa nhập), lịch sử năm chỉ
 * thống kê reviewed/locked, IDOR bị chặn (targetEmployeeCode từ client bị bỏ qua
 * hoàn toàn), và một phần lỗi (history, hoặc currentScore sau khi standard đã
 * đọc xong) không được kéo theo làm mất phần còn lại đã đọc thành công.
 *
 * Toàn bộ chạy trên dữ liệu mock trong bộ nhớ (chặn @supabase/supabase-js và
 * lib/checklist-permissions bằng Module._load theo đường dẫn thật), KHÔNG kết nối
 * Supabase thật, KHÔNG đổi logic nghiệp vụ nào trong lib/checklist-monthly.js.
 *
 * File này KHÔNG được gọi tự động ở bất kỳ đâu — chỉ chạy thủ công:
 *   node scripts/test-checklist-assessment-profile.js
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

const YEAR = String(new Date().getUTCFullYear());
const NOW_ISO = new Date().toISOString();
const P1 = YEAR + '-01'; // reviewed, snapshot version cũ 1.3 trong khi mẫu current_version đã là 1.4
const P2 = YEAR + '-02'; // locked
const P3 = YEAR + '-03'; // waiting_review, đã nộp tự đánh giá, thẩm định chưa bắt đầu
const P4 = YEAR + '-04'; // waiting_self, chưa nhập gì
const P5 = YEAR + '-05'; // waiting_self, đã nhập một phần
const P6 = YEAR + '-06'; // draft, chưa mở cho nhân viên
const P_EXPECTED = YEAR + '-08'; // chưa có phiếu, có assignment/version hợp lệ

function definition() {
  return {
    totalRows: [
      ['1', 'AUTO-C1', 'Tuân thủ Checklist', '100', '%', 50, '', 'Checklist'],
      ['2', 'MAN-C1', 'Thái độ làm việc', '10', 'điểm', 50, '', 'Nhập đánh giá']
    ]
  };
}
function snapshotFor(versionNo, effectiveDate) {
  return { template: { template_key: 'tpl-x', code: 'TPL-X', name: 'Mẫu X', department: 'Sales' }, version: { version_no: versionNo, effective_date: effectiveDate, definition: definition() } };
}
function form(id, periodMonth, status, extra) {
  return Object.assign({
    id, period_month: periodMonth, status,
    employee_id: 'id-nv001', employee_code: 'NV001', employee_name: 'Nhân Viên 1',
    department: 'Sales', title: 'NV Bán Hàng', branch: 'Phú Lợi',
    reviewer_id: 'id-ql1', reviewer_code: 'QL1', reviewer_name: 'Quản Lý 1',
    template_id: 'tpl-x', template_version: '1.3', template_snapshot: snapshotFor('1.3', '2020-01-01'),
    checklist_score: 100, self_answers: {}, review_answers: {}, updated_at: NOW_ISO
  }, extra);
}

// ---------- 1. Dữ liệu mock ----------
const store = {
  checklist_monthly_forms: [
    form('f-p1', P1, 'reviewed', { self_answers: { 'MAN-C1': { value: '9' } }, review_answers: { 'MAN-C1': { value: '9' } }, self_total_score: 95, review_total_score: 95, final_score: 95, score_formula_version: 'persisted-test' }),
    form('f-p2', P2, 'locked', { self_answers: { 'MAN-C1': { value: '8' } }, review_answers: { 'MAN-C1': { value: '9' } }, self_total_score: 90, review_total_score: 95, final_score: 87, score_formula_version: 'persisted-test' }),
    form('f-p3', P3, 'waiting_review', { self_answers: { 'MAN-C1': { value: '8' } }, self_submitted_at: NOW_ISO, review_answers: {} }),
    form('f-p4', P4, 'waiting_self', { self_answers: {} }),
    form('f-p5', P5, 'waiting_self', { self_answers: { 'MAN-C1': { value: '5' } } }),
    form('f-p6', P6, 'draft', { self_answers: {} })
  ],
  checklist_employee_assignments: [
    { employee_key: 'nv002', employee_id: 'id-nv002', employee_code: 'NV002', employee_name: 'Nhân Viên 2', department: 'Sales', title: 'NV Bán Hàng', branch: 'Phú Lợi', manager_id: 'id-ql1', manager_code: 'QL1', manager_name: 'Quản Lý 1', employee_status: 'Đang làm việc', template_id: 'tpl-y', template_version: '', effective_date: '2021-01-01', updated_at: NOW_ISO }
  ],
  checklist_employee_assignment_history: [],
  checklist_templates: [
    { template_key: 'tpl-x', code: 'TPL-X', name: 'Mẫu X', current_version: '1.4', status: 'active', effective_date: '2020-01-01', updated_at: NOW_ISO },
    { template_key: 'tpl-y', code: 'TPL-Y', name: 'Mẫu Y', current_version: 'Y-2.0', status: 'active', effective_date: '2020-01-01', updated_at: NOW_ISO }
  ],
  checklist_template_versions: [
    { template_key: 'tpl-x', version_no: '1.3', effective_date: '2020-01-01', created_at: '2020-01-01T00:00:00.000Z', definition: definition() },
    { template_key: 'tpl-x', version_no: '1.4', effective_date: YEAR + '-07-01', created_at: YEAR + '-07-01T00:00:00.000Z', definition: definition() },
    { template_key: 'tpl-y', version_no: 'Y-1.0', effective_date: '2020-01-01', created_at: '2020-01-01T00:00:00.000Z', definition: definition() },
    { template_key: 'tpl-y', version_no: 'Y-2.0', effective_date: YEAR + '-12-31', created_at: YEAR + '-12-31T00:00:00.000Z', definition: definition() }
  ],
  checklist_violation_records: []
};

// ---------- 2. Fake Supabase query builder ----------
let forceHistoryError = false;
let forceScoreError = false;
class FakeQuery {
  constructor(table) { this.table = table; this.filters = []; this._limit = null; this._single = null; this._operation = 'read'; this._payload = null; this._usedRange = false; }
  select() { return this; }
  update(payload) { this._operation = 'update'; this._payload = clone(payload); return this; }
  insert(payload) { this._operation = 'insert'; this._payload = clone(payload); return this; }
  eq(col, val) { this.filters.push(row => String(row[col]) === String(val)); return this; }
  neq(col, val) { this.filters.push(row => String(row[col]) !== String(val)); return this; }
  in(col, vals) { this.filters.push(row => vals.includes(row[col])); return this; }
  gte(col, val) { this._usedRange = true; this.filters.push(row => String(row[col]) >= String(val)); return this; }
  lte(col, val) { this._usedRange = true; this.filters.push(row => String(row[col]) <= String(val)); return this; }
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
    // Chỉ dùng để cô lập lỗi test-case J: history query trên checklist_monthly_forms
    // dùng gte/lte theo khoảng period_month, còn resolveAssessmentStandard's form
    // lookup dùng eq() đơn — nhờ vậy tách được lỗi giả lập chỉ ảnh hưởng lịch sử.
    if (forceHistoryError && this.table === 'checklist_monthly_forms' && this._usedRange) {
      return Promise.resolve({ data: null, error: { message: 'forced test error' } }).then(resolve, reject);
    }
    if (forceScoreError && this.table === 'checklist_violation_records') {
      return Promise.resolve({ data: null, error: { message: 'forced test error' } }).then(resolve, reject);
    }
    if (this._operation === 'update') {
      const source = store[this.table] || [], updated = [];
      source.forEach(row => { if (this.filters.every(f => f(row))) { Object.assign(row, clone(this._payload)); updated.push(clone(row)); } });
      const data = this._single ? (updated[0] || null) : updated;
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    }
    const rows = this._rows();
    if (this._single === 'maybe') return Promise.resolve({ data: rows[0] || null, error: null }).then(resolve, reject);
    if (this._single === 'strict') return Promise.resolve(rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'No rows found' } }).then(resolve, reject);
    return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
  }
}
async function fakeRpc(name) { return { data: null, error: { message: 'RPC không được mock: ' + name } }; }

// ---------- 3. Chặn require() theo đường dẫn thật ----------
const ROOT = path.join(__dirname, '..');
const SUPABASE_JS = '@supabase/supabase-js';
const PERMISSIONS_PATH = path.join(ROOT, 'lib', 'checklist-permissions.js');
const originalLoad = Module._load;
const originalResolve = Module._resolveFilename;
Module._load = function (request, parent, isMain) {
  if (request === SUPABASE_JS) {
    return { createClient: () => ({ from: (table) => new FakeQuery(table), rpc: (name, params) => fakeRpc(name, params) }) };
  }
  if (request !== '.' && request !== '..' && /[\/\\]/.test(request)) {
    try { if (originalResolve.call(Module, request, parent, isMain) === PERMISSIONS_PATH) return { async getChecklistExportAccess() { return { role: 'admin', people: [] }; }, async getChecklistMonthlyReviewAccess() { return { grant: null, canReview: false, people: [] }; } }; } catch (e) {}
  }
  return originalLoad.apply(this, arguments);
};
const monthlyLib = require(path.join(__dirname, '..', 'lib', 'checklist-monthly.js'));
Module._load = originalLoad;

const NV001_SESSION = { role: 'learner', employeeCode: 'NV001', employeeId: 'id-nv001', account: { id: 'id-nv001', name: 'Nhân Viên 1' }, sub: 'id-nv001' };
const NV002_SESSION = { role: 'learner', employeeCode: 'NV002', employeeId: 'id-nv002', account: { id: 'id-nv002', name: 'Nhân Viên 2' }, sub: 'id-nv002' };
const NV003_SESSION = { role: 'learner', employeeCode: 'NV003', employeeId: 'id-nv003', account: { id: 'id-nv003', name: 'Nhân Viên 3' }, sub: 'id-nv003' };
const NO_IDENTITY_SESSION = { role: 'learner', account: { id: 'id-x' }, sub: 'id-x' };

// ---------- 4. Bộ chạy test ----------
const results = [];
async function record(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('✓ PASS -', name); }
  catch (err) { results.push({ name, pass: false }); console.log('✗ FAIL -', name, '\n   ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n   ') : err)); }
}
async function expectFail(promise, codeSubstring) {
  try { await promise; throw new Error('Lẽ ra phải fail nhưng lại thành công.'); }
  catch (err) {
    if (err.message === 'Lẽ ra phải fail nhưng lại thành công.') throw err;
    assert.ok(String(err.code || '').includes(codeSubstring) || String(err.message || '').includes(codeSubstring), 'Sai mã lỗi. Nhận được: ' + (err.code || err.message));
  }
}

async function main() {
  console.log('=== Regression test: getChecklistAssessmentProfile (mock, không đụng Supabase thật) ===\n');
  console.log('Năm dùng để test: ' + YEAR + '\n');

  await record('A) Phiếu reviewed: đọc đúng snapshot, final_score persisted, tính vào thống kê', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P1, year: YEAR });
    assert.strictEqual(res.standard.status, 'ok');
    assert.strictEqual(res.standard.data.templateVersion, '1.3', 'Kỳ cũ phải giữ snapshot 1.3, không được đọc current_version 1.4 của mẫu.');
    assert.strictEqual(res.currentScore.status, 'official');
    assert.deepStrictEqual([res.currentScore.data.selfTotalScore, res.currentScore.data.reviewTotalScore, res.currentScore.data.finalScore], [95, 95, 95]);
    assert.strictEqual(res.currentScore.data.persisted, true);
  });

  await record('B) Phiếu locked: đọc đúng snapshot, tính vào thống kê', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P2, year: YEAR });
    assert.strictEqual(res.standard.status, 'ok');
    assert.strictEqual(res.currentScore.status, 'locked');
    assert.deepStrictEqual([res.currentScore.data.selfTotalScore, res.currentScore.data.reviewTotalScore, res.currentScore.data.finalScore], [90, 95, 87]);
  });

  await record('C) waiting_review: hiển thị điểm tự đánh giá thật, KHÔNG lộ điểm thẩm định giả khi chưa bắt đầu', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P3, year: YEAR });
    assert.strictEqual(res.currentScore.status, 'pending');
    assert.strictEqual(res.currentScore.data.selfTotalScore, 90, 'Tự đánh giá đã nộp đầy đủ nên phải là số thật (90), không phải null.');
    assert.strictEqual(res.currentScore.data.reviewTotalScore, null, 'Thẩm định chưa nhập gì -> không được lộ điểm 50 tính giả từ answer rỗng.');
  });

  await record('D) waiting_self chưa nhập: not_started, không trả 0 giả', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P4, year: YEAR });
    assert.strictEqual(res.currentScore.status, 'not_started');
    assert.strictEqual(res.currentScore.data.selfTotalScore, null, 'Chưa nhập gì thì selfTotalScore phải null, không phải 0.');
  });

  await record('D2) waiting_self đã nhập một phần: available, điểm tạm thời thật', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P5, year: YEAR });
    assert.strictEqual(res.currentScore.status, 'available');
    assert.strictEqual(res.currentScore.data.selfTotalScore, 75);
  });

  await record('D3) draft: standard vẫn đọc được (đã có phiếu) nhưng currentScore = none, không trình bày như điểm chính thức', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P6, year: YEAR });
    assert.strictEqual(res.standard.status, 'ok');
    assert.strictEqual(res.currentScore.status, 'none');
    assert.strictEqual(res.currentScore.data, null);
  });

  await record('E) Kỳ chưa có phiếu nhưng có assignment/version hợp lệ: trả expected, KHÔNG lấy current_version, không tạo DB row', async () => {
    const beforeCount = store.checklist_monthly_forms.length;
    const res = await monthlyLib.getChecklistAssessmentProfile(NV002_SESSION, { month: P_EXPECTED, year: YEAR });
    assert.strictEqual(res.standard.status, 'expected');
    assert.strictEqual(res.standard.data.templateVersion, 'Y-1.0', 'Phải chọn version hiệu lực theo effective_date (Y-1.0), không phải current_version (Y-2.0) vốn chưa tới ngày hiệu lực.');
    assert.ok(String(res.standard.data.note || '').includes('Dự kiến áp dụng'));
    assert.strictEqual(res.currentScore.status, 'none');
    assert.strictEqual(store.checklist_monthly_forms.length, beforeCount, 'Không được insert phiếu thật khi chỉ xem trước.');
  });

  await record('F) Không có assignment: trả unassigned, không throw lỗi giả', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NV003_SESSION, { month: P_EXPECTED, year: YEAR });
    assert.strictEqual(res.standard.status, 'unassigned');
    assert.strictEqual(res.standard.data, null);
    assert.strictEqual(res.currentScore.status, 'none');
  });

  await record('G) Kỳ cũ (P1) giữ version 1.3 dù mẫu hiện tại đã có version 1.4 hiệu lực sau đó', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P1, year: YEAR });
    assert.strictEqual(res.standard.data.templateVersion, '1.3');
    assert.notStrictEqual(res.standard.data.templateVersion, '1.4');
  });

  await record('H) Lịch sử nhiều tháng: average/max/min/countedPeriods chỉ tính reviewed/locked', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P1, year: YEAR });
    assert.strictEqual(res.history.status, 'ok');
    assert.strictEqual(res.history.records.length, 6, 'Phải liệt kê đủ 6 kỳ trong năm kể cả waiting_self/waiting_review/draft.');
    assert.strictEqual(res.history.statistics.countedPeriods, 2, 'Chỉ P1 (reviewed) và P2 (locked) được tính thống kê.');
    assert.strictEqual(res.history.statistics.average, 91, '(95+87)/2 = 91.');
    assert.strictEqual(res.history.statistics.maximum, 95);
    assert.strictEqual(res.history.statistics.minimum, 87);
    const waitingRow = res.history.records.find(r => r.periodMonth === P4);
    assert.ok(waitingRow, 'waiting_self vẫn phải xuất hiện trong danh sách trạng thái.');
    assert.strictEqual(waitingRow.finalScore, null, 'waiting_self chưa có final_score chính thức.');
  });

  await record('I) IDOR: gửi targetEmployeeCode của người khác không xem được dữ liệu người khác', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P1, year: YEAR, targetEmployeeCode: 'NV002', targetEmployeeId: 'id-nv002' });
    assert.strictEqual(res.target.employeeCode, 'NV001', 'targetEmployeeCode từ client phải bị bỏ qua hoàn toàn.');
    assert.strictEqual(res.standard.data.templateVersion, '1.3', 'Phải vẫn là dữ liệu của chính NV001 (mẫu tpl-x/1.3), không phải của NV002 (tpl-y).');
  });

  await record('I2) Session không có employeeCode/employeeId hợp lệ: trả lỗi rõ ràng, không query mở rộng', async () => {
    await expectFail(monthlyLib.getChecklistAssessmentProfile(NO_IDENTITY_SESSION, { month: P1, year: YEAR }), 'CHECKLIST_MONTHLY_IDENTITY_REQUIRED');
  });

  await record('I3) Kỳ/năm không hợp lệ bị chặn trước khi query', async () => {
    await expectFail(monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: YEAR + '-13', year: YEAR }), 'CHECKLIST_MONTHLY_INVALID');
    await expectFail(monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P1, year: '99' }), 'CHECKLIST_ASSESSMENT_YEAR_INVALID');
  });

  await record('J) Lỗi query lịch sử KHÔNG làm mất phần tiêu chuẩn đã đọc được', async () => {
    forceHistoryError = true;
    try {
      const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P1, year: YEAR });
      assert.strictEqual(res.standard.status, 'ok', 'Standard phải vẫn trả được dù history lỗi.');
      assert.strictEqual(res.currentScore.status, 'official');
      assert.strictEqual(res.history.status, 'error', 'History phải tự báo lỗi riêng, không throw làm sập cả response.');
      assert.strictEqual(res.history.records.length, 0);
    } finally { forceHistoryError = false; }
  });

  await record('J2) Lỗi query điểm kỳ hiện tại KHÔNG được kéo theo làm mất standard đã đọc thành công', async () => {
    forceScoreError = true;
    try {
      const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P1, year: YEAR });
      assert.strictEqual(res.standard.status, 'ok', 'Standard đã đọc thành công trước đó thì không được bị currentScore lỗi kéo theo.');
      assert.strictEqual(res.standard.data.templateVersion, '1.3');
      assert.strictEqual(res.currentScore.status, 'none', 'currentScore lỗi thì rơi về none/data null, không throw làm sập cả response.');
      assert.strictEqual(res.currentScore.data, null);
    } finally { forceScoreError = false; }
  });

  console.log('\n=== Kết quả ===');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' bước PASS.');
  console.log('\nToàn bộ chạy trên mock trong bộ nhớ — không có ghi nào xuống database thật.');
  console.log('Chạy thủ công khi cần: node scripts/test-checklist-assessment-profile.js');

  if (results.some(r => !r.pass)) process.exitCode = 1;
}

main().catch(err => { console.error('LỖI KHÔNG MONG ĐỢI:', err); process.exitCode = 1; });
