'use strict';
/*
 * getKnlEmployeeProfile (lib/knl-people.js) — regression test, in-memory mock.
 * Validate: self luôn xem được (không cần capability), session shape THẬT
 * (employeeId != employeeCode, đúng lib/auth.js) không làm self-view sai như
 * bug đã fix 2026-08-11, xem người khác qua đúng view_people/peopleScope,
 * không tìm thấy hồ sơ -> lỗi rõ ràng, không invent field ngoài
 * employee_profiles thật.
 *
 * Chạy: node scripts/test-knl-employee-profile-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const peoplePath = require.resolve('../lib/knl-people');
const permissionsPath = require.resolve('../lib/knl-permissions');
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

const STATE = { grants: [], grantHistory: [], employees: [] };

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          const map = { knl_permission_grants: STATE.grants, knl_permission_grant_history: STATE.grantHistory, employee_profiles: STATE.employees };
          if (!(table in map)) throw new Error('Unexpected table in KNL profile mock: ' + table);
          return makeTableFactory(map[table])();
        },
        rpc() { return Promise.resolve({ data: null, error: null }); }
      };
    }
  };
}

function loadLibsWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) { if (request === '@supabase/supabase-js') return supabasePath; return originalResolve.call(this, request, ...rest); };
  const originalCache = require.cache[supabasePath];
  [peoplePath, permissionsPath, scopePath].forEach(p => delete require.cache[p]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const lib = require(peoplePath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return lib;
}

const { getKnlEmployeeProfile } = loadLibsWithMock();
const { upsertKnlPermissionGrant: upsertGrant } = require(permissionsPath);

STATE.employees.push(
  { employee_code: 'EMP1', full_name: 'Nguyễn Văn A', title: 'Nhân viên', position: '', department: 'Bán hàng', branch: 'Phú Lợi', employment_status: 'active', avatar_url: '', hire_date: '2024-01-15' },
  { employee_code: 'EMP2', full_name: 'Trần Thị B', title: 'Quản lý', position: '', department: 'Ban giám đốc', branch: 'Phú Lợi', employment_status: 'active', avatar_url: 'https://example.com/avatar.jpg', hire_date: '2020-06-01' }
);

/* Session shape THẬT: employeeId != account.employeeCode (đúng lib/auth.js),
 * KHÔNG tự chế employeeId = code như lỗi đã gây bug trước đó. */
function session(role, opts) { opts = opts || {}; return { role, employeeId: opts.internalId || 'internal-' + Math.random().toString(36).slice(2), account: { id: opts.id || '', name: opts.name || '', employeeCode: opts.employeeCode || '' } }; }
async function grant(accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope) {
  return upsertGrant(session('admin', { id: 'u-admin' }), { accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope, reason: 'Batch test fixture' });
}

let failures = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else console.log('PASS: ' + message); }

async function run() {
  await grant('acct-emp2', 'EMP2', 'Trần Thị B', 'TRO_LY_GD', { access_knl: true, view_people: true }, { type: 'all_company', values: [] });
  await grant('acct-emp1-noview', 'EMP1', 'Nguyễn Văn A', 'NHAN_VIEN', { access_knl: true, view_people: true }, { type: 'self', values: [] });

  // 1. Self xem hồ sơ chính mình (session.employeeId != employeeCode — đúng shape thật)
  let s = session('learner', { id: 'acct-emp1-noview', employeeCode: 'EMP1', internalId: 'internal-abc-not-emp1' });
  let result = await getKnlEmployeeProfile(s, {});
  check(result.employeeCode === 'EMP1' && result.fullName === 'Nguyễn Văn A' && result.hireDate === '2024-01-15', '1. Self (EMP1) xem đúng hồ sơ chính mình dù session.employeeId khác employeeCode');

  // 2. Field không invent — chỉ trả field thật có trong employee_profiles
  check(!('salary' in result) && !('income' in result) && !('seniority' in result), '2. Không invent field ngoài employee_profiles thật (không có salary/income/seniority ở tầng service — tính ở frontend nếu cần)');

  // 3. Không có view_people (self-scope) -> bị chặn xem người khác
  let threw = null;
  try { await getKnlEmployeeProfile(s, { employeeCode: 'EMP2' }); } catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_PEOPLE_VIEW_DENIED', '3. EMP1 (self-scope) bị chặn xem hồ sơ EMP2');

  // 4. Có view_people all_company -> xem được người khác
  let s2 = session('manager', { id: 'acct-emp2', employeeCode: 'EMP2', internalId: 'internal-xyz' });
  result = await getKnlEmployeeProfile(s2, { employeeCode: 'EMP1' });
  check(result.employeeCode === 'EMP1' && result.avatarUrl === '', '4. EMP2 (view_people, all_company) xem được hồ sơ EMP1, avatarUrl rỗng đúng dữ liệu thật');

  // 5. Avatar có sẵn -> trả đúng URL, không tự sinh placeholder ở tầng service
  result = await getKnlEmployeeProfile(s2, {});
  check(result.avatarUrl === 'https://example.com/avatar.jpg', '5. Self EMP2 có avatar_url thật -> trả đúng URL');

  // 6. Không tồn tại trong employee_profiles -> lỗi rõ
  threw = null;
  let s3 = session('learner', { employeeCode: 'GHOST', internalId: 'internal-ghost' });
  try { await getKnlEmployeeProfile(s3, {}); } catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_EMPLOYEE_NOT_FOUND', '6. Mã NV không có trong employee_profiles -> KNL_EMPLOYEE_NOT_FOUND rõ ràng');

  if (failures) { console.error('\n' + failures + ' check(s) failed.'); process.exit(1); }
  console.log('\nALL PASS');
}

run().catch(err => { console.error('UNCAUGHT', err); process.exit(1); });
