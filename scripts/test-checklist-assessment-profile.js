'use strict';
/*
 * Regression Test
 * Checklist Monthly — getChecklistAssessmentProfile (UX-01 Batch 1 + Batch 2)
 * In-memory only
 * No Production Database
 * Safe for future verification
 *
 * BATCH 1 (self-view): tiêu chuẩn kỳ đã có phiếu đọc đúng template_snapshot (không
 * đọc active template/current_version), kỳ chưa có phiếu trả "expected" bằng đúng
 * logic effective_date, chưa có assignment trả "unassigned", điểm kỳ hiện tại dùng
 * đúng withScoreSummary()/refreshUnlockedChecklistScore() hiện có (không tính công
 * thức riêng, không lộ điểm giả khi chưa nhập), lịch sử năm chỉ thống kê
 * reviewed/locked, IDOR bị chặn (targetEmployeeCode từ client bị learner gửi lên bị
 * bỏ qua hoàn toàn), một phần lỗi (history, hoặc currentScore sau khi standard đã
 * đọc xong) không được kéo theo làm mất phần còn lại đã đọc thành công.
 *
 * BATCH 2 (quản lý xem người trong phạm vi): capability nguồn chuẩn view_monthly,
 * tra cứu strict (không OR view_reports/view_violations/record_violation, không
 * fallback active[0]); scope matching qua subjectMatchesScope() thật (không mock);
 * Learner/Admin luôn bị ép self dù truyền target; target ngoài scope -> 403; target
 * không tồn tại -> 404; targetEmployeeCode/targetEmployeeId mismatch -> 400; grant bị
 * revoke -> 403 ngay lần gọi kế tiếp; allowedTargets chỉ chứa self + người trong
 * scope; toàn bộ response (target/standard/currentScore/history) phải cùng 1 người
 * khi xem người khác — không lẫn dữ liệu của viewer.
 *
 * Toàn bộ chạy trên dữ liệu mock trong bộ nhớ. Từ Batch 2 trở đi, lib/checklist-
 * permissions.js được để LOAD THẬT (không còn thay bằng object giả) — chỉ chặn
 * @supabase/supabase-js bằng Module._load — để getChecklistMonthlyViewAccess() và
 * subjectMatchesScope() chạy đúng business logic thật, đúng yêu cầu "phải exercise
 * business function thật, không mock response cố định". KHÔNG kết nối Supabase thật,
 * KHÔNG đổi logic nghiệp vụ nào trong lib/checklist-monthly.js hay
 * lib/checklist-permissions.js.
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
const P_TARGET = YEAR + '-09'; // dùng cho test Target Data Truth (Batch 2)

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
    form('f-p6', P6, 'draft', { self_answers: {} }),
    // Batch 2 — Target Data Truth: phiếu của NV002 (không phải của viewer TL01) để
    // xác nhận currentScore/history trả đúng người bị xem, không lẫn dữ liệu viewer.
    Object.assign(form('f-nv002-target', P_TARGET, 'reviewed', {
      self_answers: { 'MAN-C1': { value: '8' } }, review_answers: { 'MAN-C1': { value: '7' } },
      self_total_score: 80, review_total_score: 75, final_score: 77, score_formula_version: 'persisted-test',
      template_id: 'tpl-y', template_version: 'Y-1.0',
      template_snapshot: { template: { template_key: 'tpl-y', code: 'TPL-Y', name: 'Mẫu Y', department: 'Sales' }, version: { version_no: 'Y-1.0', effective_date: '2020-01-01', definition: definition() } }
    }), { employee_id: 'id-nv002', employee_code: 'NV002', employee_name: 'Nhân Viên 2', department: 'Sales', title: 'NV Bán Hàng', branch: 'Phú Lợi' })
  ],
  checklist_employee_assignments: [
    // NV001 chỉ có form (Batch 1) nhưng Batch 2 cần dòng phân công thật để tra cứu
    // existence-check khi quản lý khác truyền targetEmployeeCode=NV001.
    { employee_key: 'nv001', employee_id: 'id-nv001', employee_code: 'NV001', employee_name: 'Nhân Viên 1', department: 'Sales', title: 'NV Bán Hàng', branch: 'Phú Lợi', manager_id: 'id-ql1', manager_code: 'QL1', manager_name: 'Quản Lý 1', employee_status: 'Đang làm việc', template_id: 'tpl-x', template_version: '', effective_date: '2020-01-01', updated_at: NOW_ISO },
    { employee_key: 'nv002', employee_id: 'id-nv002', employee_code: 'NV002', employee_name: 'Nhân Viên 2', department: 'Sales', title: 'NV Bán Hàng', branch: 'Phú Lợi', manager_id: 'id-ql1', manager_code: 'QL1', manager_name: 'Quản Lý 1', employee_status: 'Đang làm việc', template_id: 'tpl-y', template_version: '', effective_date: '2021-01-01', updated_at: NOW_ISO },
    // Batch 2 — persona/scope test fixtures.
    { employee_key: 'nv010', employee_id: 'id-nv010', employee_code: 'NV010', employee_name: 'NV Bán Hàng 10', department: 'Bộ phận bán hàng', title: 'NV', branch: 'Phú Lợi', manager_id: 'id-ql01', manager_code: 'QL01', manager_name: 'Quản Lý Trực Tiếp', employee_status: 'Đang làm việc', template_id: '', template_version: '', effective_date: '2021-01-01', updated_at: NOW_ISO },
    { employee_key: 'nv011', employee_id: 'id-nv011', employee_code: 'NV011', employee_name: 'NV Bán Hàng 11', department: 'Bộ phận bán hàng', title: 'NV', branch: 'Ngô Quyền', manager_id: 'id-mgr2', manager_code: 'MGR2', manager_name: 'Quản Lý Khác', employee_status: 'Đang làm việc', template_id: '', template_version: '', effective_date: '2021-01-01', updated_at: NOW_ISO },
    { employee_key: 'nv012', employee_id: 'id-nv012', employee_code: 'NV012', employee_name: 'NV Kho 12', department: 'Kho', title: 'NV', branch: 'Phú Lợi', manager_id: 'id-mgr3', manager_code: 'MGR3', manager_name: 'Quản Lý Kho', employee_status: 'Đang làm việc', template_id: '', template_version: '', effective_date: '2021-01-01', updated_at: NOW_ISO },
    { employee_key: 'nv020', employee_id: 'id-nv020', employee_code: 'NV020', employee_name: 'NV Marketing 20', department: 'Marketing', title: 'NV', branch: 'Phú Lợi', manager_id: 'id-mgr4', manager_code: 'MGR4', manager_name: 'Quản Lý Marketing', employee_status: 'Đang làm việc', template_id: '', template_version: '', effective_date: '2021-01-01', updated_at: NOW_ISO },
    { employee_key: 'nv030', employee_id: 'id-nv030', employee_code: 'NV030', employee_name: 'NV Danh Sách 30', department: 'Online', title: 'NV', branch: 'Phú Lợi', manager_id: 'id-mgr5', manager_code: 'MGR5', manager_name: 'Quản Lý Online', employee_status: 'Đang làm việc', template_id: '', template_version: '', effective_date: '2021-01-01', updated_at: NOW_ISO },
    { employee_key: 'nv032', employee_id: 'id-nv032', employee_code: 'NV032', employee_name: 'NV Danh Sách 32', department: 'Online', title: 'NV', branch: 'Phú Lợi', manager_id: 'id-mgr5', manager_code: 'MGR5', manager_name: 'Quản Lý Online', employee_status: 'Đang làm việc', template_id: '', template_version: '', effective_date: '2021-01-01', updated_at: NOW_ISO }
  ],
  checklist_employee_assignment_history: [],
  checklist_permission_grants: [
    { id: 'grant-ql01', account_id: 'id-ql01', employee_code: 'QL01', preset_code: 'QUAN_LY_TRUC_TIEP', capabilities: { view_monthly: true, view_violations: true, view_reports: true, export_data: false, review_monthly: true, record_violation: false }, view_scope: { type: 'direct_reports', values: [] }, review_scope: { type: 'direct_reports', values: [] }, record_scope: { type: 'none', values: [] }, export_scope: { type: 'none', values: [] }, effective_from: '2020-01-01', effective_to: null, is_active: true, updated_at: NOW_ISO },
    { id: 'grant-tc01', account_id: 'id-tc01', employee_code: 'TC01', preset_code: 'TRUONG_CA_BH', capabilities: { view_monthly: true, view_violations: true, view_reports: true, export_data: true, review_monthly: true, record_violation: true }, view_scope: { type: 'department_branch', values: ['department::Bộ phận bán hàng', 'branch::Lái Thiêu', 'branch::Ngô Quyền', 'branch::Phú Lợi'] }, review_scope: { type: 'direct_reports', values: [] }, record_scope: { type: 'department_branch', values: ['department::Bộ phận bán hàng', 'branch::Lái Thiêu', 'branch::Ngô Quyền', 'branch::Phú Lợi'] }, export_scope: { type: 'department_branch', values: ['department::Bộ phận bán hàng', 'branch::Lái Thiêu', 'branch::Ngô Quyền', 'branch::Phú Lợi'] }, effective_from: '2020-01-01', effective_to: null, is_active: true, updated_at: NOW_ISO },
    { id: 'grant-tb01', account_id: 'id-tb01', employee_code: 'TB01', preset_code: 'TRUONG_BO_PHAN', capabilities: { view_monthly: true, view_violations: true, view_reports: true, export_data: true, review_monthly: true, record_violation: true }, view_scope: { type: 'department', values: ['Marketing'] }, review_scope: { type: 'department', values: ['Marketing'] }, record_scope: { type: 'department', values: ['Marketing'] }, export_scope: { type: 'department', values: ['Marketing'] }, effective_from: '2020-01-01', effective_to: null, is_active: true, updated_at: NOW_ISO },
    { id: 'grant-tl01', account_id: 'id-tl01', employee_code: 'TL01', preset_code: 'TRO_LY_GD', capabilities: { view_monthly: true, view_violations: true, view_reports: true, export_data: true, review_monthly: true, record_violation: true }, view_scope: { type: 'all_company', values: [] }, review_scope: { type: 'all_company', values: [] }, record_scope: { type: 'all_company', values: [] }, export_scope: { type: 'all_company', values: [] }, effective_from: '2020-01-01', effective_to: null, is_active: true, updated_at: NOW_ISO },
    // Chỉ record_violation:true, view_monthly:false — NHƯNG view_scope vẫn để all_company
    // (đúng thực tế: view_scope không bị ép none theo capability lúc lưu). Đây chính là
    // "bẫy" active[0] fallback: nếu code lỡ dùng active[0]/OR record_violation sẽ PASS sai.
    { id: 'grant-nv099', account_id: 'id-nv099', employee_code: 'NV099', preset_code: 'TUY_CHINH', capabilities: { view_monthly: false, view_violations: false, view_reports: false, export_data: false, review_monthly: false, record_violation: true }, view_scope: { type: 'all_company', values: [] }, review_scope: { type: 'none', values: [] }, record_scope: { type: 'all_company', values: [] }, export_scope: { type: 'none', values: [] }, effective_from: '2020-01-01', effective_to: null, is_active: true, updated_at: NOW_ISO },
    // Quyền view_monthly + all_company nhưng ĐÃ BỊ THU HỒI (is_active:false).
    { id: 'grant-rv01', account_id: 'id-rv01', employee_code: 'RV01', preset_code: 'QUAN_LY_TRUC_TIEP', capabilities: { view_monthly: true, view_violations: true, view_reports: true, export_data: false, review_monthly: true, record_violation: false }, view_scope: { type: 'all_company', values: [] }, review_scope: { type: 'all_company', values: [] }, record_scope: { type: 'none', values: [] }, export_scope: { type: 'none', values: [] }, effective_from: '2020-01-01', effective_to: null, is_active: false, updated_at: NOW_ISO },
    { id: 'grant-em01', account_id: 'id-em01', employee_code: 'EM01', preset_code: 'TUY_CHINH', capabilities: { view_monthly: true, view_violations: false, view_reports: false, export_data: false, review_monthly: false, record_violation: false }, view_scope: { type: 'employees', values: ['NV030'] }, review_scope: { type: 'none', values: [] }, record_scope: { type: 'none', values: [] }, export_scope: { type: 'none', values: [] }, effective_from: '2020-01-01', effective_to: null, is_active: true, updated_at: NOW_ISO }
  ],
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
  // Parser tối giản cho đúng 2 dạng chuỗi .or() mà lib/checklist-permissions.js thực
  // tế dùng: "colA.eq.x,colB.eq.y" (OR nhiều field) và "col.is.null,col.gte.x" (null-hoặc-hạn).
  or(filterString) {
    const conditions = String(filterString).split(',').map(part => {
      const m = part.match(/^([a-zA-Z_]+)\.(eq|neq|is|gte|lte)\.(.*)$/);
      if (!m) return () => false;
      const col = m[1], op = m[2], rawVal = m[3];
      return row => {
        const val = row[col];
        if (op === 'is') return rawVal === 'null' ? (val == null) : String(val) === rawVal;
        if (op === 'eq') return String(val) === rawVal;
        if (op === 'neq') return String(val) !== rawVal;
        if (op === 'gte') return String(val) >= rawVal;
        if (op === 'lte') return String(val) <= rawVal;
        return false;
      };
    });
    this.filters.push(row => conditions.some(cond => cond(row)));
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
// Từ Batch 2: CHỈ chặn @supabase/supabase-js. lib/checklist-permissions.js được để
// require() THẬT (đọc dữ liệu qua cùng FakeQuery ở trên) để getChecklistMonthlyViewAccess()/
// subjectMatchesScope() chạy đúng code production, không phải bản giả lập hành vi.
const SUPABASE_JS = '@supabase/supabase-js';
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === SUPABASE_JS) {
    return { createClient: () => ({ from: (table) => new FakeQuery(table), rpc: (name, params) => fakeRpc(name, params) }) };
  }
  return originalLoad.apply(this, arguments);
};
const monthlyLib = require(path.join(__dirname, '..', 'lib', 'checklist-monthly.js'));
Module._load = originalLoad;

const NV001_SESSION = { role: 'learner', employeeCode: 'NV001', employeeId: 'id-nv001', account: { id: 'id-nv001', name: 'Nhân Viên 1' }, sub: 'id-nv001' };
const NV002_SESSION = { role: 'learner', employeeCode: 'NV002', employeeId: 'id-nv002', account: { id: 'id-nv002', name: 'Nhân Viên 2' }, sub: 'id-nv002' };
const NV003_SESSION = { role: 'learner', employeeCode: 'NV003', employeeId: 'id-nv003', account: { id: 'id-nv003', name: 'Nhân Viên 3' }, sub: 'id-nv003' };
const NO_IDENTITY_SESSION = { role: 'learner', account: { id: 'id-x' }, sub: 'id-x' };
// Batch 2 — persona sessions (session.role phải là 'manager' để có thể yêu cầu xem người khác).
const QLTT_SESSION = { role: 'manager', employeeCode: 'QL01', employeeId: 'id-ql01', account: { id: 'id-ql01', name: 'Quản Lý Trực Tiếp' }, sub: 'id-ql01' };
const TCBH_SESSION = { role: 'manager', employeeCode: 'TC01', employeeId: 'id-tc01', account: { id: 'id-tc01', name: 'Trưởng Ca Bán Hàng' }, sub: 'id-tc01' };
const TBP_SESSION = { role: 'manager', employeeCode: 'TB01', employeeId: 'id-tb01', account: { id: 'id-tb01', name: 'Trưởng Bộ Phận' }, sub: 'id-tb01' };
const TLGD_SESSION = { role: 'manager', employeeCode: 'TL01', employeeId: 'id-tl01', account: { id: 'id-tl01', name: 'Trợ Lý Giám Đốc' }, sub: 'id-tl01' };
const NOVM_SESSION = { role: 'manager', employeeCode: 'NV099', employeeId: 'id-nv099', account: { id: 'id-nv099', name: 'Quản Lý Chỉ Ghi Lỗi' }, sub: 'id-nv099' };
const REVOKED_SESSION = { role: 'manager', employeeCode: 'RV01', employeeId: 'id-rv01', account: { id: 'id-rv01', name: 'Quyền Đã Thu Hồi' }, sub: 'id-rv01' };
const EMP_SESSION = { role: 'manager', employeeCode: 'EM01', employeeId: 'id-em01', account: { id: 'id-em01', name: 'Quản Lý Theo Danh Sách' }, sub: 'id-em01' };
const NOGRANT_SESSION = { role: 'manager', employeeCode: 'NV098', employeeId: 'id-nv098', account: { id: 'id-nv098', name: 'Quản Lý Chưa Có Quyền' }, sub: 'id-nv098' };
const ADMIN_SESSION2 = { role: 'admin', employeeCode: 'AD01', employeeId: 'id-ad01', account: { id: 'id-ad01', name: 'Admin Test' }, sub: 'id-ad01' };
const LEARNER2_SESSION = { role: 'learner', employeeCode: 'NV010', employeeId: 'id-nv010', account: { id: 'id-nv010', name: 'NV Bán Hàng 10' }, sub: 'id-nv010' };

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

  // ======================= BATCH 2 — MANAGER TARGET =======================

  await record('BATCH2-A) Learner self regression: không truyền target vẫn thấy chính mình như Batch 1', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NV001_SESSION, { month: P1, year: YEAR });
    assert.strictEqual(res.target.employeeCode, 'NV001');
    assert.strictEqual(res.isSelf, true);
    assert.deepStrictEqual(res.allowedTargets.map(t => t.employeeCode), ['NV001'], 'Learner chỉ có self trong allowedTargets.');
  });

  await record('BATCH2-B) Learner truyền target khác: vẫn bị ép self, không lộ dữ liệu người khác', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(LEARNER2_SESSION, { month: P1, year: YEAR, targetEmployeeCode: 'NV001', targetEmployeeId: 'id-nv001' });
    assert.strictEqual(res.target.employeeCode, 'NV010', 'targetEmployeeCode/Id learner gửi lên phải bị bỏ qua hoàn toàn.');
    assert.strictEqual(res.isSelf, true);
  });

  await record('BATCH2-C) Manager tự xem mình (không truyền target) -> PASS kể cả không có grant', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(QLTT_SESSION, {});
    assert.strictEqual(res.target.employeeCode, 'QL01');
    assert.strictEqual(res.isSelf, true);
  });

  await record('BATCH2-D) QUAN_LY_TRUC_TIEP: direct report PASS, ngoài scope 403', async () => {
    const ok = await monthlyLib.getChecklistAssessmentProfile(QLTT_SESSION, { targetEmployeeCode: 'NV010' });
    assert.strictEqual(ok.target.employeeCode, 'NV010');
    assert.strictEqual(ok.isSelf, false);
    await expectFail(monthlyLib.getChecklistAssessmentProfile(QLTT_SESSION, { targetEmployeeCode: 'NV011' }), 'CHECKLIST_ASSESSMENT_VIEW_SCOPE_FORBIDDEN');
  });

  await record('BATCH2-E) TRUONG_CA_BH tagged department_branch: trong phạm vi PASS, Kho ngoài phạm vi 403', async () => {
    const ok = await monthlyLib.getChecklistAssessmentProfile(TCBH_SESSION, { targetEmployeeCode: 'NV010' });
    assert.strictEqual(ok.target.employeeCode, 'NV010');
    const ok2 = await monthlyLib.getChecklistAssessmentProfile(TCBH_SESSION, { targetEmployeeCode: 'NV011' });
    assert.strictEqual(ok2.target.employeeCode, 'NV011', 'NV011 (Ngô Quyền) vẫn trong 3 chi nhánh được tag.');
    await expectFail(monthlyLib.getChecklistAssessmentProfile(TCBH_SESSION, { targetEmployeeCode: 'NV012' }), 'CHECKLIST_ASSESSMENT_VIEW_SCOPE_FORBIDDEN');
  });

  await record('BATCH2-F) TRUONG_BO_PHAN: đúng phòng ban PASS, phòng ban khác 403', async () => {
    const ok = await monthlyLib.getChecklistAssessmentProfile(TBP_SESSION, { targetEmployeeCode: 'NV020' });
    assert.strictEqual(ok.target.employeeCode, 'NV020');
    await expectFail(monthlyLib.getChecklistAssessmentProfile(TBP_SESSION, { targetEmployeeCode: 'NV012' }), 'CHECKLIST_ASSESSMENT_VIEW_SCOPE_FORBIDDEN');
  });

  await record('BATCH2-G) TRO_LY_GD all_company: xem được mọi nhân sự hợp lệ', async () => {
    for (const code of ['NV001', 'NV010', 'NV011', 'NV012', 'NV020']) {
      const res = await monthlyLib.getChecklistAssessmentProfile(TLGD_SESSION, { targetEmployeeCode: code });
      assert.strictEqual(res.target.employeeCode, code);
    }
  });

  await record('BATCH2-H) Manager chỉ có record_violation (view_monthly=false) dù view_scope=all_company vẫn KHÔNG xem được người khác', async () => {
    await expectFail(monthlyLib.getChecklistAssessmentProfile(NOVM_SESSION, { targetEmployeeCode: 'NV001' }), 'CHECKLIST_ASSESSMENT_VIEW_SCOPE_FORBIDDEN');
    const self = await monthlyLib.getChecklistAssessmentProfile(NOVM_SESSION, {});
    assert.strictEqual(self.target.employeeCode, 'NV099', 'Vẫn xem được chính mình dù không có view_monthly.');
  });

  await record('BATCH2-I) view_scope type=employees: đúng danh sách PASS, ngoài danh sách 403', async () => {
    const ok = await monthlyLib.getChecklistAssessmentProfile(EMP_SESSION, { targetEmployeeCode: 'NV030' });
    assert.strictEqual(ok.target.employeeCode, 'NV030');
    await expectFail(monthlyLib.getChecklistAssessmentProfile(EMP_SESSION, { targetEmployeeCode: 'NV032' }), 'CHECKLIST_ASSESSMENT_VIEW_SCOPE_FORBIDDEN');
  });

  await record('BATCH2-J) Target Data Truth: xem NV002 thì mọi phần response đều là NV002, không lẫn dữ liệu viewer (TL01)', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(TLGD_SESSION, { targetEmployeeCode: 'NV002', month: P_TARGET, year: YEAR });
    assert.strictEqual(res.target.employeeCode, 'NV002');
    assert.strictEqual(res.target.department, 'Sales');
    assert.strictEqual(res.target.branch, 'Phú Lợi');
    assert.strictEqual(res.standard.status, 'ok');
    assert.strictEqual(res.standard.data.templateVersion, 'Y-1.0', 'Standard phải là mẫu/version của NV002 (tpl-y), không phải của TL01 (không có phiếu nào).');
    assert.strictEqual(res.currentScore.status, 'official');
    assert.strictEqual(res.currentScore.data.finalScore, 77, 'Điểm phải là điểm thật của NV002 (77), không phải suy ra/lẫn từ viewer.');
  });

  await record('BATCH2-K) Grant vừa bị thu hồi (is_active=false): xem người khác 403, tự xem mình vẫn PASS', async () => {
    await expectFail(monthlyLib.getChecklistAssessmentProfile(REVOKED_SESSION, { targetEmployeeCode: 'NV001' }), 'CHECKLIST_ASSESSMENT_VIEW_SCOPE_FORBIDDEN');
    const self = await monthlyLib.getChecklistAssessmentProfile(REVOKED_SESSION, {});
    assert.strictEqual(self.target.employeeCode, 'RV01');
  });

  await record('BATCH2-L) Target không tồn tại: 404 rõ ràng, không silent empty', async () => {
    await expectFail(monthlyLib.getChecklistAssessmentProfile(QLTT_SESSION, { targetEmployeeCode: 'NOPE999' }), 'CHECKLIST_ASSESSMENT_TARGET_NOT_FOUND');
  });

  await record('BATCH2-M) targetEmployeeCode và targetEmployeeId không khớp nhau (id là chuỗi rác): reject, không tự chọn field thuận lợi hơn', async () => {
    await expectFail(monthlyLib.getChecklistAssessmentProfile(QLTT_SESSION, { targetEmployeeCode: 'NV010', targetEmployeeId: 'id-someone-else' }), 'CHECKLIST_ASSESSMENT_TARGET_IDENTITY_MISMATCH');
  });

  await record('BATCH2-M2) targetEmployeeCode và targetEmployeeId trỏ tới HAI NGƯỜI THẬT khác nhau: vẫn phải reject, không lấy nhầm người theo id', async () => {
    // NV010 (code) và NV011 (id thật của một nhân viên khác) đều tồn tại thật trong hệ
    // thống — nếu code lỡ "chọn field thuận lợi hơn" (vd ưu tiên id khi id resolve ra một
    // người khác vẫn nằm trong scope), NV011 sẽ bị lộ nhầm cho quản lý dưới danh nghĩa NV010.
    await expectFail(monthlyLib.getChecklistAssessmentProfile(TCBH_SESSION, { targetEmployeeCode: 'NV010', targetEmployeeId: 'id-nv011' }), 'CHECKLIST_ASSESSMENT_TARGET_IDENTITY_MISMATCH');
  });

  await record('BATCH2-Q) Chỉ truyền targetEmployeeId (không kèm code): vẫn tra cứu và authorize đúng người', async () => {
    const ok = await monthlyLib.getChecklistAssessmentProfile(QLTT_SESSION, { targetEmployeeId: 'id-nv010' });
    assert.strictEqual(ok.target.employeeCode, 'NV010', 'Phải resolve đúng người qua employee_id khi không có code.');
    assert.strictEqual(ok.isSelf, false);
    // NV011 không phải direct report của QL01 — phải 403 dù tra theo id, không chỉ theo code.
    await expectFail(monthlyLib.getChecklistAssessmentProfile(QLTT_SESSION, { targetEmployeeId: 'id-nv011' }), 'CHECKLIST_ASSESSMENT_VIEW_SCOPE_FORBIDDEN');
  });

  await record('BATCH2-N) allowedTargets: đúng tập (self + direct reports thật), không lẫn người ngoài scope', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(QLTT_SESSION, {});
    const codes = res.allowedTargets.map(t => t.employeeCode).sort();
    assert.deepStrictEqual(codes, ['NV010', 'QL01'], 'Chỉ self (QL01) và direct report thật (NV010) — không NV011/NV012/NV020.');
    assert.strictEqual(res.allowedTargets.find(t => t.employeeCode === 'NV010').department, 'Bộ phận bán hàng', 'allowedTargets phải có đủ department/title/branch tối thiểu.');
    assert.ok(!('grant' in res), 'Response không được lộ grant.');
    assert.ok(!('viewScope' in res), 'Response không được lộ scope.');
  });

  await record('BATCH2-O) Manager chưa có bất kỳ grant nào: vẫn tự xem mình được, không throw', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(NOGRANT_SESSION, {});
    assert.strictEqual(res.target.employeeCode, 'NV098');
    assert.deepStrictEqual(res.allowedTargets.map(t => t.employeeCode), ['NV098']);
  });

  await record('BATCH2-P) Admin không được tự động mở quyền xem người khác qua UX này (không mở âm thầm chỉ vì role cao)', async () => {
    const res = await monthlyLib.getChecklistAssessmentProfile(ADMIN_SESSION2, { targetEmployeeCode: 'NV001' });
    assert.strictEqual(res.target.employeeCode, 'AD01', 'Admin vẫn chỉ thấy chính mình qua endpoint này ở Batch 2, không tự có quyền xem NV001.');
    assert.strictEqual(res.isSelf, true);
  });

  console.log('\n=== Kết quả ===');
  const passed = results.filter(r => r.pass).length;
  console.log(passed + '/' + results.length + ' bước PASS.');
  console.log('\nToàn bộ chạy trên mock trong bộ nhớ — không có ghi nào xuống database thật.');
  console.log('Chạy thủ công khi cần: node scripts/test-checklist-assessment-profile.js');

  if (results.some(r => !r.pass)) process.exitCode = 1;
}

main().catch(err => { console.error('LỖI KHÔNG MONG ĐỢI:', err); process.exitCode = 1; });
