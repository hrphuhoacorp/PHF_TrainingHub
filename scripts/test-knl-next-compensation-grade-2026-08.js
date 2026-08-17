'use strict';
/*
 * KNL "Thu nhập tham chiếu Bậc lương kế tiếp" (2026-08-12) — Regression test
 * cho getKnlEmployeeNextCompensationGrade (lib/knl-foundation.js).
 *
 * Business rule đã chốt: bậc KNL (competency) và bậc lương (compensation) là
 * 2 hệ ĐỘC LẬP — next grade ở đây PHẢI resolve thuần từ knl_compensation_grades
 * (order by grade_number trong CÙNG version_id của assignment hiện tại),
 * KHÔNG bao giờ đọc/suy từ knl_grade_definitions (competency).
 *
 * Whitelist: has_professional_allowance/has_management_allowance là field
 * lưu trên CHÍNH assignment hiện tại (per-employee thật đang hưởng) —
 * preview bậc kế tiếp chỉ được carry-forward đúng 2 cờ đó, không tự bật
 * thêm khoản nào employee hiện không hưởng dù grade kế tiếp có cấu hình.
 *
 * In-memory only — không chạm Production/Supabase thật. Chạy thủ công:
 *   node scripts/test-knl-next-compensation-grade-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const foundationPath = require.resolve('../lib/knl-foundation');
const permissionsPath = require.resolve('../lib/knl-permissions');
const peoplePath = require.resolve('../lib/knl-people');
const scopePath = require.resolve('../lib/knl-scope');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let mode = 'select', orderSpecs = [], limitN = null, singleMode = null, insertPayload = null, updatePayload = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
      gt(field, value) { filters.push(r => Number(r[field]) > Number(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      order(field, opts) { orderSpecs.push({ field, asc: !(opts && opts.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      insert(payload) { mode = 'insert'; insertPayload = payload; return q; },
      update(payload) { mode = 'update'; updatePayload = payload; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'insert') {
            const list = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
            const inserted = list.map(obj => {
              const row = Object.assign({ id: 'gen-' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), is_active: true }, obj);
              rows.push(row);
              return row;
            });
            resolve({ data: clone(singleMode ? inserted[0] : inserted), error: null });
            return;
          }
          if (mode === 'update') {
            const matched = rows.filter(r => filters.every(fn => fn(r)));
            matched.forEach(r => Object.assign(r, updatePayload));
            resolve({ data: clone(singleMode ? (matched[0] || null) : matched), error: null });
            return;
          }
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          orderSpecs.forEach(spec => {
            matched = matched.slice().sort((a, b) => {
              const av = a[spec.field], bv = b[spec.field];
              return (av < bv ? -1 : av > bv ? 1 : 0) * (spec.asc ? 1 : -1);
            });
          });
          if (limitN != null) matched = matched.slice(0, limitN);
          if (singleMode) { resolve({ data: clone(matched[0] || null), error: null }); return; }
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

const EMPLOYEES = [
  { employee_code: 'PHF002', full_name: 'Trần Thu Thủy', title: 'Giám đốc', position: null, department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF051', full_name: 'Trịnh Thị Ngọc Linh', title: 'Trưởng bộ phận', position: null, department: 'Bộ phận thu mua', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF036', full_name: 'Trần Trung Hải', title: 'Nhân viên', position: null, department: 'Bộ phận Gói quà & Chế biến', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF099', full_name: 'Lê Văn Đỉnh', title: 'Nhân viên', position: null, department: 'Bộ phận thu mua', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF005', full_name: 'Nguyễn Minh Nhật', title: 'Nhân viên', position: null, department: 'Bộ phận Quản trị tổng hợp', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
];

const STATE = { grants: [], employees: EMPLOYEES, assignments: [], permHistory: [], compGrades: [] };

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'knl_permission_grant_history') return makeTableFactory(STATE.permHistory)();
          if (table === 'employee_profiles') return makeTableFactory(STATE.employees)();
          if (table === 'knl_employee_compensation_assignments') return makeTableFactory(STATE.assignments)();
          if (table === 'knl_compensation_grades') return makeTableFactory(STATE.compGrades)();
          throw new Error('Unexpected table in KNL next-compensation-grade mock: ' + table);
        },
        rpc() { throw new Error('RPC not mocked in this test (write path out of scope)'); }
      };
    }
  };
}

function loadKnlLibsWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return supabasePath;
    return originalResolve.call(this, request, ...rest);
  };
  const originalCache = require.cache[supabasePath];
  [foundationPath, permissionsPath, peoplePath, scopePath].forEach(p => delete require.cache[p]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const foundationLib = require(foundationPath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return foundationLib;
}

const { getKnlEmployeeNextCompensationGrade } = loadKnlLibsWithMock();
const { upsertKnlPermissionGrant: upsertGrant } = require('../lib/knl-permissions');

function session(role, opts) {
  opts = opts || {};
  return { role, account: { id: opts.id || '', name: opts.name || '' }, employeeCode: opts.employeeCode || '' };
}

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

async function grant(accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope) {
  return upsertGrant(session('admin', { id: 'u-admin' }), { accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope, reason: 'next-compensation-grade test fixture' });
}

async function run() {
  await grant('acct-phf002', 'PHF002', 'Trần Thu Thủy', 'TRO_LY_GD',
    { access_knl: true, view_people: true, income_view: true, incomeScope: { type: 'all_company', values: [] } },
    { type: 'all_company', values: [] });
  await grant('acct-phf005', 'PHF005', 'Nguyễn Minh Nhật', 'NHAN_VIEN',
    { access_knl: true, view_people: true }, { type: 'self', values: [] });

  // Ngạch Thu mua, version v1: B1 < B2 < B4 (cố ý có KHOẢNG TRỐNG B3 để xác
  // nhận .gt()+.order()+.limit(1) đi đúng bậc kế tiếp GẦN NHẤT theo grade_number,
  // không giả định liên tục).
  STATE.compGrades.push(
    { id: 'g-thumua-b1', version_id: 'v1', grade_code: 'THUMUA-B1', grade_number: 1, base_salary: 7000000, hqcv: 400000, professional_allowance: 250000, management_allowance: 150000 },
    { id: 'g-thumua-b2', version_id: 'v1', grade_code: 'THUMUA-B2', grade_number: 2, base_salary: 8000000, hqcv: 500000, professional_allowance: 300000, management_allowance: 200000 },
    { id: 'g-thumua-b4', version_id: 'v1', grade_code: 'THUMUA-B4', grade_number: 4, base_salary: 9500000, hqcv: 650000, professional_allowance: 400000, management_allowance: 300000 }
  );

  // PHF051: đang B2, có professional=true, management=FALSE (whitelist test chính).
  STATE.assignments.push({
    id: 'a1', employee_code: 'PHF051', employee_name: 'Trịnh Thị Ngọc Linh', payroll_period: '2026-08', employment_type: 'OFFICIAL', status: 'ACTIVE',
    compensation_grade_id: 'g-thumua-b2',
    has_professional_allowance: true, has_management_allowance: false, has_meal_allowance: true, meal_allowance: 30000,
    probation_amount: 0, extra_allowances: [], reference_total: 8800000,
    structure_snapshot: { gradeCode: 'THUMUA-B2', gradeNumber: 2, ladderCode: 'THUMUA', ladderName: 'Ngạch Thu mua', versionId: 'v1', versionNumber: 1, effectivePeriod: '2026-08', baseSalary: 8000000, hqcv: 500000, professionalAllowance: 300000, managementAllowance: 200000 }
  });
  // PHF036: đang B4 = bậc cao nhất trong version v1 -> isMaxGrade.
  STATE.assignments.push({
    id: 'a2', employee_code: 'PHF036', employee_name: 'Trần Trung Hải', payroll_period: '2026-08', employment_type: 'OFFICIAL', status: 'ACTIVE',
    compensation_grade_id: 'g-thumua-b4',
    has_professional_allowance: true, has_management_allowance: true, has_meal_allowance: false, meal_allowance: 0,
    probation_amount: 0, extra_allowances: [], reference_total: 10850000,
    structure_snapshot: { gradeCode: 'THUMUA-B4', gradeNumber: 4, ladderCode: 'THUMUA', ladderName: 'Ngạch Thu mua', versionId: 'v1', versionNumber: 1, effectivePeriod: '2026-08', baseSalary: 9500000, hqcv: 650000, professionalAllowance: 400000, managementAllowance: 300000 }
  });
  // PHF099: Thử việc, chưa gán compensation_grade_id -> hasCurrentGrade=false.
  STATE.assignments.push({
    id: 'a3', employee_code: 'PHF099', employee_name: 'Lê Văn Đỉnh', payroll_period: '2026-08', employment_type: 'PROBATION', status: 'ACTIVE',
    compensation_grade_id: null,
    has_professional_allowance: false, has_management_allowance: false, has_meal_allowance: false, meal_allowance: 0,
    probation_amount: 6000000, extra_allowances: [], reference_total: 6000000,
    structure_snapshot: {}
  });

  // ============ 1. Employee có compensation grade kế tiếp (B2 -> B4, có gap B3) ============
  let r = await getKnlEmployeeNextCompensationGrade(session('learner', { id: 'acct-phf051', employeeCode: 'PHF051' }));
  check(r.hasCurrentGrade === true && r.currentGrade.code === 'THUMUA-B2', '1.1 Self resolve đúng current compensation grade B2');
  check(r.isMaxGrade === false && r.nextGrade && r.nextGrade.code === 'THUMUA-B4', '1.2 Next grade là B4 (gần nhất theo grade_number, bỏ qua gap B3 không tồn tại)');

  // ============ 2. Preview CHỈ có earning component hiện đang hưởng ============
  check(r.preview.baseSalary === 9500000 && r.preview.hqcv === 650000, '2.1 Base salary/HQCV lấy đúng mức B4 (luôn hiển thị, không thuộc whitelist)');
  check(r.preview.isProfessionalAllowance === true && r.preview.professionalAllowance === 400000, '2.2 Phụ cấp nghiệp vụ hiển thị đúng mức B4 vì PHF051 đang hưởng ở bậc hiện tại');

  // ============ 3. Component tồn tại ở next grade nhưng employee hiện KHÔNG hưởng -> không render ============
  check(r.preview.isManagementAllowance === false && r.preview.managementAllowance === 0, '3.1 Phụ cấp quản lý = 0/ẩn dù B4 có cấu hình 300000, vì PHF051 hiện has_management_allowance=false');

  // ============ 4. Employee ở compensation grade cuối ============
  let rMax = await getKnlEmployeeNextCompensationGrade(session('learner', { id: 'acct-phf036', employeeCode: 'PHF036' }));
  check(rMax.hasCurrentGrade === true && rMax.isMaxGrade === true && rMax.nextGrade === null && rMax.preview === null, '4.1 Employee ở bậc lương cao nhất -> isMaxGrade=true, không invent grade, preview=null');

  // ============ 5. KNL competency grade KHÔNG tham gia resolve compensation grade ============
  check(!('competencyGrade' in r) && !('knlGrade' in r), '5.1 Response không chứa field competency/KNL nào — resolve thuần từ knl_compensation_grades');

  // ============ 6. Probation / chưa gán compensation grade ============
  let rNone = await getKnlEmployeeNextCompensationGrade(session('learner', { id: 'acct-phf099', employeeCode: 'PHF099' }));
  check(rNone.hasCurrentGrade === false && rNone.currentGrade === null && rNone.preview === null, '6.1 Thử việc chưa gán grade -> hasCurrentGrade=false, không invent');

  // ============ 7. Permission: self luôn được xem chính mình dù không có income_view ============
  check(r.employeeCode === 'PHF051', '7.1 Self (không có income_view) vẫn xem được preview của chính mình');

  // ============ 8. Permission: người khác không có income_view bị từ chối ============
  try {
    await getKnlEmployeeNextCompensationGrade(session('learner', { id: 'acct-phf005', employeeCode: 'PHF005' }), { employeeCode: 'PHF051' });
    check(false, '8.1 Phải bị từ chối khi xem người khác không có income_view');
  } catch (e) {
    check(e.code === 'KNL_INCOME_VIEW_DENIED', '8.1 Đúng lỗi KNL_INCOME_VIEW_DENIED khi không có quyền');
  }

  // ============ 9. Permission: income_view all_company xem được người khác ============
  let rAdmin = await getKnlEmployeeNextCompensationGrade(session('learner', { id: 'acct-phf002', employeeCode: 'PHF002' }), { employeeCode: 'PHF051' });
  check(rAdmin.employeeCode === 'PHF051' && rAdmin.nextGrade && rAdmin.nextGrade.code === 'THUMUA-B4', '9.1 income_view all_company xem đúng preview của nhân sự khác — cùng shared data path với self');

  console.log(failures === 0 ? '\nALL PASS (' + (9) + ' sections)' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
