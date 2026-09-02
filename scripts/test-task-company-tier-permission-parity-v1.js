'use strict';

/*
 * PHF Task — COMPANY-LEVEL PERMISSION CLEANUP (2026-08-28).
 *
 * Business contract LOCKED by the user for this gate:
 *   ADMIN_TASK_BUSINESS = GIAM_DOC_TASK_BUSINESS = TRO_LY_GD_TASK_BUSINESS
 *   The ONLY allowed difference: "Cài đặt" (Task category settings) is
 *   Admin-only. Everything else (company-wide view, create, assign,
 *   detail, comment, deadline, transfer primary, related, cancel, reopen,
 *   proposal) must be identical for Admin/Giám đốc/3 Trợ lý GĐ.
 *
 * Identity resolution (from employee_profiles, real dev DB — NOT guessed):
 *   Admin      -> system account (no employeeCode), hr.phuhoacorp@gmail.com
 *   Giám đốc   -> PHF002 Trần Thu Thủy
 *   Trợ lý GĐ  -> PHF010 Nguyễn Thủy Tiên ("Tiên")
 *                 PHF032 Trần Hữu Vinh    ("Vinh")
 *                 PHF004 Trần Gia Bảo Ngọc ("Ngọc")
 *   (all 4 non-Admin confirmed via task_permission_assignments: PHF002=
 *   GIAM_DOC, PHF010/PHF032/PHF004=TRO_LY_GD, all is_active=true; Hub
 *   accounts role='manager' for all 4 -> roleHome()='/ql', so "Cài đặt"
 *   (adminOnly nav, gated on Hub role==='admin') is ALREADY hidden for
 *   all 4 non-Admin personas — confirmed, not re-implemented here.)
 *
 * Root cause of the parity gap this gate fixes: after the earlier G3 fix
 * (relation='received' relationship-only for ALL actors, including
 * executives — CORRECT and PRESERVED, see PART 1 below), the "Nhân sự tôi
 * quản lý" / scope=managed workspace for Admin/GĐ/TLGĐ was ALSO bounded to
 * managedEmployeeCodes (the TBP/Trưởng ca org-graph model) — this
 * incorrectly capped company-level authority to whatever direct-report
 * subtree happens to exist for that person, when business explicitly wants
 * unconditional company-wide visibility for this tier (mục 4 of this
 * gate's contract). Fixed in resolveAuthorizedTaskScope() (task-core.js)
 * and its read-bridge mirror via a new COMPANY_TIER_ACTOR_TYPES set:
 * scope=managed/cross_department/all_company now resolves to unrestricted
 * (company-wide) for admin/giam_doc/tro_ly_gd, while TBP/Trưởng ca keep the
 * exact managedEmployeeCodes-bounded behavior. hasManagedPeople is now
 * unconditionally true for company-tier actors (their company-wide
 * workspace always exists, independent of whether they happen to have any
 * direct reports in the org graph).
 *
 * "Tôi nhận" (relation='received', default/scope=mine) remains untouched —
 * self-only / Primary-only for EVERYONE, including company-tier — this is
 * the G3 Primary-responsibility guarantee (mục 5 of this gate's contract)
 * and is explicitly NOT reverted.
 *
 * HTTP, real local server (server.js) + real PHF_HR_SANDBOX dev DB, real
 * logins. WRITES throwaway fixtures (marked "[G3-COMPANY-TIER-TEST]" in the
 * title) that this script itself creates and cancels at the end of each
 * persona's block — sandbox DB only, no MAIN/live mutation, no reset/reseed.
 *
 *   node scripts/test-task-company-tier-permission-parity-v1.js
 */

const BASE = process.env.PHF_TASK_LOCAL_BASE || 'http://127.0.0.1:3000';
const PW = 'LocalParity#2026';
let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; fails.push(name); console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

async function login(email) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  const sc = r.headers.get('set-cookie') || '';
  const j = await r.json();
  if (!j.ok) throw new Error('login ' + email + ': ' + JSON.stringify(j));
  return sc.split(',').map(s => s.split(';')[0].trim()).filter(s => /=/.test(s)).join('; ');
}
async function api(cookie, payload) {
  const r = await fetch(BASE + '/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload) });
  let j; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, ok: j.ok === true, code: j.code || '', result: j.result };
}
function inDays(n) { return new Date(Date.now() + n * 86400000).toISOString(); }

const PERSONAS = {
  ADMIN: { email: 'hr.phuhoacorp@gmail.com', code: '', label: 'Admin hệ thống' },
  GD: { email: 'tranthuthuy@phuhoafresh.com', code: 'PHF002', label: 'Giám đốc — Trần Thu Thủy' },
  TIEN: { email: 'tienthuyng190400@gmail.com', code: 'PHF010', label: 'Trợ lý GĐ — Nguyễn Thủy Tiên' },
  VINH: { email: 'tranhuuvinh191099@gmail.com', code: 'PHF032', label: 'Trợ lý GĐ — Trần Hữu Vinh' },
  NGOC: { email: 'trangiabaongoc1996@gmail.com', code: 'PHF004', label: 'Trợ lý GĐ — Trần Gia Bảo Ngọc' },
};
const PRIMARY_TARGET = 'PHF082'; // real active NV, unrelated to any of the 5 above
const TRANSFER_TARGET = 'PHF073'; // real active NV, distinct from PRIMARY_TARGET
const RELATED_TARGET = 'PHF073';

// Business-action matrix result, filled in as we go — printed at the end.
const MATRIX = {};
function record(persona, action, passed) { MATRIX[action] = MATRIX[action] || {}; MATRIX[action][persona] = passed; }

(async () => {
  const cookies = {};
  for (const [k, p] of Object.entries(PERSONAS)) cookies[k] = await login(p.email);

  // =========================================================================
  // PART 0 — identity resolution sanity (from listTasks' own requesterActorType
  // field — canonical, server-resolved, not guessed).
  // =========================================================================
  console.log('\n[0] identity resolution (canonical, server-resolved)');
  const EXPECTED_ACTOR_TYPE = { ADMIN: 'admin', GD: 'giam_doc', TIEN: 'tro_ly_gd', VINH: 'tro_ly_gd', NGOC: 'tro_ly_gd' };
  for (const persona of Object.keys(PERSONAS)) {
    const r = await api(cookies[persona], { action: 'listTasks', relation: 'received', statusFilter: 'all', limit: 1 });
    ok(r.ok && r.result.requesterActorType === EXPECTED_ACTOR_TYPE[persona], `${persona} (${PERSONAS[persona].label}) requesterActorType = ${EXPECTED_ACTOR_TYPE[persona]}`, JSON.stringify(r.result && r.result.requesterActorType));
  }

  // =========================================================================
  // PART 1 — "Tôi nhận" (relation='received', default) — G3 Primary integrity
  // PRESERVED for company-tier: self-only, NOT company-wide, NOT reverted.
  // =========================================================================
  console.log('\n[1] "Tôi nhận" stays relationship-only (G3 preserved, not reverted)');
  for (const persona of Object.keys(PERSONAS)) {
    const r = await api(cookies[persona], { action: 'listTasks', relation: 'received', statusFilter: 'all', limit: 200 });
    const code = PERSONAS[persona].code;
    const prims = [...new Set((r.result.tasks || []).map(t => t.primary && t.primary.employee_code))];
    const selfOnly = code ? prims.every(p => p === code) : prims.length === 0;
    ok(r.ok && selfOnly, `${persona} "Tôi nhận": mọi Task đều có Primary = chính ${persona || 'Admin'} (relationship-only, KHÔNG company-wide)`, JSON.stringify(prims));
  }

  // =========================================================================
  // PART 2 — company-wide "Nhân sự tôi quản lý" (scope=managed) — THE FIX.
  // Admin/GĐ/TLGĐ must see identical company-wide task sets, independent of
  // whether their org-graph subtree happens to be large/small/empty.
  // =========================================================================
  console.log('\n[2] company-wide workspace (scope=managed) — parity across all 5');
  const managedCounts = {};
  for (const persona of Object.keys(PERSONAS)) {
    const r = await api(cookies[persona], { action: 'listTasks', relation: 'received', scope: 'managed', statusFilter: 'all', limit: 200 });
    ok(r.ok, `${persona} listTasks(scope=managed) = 200`, r.status + ' ' + r.code);
    ok(r.result.hasManagedPeople === true, `${persona} hasManagedPeople=true (company-tier always eligible for the workspace, independent of org-graph reports)`, r.result.hasManagedPeople);
    managedCounts[persona] = r.result.tasks.length;
    record(persona, 'Xem Task toàn công ty (workspace)', r.ok && r.result.hasManagedPeople === true);
  }
  const counts = Object.values(managedCounts);
  ok(counts.every(c => c === counts[0]), 'company-wide task COUNT is identical across Admin/GĐ/Tiên/Vinh/Ngọc (same authorized set)', JSON.stringify(managedCounts));

  // =========================================================================
  // PART 3 — per-persona full business-action lifecycle on a throwaway task
  // each persona creates themselves (Creator=persona, Primary=PHF082, i.e.
  // NOT self_task — proves company-wide authority does not corrupt Primary
  // responsibility metadata, mục 5 of the contract).
  // =========================================================================
  console.log('\n[3] business-action lifecycle per persona (create/assign/detail/comment/deadline/transfer/related/cancel)');
  const createdTaskIds = {};
  for (const persona of Object.keys(PERSONAS)) {
    const cookie = cookies[persona];
    const label = PERSONAS[persona].label;

    const created = await api(cookie, {
      action: 'createTaskDraft', flow_type: 'giao_viec',
      title: '[G3-COMPANY-TIER-TEST] ' + persona, content: 'Automated company-tier parity gate — throwaway, cancelled at end of run.',
      category_code: 'BAO_CAO', priority: 'thuong', deadline: inDays(7),
      primary_employee_code: PRIMARY_TARGET,
    });
    const createOk = !!(created.ok && created.result && created.result.id);
    ok(createOk, `${persona} (${label}) createTaskDraft (giao Task cho ${PRIMARY_TARGET}) succeeds`, created.status + ' ' + created.code);
    record(persona, 'Tạo Task', createOk);
    record(persona, 'Giao Task toàn công ty', createOk);
    if (!createOk) continue;
    const taskId = created.result.id;
    createdTaskIds[persona] = taskId;

    const published = await api(cookie, { action: 'publishTask', task_id: taskId, expected_row_version: created.result.row_version });
    ok(published.ok, `${persona} publishTask succeeds`, published.status + ' ' + published.code);

    const detail = await api(cookie, { action: 'getTaskDetail', task_id: taskId });
    const v = detail.result && detail.result.viewer;
    ok(detail.ok, `${persona} getTaskDetail succeeds`, detail.status + ' ' + detail.code);
    record(persona, 'Xem chi tiết', detail.ok);
    // Admin's viewer.relation is structurally always 'admin' (system_admin
    // intervention_basis), NOT 'creator' — a pre-existing, untouched design
    // (task-permissions.js::resolveTaskViewerAuthority — isAdmin short-
    // circuits BEFORE classifyTaskRelation). is_creator is therefore
    // correctly false for Admin even when Admin literally created the task;
    // for GĐ/TLGĐ (real employeeCode, no such short-circuit) is_creator must
    // be true. Both are asserted against their OWN correct expectation.
    if (persona === 'ADMIN') {
      ok(!!v && v.relation === 'admin' && v.intervention_basis === 'system_admin', `${persona} viewer.relation=admin, intervention_basis=system_admin (Admin's own distinct identity model, pre-existing/untouched)`, JSON.stringify(v));
    } else {
      ok(!!v && v.is_creator === true && v.intervention_basis === 'creator', `${persona} viewer.is_creator === true, intervention_basis=creator (Creator identity correct)`, JSON.stringify(v));
    }
    ok(!!v && v.is_active_primary === false, `${persona} viewer.is_active_primary === false (${persona} did NOT become Primary just by having company-wide authority — mục 5)`, JSON.stringify(v));
    ok(detail.result && detail.result.self_task === false, `${persona} self_task === false (Creator=${persona}, Primary=${PRIMARY_TARGET} — genuinely NOT self-assigned, "Tự giao" label correctly absent)`, JSON.stringify(detail.result.self_task));
    ok(!!v && v.actions && v.actions.cancel === true && v.actions.change_deadline === true && v.actions.transfer_primary === true && v.actions.add_related === true, `${persona} viewer.actions (cancel/change_deadline/transfer_primary/add_related) all true — full business capability`, JSON.stringify(v && v.actions));

    const commented = await api(cookie, { action: 'addTaskComment', task_id: taskId, body: '[G3-COMPANY-TIER-TEST] comment by ' + persona });
    ok(commented.ok, `${persona} addTaskComment (theo dõi) succeeds`, commented.status + ' ' + commented.code);
    record(persona, 'Comment/theo dõi', commented.ok);

    const afterComment = await api(cookie, { action: 'getTaskDetail', task_id: taskId });
    const rowVersionAfterComment = afterComment.result.task.row_version;

    const deadlineChanged = await api(cookie, { action: 'changeTaskDeadline', task_id: taskId, expected_row_version: rowVersionAfterComment, new_deadline: inDays(10), reason: '[G3-COMPANY-TIER-TEST] gia hạn' });
    ok(deadlineChanged.ok, `${persona} changeTaskDeadline succeeds`, deadlineChanged.status + ' ' + deadlineChanged.code);
    record(persona, 'Thay deadline', deadlineChanged.ok);

    const afterDeadline = await api(cookie, { action: 'getTaskDetail', task_id: taskId });
    let rv = afterDeadline.result.task.row_version;

    const related = await api(cookie, { action: 'addTaskRelated', task_id: taskId, target_employee_code: RELATED_TARGET });
    ok(related.ok, `${persona} addTaskRelated succeeds`, related.status + ' ' + related.code);
    record(persona, 'Thêm Related', related.ok);
    const removedRelated = await api(cookie, { action: 'removeTaskRelated', task_id: taskId, target_employee_code: RELATED_TARGET });
    ok(removedRelated.ok, `${persona} removeTaskRelated succeeds`, removedRelated.status + ' ' + removedRelated.code);
    record(persona, 'Xóa Related', removedRelated.ok);

    const afterRelated = await api(cookie, { action: 'getTaskDetail', task_id: taskId });
    rv = afterRelated.result.task.row_version;

    const transferred = await api(cookie, { action: 'transferTaskPrimary', task_id: taskId, expected_row_version: rv, new_primary_employee_code: TRANSFER_TARGET, reason: '[G3-COMPANY-TIER-TEST] chuyển Primary' });
    ok(transferred.ok, `${persona} transferTaskPrimary succeeds`, transferred.status + ' ' + transferred.code);
    record(persona, 'Chuyển Primary', transferred.ok);

    const afterTransfer = await api(cookie, { action: 'getTaskDetail', task_id: taskId });
    ok(afterTransfer.result.primary && afterTransfer.result.primary.employee_code === TRANSFER_TARGET, `${persona} Primary metadata correctly updated to ${TRANSFER_TARGET} after transfer (trách nhiệm Primary vẫn đúng)`, JSON.stringify(afterTransfer.result.primary));
    ok(afterTransfer.result.viewer.is_active_primary === false, `${persona} viewer.is_active_primary vẫn false sau transfer (Primary là ${TRANSFER_TARGET}, không phải ${persona})`, JSON.stringify(afterTransfer.result.viewer));

    const cancelled = await api(cookie, { action: 'cancelTask', task_id: taskId, expected_row_version: afterTransfer.result.task.row_version, reason: '[G3-COMPANY-TIER-TEST] cleanup' });
    ok(cancelled.ok, `${persona} cancelTask succeeds (cleanup)`, cancelled.status + ' ' + cancelled.code);
    record(persona, 'Cancel', cancelled.ok);
  }

  // =========================================================================
  // PART 4 — Proposal relations sanity (unaffected by this fix — quick check
  // all 5 personas can query proposal_sent/proposal_received without error).
  // =========================================================================
  console.log('\n[4] proposal relations (unaffected, sanity only)');
  for (const persona of Object.keys(PERSONAS)) {
    const sent = await api(cookies[persona], { action: 'listTasks', relation: 'proposal_sent', statusFilter: 'all', limit: 50 });
    const recv = await api(cookies[persona], { action: 'listTasks', relation: 'proposal_received', statusFilter: 'all', limit: 50 });
    ok(sent.ok && recv.ok, `${persona} proposal_sent/proposal_received both 200`, sent.status + '/' + recv.status);
    record(persona, 'Proposal', sent.ok && recv.ok);
  }

  // =========================================================================
  // PART 5 — the ONE allowed difference: "Cài đặt" (task category admin) —
  // ONLY Admin can manage categories; GĐ/3 TLGĐ must be denied.
  // =========================================================================
  console.log('\n[5] "Cài đặt" (Settings) — the ONLY allowed difference');
  for (const persona of Object.keys(PERSONAS)) {
    const r = await api(cookies[persona], { action: 'listAdminTaskCategories' });
    const expectAllowed = persona === 'ADMIN';
    ok(r.ok === expectAllowed, `${persona} listAdminTaskCategories ${expectAllowed ? 'ALLOWED' : 'DENIED'}`, r.status + ' ' + r.code);
    record(persona, 'Cài đặt (danh mục)', r.ok); // raw capability — the matrix must SHOW the one intentional asymmetry, not "matched expectation"
  }

  // =========================================================================
  // PART 5b — BUSINESS CONTRACT CORRECTION (2026-08-29): "Nhân sự & phân
  // quyền" is now Admin = GĐ = Tiên = Vinh = Ngọc (view AND write — grant
  // create/revoke), NOT Admin-only. Authorized by canonical capability
  // (scope.capabilities.manage, admin/giam_doc/tro_ly_gd preset-derived),
  // not by name/account special-casing.
  // =========================================================================
  console.log('\n[5b] "Nhân sự & phân quyền" — Admin = GĐ = Tiên = Vinh = Ngọc (view + write)');
  for (const persona of Object.keys(PERSONAS)) {
    const r = await api(cookies[persona], { action: 'listTaskAdminPeople' });
    ok(r.ok, `${persona} listTaskAdminPeople ALLOWED (view)`, r.status + ' ' + r.code);
    record(persona, 'Nhân sự & phân quyền (xem)', r.ok);

    const created = await api(cookies[persona], { action: 'createTaskPermissionGrant', grantee_employee_code: 'PHF082', grant_type: 'extend', people_scope: { type: 'employees', values: ['PHF073'] }, reason: '[G3-COMPANY-TIER-TEST] ' + persona + ' write-path probe' });
    ok(created.ok, `${persona} createTaskPermissionGrant ALLOWED (write)`, created.status + ' ' + created.code);
    record(persona, 'Nhân sự & phân quyền (ghi: grant)', created.ok);
    if (created.ok && created.result && created.result.grant && created.result.grant.id) {
      const revoked = await api(cookies[persona], { action: 'revokeTaskPermissionGrant', grant_id: created.result.grant.id, reason: '[G3-COMPANY-TIER-TEST] cleanup' });
      ok(revoked.ok, `${persona} revokeTaskPermissionGrant ALLOWED (cleanup)`, revoked.status + ' ' + revoked.code);
    }

    const probeListing = await api(cookies[persona], { action: 'listTasks', relation: 'received', limit: 1 });
    ok(probeListing.result.canManageTaskPermissions === true, `${persona} canManageTaskPermissions=true (frontend nav signal)`, probeListing.result.canManageTaskPermissions);
  }

  // =========================================================================
  // PART 6 — REGRESSION: TBP/Trưởng ca must keep the EXACT managed-graph-
  // bounded behavior (NOT company-wide) — this fix must not leak upward to
  // them.
  // =========================================================================
  console.log('\n[6] REGRESSION — TBP/Trưởng ca stay managed-graph-bounded (NOT company-wide)');
  const cTBP = await login('nguyenhai1372005@gmail.com'); // PHF034 TBP kho vận
  const cTC = await login('lenguyen.phf.3979@gmail.com');  // PHF018 Trưởng ca
  const cNV = await login('phuoclyminh789@gmail.com');     // PHF082 nhân viên

  const tbpManaged = await api(cTBP, { action: 'listTasks', relation: 'received', scope: 'managed', statusFilter: 'all', limit: 200 });
  const tbpManagedPrims = [...new Set((tbpManaged.result.tasks || []).map(t => t.primary && t.primary.employee_code))];
  ok(tbpManagedPrims.every(p => p === 'PHF073' || p === 'PHF005'), 'PHF034 (TBP) scope=managed still bounded to {PHF073, PHF005} — NOT company-wide', JSON.stringify(tbpManagedPrims));
  ok(tbpManaged.result.requesterActorType === 'truong_bo_phan', 'PHF034 requesterActorType unaffected');

  const tcManaged = await api(cTC, { action: 'listTasks', relation: 'received', scope: 'managed', statusFilter: 'all', limit: 200 });
  const tcManagedPrims = [...new Set((tcManaged.result.tasks || []).map(t => t.primary && t.primary.employee_code))];
  ok(!tcManagedPrims.some(p => p === 'PHF073' || p === 'PHF005'), 'PHF018 (Trưởng ca) scope=managed does NOT leak PHF034’s managed people — still bounded to own subtree', JSON.stringify(tcManagedPrims));

  const managedCompanyWideCount = managedCounts.ADMIN;
  ok(tbpManaged.result.tasks.length <= managedCompanyWideCount, 'PHF034 (TBP) managed count stays a bounded subset, not the full company-wide count', tbpManaged.result.tasks.length + ' vs company-wide ' + managedCompanyWideCount);

  const tbpAdminPeople = await api(cTBP, { action: 'listTaskAdminPeople' });
  ok(!tbpAdminPeople.ok, 'PHF034 (TBP) KHÔNG được xem "Nhân sự & phân quyền" (business contract correction chỉ áp dụng company-tier)', tbpAdminPeople.status + ' ' + tbpAdminPeople.code);
  const tcAdminPeople = await api(cTC, { action: 'listTaskAdminPeople' });
  ok(!tcAdminPeople.ok, 'PHF018 (Trưởng ca) KHÔNG được xem "Nhân sự & phân quyền"', tcAdminPeople.status + ' ' + tcAdminPeople.code);

  // =========================================================================
  // PART 7 — REGRESSION: Nhân viên thường stays fully self-bounded, no leak.
  // =========================================================================
  console.log('\n[7] REGRESSION — Nhân viên thường (PHF082) stays self-bounded, no company leak');
  const nvReceived = await api(cNV, { action: 'listTasks', relation: 'received', statusFilter: 'all', limit: 200 });
  ok(nvReceived.result.viewScopeType === 'self', 'PHF082 viewScopeType=self (unaffected)');
  const nvManaged = await api(cNV, { action: 'listTasks', relation: 'received', scope: 'managed', statusFilter: 'all', limit: 200 });
  ok(nvManaged.result.tasks.length === 0 && nvManaged.result.hasManagedPeople === false, 'PHF082 scope=managed still empty, hasManagedPeople=false — no company-tier leak to plain employee', JSON.stringify({ tasks: nvManaged.result.tasks.length, hasManagedPeople: nvManaged.result.hasManagedPeople }));
  const nvAdminPeople = await api(cNV, { action: 'listAdminTaskCategories' });
  ok(!nvAdminPeople.ok, 'PHF082 KHÔNG được xem "Cài đặt" (unaffected, correctly denied)');
  const nvAdminPeopleScreen = await api(cNV, { action: 'listTaskAdminPeople' });
  ok(!nvAdminPeopleScreen.ok, 'PHF082 KHÔNG được xem "Nhân sự & phân quyền" (không phải company-tier, correctly denied)', nvAdminPeopleScreen.status + ' ' + nvAdminPeopleScreen.code);

  // =========================================================================
  // ACCEPTANCE MATRIX PRINTOUT — Business Action | Admin | GĐ | Tiên | Vinh | Ngọc
  // =========================================================================
  console.log('\n==== ACCEPTANCE MATRIX (Business Action | Admin | GĐ | Tiên | Vinh | Ngọc) ====');
  const order = ['ADMIN', 'GD', 'TIEN', 'VINH', 'NGOC'];
  let matrixAllParityExceptSettings = true;
  for (const [action, row] of Object.entries(MATRIX)) {
    const cells = order.map(p => (row[p] === true ? 'YES' : (row[p] === false ? 'NO' : '—')));
    console.log('  ' + action.padEnd(28) + cells.join(' | '));
    if (action !== 'Cài đặt (danh mục)') {
      const allSame = cells.every(c => c === cells[0]);
      if (!allSame) matrixAllParityExceptSettings = false;
    }
  }
  ok(matrixAllParityExceptSettings, 'ACCEPTANCE MATRIX: mọi hàng ngoài "Cài đặt" đều giống hệt nhau giữa Admin/GĐ/Tiên/Vinh/Ngọc');
  const settingsRow = MATRIX['Cài đặt (danh mục)'];
  ok(settingsRow && settingsRow.ADMIN === true && ['GD', 'TIEN', 'VINH', 'NGOC'].every(p => settingsRow[p] === false), 'ACCEPTANCE MATRIX: "Cài đặt" = YES cho Admin, NO cho GĐ/Tiên/Vinh/Ngọc — ĐÚNG 1 khác biệt duy nhất');

  console.log(`\nPHF Task Company-Tier Permission Parity V1: ${PASS}/${PASS + FAIL} PASS`);
  if (FAIL > 0) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
})().catch(err => { console.error('FAIL', err); process.exit(1); });
