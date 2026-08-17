'use strict';
/*
 * KNL Thu nhập Batch 2 (2026-08) — Regression test cho:
 *  - saveKnlEmployeeIncome: validation hồi tố server-side (kỳ < kỳ khuyến
 *    nghị N+1 -> bắt buộc reason >=5 ký tự, ngược lại reject
 *    KNL_RETROACTIVE_REASON_REQUIRED).
 *  - listKnlEmployeeCompensationPeriods (mới, mục 11): self luôn xem được,
 *    người khác phải qua đúng incomeScopeAllows (không mở permission mới).
 *  - RPC knl_save_employee_compensation vẫn được gọi với đúng payload khi
 *    không hồi tố (không đổi core write path/atomicity).
 *
 * In-memory only — không chạm Production/Supabase thật. Chạy thủ công:
 *   node scripts/test-knl-income-batch2-2026-08.js
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

const EMPLOYEES = [
  { employee_code: 'PHF002', full_name: 'Trần Thu Thủy', title: 'Giám đốc', position: null, department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF010', full_name: 'Nguyễn Thủy Tiên', title: 'Trợ lý Giám đốc', position: 'Quản lý', department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF051', full_name: 'Trịnh Thị Ngọc Linh', title: 'Trưởng bộ phận', position: null, department: 'Bộ phận thu mua', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF034', full_name: 'Nguyễn Duy Hải', title: 'Trưởng bộ phận', position: null, department: 'Bộ phận kho vận', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'PHF005', full_name: 'Nguyễn Minh Nhật', title: 'Nhân viên', position: null, department: 'Bộ phận Quản trị tổng hợp', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' }
];

const STATE = { grants: [], employees: EMPLOYEES, assignments: [], permHistory: [], compHistory: [] };
const rpcCalls = [];

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
          throw new Error('Unexpected table in KNL income batch2 mock: ' + table);
        },
        rpc(name, params) {
          rpcCalls.push({ name, params });
          if (name === 'knl_save_employee_compensation') {
            /* Mô phỏng lại đúng phần cốt lõi của RPC thật (mục cho PROBATION,
             * đủ cho test suite này) để listKnlEmployeeCompensationPeriods/
             * getKnlEmployeeIncome đọc lại thấy đúng dữ liệu vừa "lưu" - đảm
             * bảo test đi qua toàn bộ round-trip, không chỉ dừng ở lời gọi RPC. */
            const code = String(params.p_employee_code || '').toUpperCase();
            const period = params.p_payroll_period;
            const isProbation = String(params.p_employment_type || '').toUpperCase() === 'PROBATION';
            const total = isProbation ? Number(params.p_probation_amount || 0) : (Number(params.p_probation_amount || 0));
            const existing = STATE.assignments.find(r => r.employee_code === code && r.payroll_period === period);
            const before = existing ? Object.assign({}, existing) : {};
            const row = Object.assign(existing || { id: 'gen-assign-' + Math.random().toString(36).slice(2), employee_code: code, payroll_period: period }, {
              employee_name: params.p_employee_name,
              employment_type: isProbation ? 'PROBATION' : 'OFFICIAL',
              compensation_version_id: null, compensation_grade_id: params.p_grade_id || null,
              has_professional_allowance: !!params.p_has_professional, has_management_allowance: !!params.p_has_management, has_meal_allowance: !!params.p_has_meal,
              meal_allowance: Number(params.p_meal_amount || 0), probation_amount: Number(params.p_probation_amount || 0),
              extra_allowances: params.p_extra_allowances || [], organization_snapshot: params.p_organization_snapshot || {},
              structure_snapshot: isProbation ? { employmentType: 'PROBATION', probationAmount: Number(params.p_probation_amount || 0) } : {},
              reference_total: total, reason: params.p_reason, updated_at: new Date().toISOString(), status: 'ACTIVE'
            });
            if (!existing) STATE.assignments.push(row);
            STATE.compHistory.push({ id: STATE.compHistory.length + 1, assignment_id: row.id, employee_code: code, payroll_period: period, action: existing ? 'UPDATE' : 'CREATE', before_data: before, after_data: Object.assign({}, row), reason: params.p_reason, changed_by: params.p_actor_id, changed_by_name: params.p_actor_name, changed_at: new Date().toISOString() });
            return Promise.resolve({ data: { assignmentId: row.id, referenceTotal: total, payrollPeriod: period }, error: null });
          }
          return Promise.resolve({ data: null, error: { message: 'RPC not mocked: ' + name } });
        }
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

const { saveKnlEmployeeIncome, listKnlEmployeeCompensationPeriods, getKnlEmployeeIncome } = loadKnlLibsWithMock();
const { upsertKnlPermissionGrant: upsertGrant } = require(permissionsPath);

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
  return upsertGrant(session('admin', { id: 'u-admin' }), { accountId, employeeCode, employeeName, presetCode, capabilities, peopleScope, reason: 'Batch 2 test fixture' });
}

/* Kỳ khuyến nghị = tháng hệ thống hiện tại + 1 - tính lại đúng công thức để
 * fixture kỳ luôn hồi tố/không hồi tố nhất quán bất kể ngày chạy test. */
function recommendedPeriod() {
  const d = new Date();
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 2;
  if (m > 12) { m -= 12; y += 1; }
  return y + '-' + (m < 10 ? '0' + m : '' + m);
}
function pastPeriod() {
  const d = new Date();
  let y = d.getUTCFullYear(), m = d.getUTCMonth(); // 1 tháng trước tháng hiện tại (0-based -> tháng hiện tại -1)
  if (m < 1) { m = 12; y -= 1; }
  return y + '-' + (m < 10 ? '0' + m : '' + m);
}

async function run() {
  await grant('acct-phf002', 'PHF002', 'Trần Thu Thủy', 'TRO_LY_GD',
    { access_knl: true, view_people: true, income_view: true, incomeScope: { type: 'all_company', values: [] } },
    { type: 'all_company', values: [] });
  await grant('acct-phf005', 'PHF005', 'Nguyễn Minh Nhật', 'NHAN_VIEN',
    { access_knl: true, view_people: true }, { type: 'self', values: [] });

  const adminSession = session('admin', { id: 'u-admin' });
  const recommended = recommendedPeriod(), past = pastPeriod();

  // ============ Retroactive validation (server-side) ============
  let threw = null;
  try {
    await saveKnlEmployeeIncome(adminSession, { employeeCode: 'PHF051', payrollPeriod: past, employmentType: 'PROBATION', probationAmount: 6800000, reason: '' });
  } catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_RETROACTIVE_REASON_REQUIRED', 'B2.1 Kỳ hồi tố (' + past + ') không có reason -> reject KNL_RETROACTIVE_REASON_REQUIRED');

  threw = null;
  try {
    await saveKnlEmployeeIncome(adminSession, { employeeCode: 'PHF051', payrollPeriod: past, employmentType: 'PROBATION', probationAmount: 6800000, reason: 'abc' });
  } catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_RETROACTIVE_REASON_REQUIRED', 'B2.2 Kỳ hồi tố với reason quá ngắn (<5 ký tự) -> vẫn reject');

  rpcCalls.length = 0;
  const okRetro = await saveKnlEmployeeIncome(adminSession, { employeeCode: 'PHF051', payrollPeriod: past, employmentType: 'PROBATION', probationAmount: 6800000, reason: 'Hồi tố theo yêu cầu Giám đốc, xem lại kỳ trước.' });
  check(okRetro && okRetro.assignment && rpcCalls.length === 1 && rpcCalls[0].name === 'knl_save_employee_compensation', 'B2.3 Kỳ hồi tố với reason đủ dài -> PASS, gọi đúng 1 lần RPC knl_save_employee_compensation');

  rpcCalls.length = 0;
  const okFuture = await saveKnlEmployeeIncome(adminSession, { employeeCode: 'PHF051', payrollPeriod: recommended, employmentType: 'PROBATION', probationAmount: 6800000, reason: '' });
  check(okFuture && okFuture.assignment && rpcCalls.length === 1, 'B2.4 Kỳ khuyến nghị N+1 (' + recommended + ') KHÔNG cần reason -> PASS bình thường (không phá vỡ hành vi cũ)');
  check(rpcCalls[0].params.p_payroll_period === recommended && rpcCalls[0].params.p_probation_amount === 6800000, 'B2.5 Payload gửi RPC giữ nguyên đúng cấu trúc cũ (period/probation amount không bị Batch 2 làm sai lệch)');

  // ============ listKnlEmployeeCompensationPeriods — permission mới KHÔNG mở rộng quyền ============
  const periodsSelf = await listKnlEmployeeCompensationPeriods(session('learner', { id: 'acct-phf051', employeeCode: 'PHF051' }));
  check(periodsSelf.employeeCode === 'PHF051' && Array.isArray(periodsSelf.periods) && periodsSelf.periods.length === 2, 'B2.6 Self (PHF051) xem được đúng cả 2 kỳ vừa lưu qua listKnlEmployeeCompensationPeriods');
  check(periodsSelf.periods.every(p => typeof p.totalReferenceIncome === 'number'), 'B2.6b Mỗi kỳ trả về đủ số tiền/reference (không phá format publicAssignment cũ)');

  threw = null;
  try { await listKnlEmployeeCompensationPeriods(session('learner', { id: 'acct-phf005', employeeCode: 'PHF005' }), { employeeCode: 'PHF051' }); }
  catch (e) { threw = e; }
  check(!!threw && threw.code === 'KNL_INCOME_VIEW_DENIED', 'B2.7 PHF005 (không có income_view) bị chặn xem các kỳ của PHF051 -> KNL_INCOME_VIEW_DENIED (đúng permission cũ, không nới lỏng)');

  const periodsAdmin = await listKnlEmployeeCompensationPeriods(session('manager', { id: 'acct-phf002', employeeCode: 'PHF002' }), { employeeCode: 'PHF051' });
  check(periodsAdmin.periods.length === 2, 'B2.8 Giám đốc (income_view all_company) xem được các kỳ của PHF051 qua endpoint mới, đúng permission income hiện hành');

  // ============ Xác nhận getKnlEmployeeIncome (đọc "current") không bị Batch 2 ảnh hưởng ============
  const current = await getKnlEmployeeIncome(session('learner', { id: 'acct-phf051', employeeCode: 'PHF051' }));
  check(current.current && current.current.payrollPeriod === (recommended > past ? recommended : past), 'B2.9 getKnlEmployeeIncome vẫn trả đúng kỳ mới nhất là "current" (logic latest-period không đổi)');
  check(current.current.employmentType === 'PROBATION' && current.current.probationAmount === 6800000, 'B2.10 Số tiền/loại hình thử việc giữ nguyên đúng như đã lưu, không bị Batch 2 làm sai số');

  if (failures) {
    console.error('\n' + failures + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nALL PASS');
}

run().catch(err => { console.error('UNCAUGHT', err); process.exit(1); });
