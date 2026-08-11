'use strict';
/*
 * KNL "Đề xuất nâng bậc" — Regression test cho batch 2 implement (routing,
 * permission separation, grade bounds, concurrency, broken route).
 *
 * In-memory only — không chạm Production/Supabase thật — mock
 * @supabase/supabase-js theo đúng kỹ thuật đã dùng ở
 * scripts/test-knl-permissions-scope.js (patch Module._resolveFilename +
 * require.cache), KHÔNG cần biến môi trường Supabase thật, KHÔNG ghi bất kỳ
 * dữ liệu Production nào.
 *
 * Chạy thủ công: node scripts/test-knl-grade-proposals.js
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

function applyFilters(rows, filters) { return rows.filter(r => filters.every(fn => fn(r))); }

function makeTableFactory(rows, opts = {}) {
  return function tableQuery() {
    const filters = [];
    let orderSpecs = [], limitN = null, singleMode = null, mode = 'select', insertPayload = null, updatePayload = null, headMode = false;
    const q = {
      select(_cols, selOpts) { if (selOpts && selOpts.head) headMode = true; return q; },
      eq(field, value) { filters.push(r => String(r[field]) === String(value)); return q; },
      neq(field, value) { filters.push(r => String(r[field]) !== String(value)); return q; },
      gt(field, value) { filters.push(r => Number(r[field]) > Number(value)); return q; },
      in(field, values) { const set = new Set((values || []).map(String)); filters.push(r => set.has(String(r[field]))); return q; },
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
      insert(payload) { mode = 'insert'; insertPayload = payload; return q; },
      update(payload) { mode = 'update'; updatePayload = payload; return q; },
      then(resolve, reject) {
        try {
          if (mode === 'insert') {
            const list = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
            if (opts.beforeInsert) { const err = opts.beforeInsert(list, rows); if (err) { resolve({ data: null, error: err }); return; } }
            const inserted = list.map(obj => {
              const row = Object.assign({ id: uid('gen'), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_active: true }, obj);
              rows.push(row);
              return row;
            });
            resolve({ data: clone(singleMode ? inserted[0] : inserted), error: null });
            return;
          }
          if (mode === 'update') {
            const matched = applyFilters(rows, filters);
            matched.forEach(r => Object.assign(r, updatePayload));
            resolve({ data: clone(singleMode ? (matched[0] || null) : matched), error: null });
            return;
          }
          let matched = applyFilters(rows, filters);
          if (headMode) { resolve({ data: null, count: matched.length, error: null }); return; }
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

const STATE = {
  grants: [], history: [], employees: [],
  ladders: [], versions: [], grades: [], assignments: [],
  proposals: [], steps: []
};

function proposalUniquenessGuard(list, existingRows) {
  for (const obj of list) {
    if (obj.status === 'pending' && existingRows.some(r => r.subject_employee_code === obj.subject_employee_code && r.status === 'pending')) {
      return { code: '23505', message: 'duplicate key value violates unique constraint "knl_grade_promotion_proposal_active_uq"' };
    }
  }
  return null;
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
          throw new Error('Unexpected table in KNL Grade Proposal mock: ' + table);
        }
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
  [supabasePath, permissionsPath, peoplePath, scopePath, proposalsPath].forEach(p => delete require.cache[p]);
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: buildSupabaseMock() };
  const permissionsLib = require(permissionsPath);
  const peopleLib = require(peoplePath);
  const proposalsLib = require(proposalsPath);
  Module._resolveFilename = originalResolve;
  if (originalCache) require.cache[supabasePath] = originalCache; else delete require.cache[supabasePath];
  return { permissionsLib, peopleLib, proposalsLib };
}

const loaded = loadLibsWithMock();
const { upsertKnlPermissionGrant: upsertGrant } = loaded.permissionsLib;
const {
  createGradePromotionProposal: createProposal,
  processGradePromotionProposalStep: processStep,
  withdrawGradePromotionProposal: withdrawProposal,
  listMyGradePromotionProposals: listMine,
  listProposalsAwaitingMyAction: listAwaitingMe,
  listVisibleGradePromotionProposals: listVisible,
  getGradePromotionProposalDetail: getDetail,
  getGradeOptionsForSubject: getGradeOptions
} = loaded.proposalsLib;

// ---------------------------------------------------------------------------
// Fixture Organization Master (subset, phản ánh đúng org chart đã clean ở
// batch "Organization Master Clean & Reset Baseline") + Compensation ladder.
// ---------------------------------------------------------------------------
STATE.employees.push(
  { employee_code: 'GD1', full_name: 'Giám Đốc Test', title: 'Giám đốc', department: 'Ban giám đốc', branch: 'Phú Lợi', manager_employee_code: '', employment_status: 'active' },
  { employee_code: 'VINH1', full_name: 'Trợ Lý Kho', title: 'Trợ lý Giám đốc', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'GD1', employment_status: 'active' },
  { employee_code: 'TBPKHO1', full_name: 'TBP Kho', title: 'Trưởng bộ phận Kho', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'VINH1', employment_status: 'active' },
  { employee_code: 'NVKHO1', full_name: 'NV Kho 1', title: 'Nhân viên', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'TBPKHO1', employment_status: 'active' },
  { employee_code: 'NVKHO2', full_name: 'NV Kho 2 (không baseline)', title: 'Nhân viên', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'TBPKHO1', employment_status: 'active' },
  { employee_code: 'NVKHOPROBATION', full_name: 'NV Kho Thử việc', title: 'Nhân viên', department: 'Kho', branch: 'Phú Lợi', manager_employee_code: 'TBPKHO1', employment_status: 'active' },
  { employee_code: 'TIEN1', full_name: 'Trợ Lý Bán hàng', title: 'Trợ lý Giám đốc', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', manager_employee_code: 'GD1', employment_status: 'active' },
  { employee_code: 'TC1', full_name: 'Trưởng ca Phú Lợi', title: 'Trưởng ca', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', manager_employee_code: 'TIEN1', employment_status: 'active' },
  { employee_code: 'TC2', full_name: 'Trưởng ca Ngô Quyền', title: 'Trưởng ca', department: 'Bộ phận bán hàng', branch: 'Ngô Quyền', manager_employee_code: 'TIEN1', employment_status: 'active' },
  { employee_code: 'NVSALES1', full_name: 'NV Bán hàng 1', title: 'Nhân viên', department: 'Bộ phận bán hàng', branch: 'Phú Lợi', manager_employee_code: 'TIEN1', employment_status: 'active' }
);

STATE.ladders.push({ id: 'ladder-1', code: 'NSGQ', name: 'Ngạch nhân sự gián quản' });
STATE.versions.push({ id: 'version-1', ladder_id: 'ladder-1', version_number: 1, status: 'ACTIVE', effective_period: '2026-07' });
['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'].forEach((code, i) => STATE.grades.push({ id: 'grade-' + code, version_id: 'version-1', ladder_id: 'ladder-1', grade_code: 'NSGQ-' + code, grade_number: i + 1 }));

STATE.assignments.push(
  { employee_code: 'NVKHO1', employment_type: 'OFFICIAL', payroll_period: '2026-07', compensation_grade_id: 'grade-B1', compensation_version_id: 'version-1' },
  { employee_code: 'NVSALES1', employment_type: 'OFFICIAL', payroll_period: '2026-07', compensation_grade_id: 'grade-B1', compensation_version_id: 'version-1' },
  { employee_code: 'TC1', employment_type: 'OFFICIAL', payroll_period: '2026-07', compensation_grade_id: 'grade-B2', compensation_version_id: 'version-1' },
  { employee_code: 'VINH1', employment_type: 'OFFICIAL', payroll_period: '2026-07', compensation_grade_id: 'grade-B1', compensation_version_id: 'version-1' },
  { employee_code: 'NVKHOPROBATION', employment_type: 'PROBATION', payroll_period: '2026-07', compensation_grade_id: null, compensation_version_id: null }
  // NVKHO2: cố ý KHÔNG có dòng assignment nào -> test "chưa thiết lập bậc hiện tại"
);

function session(role, opts) {
  opts = opts || {};
  return { role, account: { id: opts.id || '', name: opts.name || '' }, employeeId: opts.employeeCode || '', sub: opts.id || '' };
}
async function grant(accountId, employeeCode, presetCode, capabilities, peopleScope, reason) {
  return upsertGrant(session('admin', { id: 'u-admin' }), { accountId, employeeCode, presetCode, capabilities, peopleScope, reason: reason || 'Thiết lập test' });
}

let failures = 0;
function check(condition, message) { if (!condition) { console.error('FAIL: ' + message); failures++; } else console.log('PASS: ' + message); }
async function expectFail(promise, code, message) {
  let threw = null;
  try { await promise; } catch (e) { threw = e; }
  check(!!threw && threw.code === code, message + ' (expected code ' + code + ', got ' + (threw ? threw.code : 'no throw') + (threw ? ': ' + threw.message : '')+ ')');
  return threw;
}

async function run() {
  // ---------- Thiết lập grant theo đúng org chart ----------
  await grant('acc-tbpkho', 'TBPKHO1', 'TRUONG_BO_PHAN', { access_knl: true, view_people: true, propose: true, agree_proposal: true }, { type: 'department', values: ['Kho'] });
  await grant('acc-vinh', 'VINH1', 'TRO_LY_GD', { access_knl: true, view_people: true, propose: true, agree_proposal: true, view_proposals: true, proposalScope: { type: 'department', values: ['Kho'] } }, { type: 'department', values: ['Kho'] });
  await grant('acc-gd', 'GD1', 'TRO_LY_GD', { access_knl: true, view_people: true, propose: false, agree_proposal: false, approve: false, view_proposals: true, proposalScope: { type: 'all_company', values: [] } }, { type: 'all_company', values: [] });
  await grant('acc-tien', 'TIEN1', 'TRO_LY_GD', { access_knl: true, view_people: true, propose: true, agree_proposal: true, view_proposals: true, proposalScope: { type: 'department', values: ['Bộ phận bán hàng'] } }, { type: 'department', values: ['Bộ phận bán hàng'] });
  await grant('acc-tc1', 'TC1', 'TRUONG_CA_CHTR', { access_knl: true, view_people: true, propose: true, agree_proposal: true }, { type: 'sales_all_branches', values: [] });
  await grant('acc-tc2', 'TC2', 'TRUONG_CA_CHTR', { access_knl: true, view_people: true, propose: true, agree_proposal: true }, { type: 'sales_all_branches', values: [] });
  await grant('acc-nvkho1', 'NVKHO1', 'NHAN_VIEN', { access_knl: true, view_people: true, propose: true }, { type: 'self', values: [] });
  await grant('acc-nvsales1', 'NVSALES1', 'NHAN_VIEN', { access_knl: true, view_people: true, propose: true }, { type: 'self', values: [] });

  // ================= GRADE / BASELINE =================
  let opts = await getGradeOptions(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1' });
  check(opts.hasBaseline === true && opts.currentGradeCode === 'NSGQ-B1' && opts.nextGrades.length === 4 && opts.nextGrades[0].gradeCode === 'NSGQ-B2' && opts.nextGrades[3].gradeCode === 'NSGQ-B5', 'CASE GRADE-1. NVKHO1 hiện B1 -> đúng 4 bậc kế tiếp B2..B5 (ladder có đủ 7 bậc)');

  opts = await getGradeOptions(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO2' });
  check(opts.hasBaseline === false && opts.reason === 'no_assignment', 'CASE GRADE-2. NVKHO2 không có dòng compensation assignment nào -> hasBaseline=false, reason=no_assignment (KHÔNG đoán bậc)');

  opts = await getGradeOptions(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHOPROBATION' });
  check(opts.hasBaseline === false && opts.reason === 'probation', 'CASE GRADE-3. NV thử việc (employment_type=PROBATION) -> hasBaseline=false, reason=probation, phân biệt rõ với no_assignment');

  await expectFail(createProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { employeeCode: 'NVKHO2', reason: 'Test không được', proposedGradeId: 'grade-B2' }), 'KNL_PROPOSAL_CREATE_OUT_OF_SCOPE', 'CASE GRADE-4a. NV không được tạo proposal cho người khác ngoài chính mình');
  await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO2', reason: 'Test chưa có bậc nền', proposedGradeId: 'grade-B2' }), 'KNL_PROPOSAL_NO_BASELINE_GRADE', 'CASE GRADE-4b. Chưa có bậc hiện tại (no_assignment) -> chặn tạo proposal, không cho tự chọn bậc khởi điểm');
  await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHOPROBATION', reason: 'Test đang thử việc', proposedGradeId: 'grade-B2' }), 'KNL_PROPOSAL_NO_BASELINE_GRADE', 'CASE GRADE-4c. Đang thử việc -> cũng chặn tạo proposal (đúng nghiệp vụ mục 4 batch 2)');
  await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test vượt quá 4 bậc', proposedGradeId: 'grade-B6' }), 'KNL_PROPOSAL_GRADE_OUT_OF_RANGE', 'CASE GRADE-5. B1 -> B6 vượt quá tối đa 4 bậc kế tiếp (chỉ tới B5) -> bị chặn');
  await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test chọn bậc thấp hơn', proposedGradeId: 'grade-B1' }), 'KNL_PROPOSAL_GRADE_OUT_OF_RANGE', 'CASE GRADE-6. Không cho chọn = bậc hiện tại (B1 -> B1)');

  // ================= ROUTING: NON-SALES (Kho) =================
  let created = await createProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { employeeCode: 'NVKHO1', reason: 'NV Kho tự đề xuất nâng bậc', proposedGradeId: 'grade-B4' });
  let proposal = created.proposal;
  check(proposal.status === 'pending' && proposal.currentStepIndex === 0, 'CASE ROUTE-1. Self-proposal NVKHO1 tạo thành công, current_step_index=0 (chưa ai agree)');
  check(proposal.routingSnapshot.map(s => s.employeeCode).join(',') === 'TBPKHO1,VINH1,', 'CASE ROUTE-2. Chain đúng NV Kho -> TBP Kho -> Trợ lý Vinh -> Admin (Giám đốc bị loại vì agree_proposal=false, không hard-code theo tên)');

  await expectFail(processStep(session('manager', { id: 'acc-tien', employeeCode: 'TIEN1' }), { proposalId: proposal.id, action: 'agree', suggestedGradeId: 'grade-B4' }), 'KNL_PROPOSAL_NOT_YOUR_TURN', 'CASE ROUTE-3. Người ngoài chain (Tiên, không phụ trách Kho) không xử lý được dù có agree_proposal capability nói chung');

  let agreed = await processStep(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { proposalId: proposal.id, action: 'agree', suggestedGradeId: 'grade-B3', note: 'Đề nghị B3 thay vì B4' });
  check(agreed.proposal.currentStepIndex === 1 && agreed.proposal.status === 'pending', 'CASE ROUTE-4. TBP Kho agree với bậc kiến nghị B3 (thấp hơn initial B4) -> hợp lệ, current_step_index sang 1');

  await expectFail(processStep(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { proposalId: proposal.id, action: 'agree', suggestedGradeId: 'grade-B3' }), 'KNL_PROPOSAL_NOT_YOUR_TURN', 'CASE ROUTE-5. TBP Kho không được agree lần 2 (đã qua lượt của mình, giờ là lượt Trợ lý Vinh)');

  await expectFail(processStep(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }), { proposalId: proposal.id, action: 'agree', suggestedGradeId: 'grade-B1' }), 'KNL_PROPOSAL_SUGGESTED_GRADE_OUT_OF_RANGE', 'CASE GRADE-7. Bậc kiến nghị phải > bậc hiện tại (B1 <= current B1 -> bị chặn)');
  await expectFail(processStep(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }), { proposalId: proposal.id, action: 'agree', suggestedGradeId: 'grade-B5' }), 'KNL_PROPOSAL_SUGGESTED_GRADE_OUT_OF_RANGE', 'CASE GRADE-8. Bậc kiến nghị không được > bậc đề xuất ban đầu (B5 > initial B4 -> bị chặn), kể cả khi B5 nằm trong 4-bậc option lúc tạo');

  agreed = await processStep(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }), { proposalId: proposal.id, action: 'agree', suggestedGradeId: 'grade-B2' });
  check(agreed.proposal.currentStepIndex === 2 && agreed.proposal.status === 'pending', 'CASE ROUTE-6. Trợ lý Vinh agree với B2 -> current_step_index sang 2 (lượt Admin)');

  await expectFail(processStep(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }), { proposalId: proposal.id, action: 'agree', suggestedGradeId: 'grade-B2' }), 'KNL_APPROVE_DENIED', 'CASE PERM-1. agree_proposal KHÔNG tự cấp final authority — Vinh (agree_proposal=true, approve=false) không thể duyệt cuối, dù đúng lượt về mặt index');

  const finalDecision = await processStep(session('admin', { id: 'u-admin' }), { proposalId: proposal.id, action: 'agree', suggestedGradeId: 'grade-B3' });
  check(finalDecision.proposal.status === 'approved' && finalDecision.proposal.finalDecidedGradeCode === 'NSGQ-B3', 'CASE ROUTE-7. Admin chốt B3 (nằm trong (B1,B4]) -> status=approved, final_decided_grade lưu đúng');

  const detail1 = await getDetail(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }), { proposalId: proposal.id });
  const timeline = detail1.steps.map(s => s.action);
  check(timeline.join(',') === 'propose,agree,agree,approve', 'CASE AUDIT-1. Timeline đủ 4 bước propose(NV)->agree(TBP)->agree(Trợ lý)->approve(Admin final, action riêng biệt để timeline đọc rõ ai kết thúc workflow), append-only, không mất bước nào');
  check(detail1.steps[0].suggestedGradeCode === 'NSGQ-B4' && detail1.steps[1].suggestedGradeCode === 'NSGQ-B3' && detail1.steps[2].suggestedGradeCode === 'NSGQ-B2' && detail1.steps[3].suggestedGradeCode === 'NSGQ-B3', 'CASE AUDIT-2. Mỗi tầng lưu ĐÚNG bậc kiến nghị riêng của tầng đó (B4/B3/B2/B3) — không ghi đè lịch sử (mục 8/17)');

  // ================= 1 ACTIVE PROPOSAL / CONCURRENCY =================
  const afterApprovedCreate = await createProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { employeeCode: 'NVKHO1', reason: 'Tạo lại sau khi proposal trước đã APPROVED', proposedGradeId: 'grade-B4' });
  check(afterApprovedCreate.proposal.status === 'pending', 'CASE CONCURRENCY-1. Sau khi proposal trước đã approved (không còn pending), subject được tạo proposal mới bình thường');

  const secondAttempt = await expectFail(createProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { employeeCode: 'NVKHO1', reason: 'Tạo trùng khi đang có 1 pending', proposedGradeId: 'grade-B3' }), 'KNL_PROPOSAL_ALREADY_ACTIVE', 'CASE CONCURRENCY-2. 2 lần tạo cho CÙNG subject khi đang có 1 pending -> lần 2 bị chặn 409 (DB-level unique constraint qua beforeInsert guard, không phải chỉ app-level check)');
  check(secondAttempt.statusCode === 409, 'CASE CONCURRENCY-3. Lỗi trùng trả đúng statusCode 409');

  // rút proposal đang pending để dọn state cho case sau
  await withdrawProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { proposalId: afterApprovedCreate.proposal.id, reason: 'Rút để test case khác, không liên quan quyết định cũ' });

  // ================= WITHDRAW =================
  let wCreated = (await createProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test withdraw', proposedGradeId: 'grade-B2' })).proposal;
  await expectFail(withdrawProposal(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { proposalId: wCreated.id, reason: 'Không phải người tạo' }), 'KNL_PROPOSAL_WITHDRAW_NOT_CREATOR', 'CASE WITHDRAW-1. Chỉ người tạo mới được rút — TBP Kho (không phải creator) bị chặn');
  const withdrawn = await withdrawProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { proposalId: wCreated.id, reason: 'Đổi ý, rút lại đề xuất' });
  check(withdrawn.proposal.status === 'withdrawn' && withdrawn.proposal.withdrawnReason === 'Đổi ý, rút lại đề xuất', 'CASE WITHDRAW-2. Người tạo rút thành công, status=withdrawn, giữ lý do');
  await expectFail(processStep(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { proposalId: wCreated.id, action: 'agree', suggestedGradeId: 'grade-B2' }), 'KNL_PROPOSAL_ALREADY_FINAL', 'CASE WITHDRAW-3. Proposal đã WITHDRAWN không xử lý tiếp được nữa');
  const reCreateAfterWithdraw = await createProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { employeeCode: 'NVKHO1', reason: 'Tạo lại sau khi withdraw', proposedGradeId: 'grade-B2' });
  check(reCreateAfterWithdraw.proposal.status === 'pending', 'CASE WITHDRAW-4. Sau WITHDRAWN, subject được tạo proposal mới (mục 13 batch 1)');

  // ================= REJECT =================
  const rejectReasonFail = await expectFail(processStep(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { proposalId: reCreateAfterWithdraw.proposal.id, action: 'reject' }), 'KNL_PROPOSAL_REJECT_REASON_REQUIRED', 'CASE REJECT-1. Không đồng ý bắt buộc phải có lý do');
  check(rejectReasonFail.statusCode === 400, 'CASE REJECT-1b. Thiếu lý do reject trả đúng 400');
  const rejected = await processStep(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { proposalId: reCreateAfterWithdraw.proposal.id, action: 'reject', reason: 'Chưa đủ điều kiện năng lực' });
  check(rejected.proposal.status === 'rejected' && rejected.proposal.rejectedReason === 'Chưa đủ điều kiện năng lực', 'CASE REJECT-2. Không đồng ý ở tầng trung gian (TBP) kết thúc workflow ngay, KHÔNG cần đi tiếp lên Admin');

  // ================= ROUTING: SELF-PROPOSAL SKIP SELF =================
  const vinhSelf = (await createProposal(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }), { employeeCode: 'VINH1', reason: 'Trợ lý Vinh tự đề xuất', proposedGradeId: 'grade-B2' })).proposal;
  check(vinhSelf.routingSnapshot.map(s => s.employeeCode).join(',') === '', 'CASE SELF-1. Vinh (Trợ lý) tự đề xuất -> chain KHÔNG có ai ở giữa (Vinh loại chính mình, GD không đủ quyền) -> đi thẳng Admin, không tồn tại self-agree');
  const vinhSelfDecision = await processStep(session('admin', { id: 'u-admin' }), { proposalId: vinhSelf.id, action: 'agree', suggestedGradeId: 'grade-B2' });
  check(vinhSelfDecision.proposal.status === 'approved', 'CASE SELF-2. Admin xử lý trực tiếp cho self-proposal của Trợ lý, không ai khác cần agree trước');

  // ================= ADMIN-CREATED PROPOSAL VẪN NORMAL CHAIN =================
  const adminCreated = (await createProposal(session('admin', { id: 'u-admin' }), { employeeCode: 'NVKHO1', reason: 'Admin tạo hộ cho NV Kho', proposedGradeId: 'grade-B2' })).proposal;
  check(adminCreated.routingSnapshot.map(s => s.employeeCode).join(',') === 'TBPKHO1,VINH1,', 'CASE ADMIN-CREATE-1. Admin tạo proposal cho NV Kho vẫn đi đúng chain TBP Kho -> Vinh -> Admin, KHÔNG bypass (mục 3/9 batch 1+2)');
  await expectFail(processStep(session('admin', { id: 'u-admin-2' }), { proposalId: adminCreated.id, action: 'agree', suggestedGradeId: 'grade-B2' }), 'KNL_PROPOSAL_NOT_YOUR_TURN', 'CASE ADMIN-CREATE-2. Kể cả Admin tạo, Admin KHÔNG được nhảy cóc xử lý thay tầng TBP Kho khi chưa tới lượt (create authority ≠ bypass authority)');
  // Dọn state: hoàn tất adminCreated để NVKHO1 hết pending, không chặn các case sau
  await processStep(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { proposalId: adminCreated.id, action: 'agree', suggestedGradeId: 'grade-B2' });
  await processStep(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }), { proposalId: adminCreated.id, action: 'agree', suggestedGradeId: 'grade-B2' });
  await processStep(session('admin', { id: 'u-admin' }), { proposalId: adminCreated.id, action: 'agree', suggestedGradeId: 'grade-B2' });

  // ================= ROUTING: SALES =================
  await expectFail(createProposal(session('learner', { id: 'acc-nvsales1', employeeCode: 'NVSALES1' }), { employeeCode: 'NVSALES1', reason: 'Chưa chọn Trưởng ca', proposedGradeId: 'grade-B2' }), 'KNL_PROPOSAL_SALES_APPROVER_REQUIRED', 'CASE SALES-1. NV Bán hàng tạo proposal mà chưa chọn Trưởng ca -> bị chặn, không silently chọn 1 người');
  await expectFail(createProposal(session('learner', { id: 'acc-nvsales1', employeeCode: 'NVSALES1' }), { employeeCode: 'NVSALES1', reason: 'Chọn người không phải Trưởng ca hợp lệ', proposedGradeId: 'grade-B2', selectedFirstApproverEmployeeCode: 'TBPKHO1' }), 'KNL_PROPOSAL_SALES_APPROVER_INVALID', 'CASE SALES-2. Chọn 1 người không có agree_proposal/scope Sales hợp lệ (TBP Kho) -> bị từ chối');

  const salesCreated = (await createProposal(session('learner', { id: 'acc-nvsales1', employeeCode: 'NVSALES1' }), { employeeCode: 'NVSALES1', reason: 'NV Bán hàng tự đề xuất, chọn TC2', proposedGradeId: 'grade-B3', selectedFirstApproverEmployeeCode: 'TC2' })).proposal;
  check(salesCreated.routingSnapshot.map(s => s.employeeCode).join(',') === 'TC2,TIEN1,', 'CASE SALES-3. NV Bán hàng chọn TC2 (không phải Trưởng ca "mặc định" theo chi nhánh) -> chain đúng TC2 -> Tiên -> Admin (Trưởng ca KHÔNG bị giới hạn theo chi nhánh của actor)');

  const tc2AgreeSales = await processStep(session('manager', { id: 'acc-tc2', employeeCode: 'TC2' }), { proposalId: salesCreated.id, action: 'agree', suggestedGradeId: 'grade-B3' });
  check(tc2AgreeSales.proposal.currentStepIndex === 1, 'CASE SALES-4. Trưởng ca TC2 (đúng người được chọn) agree thành công');
  await processStep(session('manager', { id: 'acc-tien', employeeCode: 'TIEN1' }), { proposalId: salesCreated.id, action: 'agree', suggestedGradeId: 'grade-B3' });
  await processStep(session('admin', { id: 'u-admin' }), { proposalId: salesCreated.id, action: 'agree', suggestedGradeId: 'grade-B3' });

  // Trưởng ca tự tạo cho NV thuộc scope -> hành động tạo = ý kiến tầng đó, không phải tự Agree lần nữa
  const tcCreatesForNv = (await createProposal(session('manager', { id: 'acc-tc1', employeeCode: 'TC1' }), { employeeCode: 'NVSALES1', reason: 'TC1 chủ động đề xuất cho NV thuộc scope Sales', proposedGradeId: 'grade-B2', selectedFirstApproverEmployeeCode: 'TC1' })).proposal;
  check(tcCreatesForNv.currentStepIndex === 1 && tcCreatesForNv.routingSnapshot[0].employeeCode === 'TC1', 'CASE SALES-5. Trưởng ca TC1 tự tạo cho NV Sales thuộc scope mình -> current_step_index tự nhảy sang 1 ngay lúc tạo (không bắt agree lần 2), đúng mục 5 batch 2');
  const tcCreatesDetail = await getDetail(session('manager', { id: 'acc-tien', employeeCode: 'TIEN1' }), { proposalId: tcCreatesForNv.id });
  check(tcCreatesDetail.steps.map(s => s.action).join(',') === 'propose,agree' && tcCreatesDetail.steps[1].reason.includes('Tự động'), 'CASE SALES-6. Timeline ghi rõ bước agree tự động (audit minh bạch, không giấu)');

  // Trưởng ca tự đề xuất cho chính mình -> bỏ qua tầng Trưởng ca, đi thẳng Tiên
  const tc1Self = (await createProposal(session('manager', { id: 'acc-tc1', employeeCode: 'TC1' }), { employeeCode: 'TC1', reason: 'TC1 tự đề xuất', proposedGradeId: 'grade-B4' })).proposal;
  check(tc1Self.routingSnapshot.map(s => s.employeeCode).join(',') === 'TIEN1,', 'CASE SALES-7. Trưởng ca tự đề xuất (title=Trưởng ca) -> KHÔNG cần chọn selectedFirstApprover, bỏ qua chính mình, đi thẳng Tiên -> Admin');

  // ================= VISIBILITY (proposalScope ĐỘC LẬP với people_scope) =================
  await grant('acc-nvkho1', 'NVKHO1', 'NHAN_VIEN', { access_knl: true, view_people: true, propose: true, view_proposals: true, proposalScope: { type: 'self', values: [] } }, { type: 'self', values: [] }, 'Bổ sung view_proposals cho NVKHO1 (cập nhật cùng account, giữ nguyên các quyền khác)');
  let visible = await listVisible(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }));
  check(visible.proposals.every(p => p.subjectEmployeeCode === 'NVKHO1'), 'CASE VISIBILITY-1. NV (proposalScope self) chỉ thấy đúng proposal của chính mình trong danh sách chung');

  visible = await listVisible(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }));
  check(visible.proposals.some(p => p.subjectEmployeeCode === 'NVKHO1'), 'CASE VISIBILITY-2. Vinh (proposalScope department=Kho) thấy proposal của NV Kho');
  check(!visible.proposals.some(p => p.subjectEmployeeCode === 'NVSALES1' || p.subjectEmployeeCode === 'TC1'), 'CASE VISIBILITY-2b. Vinh (department=Kho) KHÔNG thấy proposal của Sales dù có agree_proposal capability nói chung (proposalScope tách biệt hoàn toàn khỏi people_scope)');

  visible = await listVisible(session('manager', { id: 'acc-tien', employeeCode: 'TIEN1' }));
  check(visible.proposals.some(p => p.subjectEmployeeCode === 'NVSALES1' || p.subjectEmployeeCode === 'TC1') && !visible.proposals.some(p => p.subjectEmployeeCode === 'NVKHO1'), 'CASE VISIBILITY-3. Tiên (proposalScope department=Bộ phận bán hàng) thấy đúng phạm vi Sales, không thấy Kho');

  visible = await listVisible(session('manager', { id: 'acc-gd', employeeCode: 'GD1' }));
  check(visible.proposals.length >= 1, 'CASE VISIBILITY-4. Giám đốc (proposalScope all_company) thấy toàn bộ proposal toàn công ty');
  await expectFail(processStep(session('manager', { id: 'acc-gd', employeeCode: 'GD1' }), { proposalId: tc1Self.id, action: 'agree', suggestedGradeId: 'grade-B2' }), 'KNL_AGREE_PROPOSAL_DENIED', 'CASE VISIBILITY-5. Giám đốc xem được toàn công ty nhưng KHÔNG thực thi được (agree_proposal=false) — view all ≠ execution, đúng kiến trúc đã chốt (mục 18 batch 1 / mục 12 batch 2)');

  visible = await listVisible(session('admin', { id: 'u-admin' }));
  check(visible.proposals.length === STATE.proposals.length, 'CASE VISIBILITY-6. Admin thấy toàn công ty (đường cứu hộ, không cần grant riêng) — đúng bằng tổng số proposal đã tạo trong test');

  // ---------- PERMISSION SEPARATION — chứng minh bằng test, không suy diễn ----------
  await expectFail(listVisible(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' })), 'KNL_VIEW_PROPOSALS_DENIED', 'CASE PERM-2. TBP Kho có agree_proposal=true + people_scope Kho nhưng KHÔNG có view_proposals -> KHÔNG tự có quyền xem danh sách chung (people_scope không tự cấp Proposal Visibility, đúng mục 2 batch 2)');
  // ...nhưng TBP Kho vẫn xử lý được proposal ĐANG ĐÚNG LƯỢT của mình (đã chứng minh ở CASE ROUTE-4) — creation/processing độc lập với general visibility.
  const detailForTbp = await getDetail(session('manager', { id: 'acc-tbpkho', employeeCode: 'TBPKHO1' }), { proposalId: tc1Self.id }).catch(e => e);
  check(detailForTbp instanceof Error && detailForTbp.statusCode === 403 && ['KNL_PROPOSAL_VIEW_DENIED', 'KNL_VIEW_PROPOSALS_DENIED'].includes(detailForTbp.code), 'CASE PERM-3. TBP Kho (không view_proposals, không phải subject/creator/đúng lượt) KHÔNG mở được chi tiết proposal của Sales — không có "quyền xem ké" nào ngoài phạm vi');

  await expectFail(createProposal(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }), { employeeCode: 'NVSALES1', reason: 'Vinh (view_proposals Kho) thử tạo cho Sales', proposedGradeId: 'grade-B2' }), 'KNL_PROPOSAL_CREATE_OUT_OF_SCOPE', 'CASE PERM-4. proposalScope (Vinh xem được Kho) KHÔNG tự cấp quyền TẠO proposal ngoài people_scope của Vinh (Vinh people_scope cũng chỉ Kho) — 2 trục độc lập, không suy quyền lẫn nhau');

  // ================= BROKEN ROUTE / REASSIGNMENT =================
  const brokenSubject = (await createProposal(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }), { employeeCode: 'NVKHO1', reason: 'Test broken route', proposedGradeId: 'grade-B2' })).proposal;
  // TBP Kho đột ngột mất agree_proposal (rời vị trí / đổi role) TRƯỚC khi được xử lý
  await grant('acc-tbpkho', 'TBPKHO1', 'NHAN_VIEN', { access_knl: true, view_people: true, propose: true, agree_proposal: false }, { type: 'self', values: [] }, 'TBP Kho rời vị trí, thu hồi agree_proposal');
  const brokenDetail = await getDetail(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }), { proposalId: brokenSubject.id });
  check(brokenDetail.liveChain.map(s => s.employeeCode).join(',') === 'VINH1,', 'CASE BROKEN-1. TBP Kho mất agree_proposal -> chain tính lại (live) tự động bỏ qua, nhảy thẳng tới Vinh (không còn kẹt ở TBP cũ)');
  check(brokenDetail.isMyTurn === true, 'CASE BROKEN-2. Vinh giờ đúng là người cần xử lý (current_step_index=0 vẫn trỏ đúng vị trí đầu chain MỚI, không bị lệch)');
  const brokenAgree = await processStep(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }), { proposalId: brokenSubject.id, action: 'agree', suggestedGradeId: 'grade-B2' });
  check(brokenAgree.proposal.status === 'pending' && brokenAgree.proposal.currentStepIndex === 1, 'CASE BROKEN-3. Vinh xử lý thành công dù TBP Kho (người được routing_snapshot lúc tạo trỏ tới) không còn thẩm quyền');
  const brokenStepsDetail = await getDetail(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }), { proposalId: brokenSubject.id });
  check(brokenStepsDetail.steps.some(s => s.action === 'reassign' && s.reassignedFromEmployeeCode === 'TBPKHO1' && s.reassignedToEmployeeCode === 'VINH1'), 'CASE BROKEN-4. Timeline có ghi rõ 1 bước "reassign" audit lại việc route bị đứt (mục 7 batch 2 — không âm thầm bỏ qua)');
  // khôi phục quyền TBP Kho cho các case sau (không ảnh hưởng gì vì proposal này đã qua tầng đó)
  await grant('acc-tbpkho', 'TBPKHO1', 'TRUONG_BO_PHAN', { access_knl: true, view_people: true, propose: true, agree_proposal: true }, { type: 'department', values: ['Kho'] }, 'Khôi phục quyền TBP Kho cho case sau');

  // ================= "CẦN TÔI XỬ LÝ" =================
  const awaitingVinh = await listAwaitingMe(session('manager', { id: 'acc-vinh', employeeCode: 'VINH1' }));
  check(awaitingVinh.proposals.some(p => p.id === brokenSubject.id), 'CASE AWAITING-1. Danh sách "cần tôi xử lý" của Vinh gồm đúng proposal đang chờ Vinh (broken-route đã reassign xong)');
  const awaitingAdmin = await listAwaitingMe(session('admin', { id: 'u-admin' }));
  check(Array.isArray(awaitingAdmin.proposals), 'CASE AWAITING-2. Admin gọi được "cần tôi xử lý" (bao gồm mọi proposal đang ở tầng final)');

  // ================= listMyGradePromotionProposals =================
  const mine = await listMine(session('learner', { id: 'acc-nvkho1', employeeCode: 'NVKHO1' }));
  check(mine.proposals.every(p => p.subjectEmployeeCode === 'NVKHO1' || p.createdBy === 'acc-nvkho1'), 'CASE MINE-1. "Proposal của tôi" chỉ gồm proposal mà NVKHO1 là subject hoặc creator');

  // ================= REGRESSION — không đọc income/lương ở bất kỳ đâu =================
  const proposalJson = JSON.stringify(STATE.proposals);
  const stepJson = JSON.stringify(STATE.steps);
  check(!/base_salary|hqcv|professional_allowance|management_allowance|incomeScope|income_view/i.test(proposalJson + stepJson), 'CASE INCOME-GUARD-1. Không có field lương/thu nhập/incomeScope/income_view nào lọt vào dữ liệu proposals/steps trong toàn bộ test run');

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(e => { console.error('UNCAUGHT', e); process.exit(1); });
