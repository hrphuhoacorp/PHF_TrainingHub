'use strict';
/*
 * PHF Checklist — Annual Result Report "Cả năm" (Phase 2, 2026-08-18).
 * Backend regression cho getChecklistAnnualResultReport() (lib/checklist-
 * reports.js) - mock Supabase boundary, KHÔNG kết nối Production. Cùng kỹ
 * thuật với scripts/test-ai-knl-tools.js/scripts/test-checklist-*-2026-08.js
 * (mock table factory chỉ hỗ trợ READ, không có insert/update/delete - lưới
 * an toàn chống ghi nếu code vô tình cố ghi).
 *
 * Chạy: node scripts/test-checklist-annual-result-report-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const assert = require('assert');
const supabasePath = require.resolve('@supabase/supabase-js');
const LIB_PATHS = ['../lib/checklist-permissions', '../lib/checklist-scope', '../lib/checklist-reports'].map(p => require.resolve(p));

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
let queryLog = [];
function makeTableFactory(tableName, rows) {
  return function tableQuery() {
    queryLog.push(tableName);
    const filters = [];
    let orderSpecs = [], limitN = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
      lte(field, value) { filters.push(r => String(r[field]) <= String(value)); return q; },
      gte(field, value) { filters.push(r => String(r[field]) >= String(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      or(expr) {
        // mô phỏng đơn giản 'a.is.null,a.gte.X' và 'account_id.eq.X,employee_code.eq.Y' - đủ cho getChecklistReportAccess thật.
        const clauses = String(expr || '').split(',');
        filters.push(r => clauses.some(clause => {
          const m = clause.match(/^([a-z_]+)\.(eq|is|gte)\.(.*)$/i);
          if (!m) return false;
          const [, field, op, val] = m;
          if (op === 'is' && val === 'null') return r[field] == null || r[field] === '';
          if (op === 'eq') return String(r[field]) === String(val);
          if (op === 'gte') return String(r[field]) >= String(val);
          return false;
        }));
        return q;
      },
      order(field, opts) { orderSpecs.push({ field, asc: !(opts && opts.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      then(resolve, reject) {
        try {
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
    { employee_id: 'e1', employee_code: 'PHF001', full_name: 'Nguyễn Văn A', title: 'NV', department: 'Bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
    { employee_id: 'e2', employee_code: 'PHF002', full_name: 'Trần Thị B', title: 'NV', department: 'Kế toán', branch: 'Ngô Quyền', manager_employee_code: '', employment_status: 'inactive' },
    { employee_id: 'e3', employee_code: 'PHF003', full_name: 'Lê Văn C', title: 'NV', department: 'Bán hàng', branch: 'Lái Thiêu', manager_employee_code: '', employment_status: 'active' }
  ],
  checklist_employee_assignments: [
    { employee_id: 'e1', employee_code: 'PHF001', employee_name: 'Nguyễn Văn A', department: 'Bán hàng', title: 'NV', branch: 'Phú Lợi', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', template_id: '', template_version: '', effective_date: '2026-01-01' },
    { employee_id: 'e3', employee_code: 'PHF003', employee_name: 'Lê Văn C', department: 'Bán hàng', title: 'NV', branch: 'Lái Thiêu', manager_id: '', manager_code: '', manager_name: '', employee_status: 'Đang làm việc', template_id: '', template_version: '', effective_date: '2026-01-01' }
  ],
  checklist_permission_grants: [
    { id: 'g1', account_id: 'mgr-1', employee_code: 'PHF900', preset_code: 'TRUONG_BO_PHAN', capabilities: { view_reports: true, export_data: false }, view_scope: { type: 'department', values: ['Bán hàng'] }, review_scope: { type: 'none', values: [] }, record_scope: { type: 'none', values: [] }, export_scope: { type: 'none', values: [] }, effective_from: '2026-01-01', effective_to: null, reason: 'seed', is_active: true, updated_at: '2026-01-01', updated_by_name: '' }
  ],
  checklist_monthly_results: [
    { employee_code: 'PHF001', period_month: '2026-01', result_state: 'SCORED', score: 90, source: 'BASELINE_IMPORT' },
    { employee_code: 'PHF001', period_month: '2026-02', result_state: 'SCORED', score: 0, source: 'BASELINE_IMPORT' },
    { employee_code: 'PHF001', period_month: '2026-03', result_state: 'NO_ASSESSMENT', score: null, source: 'BASELINE_IMPORT' },
    { employee_code: 'PHF001', period_month: '2026-04', result_state: 'PROBATION', score: null, source: 'BASELINE_IMPORT' },
    { employee_code: 'PHF001', period_month: '2026-05', result_state: 'NO_DATA', score: null, source: 'BASELINE_IMPORT' },
    { employee_code: 'PHF001', period_month: '2026-08', result_state: 'SCORED', score: 100, source: 'TRANSITION_IMPORT' },
    { employee_code: 'PHF001', period_month: '2026-09', result_state: 'SCORED', score: 80, source: 'SYSTEM_LIVE' },
    { employee_code: 'PHF001', period_month: '2026-10', result_state: 'SCORED', score: 70, source: 'MANUAL_IMPORT' },
    { employee_code: 'PHF003', period_month: '2026-01', result_state: 'PROBATION', score: null, source: 'BASELINE_IMPORT' },
    // dòng của PHF002 (inactive) không được xuất hiện trong bất kỳ output nào - nếu vô tình xuất hiện là bug (PHF002 không active nên đáng lẽ không nằm trong scope, nhưng để chắc chắn vẫn seed dữ liệu để phát hiện leak nếu có).
    { employee_code: 'PHF002', period_month: '2026-01', result_state: 'SCORED', score: 99, source: 'BASELINE_IMPORT' }
  ]
};

function buildSupabaseMock() {
  return { createClient() { return { from(table) { if (!(table in STATE)) throw new Error('Unexpected table: ' + table); return makeTableFactory(table, STATE[table])(); } }; } };
}
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
LIB_PATHS.forEach(p => delete require.cache[p]);

const { getChecklistAnnualResultReport } = require('../lib/checklist-reports');

const adminSession = { account: { id: 'admin-1', name: 'Admin' }, role: 'admin' };
const managerSession = { account: { id: 'mgr-1', name: 'Manager' }, role: 'manager' };
const unauthorizedSession = { account: { id: 'nobody-1', name: 'Nobody' }, role: 'manager' };

let passes = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } else { passes++; console.log('PASS: ' + msg); } }

(async () => {
  // ---- A. Permission gate reused: unauthorized (no grant) -> throws exact code from getChecklistReportAccess ----
  let unauthorizedErr = null;
  try { await getChecklistAnnualResultReport(unauthorizedSession, { year: '2026' }); } catch (e) { unauthorizedErr = e; }
  check(unauthorizedErr && unauthorizedErr.code === 'CHECKLIST_REPORT_FORBIDDEN', 'A: session không có grant view_reports bị chặn CHECKLIST_REPORT_FORBIDDEN - đúng permission gate CŨ, không tạo gate mới');

  // ---- Admin: full scope ----
  queryLog = [];
  const adminResult = await getChecklistAnnualResultReport(adminSession, { year: '2026' });
  check(adminResult.employees.length === 2, 'C1: chỉ 2 nhân sự ACTIVE (PHF001, PHF003) xuất hiện - PHF002 (inactive) bị loại đúng employee_profiles.employment_status');
  check(!adminResult.employees.some(e => e.employeeCode === 'PHF002'), 'B: PHF002 (inactive, ngoài phạm vi) không xuất hiện trong output admin');
  check(adminResult.periods.length === 12 && adminResult.periods[0] === '2026-01' && adminResult.periods[11] === '2026-12', 'D: đúng 12 tháng của năm 2026 được yêu cầu');

  // ---- C. employee_profiles là nguồn danh tính/tổ chức (tên/dept/branch đúng employee_profiles, KHÔNG phải checklist_employee_assignments dù 2 bảng có seed khác nhau) ----
  const phf001 = adminResult.employees.find(e => e.employeeCode === 'PHF001');
  check(phf001.employeeName === 'Nguyễn Văn A' && phf001.department === 'Bán hàng' && phf001.branch === 'Phú Lợi', 'C2: tên/phòng ban/chi nhánh lấy đúng từ employee_profiles');

  // ---- E/F/G/H/I/J. result-state rendering đúng dữ liệu (score/resultState phân biệt rõ) ----
  check(phf001.periods['2026-01'].resultState === 'SCORED' && phf001.periods['2026-01'].score === 90, 'E: SCORED render đúng số');
  check(phf001.periods['2026-02'].resultState === 'SCORED' && phf001.periods['2026-02'].score === 0, 'F: SCORED=0 giữ nguyên score=0 (không phải null)');
  check(phf001.periods['2026-03'].resultState === 'NO_ASSESSMENT' && phf001.periods['2026-03'].score === null, 'G: NO_ASSESSMENT score=null');
  check(phf001.periods['2026-04'].resultState === 'PROBATION' && phf001.periods['2026-04'].score === null, 'H: PROBATION score=null');
  check(phf001.periods['2026-05'].resultState === 'NO_DATA' && phf001.periods['2026-05'].score === null, 'I: NO_DATA score=null');
  check(phf001.periods['2026-06'].hasResult === false, 'J: tháng không có authoritative result -> hasResult=false');

  // ---- K/L/M/N/O/P. Average formula ----
  // PHF001 SCORED months: 01=90, 02=0, 08=100, 09=80, 10=70 -> (90+0+100+80+70)/5 = 68
  check(phf001.average === 68, 'K/L: Bình quân chỉ tính SCORED (kể cả 0) = (90+0+100+80+70)/5 = 68, thực tế=' + phf001.average);
  check(phf001.scoredMonthCount === 5, 'K: scoredMonthCount đúng = 5 (không đếm NO_ASSESSMENT/PROBATION/NO_DATA/thiếu)');
  const phf003 = adminResult.employees.find(e => e.employeeCode === 'PHF003');
  check(phf003.average === null, 'P: PHF003 chỉ có PROBATION (không có tháng SCORED nào) -> Bình quân = null, không phải 0');
  check(phf003.scoredMonthCount === 0, 'M/N/O: PROBATION không được đếm vào scoredMonthCount');

  // ---- Q/R/S/T/U. Nguồn (source) không branching hành vi - BASELINE/TRANSITION/SYSTEM_LIVE/MANUAL đều render y hệt SCORED ----
  check(phf001.periods['2026-01'].resultState === 'SCORED', 'Q: BASELINE_IMPORT xử lý như SCORED bình thường');
  check(phf001.periods['2026-08'].resultState === 'SCORED' && phf001.periods['2026-08'].score === 100, 'R: TRANSITION_IMPORT xử lý giống hệt (không có field source nào ảnh hưởng output)');
  check(phf001.periods['2026-09'].resultState === 'SCORED' && phf001.periods['2026-09'].score === 80, 'S: SYSTEM_LIVE xử lý giống hệt');
  check(phf001.periods['2026-10'].resultState === 'SCORED' && phf001.periods['2026-10'].score === 70, 'T: MANUAL_IMPORT xử lý giống hệt');
  check(JSON.stringify(adminResult).indexOf('BASELINE_IMPORT') === -1 && JSON.stringify(adminResult).indexOf('source') === -1, 'U: response không hề chứa field/giá trị source - chứng minh KHÔNG branching theo nguồn (thậm chí không select cột đó)');

  // ---- V. Query shape - KHÔNG N+1 (đúng số lượng cố định, không tăng theo số nhân viên/tháng) ----
  const dbQueriesForAdmin = queryLog.filter(t => t !== 'checklist_employee_assignments' && t !== 'checklist_permission_grants').length; // trừ các bảng nội bộ của getChecklistReportAccess (đã audit riêng, không phải query mới của annual report)
  check(queryLog.filter(t => t === 'employee_profiles').length === 1, 'V: employee_profiles được đọc ĐÚNG 1 LẦN (không phải theo từng nhân viên)');
  check(queryLog.filter(t => t === 'checklist_monthly_results').length === 1, 'V: checklist_monthly_results được đọc ĐÚNG 1 LẦN cho toàn bộ năm (không phải theo từng tháng/từng nhân viên)');
  console.log('  query log (admin call):', JSON.stringify(queryLog));

  // ---- Manager scope: chỉ thấy đúng phòng ban được cấp (department: Bán hàng) ----
  queryLog = [];
  const mgrResult = await getChecklistAnnualResultReport(managerSession, { year: '2026' });
  check(mgrResult.employees.length === 2 && mgrResult.employees.every(e => e.department === 'Bán hàng'), 'B: manager chỉ thấy đúng phạm vi view_scope (department=Bán hàng) - reuse đúng subjectMatchesScope, không tự nới quyền');

  // ---- filters: department/branch/query ----
  const filteredResult = await getChecklistAnnualResultReport(adminSession, { year: '2026', branch: 'Lái Thiêu' });
  check(filteredResult.employees.length === 1 && filteredResult.employees[0].employeeCode === 'PHF003', 'filter branch hoạt động đúng');

  // ---- default year (không truyền year) ----
  const noYearResult = await getChecklistAnnualResultReport(adminSession, {});
  check(/^\d{4}$/.test(noYearResult.year), 'default year hợp lệ khi không truyền input.year');

  console.log('\n' + passes + ' assertions passed.');
})().catch(err => { console.error('FATAL', err && err.stack || err); process.exitCode = 1; });
