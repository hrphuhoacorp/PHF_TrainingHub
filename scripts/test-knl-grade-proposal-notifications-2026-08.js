'use strict';
/*
 * KNL Notification (Phase N1, "Đề xuất nâng bậc") — regression test RIÊNG,
 * độc lập với scripts/test-knl-grade-proposals.js (không sửa file đó — đang
 * có WIP khác không liên quan batch này). In-memory only, mock
 * @supabase/supabase-js + lib/knl-competency (Phase 2 "Đánh giá theo tiêu
 * chí" không thuộc scope batch notification, stub 1 standard cố định để
 * createGradePromotionProposal() chạy qua được) — không chạm Production.
 *
 * Chạy thủ công: node scripts/test-knl-grade-proposal-notifications-2026-08.js
 */
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';

const supabasePath = require.resolve('@supabase/supabase-js');
const permissionsPath = require.resolve('../lib/knl-permissions');
const peoplePath = require.resolve('../lib/knl-people');
const scopePath = require.resolve('../lib/knl-scope');
const competencyPath = require.resolve('../lib/knl-competency');
const notificationsPath = require.resolve('../lib/knl-notifications');
const proposalsPath = require.resolve('../lib/knl-grade-proposals');
const authPath = require.resolve('../lib/auth');

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function uid(prefix) { return prefix + '-' + Math.random().toString(36).slice(2); }
function applyFilters(rows, filters) { return rows.filter(r => filters.every(fn => fn(r))); }

function makeTableFactory(rows, opts = {}) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null, singleMode = null, mode = 'select', writePayload = null, headMode = false, upsertOpts = {};
    const q = {
      select(_cols, selOpts) { if (selOpts && selOpts.head) headMode = true; return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
      gt(field, value) { filters.push(r => Number(r[field]) > Number(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
      is(field, value) { filters.push(r => (value === null ? (r[field] == null) : r[field] === value)); return q; },
      or(expr) {
        const clauses = String(expr || '').split(',').map(s => s.trim()).filter(Boolean).map(clause => {
          const [field, op, value] = clause.split('.');
          return r => op === 'eq' ? String(r[field]) === String(value) : true;
        });
        filters.push(r => clauses.some(fn => fn(r)));
        return q;
      },
      order(field, o) { orderSpecs.push({ field, asc: !(o && o.ascending === false) }); return q; },
      limit(n) { limitN = n; return q; },
      maybeSingle() { singleMode = 'maybe'; return q; },
      single() { singleMode = 'single'; return q; },
      insert(payload) { mode = 'insert'; writePayload = payload; return q; },
      update(payload) { mode = 'update'; writePayload = payload; return q; },
      upsert(payload, o) { mode = 'upsert'; writePayload = payload; upsertOpts = o || {}; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'insert') {
            const list = Array.isArray(writePayload) ? writePayload : [writePayload];
            const inserted = list.map(obj => { const row = Object.assign({ id: uid('gen'), created_at: new Date().toISOString() }, obj); rows.push(row); return row; });
            resolve({ data: clone(singleMode ? inserted[0] : inserted), error: null }); return;
          }
          if (mode === 'update') {
            const matched = applyFilters(rows, filters);
            matched.forEach(r => Object.assign(r, writePayload));
            resolve({ data: clone(singleMode ? (matched[0] || null) : matched), error: null }); return;
          }
          if (mode === 'upsert') {
            if (opts.failUpsert) { resolve({ data: null, error: { message: opts.failUpsert } }); return; }
            const conflictField = upsertOpts.onConflict;
            const list = Array.isArray(writePayload) ? writePayload : [writePayload];
            const inserted = [];
            list.forEach(obj => {
              const key = conflictField ? obj[conflictField] : null;
              const exists = key != null && rows.some(r => r[conflictField] === key);
              if (exists && upsertOpts.ignoreDuplicates) return;
              const row = Object.assign({ id: uid('gen'), created_at: new Date().toISOString() }, obj);
              rows.push(row); inserted.push(row);
            });
            resolve({ data: clone(inserted), error: null }); return;
          }
          let matched = applyFilters(rows, filters);
          if (headMode) { resolve({ data: null, count: matched.length, error: null }); return; }
          orderSpecs.forEach(spec => { matched = matched.slice().sort((a, b) => { const av = a[spec.field], bv = b[spec.field]; return (av < bv ? -1 : av > bv ? 1 : 0) * (spec.asc ? 1 : -1); }); });
          if (limitN != null) matched = matched.slice(0, limitN);
          if (singleMode) { resolve({ data: clone(matched[0] || null), error: null }); return; }
          resolve({ data: clone(matched), error: null });
        } catch (e) { (reject || (err => Promise.reject(err)))(e); }
      }
    };
    return q;
  };
}

const STATE = {
  grants: [], history: [], employees: [], ladders: [], versions: [], grades: [], assignments: [],
  proposals: [], steps: [], accounts: [], notifications: [],
  failNotificationsUpsert: false
};

function proposalUniquenessGuard(list, existingRows) {
  for (const obj of list) if (obj.status === 'pending' && existingRows.some(r => r.subject_employee_code === obj.subject_employee_code && r.status === 'pending')) return { code: '23505', message: 'duplicate key value violates unique constraint "knl_grade_promotion_proposal_active_uq"' };
  return null;
}
function snakeRow(obj) { const row = {}; Object.keys(obj || {}).forEach(k => { if (obj[k] !== undefined) row[k] = obj[k]; }); return row; }

async function mockGradePromotionRpc(name, params) {
  if (name === 'knl_grade_promotion_propose') {
    const p = params.p_proposal, steps = params.p_steps || [];
    const dupErr = proposalUniquenessGuard([{ status: 'pending', subject_employee_code: p.subject_employee_code }], STATE.proposals);
    if (dupErr) return { data: null, error: dupErr };
    const now = new Date().toISOString();
    const proposalRow = snakeRow({
      id: uid('proposal'), subject_employee_code: p.subject_employee_code, subject_employee_name: p.subject_employee_name,
      created_by: p.created_by || null, created_by_name: p.created_by_name || null, created_at: now,
      compensation_ladder_id: p.compensation_ladder_id, compensation_version_id: p.compensation_version_id,
      current_grade_id: p.current_grade_id, current_grade_code: p.current_grade_code, current_grade_number: p.current_grade_number,
      proposed_grade_id: p.proposed_grade_id, proposed_grade_code: p.proposed_grade_code, proposed_grade_number: p.proposed_grade_number,
      reason: p.reason, status: 'pending', selected_first_approver_employee_code: p.selected_first_approver_employee_code || null,
      routing_snapshot: p.routing_snapshot || [], current_step_index: p.current_step_index || 0, criteria_snapshot: p.criteria_snapshot || {}, updated_at: now
    });
    const stepRows = steps.map(s => snakeRow({ id: uid('step'), proposal_id: proposalRow.id, step_index: s.step_index, actor_id: s.actor_id || null, actor_employee_code: s.actor_employee_code || null, actor_name: s.actor_name || null, action: s.action, suggested_grade_id: s.suggested_grade_id || null, suggested_grade_code: s.suggested_grade_code || null, suggested_grade_number: s.suggested_grade_number || null, reason: s.reason || null, acted_at: now }));
    STATE.proposals.push(proposalRow);
    stepRows.forEach(r => STATE.steps.push(r));
    return { data: clone(proposalRow), error: null };
  }
  if (name === 'knl_grade_promotion_transition') {
    const row = STATE.proposals.find(r => r.id === params.p_proposal_id);
    if (!row) return { data: null, error: { message: 'PROPOSAL_NOT_FOUND' } };
    if (row.status !== params.p_expected_status) return { data: null, error: { message: 'PROPOSAL_STATE_CHANGED' } };
    if (params.p_expected_step_index != null && row.current_step_index !== params.p_expected_step_index) return { data: null, error: { message: 'PROPOSAL_STATE_CHANGED' } };
    const now = new Date().toISOString();
    const patch = params.p_patch || {};
    const stepRows = (params.p_steps || []).map(s => snakeRow({ id: uid('step'), proposal_id: row.id, step_index: s.step_index, actor_id: s.actor_id || null, actor_employee_code: s.actor_employee_code || null, actor_name: s.actor_name || null, action: s.action, suggested_grade_id: s.suggested_grade_id || null, suggested_grade_code: s.suggested_grade_code || null, suggested_grade_number: s.suggested_grade_number || null, reason: s.reason || null, reassigned_from_employee_code: s.reassigned_from_employee_code || null, reassigned_to_employee_code: s.reassigned_to_employee_code || null, acted_at: now }));
    Object.assign(row, snakeRow(patch), { updated_at: now });
    stepRows.forEach(r => STATE.steps.push(r));
    return { data: clone(row), error: null };
  }
  throw new Error('Unexpected RPC: ' + name);
}

function buildSupabaseMock() {
  return {
    createClient() {
      return {
        from(table) {
          if (table === 'knl_permission_grants') return makeTableFactory(STATE.grants)();
          if (table === 'knl_permission_grant_history') return makeTableFactory(STATE.history)();
          if (table === 'employee_profiles') return makeTableFactory(STATE.employees)();
          if (table === 'knl_compensation_ladders') return makeTableFactory(STATE.ladders)();
          if (table === 'knl_compensation_versions') return makeTableFactory(STATE.versions)();
          if (table === 'knl_compensation_grades') return makeTableFactory(STATE.grades)();
          if (table === 'knl_employee_compensation_assignments') return makeTableFactory(STATE.assignments)();
          if (table === 'knl_grade_promotion_proposals') return makeTableFactory(STATE.proposals, { beforeInsert: proposalUniquenessGuard })();
          if (table === 'knl_grade_promotion_proposal_steps') return makeTableFactory(STATE.steps)();
          if (table === 'user_accounts') return makeTableFactory(STATE.accounts)();
          if (table === 'knl_notifications') return makeTableFactory(STATE.notifications, { failUpsert: STATE.failNotificationsUpsert ? 'SIMULATED_NOTIFICATION_DB_FAILURE' : null })();
          throw new Error('Unexpected table in mock: ' + table);
        },
        rpc(name, params) { return mockGradePromotionRpc(name, params); }
      };
    }
  };
}

const FAKE_COMPETENCY_STANDARD = { groups: [{ id: 'g1', name: 'Nhóm 1', sortOrder: 1, items: [{ id: 'i1', name: 'Tiêu chí 1', sortOrder: 1, requiredLevelNumber: 1, requiredColumnLabel: 'L1', content: 'Nội dung' }] }] };
function buildCompetencyMock() {
  return {
    resolveCompetencyStandardForCompensationGrade: async () => ({ ok: true, frameworkVersionId: 'fv-1', competencyGradeId: 'cg-1', gradeCode: 'CG1', framework: { code: 'F1', name: 'Framework 1', versionNumber: 1 }, standard: FAKE_COMPETENCY_STANDARD })
  };
}
const FIXED_ASSESSMENT = [{ itemId: 'i1', result: 'met', note: '' }];

function loadLibsWithMock() {
  const Module = require('module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) { if (request === '@supabase/supabase-js') return supabasePath; return originalResolve.call(this, request, ...rest); };
  const originalSupabaseCache = require.cache[supabasePath];
  const originalCompetencyCache = require.cache[competencyPath];
  [supabasePath, competencyPath, permissionsPath, peoplePath, scopePath, notificationsPath, proposalsPath, authPath].forEach(p => delete require.cache[p]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  require.cache[competencyPath] = { id: competencyPath, filename: competencyPath, loaded: true, exports: buildCompetencyMock() };
  const authLib = require(authPath);
  const permissionsLib = require(permissionsPath);
  const peopleLib = require(peoplePath);
  const notificationsLib = require(notificationsPath);
  const proposalsLib = require(proposalsPath);
  Module._resolveFilename = originalResolve;
  if (originalSupabaseCache) require.cache[supabasePath] = originalSupabaseCache; else delete require.cache[supabasePath];
  if (originalCompetencyCache) require.cache[competencyPath] = originalCompetencyCache; else delete require.cache[competencyPath];
  return { authLib, permissionsLib, peopleLib, notificationsLib, proposalsLib };
}

const loaded = loadLibsWithMock();
const { upsertKnlPermissionGrant: upsertGrant } = loaded.permissionsLib;
const { createGradePromotionProposal: createProposal, processGradePromotionProposalStep: processStep, withdrawGradePromotionProposal: withdrawProposal, getGradePromotionProposalDetail: getDetail } = loaded.proposalsLib;
const { listMyKnlNotifications: listMyNotifications, markKnlNotificationRead: markRead, markAllKnlNotificationsRead: markAllRead } = loaded.notificationsLib;

// ---------------------------------------------------------------------------
// Fixture: 1 nhánh Kho đơn giản — NV -> TBP (agree_proposal, scope Kho) ->
// GRADDIR (approve, scope all_company, KHÔNG phải admin role — kiểm chứng
// "final approver" gồm cả grant approve=true, không chỉ role=admin) -> Admin.
// OUTSIDER: agree_proposal=true nhưng scope KHÁC (Bán hàng) -> KHÔNG được
// vào chain -> KHÔNG được notify (CASE N-2). VIEWER: chỉ view_proposals=true
// (không propose/agree/approve) -> KHÔNG bao giờ nhận actionable notification
// (CASE N-3).
// ---------------------------------------------------------------------------
STATE.employees.push(
  { employee_code: 'GD1', full_name: 'Giám Đốc', title: 'Giám đốc', department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'GRADDIR', full_name: 'Giám đốc nhân sự', title: 'Giám đốc nhân sự', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'GD1', employment_status: 'active' },
  { employee_code: 'TBPKHO1', full_name: 'TBP Kho', title: 'Trưởng bộ phận Kho', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'GRADDIR', employment_status: 'active' },
  { employee_code: 'NVKHO1', full_name: 'NV Kho 1', title: 'Nhân viên', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'TBPKHO1', employment_status: 'active' },
  { employee_code: 'OUTSIDER1', full_name: 'Quản lý Bán hàng khác scope', title: 'Trưởng bộ phận', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', manager_employee_code: 'GD1', employment_status: 'active' },
  { employee_code: 'VIEWER1', full_name: 'Người chỉ được xem', title: 'Trợ lý', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'GD1', employment_status: 'active' }
);
STATE.ladders.push({ id: 'ladder-1', code: 'NSGQ', name: 'Ngạch NS gián quản' });
STATE.versions.push({ id: 'version-1', ladder_id: 'ladder-1', version_number: 1, status: 'ACTIVE', effective_period: '2026-07' });
['B1', 'B2', 'B3', 'B4', 'B5'].forEach((code, i) => STATE.grades.push({ id: 'grade-' + code, version_id: 'version-1', ladder_id: 'ladder-1', grade_code: 'NSGQ-' + code, grade_number: i + 1 }));
STATE.assignments.push({ employee_code: 'NVKHO1', employment_type: 'OFFICIAL', payroll_period: '2026-07', compensation_grade_id: 'grade-B1', compensation_version_id: 'version-1', status: 'ACTIVE' });

function session(role, opts) { opts = opts || {}; return { role, account: { id: opts.id || '', name: opts.name || '', employeeCode: opts.employeeCode || '' }, sub: opts.id || '' }; }
async function grant(accountId, employeeCode, presetCode, capabilities, peopleScope) {
  if (!STATE.accounts.some(a => a.id === accountId)) STATE.accounts.push({ id: accountId, employee_code: employeeCode, role: 'manager', status: 'active', name: employeeCode });
  return upsertGrant(session('admin', { id: 'u-admin' }), { accountId, employeeCode, presetCode, capabilities, peopleScope, reason: 'Thiết lập test notification' });
}

let failures = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else console.log('PASS: ' + message); }
function notifFor(employeeCode, eventCode, proposalId) { return STATE.notifications.filter(n => n.recipient_employee_code === employeeCode && (!eventCode || n.event_code === eventCode) && (!proposalId || n.proposal_id === proposalId)); }

async function run() {
  await grant('acc-tbpkho', 'TBPKHO1', 'TRUONG_BO_PHAN', { access_knl: true, view_people: true, propose: true, agree_proposal: true }, { type: 'department', values: ['Kho'] });
  await grant('acc-graddir', 'GRADDIR', 'CUSTOM', { access_knl: true, view_people: true, approve: true }, { type: 'all_company', values: [] });
  await grant('acc-nvkho1', 'NVKHO1', 'NHAN_VIEN', { access_knl: true, view_people: true, propose: true }, { type: 'self', values: [] });
  // OUTSIDER1: agree_proposal=true nhưng scope Bán hàng (không phải Kho) -> resolveApprovalChain() sẽ KHÔNG chọn vào chain của NVKHO1.
  await grant('acc-outsider', 'OUTSIDER1', 'CUSTOM', { access_knl: true, view_people: true, agree_proposal: true }, { type: 'department', values: ['Bộ phận bán hàng'] });
  // VIEWER1: chỉ view_proposals (đọc rộng), KHÔNG propose/agree_proposal/approve.
  await grant('acc-viewer', 'VIEWER1', 'CUSTOM', { access_knl: true, view_people: true, view_proposals: true, proposalScope: { type: 'all_company', values: [] } }, { type: 'all_company', values: [] });
  // CORRECTION (audit): role='admin' KHÔNG còn tự động là "current workflow
  // actor" của tier cuối — chỉ grantsByCode (approve=true, is_active=true)
  // mới là nguồn duy nhất. ADMIN2 KHÔNG có grant nào -> phải KHÔNG nhận
  // actionable notification, dù vẫn xử lý được final tier qua admin_recovery
  // (requireApprove() không đổi, chỉ notification không tự suy diễn quyền
  // từ role) — CASE N-5b bên dưới.
  STATE.accounts.push({ id: 'u-admin2', employee_code: 'ADMIN2', role: 'admin', status: 'active', name: 'Admin Hai' });
  // APPROVER2: có grant approve=true NHƯNG bị vô hiệu hoá (is_active=false)
  // NGAY SAU KHI cấp — loadActiveGrantsByEmployeeCode() chỉ đọc is_active=true
  // nên APPROVER2 KHÔNG còn nằm trong grantsByCode -> workflow không route
  // tới họ nữa -> KHÔNG được notify (CASE N-5c, đúng mục 2 yêu cầu audit).
  await grant('acc-approver2', 'APPROVER2', 'CUSTOM', { access_knl: true, view_people: true, approve: true }, { type: 'all_company', values: [] });
  { const row = STATE.grants.find(g => g.employee_code === 'APPROVER2'); if (row) row.is_active = false; }

  // ===== CASE N-1 / N-2 / N-3: CREATE -> đúng actor kế tiếp (TBP) nhận, outsider/viewer KHÔNG nhận =====
  const created = (await createProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { employeeCode: 'NVKHO1', reason: 'NV Kho tự đề xuất nâng bậc', proposedGradeId: 'grade-B3', assessment: FIXED_ASSESSMENT })).proposal;
  check(notifFor('TBPKHO1', 'GRADE_PROPOSAL_ACTION_REQUIRED', created.id).length === 1, 'CASE N-1. Create -> đúng actor bước kế tiếp (TBPKHO1) nhận đúng 1 notification ACTION_REQUIRED');
  check(notifFor('OUTSIDER1', null, created.id).length === 0, 'CASE N-2. OUTSIDER1 có agree_proposal nhưng ngoài scope (Bán hàng != Kho) -> KHÔNG nhận notification nào của proposal này');
  check(notifFor('VIEWER1', null, created.id).length === 0, 'CASE N-3. VIEWER1 chỉ có view_proposals (không propose/agree/approve) -> KHÔNG nhận actionable notification nào');
  check(notifFor('NVKHO1', 'GRADE_PROPOSAL_ACTION_REQUIRED', created.id).length === 0, 'CASE N-1b. Người vừa tạo (NVKHO1) không tự nhận notification "cần xử lý" cho chính bước họ vừa tạo');

  // ===== CASE N-4: AGREE (mid-chain) -> actor kế tiếp (GRADDIR, final tier) nhận =====
  const agreed = (await processStep(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { proposalId: created.id, action: 'agree', suggestedGradeId: 'grade-B2' })).proposal;
  check(agreed.currentStepIndex === 1, 'setup: TBPKHO1 agree xong, current_step_index=1 (lượt final tier)');
  check(notifFor('GRADDIR', 'GRADE_PROPOSAL_ACTION_REQUIRED', created.id).length === 1, 'CASE N-5. Final current actor được workflow resolve đúng qua grantsByCode (GRADDIR, capabilities.approve=true, is_active=true) -> nhận đúng 1 notification ACTION_REQUIRED');
  check(notifFor('ADMIN2', 'GRADE_PROPOSAL_ACTION_REQUIRED', created.id).length === 0, 'CASE N-5b (CORRECTION). ADMIN2 role=admin nhưng KHÔNG có grant approve=true -> KHÔNG phải current workflow actor -> KHÔNG nhận actionable notification (không còn tự suy diễn quyền từ role=admin)');
  check(notifFor('APPROVER2', 'GRADE_PROPOSAL_ACTION_REQUIRED', created.id).length === 0, 'CASE N-5c (CORRECTION). APPROVER2 có capabilities.approve=true NHƯNG grant đã bị vô hiệu hoá (is_active=false) -> không còn trong grantsByCode -> proposal hiện tại KHÔNG route tới -> KHÔNG nhận');
  check(notifFor('TBPKHO1', 'GRADE_PROPOSAL_ACTION_REQUIRED', created.id).length === 1, 'CASE N-4b. TBPKHO1 (người vừa agree) không nhận thêm 1 notification "cần xử lý" nào mới cho chính họ (vẫn đúng 1 dòng từ lúc create)');

  // ===== CASE N-6 / N-8: FINAL APPROVE -> creator + subject nhận, creator===subject nên dedupe còn 1 =====
  const finalDecision = (await processStep(session('manager', { id: 'acc-graddir', employeeCode: 'GRADDIR' }), { proposalId: created.id, action: 'agree', suggestedGradeId: 'grade-B2' })).proposal;
  check(finalDecision.status === 'approved', 'setup: GRADDIR duyệt cuối -> status=approved');
  const approvedNotifs = notifFor('NVKHO1', 'GRADE_PROPOSAL_APPROVED', created.id);
  check(approvedNotifs.length === 1, 'CASE N-6/N-8. Approve xong -> creator+subject (cùng là NVKHO1, tự đề xuất) dedupe còn ĐÚNG 1 notification kết quả');
  check(approvedNotifs.length === 1 && !/base_salary|hqcv|allowance|thu nhập|lương/i.test(approvedNotifs[0].title + ' ' + approvedNotifs[0].message), 'CASE N-10. Payload notification kết quả KHÔNG chứa bất kỳ nội dung tiền lương/thu nhập nào');

  // ===== CASE N-7: REJECT (proposal khác) -> creator + subject nhận =====
  const rejectSubject = (await createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test reject notification', proposedGradeId: 'grade-B2', assessment: FIXED_ASSESSMENT })).proposal;
  const rejected = (await processStep(session('manager', { id: 'acc-graddir', employeeCode: 'GRADDIR' }), { proposalId: rejectSubject.id, action: 'reject', reason: 'Chưa đủ điều kiện đợt này' })).proposal;
  check(rejected.status === 'rejected', 'setup: reject thành công');
  check(notifFor('TBPKHO1', 'GRADE_PROPOSAL_REJECTED', rejectSubject.id).length === 1, 'CASE N-7a. Reject -> người tạo (TBPKHO1) nhận notification kết quả');
  check(notifFor('NVKHO1', 'GRADE_PROPOSAL_REJECTED', rejectSubject.id).length === 1, 'CASE N-7b. Reject -> nhân sự được đề xuất (NVKHO1, subject) cũng nhận (khác người tạo -> 2 dòng riêng, không dedupe nhầm)');

  // ===== CASE N-9: retry / double emit không tạo trùng =====
  const notifCountBeforeRetry = STATE.notifications.length;
  const emitAgain = await loaded.notificationsLib.emitKnlNotification('GRADE_PROPOSAL_REJECTED', { recipients: [{ employeeCode: 'TBPKHO1' }], proposalId: rejectSubject.id, title: 'Đề xuất nâng bậc đã bị từ chối', message: 'retry test', dedupeKey: 'GRADE_PROPOSAL_REJECTED|' + rejectSubject.id });
  check(emitAgain.created === 0 && STATE.notifications.length === notifCountBeforeRetry, 'CASE N-9. Emit lại đúng event/proposal/recipient (retry/double emit) -> KHÔNG tạo dòng mới, tổng số notification không đổi');

  // ===== CASE N-11: user A không đọc được notification của user B =====
  const outsiderReadAttempt = await markRead(session('manager', { id: 'acc-outsider', employeeCode: 'OUTSIDER1' }), { id: notifFor('TBPKHO1', 'GRADE_PROPOSAL_REJECTED', rejectSubject.id)[0].id });
  const stillUnread = notifFor('TBPKHO1', 'GRADE_PROPOSAL_REJECTED', rejectSubject.id)[0];
  check(outsiderReadAttempt.marked === 1 && !stillUnread.read_at, 'CASE N-11. OUTSIDER1 gọi markRead với id notification của TBPKHO1 -> update scope theo actor không khớp -> notification của TBPKHO1 vẫn CHƯA đọc (không bị outsider đánh dấu hộ)');
  const listForOwner = await listMyNotifications(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), {});
  check(listForOwner.notifications.some(n => n.id === stillUnread.id), 'CASE N-11b. Chính chủ (TBPKHO1) list được đúng notification của mình');
  const listForOutsider = await listMyNotifications(session('manager', { id: 'acc-outsider', employeeCode: 'OUTSIDER1' }), {});
  check(!listForOutsider.notifications.some(n => n.id === stillUnread.id), 'CASE N-11c. OUTSIDER1 KHÔNG list được notification của TBPKHO1 (danh sách của actor khác)');
  await markRead(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { id: stillUnread.id });
  check(STATE.notifications.find(n => n.id === stillUnread.id).read_at, 'CASE N-11d. Chính chủ markRead thành công (đối chứng: markRead hoạt động đúng khi actor khớp)');

  // ===== CASE N-12: click/detail vẫn không bypass permission Grade Proposal hiện hữu =====
  await (async () => {
    let threw = null;
    try { await getDetail(session('manager', { id: 'acc-outsider', employeeCode: 'OUTSIDER1' }), { proposalId: rejectSubject.id }); }
    catch (e) { threw = e; }
    check(!!threw && (threw.code === 'KNL_PROPOSAL_VIEW_DENIED' || threw.code === 'KNL_VIEW_PROPOSALS_DENIED'), 'CASE N-12. OUTSIDER1 (không liên quan proposal, không đủ view_proposals+scope) mở detail bằng đúng proposalId vẫn bị chặn permission như bình thường (đúng KNL_PROPOSAL_VIEW_DENIED hoặc KNL_VIEW_PROPOSALS_DENIED tuỳ actor có capability view_proposals hay không)');
  })();

  // ===== CASE N-13: notification emit failure KHÔNG rollback proposal transition =====
  STATE.failNotificationsUpsert = true;
  const proposalsCountBefore = STATE.proposals.length, notifCountBefore = STATE.notifications.length;
  const createdDespiteNotifFail = await createProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test notification fail không rollback', proposedGradeId: 'grade-B2', assessment: FIXED_ASSESSMENT });
  STATE.failNotificationsUpsert = false;
  check(createdDespiteNotifFail && createdDespiteNotifFail.proposal && createdDespiteNotifFail.proposal.status === 'pending', 'CASE N-13a. Notification DB lỗi -> createGradePromotionProposal() VẪN trả về thành công bình thường (không throw, không đổi response)');
  check(STATE.proposals.length === proposalsCountBefore + 1, 'CASE N-13b. Proposal vẫn được ghi nhận đầy đủ dù notification lỗi (không rollback transition vì lỗi notification)');
  check(STATE.notifications.length === notifCountBefore, 'CASE N-13c. Không có notification nào lọt vào DB khi upsert lỗi (đúng "an toàn tuyệt đối", không có dữ liệu nửa vời)');
  await withdrawProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { proposalId: createdDespiteNotifFail.proposal.id, reason: 'Dọn state sau test N-13' });

  // ===== Regression: không có field tiền lương nào trong toàn bộ bảng knl_notifications =====
  const notifJson = JSON.stringify(STATE.notifications);
  check(!/base_salary|hqcv|professional_allowance|management_allowance|incomeScope|income_view|compensation_grade_id/i.test(notifJson), 'CASE N-10b. Toàn bộ dữ liệu knl_notifications (mọi dòng, mọi field) không chứa bất kỳ field tiền lương/thu nhập nào');

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error('UNCAUGHT', e); process.exit(1); });
