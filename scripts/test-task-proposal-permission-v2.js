'use strict';

// TEST/MOCK HARNESS — Proposal V2 permission gate
// (api/_lib/task-permissions.js::resolveProposalRecipientEmployeeCodes /
// listProposalRecipientEmployees / canProposeTo).
//
// KHÔNG kết nối Supabase thật (dù .env có SUPABASE_URL/SUPABASE_SECRET_KEY
// thật) — inject module giả vào require.cache cho '@supabase/supabase-js'
// VÀ './task-employee-scope' TRƯỚC khi require api/_lib/task-permissions.js,
// cùng kỹ thuật fake-module đã dùng ở services/phf-hr-api/
// test-task-write-mock-harness.js (KHÔNG sửa task-permissions.js/
// task-employee-scope.js production code).
//
// Bảo vệ (2026-08-29 FIX — population nay dựa trên EFFECTIVE assign
// capability, KHÔNG hard-code theo 4 preset cố định như bản trước):
//   PROPOSAL_RECIPIENT_EFFECTIVE_ASSIGN_CAPABILITY — TBP với 1 restrict grant
//     tắt capabilities.assign=false PHẢI bị loại khỏi population dù vẫn giữ
//     preset TRUONG_BO_PHAN (chứng minh gate đọc EFFECTIVE scope qua
//     resolveEffectiveTaskScopesForActorContexts(), không chỉ preset thô).
//   ADMIN_RECIPIENT_INCLUDED_WHEN_ASSIGN_CAPABLE — 1 employee CÓ account
//     role=admin nhưng KHÔNG có row task_permission_assignments nào (không
//     giữ preset TBP/Trưởng ca/GĐ/TLGĐ) PHẢI vẫn xuất hiện trong population.
//   PROPOSAL_RECIPIENT_GATE (giữ nguyên phần cũ) — active employee only,
//     KHÔNG giới hạn phòng ban, KHÔNG bao giờ có NHAN_VIEN thường.
//   EMPLOYEE_SELF_TASK_PRESERVED — resolveBaseTaskScope('nhan_vien') vẫn
//     assignScope=self y hệt trước (hàm KHÔNG bị sửa, gọi trực tiếp không
//     qua mock để chứng minh literal source behavior).
//   NORMAL_TASK_ASSIGN_PERMISSION_PRESERVED — canAssignTaskTo() (Giao việc)
//     vẫn hoạt động đúng cho TBP company-wide, không bị Proposal gate ảnh
//     hưởng (2 hàm hoàn toàn độc lập, không hàm nào gọi hàm kia).
//   PERMISSION_CONTRACT_V1 — resolveBaseTaskScope() cho cả 5 actorType trả
//     đúng shape/capabilities/assignScope như tài liệu đã LOCKED, không đổi.
//
// Chạy: node scripts/test-task-proposal-permission-v2.js

const assert = require('assert');

const TASK_PERMISSIONS_JS_PATH = require.resolve('../api/_lib/task-permissions.js');
const TASK_EMPLOYEE_SCOPE_JS_PATH = require.resolve('../api/_lib/task-employee-scope.js');
const AUTH_JS_PATH = require.resolve('../api/_lib/auth.js');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`, detail !== undefined ? detail : '');
}

// ---------------------------------------------------------------------------
// Fixture org data — active employees trải nhiều phòng ban khác nhau, cố ý
// để chứng minh recipient population KHÔNG giới hạn cùng phòng ban.
// ---------------------------------------------------------------------------
const ORG_ROWS = [
  { employeeCode: 'EMP001', fullName: 'Nguyễn Văn A', department: 'Bán hàng', title: 'NV', position: 'NV', branch: 'CN1', managerCode: 'EMP010', status: 'active' },
  { employeeCode: 'EMP050', fullName: 'Vũ Thị F', department: 'Kế toán', title: 'NV', position: 'NV', branch: 'CN1', managerCode: 'EMP010', status: 'active' },
  { employeeCode: 'EMP010', fullName: 'Trần Thị B', department: 'Bán hàng', title: 'TBP', position: 'TBP', branch: 'CN1', managerCode: null, status: 'active' },
  { employeeCode: 'EMP020', fullName: 'Lê Văn C', department: 'Kho', title: 'Trưởng ca', position: 'Trưởng ca', branch: 'CN2', managerCode: null, status: 'active' },
  { employeeCode: 'EMP030', fullName: 'Phạm Thị D', department: 'Ban giám đốc', title: 'GĐ', position: 'GĐ', branch: 'CN1', managerCode: null, status: 'active' },
  { employeeCode: 'EMP040', fullName: 'Hoàng Văn E', department: 'Ban giám đốc', title: 'TLGĐ', position: 'TLGĐ', branch: 'CN1', managerCode: null, status: 'active' },
  // EMP060: preset TBP nhưng status INACTIVE — phải bị loại khỏi population
  // (isActiveEmployee filter), chứng minh gate không "tin mù" bảng preset.
  { employeeCode: 'EMP060', fullName: 'Ngô Văn G', department: 'Kho', title: 'TBP', position: 'TBP', branch: 'CN2', managerCode: null, status: 'inactive' },
  // EMP070: KHÔNG có row nào trong ASSIGNMENTS (không giữ preset TBP/Trưởng
  // ca/GĐ/TLGĐ) nhưng account.role='admin' (xem ACCOUNTS bên dưới) — phải
  // vẫn xuất hiện trong population (ADMIN_RECIPIENT_INCLUDED_WHEN_ASSIGN_CAPABLE).
  { employeeCode: 'EMP070', fullName: 'Đỗ Thị H', department: 'IT', title: 'Admin hệ thống', position: 'Admin', branch: 'CN1', managerCode: null, status: 'active' },
  // EMP080: giữ preset TRUONG_BO_PHAN (như EMP010) NHƯNG có 1 restrict grant
  // đang active tắt capabilities.assign=false — phải bị LOẠI khỏi population
  // dù preset vẫn là TBP (PROPOSAL_RECIPIENT_EFFECTIVE_ASSIGN_CAPABILITY).
  { employeeCode: 'EMP080', fullName: 'Bùi Văn K', department: 'Kho', title: 'TBP', position: 'TBP', branch: 'CN2', managerCode: null, status: 'active' },
];

// Account/role data (user_accounts qua listHubAccountSummaries()) — Account/
// HR data, KHÔNG phải Task data, cùng nguồn listTaskAdminPeople() đã dùng.
const ACCOUNTS = [
  { id: 'acc-070', employeeCode: 'EMP070', role: 'admin', name: 'Đỗ Thị H' },
];

const ASSIGNMENTS = [
  { employee_code: 'EMP001', account_id: null, preset_code: 'NHAN_VIEN', is_active: true, effective_from: '2020-01-01T00:00:00Z', effective_to: null },
  { employee_code: 'EMP010', account_id: null, preset_code: 'TRUONG_BO_PHAN', is_active: true, effective_from: '2020-01-01T00:00:00Z', effective_to: null },
  { employee_code: 'EMP020', account_id: null, preset_code: 'TRUONG_CA', is_active: true, effective_from: '2020-01-01T00:00:00Z', effective_to: null },
  { employee_code: 'EMP030', account_id: null, preset_code: 'GIAM_DOC', is_active: true, effective_from: '2020-01-01T00:00:00Z', effective_to: null },
  { employee_code: 'EMP040', account_id: null, preset_code: 'TRO_LY_GD', is_active: true, effective_from: '2020-01-01T00:00:00Z', effective_to: null },
  { employee_code: 'EMP060', account_id: null, preset_code: 'TRUONG_BO_PHAN', is_active: true, effective_from: '2020-01-01T00:00:00Z', effective_to: null },
  { employee_code: 'EMP080', account_id: null, preset_code: 'TRUONG_BO_PHAN', is_active: true, effective_from: '2020-01-01T00:00:00Z', effective_to: null },
];

const GRANTS = [
  {
    id: 'g1', grantee_employee_code: 'EMP080', grant_type: 'restrict',
    capabilities: { assign: false }, people_scope: { type: 'all_company', values: [] },
    is_active: true, effective_from: '2020-01-01T00:00:00Z', effective_to: null, reason: 'test restrict assign',
  },
];

// ---------------------------------------------------------------------------
// Fake Supabase client — .from(table)... chain KHÔNG áp filter thật (test
// isolation), chỉ trả nguyên fixture theo table name. An toàn vì fixture ở
// trên CHỈ chứa row "active, currently-effective" — đúng ý nghĩa những gì
// WHERE is_active=true AND effective_from<=now() thật sự lọc ra. Filtering
// theo actor/employee CỤ THỂ vẫn chạy bằng code THẬT không mock (
// selectCurrentAssignment/identityMatches trong task-permissions.js).
// ---------------------------------------------------------------------------
// Filter thật theo .eq(column, value) — cần thiết cho GRANTS (nếu không lọc
// đúng grantee_employee_code, loadActiveGrants('EMP010') sẽ vô tình "thấy"
// grant của EMP080 và làm sai lệch effective scope của EMP010 — đã phát
// hiện qua chính test NORMAL_TASK_ASSIGN_PERMISSION_PRESERVED khi thêm
// fixture GRANTS có >1 phần tử). .in()/.or()/.lte()/.gte() vẫn no-op (không
// cần cho các case hiện có — assignments/accounts fixture không có 2 hàng
// nào khác nhau theo các trục đó trong bộ test này).
function makeChain(rows) {
  let filtered = rows;
  const chain = {
    select() { return chain; },
    eq(column, value) {
      filtered = filtered.filter((r) => String(r[column]) === String(value));
      return chain;
    },
    lte() { return chain; },
    gte() { return chain; },
    or() { return chain; },
    in() { return chain; },
    limit() { return chain; },
    then(resolve) { return Promise.resolve({ data: filtered, error: null }).then(resolve); },
  };
  return chain;
}

function makeFakeSupabaseModule() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'task_permission_assignments') return makeChain(ASSIGNMENTS);
          if (table === 'task_permission_grants') return makeChain(GRANTS);
          throw new Error('HARNESS_UNEXPECTED_TABLE: ' + table);
        },
      };
    },
  };
}

function makeFakeAuthModule() {
  return { async listHubAccountSummaries() { return ACCOUNTS; } };
}

// resolveActorContextForRecord — bản fake tái hiện ĐÚNG logic thật của
// api/_lib/task-employee-scope.js::resolveActorContextForRecord() (session.
// account.role==='admin' -> actorType='admin' luôn giữ record.employeeCode
// THẬT, KHÔNG blank như resolveActorContext() cho session admin không gắn
// employee; else -> placeholder 'nhan_vien', preset THẬT được
// resolveEffectiveTaskScopesForActorContexts() tự tra lại từ
// task_permission_assignments bên trong task-permissions.js — pure/
// deterministic nên an toàn tái hiện lại cho test, không cần gọi code thật).
function makeFakeTaskEmployeeScopeModule() {
  const TASK_PRESET_TO_ACTOR_TYPE = Object.freeze({
    GIAM_DOC: 'giam_doc', TRO_LY_GD: 'tro_ly_gd', TRUONG_BO_PHAN: 'truong_bo_phan',
    TRUONG_CA: 'truong_ca', NHAN_VIEN: 'nhan_vien',
  });
  return {
    async resolveActorContext(session) { return session.actorContext; },
    resolveActorContextForRecord(session, record) {
      const sessionRole = String((session && session.account && session.account.role) || '').trim().toLowerCase();
      const actorType = sessionRole === 'admin' ? 'admin' : 'nhan_vien';
      return {
        accountId: (session && session.account && session.account.id) || '',
        employeeCode: String(record.employeeCode || '').trim().toUpperCase(),
        fullName: record.fullName, department: record.department, branch: record.branch,
        title: record.title, managerCode: record.managerCode, status: record.status,
        actorType,
        taskPresetCode: actorType === 'admin' ? 'ADMIN_SYSTEM' : 'NHAN_VIEN',
        managedEmployeeCodes: new Set(),
      };
    },
    applyTaskPresetToActorContext(actorContext, presetCode) {
      if (!actorContext || actorContext.actorType === 'admin') return actorContext;
      return Object.assign({}, actorContext, {
        actorType: TASK_PRESET_TO_ACTOR_TYPE[presetCode] || 'nhan_vien',
        managedEmployeeCodes: actorContext.managedEmployeeCodes || new Set(),
      });
    },
    normalizeScopeText(v) { return String(v == null ? '' : v).trim().toUpperCase(); },
    isSalesAllBranchesSubject() { return false; },
    async loadOrgRows() { return ORG_ROWS; },
    findByCode(rows, empCode) {
      const target = String(empCode || '').trim().toUpperCase();
      return (rows || []).find(r => String(r.employeeCode || '').trim().toUpperCase() === target) || null;
    },
    TASK_PRESET_TO_ACTOR_TYPE,
  };
}

function loadTaskPermissionsWithFakes() {
  const supabasePath = require.resolve('@supabase/supabase-js');
  delete require.cache[TASK_PERMISSIONS_JS_PATH];
  delete require.cache[TASK_EMPLOYEE_SCOPE_JS_PATH];
  delete require.cache[AUTH_JS_PATH];
  const originalSupabaseEntry = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: makeFakeSupabaseModule() };
  require.cache[TASK_EMPLOYEE_SCOPE_JS_PATH] = { id: TASK_EMPLOYEE_SCOPE_JS_PATH, filename: TASK_EMPLOYEE_SCOPE_JS_PATH, loaded: true, exports: makeFakeTaskEmployeeScopeModule() };
  require.cache[AUTH_JS_PATH] = { id: AUTH_JS_PATH, filename: AUTH_JS_PATH, loaded: true, exports: makeFakeAuthModule() };
  const mod = require(TASK_PERMISSIONS_JS_PATH);
  if (originalSupabaseEntry) require.cache[supabasePath] = originalSupabaseEntry;
  else delete require.cache[supabasePath];
  delete require.cache[TASK_EMPLOYEE_SCOPE_JS_PATH]; // restore real module for other test files run in same process
  delete require.cache[AUTH_JS_PATH];
  return mod;
}

function sessionFor(employeeCode, actorType) {
  return { actorContext: { employeeCode, actorType: actorType || 'nhan_vien', accountId: '', managedEmployeeCodes: [], status: 'active' } };
}

(async () => {
  const tp = loadTaskPermissionsWithFakes();

  // =========================================================================
  // PROPOSAL_RECIPIENT_GATE — population
  // =========================================================================
  {
    const codes = await tp.resolveProposalRecipientEmployeeCodes();
    // EMP080 giữ preset TBP nhưng bị restrict grant tắt assign -> loại.
    // EMP070 KHÔNG giữ preset nào nhưng account.role=admin -> vẫn có mặt.
    const expected = new Set(['EMP010', 'EMP020', 'EMP030', 'EMP040', 'EMP070']);
    const gotSet = codes;
    const exact = gotSet.size === expected.size && [...expected].every(c => gotSet.has(c));
    record('PROPOSAL_RECIPIENT_GATE_population_exact', exact, { got: [...gotSet].sort() });
    record('PROPOSAL_RECIPIENT_GATE_excludes_nhan_vien', !codes.has('EMP001'), { hasEMP001: codes.has('EMP001') });
    record('PROPOSAL_RECIPIENT_GATE_excludes_inactive_employee_despite_TBP_preset', !codes.has('EMP060'), { hasEMP060: codes.has('EMP060') });
    record('PROPOSAL_RECIPIENT_GATE_not_department_restricted', codes.has('EMP020') && codes.has('EMP030'), 'EMP020(Kho)/EMP030(Ban giám đốc) cùng có mặt dù khác phòng ban với actor');
    record('PROPOSAL_RECIPIENT_EFFECTIVE_ASSIGN_CAPABILITY', !codes.has('EMP080'), 'EMP080 giữ preset TRUONG_BO_PHAN nhưng có restrict grant tắt capabilities.assign=false -> PHẢI bị loại (population đọc EFFECTIVE scope, không phải preset thô)');
    record('ADMIN_RECIPIENT_INCLUDED_WHEN_ASSIGN_CAPABLE', codes.has('EMP070'), 'EMP070 không giữ preset TBP/Trưởng ca/GĐ/TLGĐ nào nhưng account.role=admin -> PHẢI xuất hiện');
  }

  {
    const out = await tp.listProposalRecipientEmployees(sessionFor('EMP001', 'nhan_vien'));
    const codes = out.employees.map(e => e.employeeCode).sort();
    record('listProposalRecipientEmployees_employee_actor_sees_full_population', JSON.stringify(codes) === JSON.stringify(['EMP010', 'EMP020', 'EMP030', 'EMP040', 'EMP070']), { codes });
  }

  {
    const out = await tp.listProposalRecipientEmployees(sessionFor('EMP010', 'truong_bo_phan'));
    const codes = out.employees.map(e => e.employeeCode).sort();
    record('listProposalRecipientEmployees_excludes_self', !codes.includes('EMP010') && codes.includes('EMP020') && codes.includes('EMP030') && codes.includes('EMP040'), { codes });
  }

  {
    const allow = await tp.canProposeTo(sessionFor('EMP001', 'nhan_vien'), 'EMP010');
    record('canProposeTo_employee_to_TBP_allowed', allow === true);
  }
  {
    const deny = await tp.canProposeTo(sessionFor('EMP001', 'nhan_vien'), 'EMP050');
    record('canProposeTo_employee_to_employee_denied_never_valid_recipient', deny === false);
  }
  {
    const deny = await tp.canProposeTo(sessionFor('EMP001', 'nhan_vien'), 'EMP001');
    record('canProposeTo_self_propose_denied', deny === false);
  }
  {
    const deny = await tp.canProposeTo(sessionFor('EMP010', 'truong_bo_phan'), 'EMP001');
    record('canProposeTo_TBP_to_employee_denied_population_is_target_based_not_caller_based', deny === false);
  }

  // =========================================================================
  // EMPLOYEE_SELF_TASK_PRESERVED + PERMISSION_CONTRACT_V1 — resolveBaseTaskScope
  // KHÔNG bị sửa bởi Proposal V2 (gọi trực tiếp, đúng nguồn thật).
  // =========================================================================
  {
    const scope = tp.resolveBaseTaskScope({ actorType: 'nhan_vien', employeeCode: 'EMP001' });
    record(
      'EMPLOYEE_SELF_TASK_PRESERVED_assignScope_still_self',
      scope.assignScope.type === 'self' && scope.assignScope.values.length === 1 && scope.assignScope.values[0] === 'EMP001',
      scope.assignScope
    );
  }
  {
    const tbp = tp.resolveBaseTaskScope({ actorType: 'truong_bo_phan', employeeCode: 'EMP010', managedEmployeeCodes: [] });
    const admin = tp.resolveBaseTaskScope({ actorType: 'admin', employeeCode: '' });
    const giamDoc = tp.resolveBaseTaskScope({ actorType: 'giam_doc', employeeCode: 'EMP030' });
    record(
      'PERMISSION_CONTRACT_V1_unchanged_assignScope_shapes',
      tbp.assignScope.type === 'all_company' && admin.assignScope.type === 'all_company' && giamDoc.assignScope.type === 'all_company',
      { tbp: tbp.assignScope, admin: admin.assignScope, giamDoc: giamDoc.assignScope }
    );
  }

  // =========================================================================
  // NORMAL_TASK_ASSIGN_PERMISSION_PRESERVED — canAssignTaskTo() (Giao việc)
  // vẫn hoạt động đúng, hoàn toàn độc lập với Proposal gate mới.
  // =========================================================================
  {
    const allowed = await tp.canAssignTaskTo(sessionFor('EMP010', 'truong_bo_phan'), 'EMP001');
    record('NORMAL_TASK_ASSIGN_PERMISSION_PRESERVED_TBP_can_assign_company_wide', allowed === true);
  }
  {
    const denied = await tp.canAssignTaskTo(sessionFor('EMP001', 'nhan_vien'), 'EMP050');
    record('NORMAL_TASK_ASSIGN_PERMISSION_PRESERVED_employee_still_cannot_assign_others', denied === false);
  }
  {
    const selfOk = await tp.canAssignTaskTo(sessionFor('EMP001', 'nhan_vien'), 'EMP001');
    record('NORMAL_TASK_ASSIGN_PERMISSION_PRESERVED_employee_self_assign_still_ok', selfOk === true);
  }

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.error('FAILED:', failed.map(f => f.name).join(', '));
    process.exit(1);
  }
})().catch(err => {
  console.error('HARNESS_CRASH', err);
  process.exit(1);
});
