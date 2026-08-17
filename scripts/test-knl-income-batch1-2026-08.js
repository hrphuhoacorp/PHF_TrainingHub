'use strict';
/*
 * KNL Thu nhập Batch 1 (2026-08) — Regression test cho:
 *  - incomeScopeAllows/getKnlEmployeeIncome/listKnlIncomeTargets với scope
 *    THẬT đang sống trên Production (Giám đốc all_company, Trợ lý Tiên
 *    department=[Thu mua, Gói quà & Chế biến, Bán hàng, Bán hàng Online]).
 *  - policy "đang hưởng mới hiện" (isProfessionalAllowance/isManagementAllowance/
 *    isMealAllowance) qua publicAssignment() — không đổi số tiền/reference_total.
 *
 * In-memory only — không chạm Production/Supabase thật. Chạy thủ công:
 *   node scripts/test-knl-income-batch1-2026-08.js
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

// ---- Fixture: đúng string thật đã verify trên Production employee_profiles ----
const EMPLOYEES = [
  { employee_code: 'PHF002', full_name: 'Trần Thu Thủy', title: 'Giám đốc', position: null, department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF010', full_name: 'Nguyễn Thủy Tiên', title: 'Trợ lý Giám đốc', position: 'Quản lý', department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF051', full_name: 'Trịnh Thị Ngọc Linh', title: 'Trưởng bộ phận', position: null, department: 'Bộ phận thu mua', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF036', full_name: 'Trần Trung Hải', title: 'Nhân viên', position: null, department: 'Bộ phận Gói quà & Chế biến', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF018', full_name: 'Nguyễn Thị Lệ', title: 'Trưởng ca', position: null, department: 'Bộ phận bán hàng', branch: 'Ngô Quyền', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF026', full_name: 'Đinh Thị Như Quyên', title: 'Nhân viên', position: null, department: 'Bộ phận bán hàng Online', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  // Ngoài phạm vi Tiên: Kho vận
  { employee_code: 'PHF034', full_name: 'Nguyễn Duy Hải', title: 'Trưởng bộ phận', position: null, department: 'Bộ phận kho vận', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  // Nhân viên thường, không có income_view
  { employee_code: 'PHF005', full_name: 'Nguyễn Minh Nhật', title: 'Nhân viên', position: null, department: 'Bộ phận Quản trị tổng hợp', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
];

const STATE = { grants: [], employees: EMPLOYEES, assignments: [], permHistory: [], compHistory: [] };

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'knl_permission_grant_history') return makeTableFactory(STATE.permHistory)();
          if (table === 'employee_profiles') return makeTableFactory(STATE.employees)();
          if (table === 'knl_employee_compensation_assignments') return makeTableFactory(STATE.assignments)();
          if (table === 'knl_employee_compensation_history') return makeTableFactory(STATE.compHistory)();
          throw new Error('Unexpected table in KNL income mock: ' + table);
        },
        rpc() { throw new Error('RPC not mocked in this test (write path out of Batch 1 scope)'); }
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

const { getKnlEmployeeIncome, listKnlIncomeTargets, incomeScopeAllows } = loadKnlLibsWithMock();
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
function codesOf(people) { return people.map(p => p.employeeCode).sort(); }

async function grant(accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope) {
  return upsertGrant(session('admin', { id: 'u-admin' }), { accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope, reason: 'Batch 1 test fixture' });
}

async function run() {
  // ---- Thiết lập grant ĐÚNG NHƯ Production thật (đã verify read-only trước khi test) ----
  await grant('acct-phf002', 'PHF002', 'Trần Thu Thủy', 'TRO_LY_GD',
    { access_knl: true, view_people: true, income_view: true, incomeScope: { type: 'all_company', values: [] } },
    { type: 'all_company', values: [] });
  await grant('acct-phf010', 'PHF010', 'Nguyễn Thủy Tiên', 'TRUONG_BO_PHAN',
    { access_knl: true, view_people: true, income_view: true, incomeScope: { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến', 'Bộ phận bán hàng', 'Bộ phận bán hàng Online'] } },
    { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến', 'Bộ phận bán hàng', 'Bộ phận bán hàng Online'] });
  await grant('acct-phf005', 'PHF005', 'Nguyễn Minh Nhật', 'NHAN_VIEN',
    { access_knl: true, view_people: true }, { type: 'self', values: [] });
  await grant('acct-phf034', 'PHF034', 'Nguyễn Duy Hải', 'TRUONG_BO_PHAN',
    { access_knl: true, view_people: true }, { type: 'department', values: ['Bộ phận kho vận'] });

  // ---- Assignment cố định để test policy "đang hưởng mới hiện" ----
  STATE.assignments.push(
    ...[
      { id: 'a1', employee_code: 'PHF051', employee_name: 'Trịnh Thị Ngọc Linh', payroll_period: '2026-08', employment_type: 'OFFICIAL',
        has_professional_allowance: true, has_management_allowance: true, has_meal_allowance: true, meal_allowance: 30000,
        probation_amount: 0, extra_allowances: [], reference_total: 9000000,
        structure_snapshot: { gradeCode: 'B2', gradeNumber: 2, ladderCode: 'THUMUA', ladderName: 'Ngạch Thu mua', versionId: 'v1', versionNumber: 1, effectivePeriod: '2026-08', baseSalary: 8000000, hqcv: 500000, professionalAllowance: 300000, managementAllowance: 200000 } },
      { id: 'a2', employee_code: 'PHF036', employee_name: 'Trần Trung Hải', payroll_period: '2026-08', employment_type: 'OFFICIAL',
        has_professional_allowance: false, has_management_allowance: false, has_meal_allowance: false, meal_allowance: 0,
        probation_amount: 0, extra_allowances: [], reference_total: 8500000,
        structure_snapshot: { gradeCode: 'B1', gradeNumber: 1, ladderCode: 'GOIQUA', ladderName: 'Ngạch Gói quà', versionId: 'v1', versionNumber: 1, effectivePeriod: '2026-08', baseSalary: 8000000, hqcv: 500000, professionalAllowance: 300000, managementAllowance: 200000 } }
    ].map(r => Object.assign({ status: 'ACTIVE' }, r))
  );

  // ============ SECTION 9.1: Self xem thu nhập của mình ============
  let result = await getKnlEmployeeIncome(session('learner', { id: 'acct-phf036', employeeCode: 'PHF036' }));
  check(result.employeeCode === 'PHF036' && result.current != null, '9.1 Self (PHF036, không có income_view) vẫn xem được thu nhập CHÍNH MÌNH');

  // ============ SECTION 9.2: Không có income_view -> không xem được người khác ============
  let threw = null;
  try { await getKnlEmployeeIncome(session('learner', { id: 'acct-phf005', employeeCode: 'PHF005' }), { employeeCode: 'PHF051' }); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_INCOME_VIEW_DENIED', '9.2 PHF005 (không có income_view) bị chặn xem thu nhập PHF051 -> KNL_INCOME_VIEW_DENIED');

  // ============ SECTION 9.3: Giám đốc xem được người bất kỳ toàn công ty ============
  result = await getKnlEmployeeIncome(session('manager', { id: 'acct-phf002', employeeCode: 'PHF002' }), { employeeCode: 'PHF034' });
  check(result.employeeCode === 'PHF034', '9.3a Giám đốc (PHF002, all_company) xem được PHF034 (Kho vận, ngoài scope Tiên)');
  let targets = await listKnlIncomeTargets(session('manager', { id: 'acct-phf002', employeeCode: 'PHF002' }));
  check(targets.canSelectOthers === true && codesOf(targets.people).length === EMPLOYEES.filter(e => e.employment_status === 'active').length, '9.3b Giám đốc thấy đủ toàn bộ nhân sự đang làm việc trong picker Thu nhập');

  // ============ SECTION 9.4: Tiên xem được người thuộc từng nhóm trong 4 nhóm ============
  const tienSession = session('manager', { id: 'acct-phf010', employeeCode: 'PHF010' });
  for (const code of ['PHF051', 'PHF036', 'PHF018', 'PHF026']) {
    result = await getKnlEmployeeIncome(tienSession, { employeeCode: code });
    check(result.employeeCode === code, '9.4 Trợ lý Tiên xem được ' + code + ' (thuộc 1 trong 4 nhóm: Thu mua/Gói quà/Bán hàng/Bán hàng Online)');
  }

  // ============ SECTION 9.5: Tiên bị chặn với người ngoài 4 nhóm ============
  threw = null;
  try { await getKnlEmployeeIncome(tienSession, { employeeCode: 'PHF034' }); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_INCOME_VIEW_DENIED', '9.5 Trợ lý Tiên bị chặn xem PHF034 (Kho vận, ngoài 4 nhóm) -> KNL_INCOME_VIEW_DENIED');

  targets = await listKnlIncomeTargets(tienSession);
  check(JSON.stringify(codesOf(targets.people)) === JSON.stringify(['PHF010', 'PHF018', 'PHF026', 'PHF036', 'PHF051']), '9.5b Picker của Tiên chỉ liệt kê đúng chính mình (PHF010) + 4 nhóm, không có PHF002/PHF005/PHF034');

  // ============ SECTION 9.6-9.9: Policy "đang hưởng mới hiện" — publicAssignment flags ============
  result = await getKnlEmployeeIncome(session('learner', { id: 'acct-phf051', employeeCode: 'PHF051' }));
  check(result.current.isProfessionalAllowance === true && result.current.isManagementAllowance === true && result.current.isMealAllowance === true, '9.6/9.7/9.8a PHF051 có đủ PC nghiệp vụ/PC quản lý/Tiền cơm -> flag true (sẽ render dòng)');
  check(result.current.professionalAllowance === 300000 && result.current.managementAllowance === 200000 && result.current.totalReferenceIncome === 9000000, '9.6b Số tiền PC nghiệp vụ/PC quản lý/reference_total giữ nguyên, không bị Batch 1 thay đổi');

  result = await getKnlEmployeeIncome(session('learner', { id: 'acct-phf036', employeeCode: 'PHF036' }));
  check(result.current.isProfessionalAllowance === false && result.current.isManagementAllowance === false && result.current.isMealAllowance === false, '9.7/9.8b PHF036 không có PC nghiệp vụ/PC quản lý/Tiền cơm -> flag false (sẽ ẩn dòng hoàn toàn ở UI, không render placeholder)');
  check(result.current.professionalAllowance === 0 && result.current.managementAllowance === 0 && result.current.totalReferenceIncome === 8500000, '9.7b PHF036 số tiền/reference_total giữ nguyên (0 vì has_*=false, không phải do Batch 1 sửa số)');

  // ============ SECTION 9.10: Extra allowance conditional (đã đúng từ trước, không đổi) ============
  check(Array.isArray(result.current.extraAllowances) && result.current.extraAllowances.length === 0, '9.10 PHF036 extraAllowances rỗng -> dòng "PC khác" tiếp tục ẩn đúng như logic cũ (không đổi)');

  // ============ SECTION 9.11: History không bị thay đổi bởi Batch 1 (đọc lại nguyên vẹn) ============
  check(Array.isArray(result.history) && result.history.length === 0, '9.11 getKnlEmployeeIncome vẫn trả history nguyên vẹn qua field riêng (Batch 1 không đụng logic đọc history)');

  // ============ SECTION 9.13: incomeScopeAllows KHÔNG đọc peopleScope/proposalScope của grant (độc lập) ============
  const resolvedTien = { source: 'grant', capabilities: { income_view: true }, row: { capabilities: { incomeScope: { type: 'department', values: ['Bộ phận thu mua'] }, proposalScope: { type: 'all_company', values: [] } } } };
  check(incomeScopeAllows(resolvedTien, { department: 'Bộ phận thu mua' }) === true, '9.13a incomeScopeAllows chỉ đọc incomeScope, khớp đúng department');
  check(incomeScopeAllows(resolvedTien, { department: 'Bộ phận bán hàng' }) === false, '9.13b incomeScopeAllows không bị proposalScope (all_company) "rò" quyền sang income - vẫn false dù proposalScope rộng hơn');

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nALL PASS');
}

run().catch(err => { console.error('UNCAUGHT', err); process.exit(1); });
