'use strict';
/*
 * KNL "Xem thu nhập" per-row gate (2026-08-12) — Regression test cho
 * lib/knl-people.js:listKnlPeople trả field mới `canViewIncome` (per-row,
 * tính bằng ĐÚNG incomeScopeAllows dùng thật ở getKnlEmployeeIncome —
 * lib/knl-permissions.js, di dời từ lib/knl-foundation.js để tránh circular
 * require với lib/knl-people.js).
 *
 * Bug đã sửa: trước đây frontend dùng cờ phẳng
 * `peopleCanViewIncome = isAdmin || capabilities.income_view === true`
 * cho MỌI row — khi peopleScope rộng hơn incomeScope, nút "Xem thu nhập"
 * hiện sai cho nhân sự ngoài incomeScope (dù backend vẫn chặn đúng khi
 * click, không leak data — chỉ là bug UX/rule).
 *
 * In-memory only — không chạm Production/Supabase thật. Chạy thủ công:
 *   node scripts/test-knl-people-income-gate-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const peoplePath = require.resolve('../api/_lib/knl-people');
const permissionsPath = require.resolve('../api/_lib/knl-permissions');
const scopePath = require.resolve('../api/_lib/knl-scope');
const foundationPath = require.resolve('../api/_lib/knl-foundation');

function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let mode = 'select', orderSpecs = [], limitN = null, singleMode = null, insertPayload = null, updatePayload = null;
    const q = {
      select() { return q; },
      eq(f, v) { filters.push(r => String(r[f]) === String(v)); return q; },
      order(f, o) { orderSpecs.push({ f, asc: !(o && o.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      insert(p) { mode = 'insert'; insertPayload = p; return q; },
      update(p) { mode = 'update'; updatePayload = p; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'insert') {
            const list = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
            const inserted = list.map(obj => { const row = Object.assign({ id: 'gen-' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), is_active: true }, obj); rows.push(row); return row; });
            resolve({ data: clone(singleMode ? inserted[0] : inserted), error: null }); return;
          }
          if (mode === 'update') {
            const matched = rows.filter(r => filters.every(fn => fn(r)));
            matched.forEach(r => Object.assign(r, updatePayload));
            resolve({ data: clone(singleMode ? (matched[0] || null) : matched), error: null }); return;
          }
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          orderSpecs.forEach(spec => { matched = matched.slice().sort((a, b) => (a[spec.f] < b[spec.f] ? -1 : a[spec.f] > b[spec.f] ? 1 : 0) * (spec.asc ? 1 : -1)); });
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
  { employee_id: 'e-002', employee_code: 'PHF002', full_name: 'Trần Thu Thủy', title: 'Giám đốc', position: null, department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_id: 'e-010', employee_code: 'PHF010', full_name: 'Nguyễn Thủy Tiên', title: 'Trợ lý Giám đốc', position: 'Quản lý', department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_id: 'e-051', employee_code: 'PHF051', full_name: 'Trịnh Thị Ngọc Linh', title: 'Trưởng bộ phận', position: null, department: 'Bộ phận thu mua', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_id: 'e-036', employee_code: 'PHF036', full_name: 'Trần Trung Hải', title: 'Nhân viên', position: null, department: 'Bộ phận Gói quà & Chế biến', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_id: 'e-034', employee_code: 'PHF034', full_name: 'Nguyễn Duy Hải', title: 'Trưởng bộ phận', position: null, department: 'Bộ phận kho vận', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_id: 'e-005', employee_code: 'PHF005', full_name: 'Nguyễn Minh Nhật', title: 'Nhân viên', position: null, department: 'Bộ phận Quản trị tổng hợp', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
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
          throw new Error('Unexpected table in mock: ' + table);
        },
        rpc() { throw new Error('RPC not mocked (write path out of scope)'); }
      };
    }
  };
}

function loadLibsWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return supabasePath;
    return originalResolve.call(this, request, ...rest);
  };
  const originalCache = require.cache[supabasePath];
  [peoplePath, permissionsPath, scopePath, foundationPath].forEach(p => delete require.cache[p]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const people = require(peoplePath);
  const permissions = require(permissionsPath);
  const foundation = require(foundationPath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return { people, permissions, foundation };
}

const { people, permissions, foundation } = loadLibsWithMock();
const { listKnlPeople } = people;
const { upsertKnlPermissionGrant } = permissions;
const { getKnlEmployeeIncome } = foundation;

function session(role, opts) { opts = opts || {}; return { role, account: { id: opts.id || '', name: opts.name || '' }, employeeCode: opts.employeeCode || '' }; }
async function grant(accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope) {
  return upsertKnlPermissionGrant(session('admin', { id: 'u-admin' }), { accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope, reason: 'canViewIncome per-row test fixture' });
}

let failures = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); failures++; } else console.log('PASS: ' + msg); }

async function run() {
  // ========== 1. Admin: list đúng, mọi row canViewIncome=true ==========
  const adminSession = session('admin', { id: 'u-admin' });
  const adminPeople = await listKnlPeople(adminSession, { status: 'active' });
  check(adminPeople.people.length === EMPLOYEES.length, '1.1 Admin listKnlPeople trả toàn bộ nhân sự active');
  check(adminPeople.people.every(p => p.canViewIncome === true), '1.2 Admin: canViewIncome=true cho MỌI row (phạm vi Admin = toàn công ty)');

  // ========== 2. Tiên (fixture khớp Production hiện có) ==========
  await grant('acct-phf010', 'PHF010', 'Nguyễn Thủy Tiên', 'TRO_LY_GD',
    { access_knl: true, view_people: true, income_view: true, incomeScope: { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến'] } },
    { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến'] });
  const tienSession = session('learner', { id: 'acct-phf010', employeeCode: 'PHF010' });
  const tienPeople = await listKnlPeople(tienSession, { status: 'active' });
  const tienByCode = Object.fromEntries(tienPeople.people.map(p => [p.employeeCode, p]));
  check(Object.keys(tienByCode).sort().join(',') === 'PHF036,PHF051', '2.1 listKnlPeople(Tiên) resolve theo peopleScope — đúng 2 phòng ban');
  check(tienByCode.PHF051.canViewIncome === true, '2.2 PHF051 (trong peopleScope + incomeScope) -> canViewIncome=true');
  check(tienByCode.PHF036.canViewIncome === true, '2.3 PHF036 (trong peopleScope + incomeScope, cùng 2 phòng ban) -> canViewIncome=true');

  // ========== 3. Synthetic split-scope: peopleScope rộng hơn incomeScope ==========
  await grant('acct-test-split', 'TESTSPLIT', 'Test Split-Scope Manager', 'CUSTOM',
    { access_knl: true, view_people: true, income_view: true, incomeScope: { type: 'department', values: ['Bộ phận thu mua'] } },
    { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến'] });
  const splitSession = session('learner', { id: 'acct-test-split', employeeCode: 'TESTSPLIT' });
  const splitPeople = await listKnlPeople(splitSession, { status: 'active' });
  const splitByCode = Object.fromEntries(splitPeople.people.map(p => [p.employeeCode, p]));
  check(Object.keys(splitByCode).sort().join(',') === 'PHF036,PHF051', '3.1 listKnlPeople(split-scope) trả cả 2 (đúng peopleScope rộng)');
  check(splitByCode.PHF051.canViewIncome === true, '3.2 PHF051 (Thu mua, trong cả 2 scope) -> canViewIncome=true');
  check(splitByCode.PHF036.canViewIncome === false, '3.3 *** FIX XÁC NHẬN ***: PHF036 (Gói quà, trong peopleScope NHƯNG NGOÀI incomeScope) -> canViewIncome=false — row vẫn xuất hiện trong danh sách nhưng field gate đúng, KHÔNG còn hiện nút sai nữa');

  // ========== 4. Employee ngoài peopleScope -> không có trong list ==========
  check(!('PHF034' in splitByCode) && !('PHF034' in tienByCode), '4.1 PHF034 (Kho vận, ngoài peopleScope) KHÔNG xuất hiện trong danh sách của cả Tiên và split-scope');

  // ========== 5. User không có income_view -> không row nào canViewIncome=true ==========
  await grant('acct-phf005', 'PHF005', 'Nguyễn Minh Nhật', 'TRUONG_BO_PHAN',
    { access_knl: true, view_people: true, income_view: false },
    { type: 'department', values: ['Bộ phận thu mua', 'Bộ phận Gói quà & Chế biến'] });
  const noIncomeSession = session('learner', { id: 'acct-phf005', employeeCode: 'PHF005' });
  const noIncomePeople = await listKnlPeople(noIncomeSession, { status: 'active' });
  check(noIncomePeople.people.length > 0, '5.1 User không có income_view vẫn xem được danh sách nhân sự (view_people độc lập với income_view)');
  check(noIncomePeople.people.every(p => p.canViewIncome === false), '5.2 User không có income_view -> canViewIncome=false cho MỌI row');

  // ========== 6. Gọi API trực tiếp ngoài incomeScope vẫn 403 (backend không đổi) ==========
  let r36 = await getKnlEmployeeIncome(splitSession, { employeeCode: 'PHF036' }).then(() => ({ ok: true })).catch(e => ({ ok: false, code: e.code }));
  check(r36.ok === false && r36.code === 'KNL_INCOME_VIEW_DENIED', '6.1 getKnlEmployeeIncome(PHF036) qua split-scope actor vẫn REJECT 403 KNL_INCOME_VIEW_DENIED (backend enforcement không đổi, chỉ frontend gate được sửa)');
  let r51 = await getKnlEmployeeIncome(splitSession, { employeeCode: 'PHF051' }).then(() => ({ ok: true })).catch(e => ({ ok: false }));
  check(r51.ok === true, '6.2 getKnlEmployeeIncome(PHF051) qua split-scope actor vẫn PASS đúng như canViewIncome đã báo trước');

  // ========== 8. Regression: response fields cũ không đổi (chỉ bổ sung canViewIncome) ==========
  const p = adminPeople.people[0];
  const oldFields = ['employeeCode', 'employeeName', 'title', 'position', 'department', 'branch', 'status'];
  check(oldFields.every(f => f in p), '8.1 publicPerson() vẫn giữ nguyên đủ field cũ (employeeCode/employeeName/title/position/department/branch/status)');
  check(Object.keys(p).length === oldFields.length + 1, '8.2 Response CHỈ bổ sung đúng 1 field mới (canViewIncome), không có field lạ nào khác');

  console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
