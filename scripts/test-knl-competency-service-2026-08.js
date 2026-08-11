'use strict';
/*
 * KNL Employee Competency Assignment service (lib/knl-competency.js) —
 * regression test, in-memory mock (không chạm Production). Vì migration
 * scripts/PHF_KNL_EMPLOYEE_COMPETENCY_ASSIGNMENT_1.52.0_DRAFT.sql CHƯA apply,
 * bảng knl_employee_competency_assignments/_history không tồn tại thật ở đâu
 * để test tích hợp — file này validate ĐÚNG phần code đã viết (permission
 * gate self/others/admin-write, error translation) bằng mock supabase, và
 * riêng CASE cuối xác nhận throwDb() dịch đúng lỗi "chưa cài schema" thay vì
 * lộ lỗi 500 chung chung khi bảng thật sự chưa tồn tại.
 *
 * Chạy: node scripts/test-knl-competency-service-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const competencyPath = require.resolve('../lib/knl-competency');
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
            const inserted = list.map(obj => { const row = Object.assign({ id: 'gen-' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), is_active: true }, obj); rows.push(row); return row; });
            resolve({ data: clone(singleMode ? inserted[0] : inserted), error: null }); return;
          }
          if (mode === 'update') {
            const matched = rows.filter(r => filters.every(fn => fn(r)));
            matched.forEach(r => Object.assign(r, updatePayload));
            resolve({ data: clone(singleMode ? (matched[0] || null) : matched), error: null }); return;
          }
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          orderSpecs.forEach(spec => { matched = matched.slice().sort((a, b) => ((a[spec.field] < b[spec.field] ? -1 : a[spec.field] > b[spec.field] ? 1 : 0) * (spec.asc ? 1 : -1))); });
          if (limitN != null) matched = matched.slice(0, limitN);
          if (singleMode) { resolve({ data: clone(matched[0] || null), error: null }); return; }
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}
function missingSchemaTableQuery() {
  const q = { select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, maybeSingle() { return q; }, single() { return q; },
    then(resolve) { resolve({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.knl_employee_competency_assignments' in the schema cache" } }); } };
  return q;
}

const STATE = { grants: [], grantHistory: [], employees: [], competency: [], simulateSchemaMissing: false };

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'knl_permission_grant_history') return makeTableFactory(STATE.grantHistory)();
          if (table === 'employee_profiles') return makeTableFactory(STATE.employees)();
          if (table === 'knl_employee_competency_assignments') return STATE.simulateSchemaMissing ? missingSchemaTableQuery() : makeTableFactory(STATE.competency)();
          throw new Error('Unexpected table in KNL competency mock: ' + table);
        },
        rpc(name) {
          if (STATE.simulateSchemaMissing) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } });
          return Promise.resolve({ data: { assignmentId: 'fake-id', action: 'CREATE' }, error: null });
        }
      };
    }
  };
}

function loadLibsWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) { if (request === '@supabase/supabase-js') return supabasePath; return originalResolve.call(this, request, ...rest); };
  const originalCache = require.cache[supabasePath];
  [competencyPath, permissionsPath, peoplePath, scopePath].forEach(p => delete require.cache[p]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const lib = require(competencyPath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return lib;
}

const { getKnlEmployeeCompetencyAssignment, listKnlEmployeeCompetencyHistory, setKnlEmployeeCompetencyAssignment } = loadLibsWithMock();
const { upsertKnlPermissionGrant: upsertGrant } = require(permissionsPath);

STATE.employees.push(
  { employee_code: 'PHF090', full_name: 'Nguyễn Thị Khánh Vân', title: 'Nhân viên', department: 'Bộ phận bán hàng Online', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF002', full_name: 'Trần Thu Thủy', title: 'Giám đốc', department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF005', full_name: 'Nguyễn Minh Nhật', title: 'Nhân viên', department: 'Bộ phận kho vận', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
);
STATE.competency.push({ id: 'ca-1', employee_code: 'PHF090', employee_name: 'Nguyễn Thị Khánh Vân', framework_version_id: 'v-online', competency_grade_id: 'g-b1', status: 'PROVISIONAL', effective_from: '2026-08-01', effective_to: null, is_active: true, grade_snapshot: {}, organization_snapshot: {}, note: 'baseline', reason: 'baseline', updated_at: '2026-08-11T00:00:00Z' });

function session(role, opts) { opts = opts || {}; return { role, account: { id: opts.id || '', name: opts.name || '' }, employeeCode: opts.employeeCode || '' }; }
async function grant(accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope) {
  return upsertGrant(session('admin', { id: 'u-admin' }), { accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope, reason: 'Batch test fixture' });
}

let failures = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else console.log('PASS: ' + message); }

async function run() {
  await grant('acct-phf002', 'PHF002', 'Trần Thu Thủy', 'TRO_LY_GD', { access_knl: true, view_people: true }, { type: 'all_company', values: [] });
  await grant('acct-phf005', 'PHF005', 'Nguyễn Minh Nhật', 'NHAN_VIEN', { access_knl: true, view_people: true }, { type: 'self', values: [] });

  // 1. Self xem KNL của mình, không cần capability
  let result = await getKnlEmployeeCompetencyAssignment(session('learner', { id: 'acct-phf090', employeeCode: 'PHF090' }));
  check(result.current && result.current.employeeCode === 'PHF090' && result.current.status === 'PROVISIONAL', '1. Self (PHF090) xem được KNL của chính mình, không cần capability/permission nào');

  // 2. Người không có view_people bị chặn xem người khác
  let threw = null;
  try { await getKnlEmployeeCompetencyAssignment(session('learner', { id: 'acct-phf005', employeeCode: 'PHF005' }), { employeeCode: 'PHF090' }); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_COMPETENCY_VIEW_DENIED', '2. PHF005 (self-scope, không view_people người khác thực chất) bị chặn xem KNL của PHF090');

  // 3. Người có view_people + scope all_company xem được người khác
  result = await getKnlEmployeeCompetencyAssignment(session('manager', { id: 'acct-phf002', employeeCode: 'PHF002' }), { employeeCode: 'PHF090' });
  check(result.current && result.current.employeeCode === 'PHF090', '3. PHF002 (view_people, scope all_company) xem được KNL của PHF090');

  // 4. Không phải income_view/incomeScope gate - xác nhận KHÔNG cần income_view
  const grantPhf002 = (await require(permissionsPath).listKnlPermissionGrants(session('admin', { id: 'u-admin' }))).grants.find(g => g.employeeCode === 'PHF002');
  check(!grantPhf002.capabilities.income_view, '4. Xem KNL người khác PASS dù income_view=false — xác nhận độc lập hoàn toàn với income permission');

  // 5. Write: non-admin bị chặn
  threw = null;
  try { await setKnlEmployeeCompetencyAssignment(session('manager', { id: 'acct-phf002', employeeCode: 'PHF002' }), { employeeCode: 'PHF090', frameworkVersionId: 'v1', competencyGradeId: 'g1', status: 'PROVISIONAL', effectiveFrom: '2026-08-01', reason: 'test' }); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_COMPETENCY_ADMIN_REQUIRED', '5. Non-admin (kể cả có view_people all_company) bị chặn ghi KNL -> KNL_COMPETENCY_ADMIN_REQUIRED');

  // 6. Write: employee không tồn tại trong organization -> reject
  threw = null;
  try { await setKnlEmployeeCompetencyAssignment(session('admin', { id: 'u-admin' }), { employeeCode: 'PHFXXX', frameworkVersionId: 'v1', competencyGradeId: 'g1', status: 'PROVISIONAL', effectiveFrom: '2026-08-01', reason: 'test' }); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_EMPLOYEE_NOT_FOUND', '6. Admin ghi cho mã NV không tồn tại trong organization -> KNL_EMPLOYEE_NOT_FOUND');

  // 7. Write: Admin hợp lệ -> gọi RPC thành công (mock trả về CREATE)
  result = await setKnlEmployeeCompetencyAssignment(session('admin', { id: 'u-admin' }), { employeeCode: 'PHF090', frameworkVersionId: 'v1', competencyGradeId: 'g1', status: 'PROVISIONAL', effectiveFrom: '2026-08-01', reason: 'PHF baseline 08/2026' });
  check(result.assignment && result.assignment.assignmentId === 'fake-id', '7. Admin ghi hợp lệ -> gọi RPC knl_set_employee_competency_assignment thành công');

  // 8. Schema chưa tồn tại (đúng trạng thái Production thật hiện tại) -> lỗi rõ, không phải 500 chung chung
  STATE.simulateSchemaMissing = true;
  threw = null;
  try { await getKnlEmployeeCompetencyAssignment(session('learner', { id: 'acct-phf090', employeeCode: 'PHF090' })); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_COMPETENCY_SCHEMA_MISSING' && threw.statusCode === 503, '8a. Khi bảng knl_employee_competency_assignments chưa tồn tại (đúng trạng thái Production hiện tại) -> lỗi rõ 503 KNL_COMPETENCY_SCHEMA_MISSING, không phải 500 chung chung');
  threw = null;
  try { await setKnlEmployeeCompetencyAssignment(session('admin', { id: 'u-admin' }), { employeeCode: 'PHF090', frameworkVersionId: 'v1', competencyGradeId: 'g1', status: 'PROVISIONAL', effectiveFrom: '2026-08-01', reason: 'x' }); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_COMPETENCY_SCHEMA_MISSING', '8b. Write cũng dịch lỗi RPC-not-found thành cùng KNL_COMPETENCY_SCHEMA_MISSING rõ ràng');
  STATE.simulateSchemaMissing = false;

  if (failures) { console.error('\n' + failures + ' check(s) failed.'); process.exit(1); }
  console.log('\nALL PASS');
}

run().catch(err => { console.error('UNCAUGHT', err); process.exit(1); });
