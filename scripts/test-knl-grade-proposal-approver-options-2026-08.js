'use strict';
/*
 * KNL "Đề xuất nâng bậc" — getGradePromotionApproverOptions (2026-08-12,
 * batch redesign "Tạo đề xuất"). Regression test cho hàm READ mới, xác nhận
 * nó trả ĐÚNG cùng tập người mà resolveApprovalChain() (nhánh Sales) đã và
 * đang dùng để validate selectedFirstApproverEmployeeCode lúc submit — không
 * business rule mới, chỉ liệt kê trước cùng 1 predicate.
 *
 * In-memory only — mock theo đúng kỹ thuật ở scripts/test-knl-grade-proposals.js.
 * Chạy thủ công: node scripts/test-knl-grade-proposal-approver-options-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const permissionsPath = require.resolve('../lib/knl-permissions');
const peoplePath = require.resolve('../lib/knl-people');
const scopePath = require.resolve('../lib/knl-scope');
const proposalsPath = require.resolve('../lib/knl-grade-proposals');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function uid(prefix) { return prefix + '-' + Math.random().toString(36).slice(2); }

function makeTableFactory(rows) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null, singleMode = null, mode = 'select', insertPayload = null, updatePayload = null;
    const q = {
      select() { return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      order(field, o) { orderSpecs.push({ field, asc: !(o && o.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      insert(payload) { mode = 'insert'; insertPayload = payload; return q; },
      update(payload) { mode = 'update'; updatePayload = payload; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'insert') {
            const list = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
            const inserted = list.map(obj => { const row = Object.assign({ id: uid('gen'), created_at: new Date().toISOString(), is_active: true }, obj); rows.push(row); return row; });
            resolve({ data: clone(singleMode ? inserted[0] : inserted), error: null }); return;
          }
          if (mode === 'update') {
            const matched = rows.filter(r => filters.every(fn => fn(r)));
            matched.forEach(r => Object.assign(r, updatePayload));
            resolve({ data: clone(singleMode ? (matched[0] || null) : matched), error: null }); return;
          }
          let matched = rows.filter(r => filters.every(fn => fn(r)));
          orderSpecs.forEach(spec => { matched = matched.slice().sort((a, b) => (a[spec.field] < b[spec.field] ? -1 : a[spec.field] > b[spec.field] ? 1 : 0) * (spec.asc ? 1 : -1)); });
          if (limitN != null) matched = matched.slice(0, limitN);
          if (singleMode) { resolve({ data: clone(matched[0] || null), error: null }); return; }
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

const STATE = { grants: [], history: [], employees: [] };

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'knl_permission_grant_history') return makeTableFactory(STATE.history)();
          if (table === 'employee_profiles') return makeTableFactory(STATE.employees)();
          throw new Error('Unexpected table in mock: ' + table);
        },
        rpc() { throw new Error('RPC not mocked (write path out of scope for this READ-only test)'); }
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
  [permissionsPath, peoplePath, scopePath, proposalsPath].forEach(p => delete require.cache[p]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const permissionsLib = require(permissionsPath);
  const proposalsLib = require(proposalsPath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return { permissionsLib, proposalsLib };
}

const { permissionsLib, proposalsLib } = loadLibsWithMock();
const { upsertKnlPermissionGrant: upsertGrant } = permissionsLib;
const { getGradePromotionApproverOptions: getApproverOptions } = proposalsLib;

STATE.employees.push(
  { employee_code: 'NVKHO1', full_name: 'NV Kho 1', title: 'Nhân viên', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'TBPKHO1', employment_status: 'active' },
  { employee_code: 'TBPKHO1', full_name: 'TBP Kho', title: 'Trưởng bộ phận Kho', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'TIEN1', full_name: 'Trợ Lý Bán hàng', title: 'Trợ lý Giám đốc', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'TC1', full_name: 'Trưởng ca Phú Lợi', title: 'Trưởng ca', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', manager_employee_code: 'TIEN1', employment_status: 'active' },
  { employee_code: 'TC2', full_name: 'Trưởng ca Ngô Quyền', title: 'Trưởng ca', department: 'Bộ phận bán hàng', branch: 'Ngô Quyền', manager_employee_code: 'TIEN1', employment_status: 'active' },
  { employee_code: 'TC3', full_name: 'Trưởng ca Chưa Được Cấp Quyền', title: 'Trưởng ca', department: 'Bộ phận bán hàng', branch: 'Lái Thiêu', manager_employee_code: 'TIEN1', employment_status: 'active' },
  { employee_code: 'NVSALES1', full_name: 'NV Bán hàng 1', title: 'Nhân viên', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', manager_employee_code: 'TIEN1', employment_status: 'active' },
  { employee_code: 'NVSALESGONE', full_name: 'NV Bán hàng Đã nghỉ', title: 'Nhân viên', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', manager_employee_code: 'TIEN1', employment_status: 'inactive' }
);

function session(role, opts) { opts = opts || {}; return { role, account: { id: opts.id || '', name: opts.name || '' }, employeeId: opts.employeeCode || '', sub: opts.id || '' }; }
async function grant(accountId, employeeCode, presetCode, capabilities, peopleScope) {
  return upsertGrant(session('admin', { id: 'admin-seed' }), { accountId, employeeCode, presetCode, capabilities, peopleScope, reason: 'approver-options test fixture' });
}

let failures = 0;
function check(cond, msg) { if (!cond) { console.error('FAIL: ' + msg); failures++; } else console.log('PASS: ' + msg); }

async function run() {
  // Actor gọi API — bất kỳ ai có propose:true (Tiên, quản lý phòng ban khác) đều được xem picker.
  await grant('acc-tien', 'TIEN1', 'TRO_LY_GD', { access_knl: true, view_people: true, propose: true }, { type: 'all_company', values: [] });
  const callerSession = session('learner', { id: 'acc-tien', employeeCode: 'TIEN1' });

  // ---- 1. Non-Sales subject -> required=false ----
  let r1 = await getApproverOptions(callerSession, { employeeCode: 'NVKHO1' });
  check(r1.required === false && r1.approvers.length === 0, '1. Subject không thuộc Bán hàng -> required=false, không liệt kê approver nào');

  // ---- 2. Chưa cấu hình Sales approver nào -> configured=false ----
  let r2 = await getApproverOptions(callerSession, { employeeCode: 'NVSALES1' });
  check(r2.required === true && r2.configured === false && r2.approvers.length === 0, '2. Chưa có Trưởng ca nào được cấp agree_proposal+sales_all_branches -> configured=false (fail-closed, đúng resolveApprovalChain)');

  // ---- Cấp quyền TC1/TC2 đúng sales_all_branches, TC3 KHÔNG có grant (dù title Trưởng ca) ----
  await grant('acc-tc1', 'TC1', 'TRUONG_CA_CHTR', { access_knl: true, view_people: true, propose: true, agree_proposal: true }, { type: 'sales_all_branches', values: [] });
  await grant('acc-tc2', 'TC2', 'TRUONG_CA_CHTR', { access_knl: true, view_people: true, propose: true, agree_proposal: true }, { type: 'sales_all_branches', values: [] });
  // TBPKHO1 có agree_proposal nhưng scope department=Kho -> KHÔNG match subject Sales.
  await grant('acc-tbpkho', 'TBPKHO1', 'TRUONG_BO_PHAN', { access_knl: true, view_people: true, agree_proposal: true }, { type: 'department', values: ['Kho'] });

  // ---- 3. Sales subject không phải approver -> required=true, configured=true, approvers = [TC1, TC2] ----
  let r3 = await getApproverOptions(callerSession, { employeeCode: 'NVSALES1' });
  check(r3.required === true && r3.configured === true, '3.1 NVSALES1 (Sales, không phải approver) -> required=true, configured=true');
  const codes3 = r3.approvers.map(a => a.employeeCode).sort();
  check(JSON.stringify(codes3) === JSON.stringify(['TC1', 'TC2']), '3.2 Approvers đúng = [TC1, TC2] — TC3 (title Trưởng ca nhưng KHÔNG có grant) và TBPKHO1 (grant sai scope) bị loại đúng');
  check(r3.approvers.every(a => a.employeeCode !== 'NVSALES1'), '3.3 Subject không tự xuất hiện trong danh sách approver của chính mình');
  check(r3.approvers.some(a => a.employeeName === 'Trưởng ca Phú Lợi') && r3.approvers.some(a => a.employeeName === 'Trưởng ca Ngô Quyền'), '3.4 employeeName trả đúng để hiển thị picker');

  // ---- 4. Sales subject CHÍNH LÀ approver (TC1 tự đề xuất bậc cho TC1) -> required=false ----
  let r4 = await getApproverOptions(callerSession, { employeeCode: 'TC1' });
  check(r4.required === false, '4. Subject Sales nhưng chính là approver (có agree_proposal) -> required=false, không cần chọn ai');

  // ---- 5. Nhân sự đã nghỉ việc bị loại khỏi danh sách approver dù có grant giả định ----
  await grant('acc-gone', 'NVSALESGONE', 'TRUONG_CA_CHTR', { access_knl: true, view_people: true, propose: true, agree_proposal: true }, { type: 'sales_all_branches', values: [] });
  let r5 = await getApproverOptions(callerSession, { employeeCode: 'NVSALES1' });
  check(!r5.approvers.some(a => a.employeeCode === 'NVSALESGONE'), '5. Nhân sự đã nghỉ việc (dù có grant agree_proposal hợp lệ) bị loại khỏi danh sách approver');

  // ---- 6. Permission gate: actor không có propose -> reject ----
  await grant('acc-noprop', 'NOPROP1', 'NHAN_VIEN', { access_knl: true, view_people: true, propose: false }, { type: 'self', values: [] });
  STATE.employees.push({ employee_code: 'NOPROP1', full_name: 'NV Không có propose', title: 'Nhân viên', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' });
  const noProposeSession = session('learner', { id: 'acc-noprop', employeeCode: 'NOPROP1' });
  let r6 = await getApproverOptions(noProposeSession, { employeeCode: 'NVSALES1' }).then(() => ({ ok: true })).catch(e => ({ ok: false, code: e.code }));
  check(r6.ok === false && r6.code === 'KNL_PROPOSE_DENIED', '6. Actor không có propose capability -> reject KNL_PROPOSE_DENIED (đúng gate requirePropose, cùng gate với getGradeOptionsForSubject)');

  // ---- 7. Subject không tồn tại -> 404 rõ ràng, không âm thầm trả rỗng ----
  let r7 = await getApproverOptions(callerSession, { employeeCode: 'GHOST999' }).then(() => ({ ok: true })).catch(e => ({ ok: false, code: e.code }));
  check(r7.ok === false && r7.code === 'KNL_PROPOSAL_SUBJECT_NOT_FOUND', '7. Subject không có trong Organization Master -> 404 KNL_PROPOSAL_SUBJECT_NOT_FOUND');

  console.log(failures === 0 ? '\nALL PASS' : '\n' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
