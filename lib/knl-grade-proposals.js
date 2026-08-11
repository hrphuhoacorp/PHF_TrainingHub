'use strict';

/*
 * KNL "Đề xuất nâng bậc" (Grade Promotion Proposal) — batch 2 implement, theo
 * đúng TRACE REPORT batch 1 + review Technical Lead batch 2. Phạm vi: CHỈ
 * workflow propose -> agree (nhiều tầng) -> approve/reject/withdraw. TUYỆT
 * ĐỐI không đọc/ghi tiền lương — xem loadCurrentGrade()/listNextGrades() chỉ
 * select id/code/number, không bao giờ select base_salary/hqcv/allowance.
 * "approved" ở đây CHỈ có nghĩa Admin đã chấp thuận workflow — KHÔNG ghi
 * knl_employee_compensation_assignments hay bất kỳ bảng thu nhập nào (mục 11
 * batch 2). Hậu xử lý sau approved là bài toán riêng, không nằm ở đây.
 *
 * Routing (mục 5/6/7 batch 2): LUÔN dựa vào SUBJECT, không phải creator.
 * resolveApprovalChain() không hề đọc creatorEmployeeCode — chain 100% là
 * hàm của subject + (Sales) approver được chọn tường minh. Mỗi lượt xử lý
 * (agree/reject) đều RE-RESOLVE chain từ dữ liệu sống (Organization Master +
 * knl_permission_grants hiện hành) — không tin routing_snapshot lúc tạo, chỉ
 * dùng snapshot đó để phát hiện + audit reassignment (mục 7).
 *
 * Visibility (proposalScope) và Creation/Processing (people_scope +
 * propose/agree_proposal/approve) là 2 trục ĐỘC LẬP — xem lib/knl-permissions.js.
 * File này không đọc income_view/incomeScope ở bất kỳ đâu.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { subjectMatchesScope, normalizeScopeText, SALES_ALL_BRANCHES_DEPARTMENT } = require('./knl-scope');
const { resolveActorGrant, requireAccessKnl, requireViewProposals, requirePropose, requireAgreeProposal, requireApprove } = require('./knl-permissions');
const { loadKnlOrganizationRows } = require('./knl-people');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const db = configured
  ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

const MIGRATION = 'scripts/PHF_KNL_GRADE_PROMOTION_PROPOSAL_1.51.0.sql';
const PROPOSALS_TABLE = 'knl_grade_promotion_proposals';
const STEPS_TABLE = 'knl_grade_promotion_proposal_steps';
const MAX_CHAIN_HOPS = 12;
const MAX_NEXT_GRADES = 4;

function text(value) { return String(value == null ? '' : value).trim(); }
function code(value) { return text(value).toUpperCase(); }
function fail(message, statusCode = 400, errorCode = 'KNL_PROPOSAL_INVALID') { const error = new Error(message); error.statusCode = statusCode; error.code = errorCode; throw error; }
function ensureDb() { if (!db) fail('Supabase chưa được cấu hình cho KNL Đề xuất nâng bậc.', 503, 'SUPABASE_NOT_CONFIGURED'); }
function throwDb(error) {
  if (!error) return;
  const errCode = text(error.code), message = text(error.message);
  if (errCode === 'PGRST205' || errCode === '42P01' || /Could not find the table|relation .* does not exist|schema cache/i.test(message)) {
    fail('Schema Đề xuất nâng bậc chưa được cài đặt. Hãy chạy ' + MIGRATION + '.', 503, 'KNL_PROPOSAL_SCHEMA_MISSING');
  }
  if (errCode === '23505') fail('Nhân sự này đã có 1 Đề xuất nâng bậc đang xử lý (chỉ được tối đa 1 đề xuất active).', 409, 'KNL_PROPOSAL_ALREADY_ACTIVE');
  throw error;
}
function actor(session) {
  return {
    id: text(session?.account?.id || session?.sub) || null,
    name: text(session?.account?.name || session?.account?.email || session?.email) || null,
    employeeCode: code(session?.employeeId || session?.account?.employeeCode || session?.employeeCode),
    role: text(session?.role).toLowerCase()
  };
}

// ---------------------------------------------------------------------------
// Grade source — CHỈ knl_compensation_grades (bậc lương, không phải bậc năng
// lực knl_grade_definitions — xem TRACE REPORT mục A/B). CHỈ đọc
// id/version_id/ladder_id/grade_code/grade_number — không bao giờ select cột
// tiền.
// ---------------------------------------------------------------------------
async function loadCurrentGrade(employeeCode) {
  ensureDb();
  const assignmentResult = await db.from('knl_employee_compensation_assignments')
    .select('employee_code,employment_type,payroll_period,compensation_grade_id,compensation_version_id')
    .eq('employee_code', employeeCode)
    .order('payroll_period', { ascending: false })
    .limit(1).maybeSingle();
  throwDb(assignmentResult.error);
  const assignment = assignmentResult.data;
  if (!assignment) return { hasBaseline: false, reason: 'no_assignment' };
  if (assignment.employment_type === 'PROBATION' || !assignment.compensation_grade_id) return { hasBaseline: false, reason: 'probation' };

  const gradeResult = await db.from('knl_compensation_grades').select('id,version_id,ladder_id,grade_code,grade_number').eq('id', assignment.compensation_grade_id).maybeSingle();
  throwDb(gradeResult.error);
  const grade = gradeResult.data;
  if (!grade) return { hasBaseline: false, reason: 'grade_missing' };

  const [versionResult, ladderResult] = await Promise.all([
    db.from('knl_compensation_versions').select('id,ladder_id,version_number,status').eq('id', grade.version_id).maybeSingle(),
    db.from('knl_compensation_ladders').select('id,code,name').eq('id', grade.ladder_id).maybeSingle()
  ]);
  throwDb(versionResult.error); throwDb(ladderResult.error);
  const version = versionResult.data, ladder = ladderResult.data;

  return {
    hasBaseline: true,
    gradeId: grade.id, gradeCode: grade.grade_code, gradeNumber: grade.grade_number,
    versionId: grade.version_id, versionNumber: version ? version.version_number : null,
    ladderId: grade.ladder_id, ladderCode: ladder ? ladder.code : '', ladderName: ladder ? ladder.name : ''
  };
}

async function listNextGrades(versionId, currentGradeNumber) {
  ensureDb();
  const result = await db.from('knl_compensation_grades')
    .select('id,grade_code,grade_number,version_id')
    .eq('version_id', versionId)
    .gt('grade_number', currentGradeNumber)
    .order('grade_number', { ascending: true })
    .limit(MAX_NEXT_GRADES);
  throwDb(result.error);
  return (result.data || []).map(row => ({ id: row.id, gradeCode: row.grade_code, gradeNumber: row.grade_number, versionId: row.version_id }));
}

async function loadGradeById(gradeId, versionId) {
  ensureDb();
  const result = await db.from('knl_compensation_grades').select('id,version_id,grade_code,grade_number').eq('id', gradeId).eq('version_id', versionId).maybeSingle();
  throwDb(result.error);
  return result.data;
}

// ---------------------------------------------------------------------------
// Visibility (proposalScope) — mirror incomeScopeAllows pattern ở
// lib/knl-foundation.js: đọc resolved.row.capabilities.proposalScope (jsonb
// gốc, không qua capabilities() picker), KHÔNG đọc people_scope.
// ---------------------------------------------------------------------------
function proposalScopeAllows(resolved, subjectRow) {
  if (resolved.source === 'admin_recovery') return true;
  if (resolved.capabilities.view_proposals !== true) return false;
  const scope = resolved.row && resolved.row.capabilities && resolved.row.capabilities.proposalScope;
  if (!scope || typeof scope !== 'object') return false;
  return subjectMatchesScope(subjectRow, scope, resolved.identity);
}

// Creation authority (mục 3 batch 1): self luôn được (nếu có propose), Admin
// luôn được, ngoài ra dùng people_scope hiện có ("phạm vi phụ trách hợp lệ")
// — KHÔNG dùng proposalScope cho việc này (proposalScope CHỈ cho visibility).
function creationAuthorized(resolved, subjectRow) {
  if (resolved.source === 'admin_recovery') return true;
  if (code(subjectRow.employee_code) === resolved.identity.employeeCode) return true;
  return subjectMatchesScope(subjectRow, resolved.peopleScope, resolved.identity);
}

// ---------------------------------------------------------------------------
// Active knl_permission_grants keyed by employee_code — dùng để xác định
// authority xử lý (agree_proposal + people_scope) khi walk chain. Load 1 lần/
// request, không query lặp lại theo từng candidate.
// ---------------------------------------------------------------------------
async function loadActiveGrantsByEmployeeCode() {
  ensureDb();
  const result = await db.from('knl_permission_grants').select('employee_code,capabilities,people_scope').eq('is_active', true);
  throwDb(result.error);
  const map = new Map();
  (result.data || []).forEach(row => {
    const empCode = code(row.employee_code);
    if (empCode && !map.has(empCode)) map.set(empCode, row);
  });
  return map;
}

/* subjectIsApproverRole: dùng OR của 2 tín hiệu — (a) title='Trưởng ca' trong
 * Organization Master (đã chuẩn hoá ở batch Organization Master Clean &
 * Reset, 2026-08-11), (b) chính subject đang giữ agree_proposal=true qua
 * grant thật. (a) là fallback CHO ĐẾN KHI Admin thật sự cấp agree_proposal
 * cho các tài khoản Trưởng ca (hiện tại 0 grant nào có agree_proposal=true
 * ngoài 3 Trợ lý GĐ — xem TRACE REPORT). Đây là quyết định triển khai có rủi
 * ro drift nếu title đổi sau này mà quên cập nhật — ĐÃ NÊU RÕ TRONG REPORT
 * BATCH 2, không phải quyết định nghiệp vụ tự ý giấu đi. KHÔNG dùng title
 * cho bất kỳ quyết định CẤP QUYỀN nào khác trong file này — chỉ dùng để định
 * hình CHAIN (thứ tự các bước), authority thật vẫn luôn qua
 * capabilities.agree_proposal + people_scope. */
function subjectIsApproverRole(subjectRow, grantsByCode) {
  const titleIsTruongCa = normalizeScopeText(subjectRow.title) === normalizeScopeText('Trưởng ca');
  const grant = grantsByCode.get(code(subjectRow.employee_code));
  const grantHasAgree = Boolean(grant && grant.capabilities && grant.capabilities.agree_proposal === true);
  return titleIsTruongCa || grantHasAgree;
}

function findOrgRow(orgRows, employeeCode) {
  const target = code(employeeCode);
  return orgRows.find(row => code(row.employee_code) === target) || null;
}

/* resolveApprovalChain — 100% hàm của subject (+ selectedFirstApprover cho
 * Sales rank-and-file), KHÔNG đọc creator. Trả về mảng các bước
 * [{employeeCode,employeeName,tier:'agree'}, ..., {employeeCode:'',
 * employeeName:'Admin',tier:'final'}] — phần tử cuối LUÔN là Admin (final
 * authority, mục 9 batch 1: "Admin tạo proposal KHÔNG bypass normal
 * workflow" — Admin luôn là tier cuối, không bao giờ là tier giữa). */
function resolveApprovalChain({ orgRows, grantsByCode, subjectEmployeeCode, selectedFirstApproverEmployeeCode }) {
  const subject = findOrgRow(orgRows, subjectEmployeeCode);
  if (!subject) fail('Không tìm thấy nhân sự trong Organization Master.', 404, 'KNL_PROPOSAL_SUBJECT_NOT_FOUND');

  const isSalesSubject = normalizeScopeText(subject.department) === normalizeScopeText(SALES_ALL_BRANCHES_DEPARTMENT);
  const chain = [];
  const seen = new Set([code(subject.employee_code)]);
  let startCode;

  if (isSalesSubject && !subjectIsApproverRole(subject, grantsByCode)) {
    const selected = code(selectedFirstApproverEmployeeCode);
    if (!selected) fail('Vui lòng chọn một Trưởng ca Bán hàng hợp lệ để xử lý đề xuất.', 400, 'KNL_PROPOSAL_SALES_APPROVER_REQUIRED');
    const approverRow = findOrgRow(orgRows, selected);
    const approverGrant = grantsByCode.get(selected);
    const approverQualifies = approverRow && approverGrant && approverGrant.capabilities.agree_proposal === true &&
      subjectMatchesScope(subject, approverGrant.people_scope, { employeeCode: selected });
    if (!approverQualifies) fail('Trưởng ca được chọn không hợp lệ cho nhân sự này (không có quyền xử lý đề xuất hoặc ngoài phạm vi phụ trách).', 400, 'KNL_PROPOSAL_SALES_APPROVER_INVALID');
    chain.push({ employeeCode: selected, employeeName: approverRow.employee_name, tier: 'agree' });
    seen.add(selected);
    startCode = approverRow.manager_code;
  } else {
    startCode = subject.manager_code;
  }

  let cursor = startCode, hops = 0;
  while (cursor && hops < MAX_CHAIN_HOPS) {
    const candidateCode = code(cursor);
    if (seen.has(candidateCode)) break; // cycle guard
    seen.add(candidateCode);
    const row = findOrgRow(orgRows, candidateCode);
    if (!row || row.employee_status === 'Đã nghỉ việc') break; // route chấm dứt tại đây, rơi thẳng xuống Admin bên dưới
    const grant = grantsByCode.get(candidateCode);
    if (grant && grant.capabilities && grant.capabilities.agree_proposal === true && subjectMatchesScope(subject, grant.people_scope, { employeeCode: candidateCode })) {
      chain.push({ employeeCode: candidateCode, employeeName: row.employee_name, tier: 'agree' });
    }
    cursor = row.manager_code;
    hops++;
  }

  chain.push({ employeeCode: '', employeeName: 'Admin', tier: 'final' });
  return chain;
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------
async function createGradePromotionProposal(session, input = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  requirePropose(resolved);
  const a = actor(session);
  // Lưu ý: Admin có thể tạo proposal mà không có employeeCode liên kết (mục 9
  // batch 1: Admin tạo cho toàn công ty) — chỉ NGƯỜI KHÔNG PHẢI admin_recovery
  // và không tự-tạo-cho-chính-mình mới cần employeeCode để creationAuthorized()
  // so khớp people_scope; admin_recovery đã bypass check đó, không cần ở đây.

  const subjectEmployeeCode = code(input.employeeCode || input.subjectEmployeeCode);
  if (!subjectEmployeeCode) fail('Thiếu mã nhân viên được đề xuất.', 400, 'KNL_PROPOSAL_SUBJECT_REQUIRED');
  const reason = text(input.reason);
  if (reason.length < 5) fail('Lý do đề xuất cần tối thiểu 5 ký tự.', 400, 'KNL_PROPOSAL_REASON_REQUIRED');
  const proposedGradeId = text(input.proposedGradeId);
  if (!proposedGradeId) fail('Vui lòng chọn bậc đề xuất.', 400, 'KNL_PROPOSAL_GRADE_REQUIRED');

  const orgRows = await loadKnlOrganizationRows();
  const subjectRow = findOrgRow(orgRows, subjectEmployeeCode);
  if (!subjectRow) fail('Không tìm thấy nhân sự trong Organization Master.', 404, 'KNL_PROPOSAL_SUBJECT_NOT_FOUND');
  if (subjectRow.employee_status === 'Đã nghỉ việc') fail('Không thể tạo Đề xuất nâng bậc cho nhân sự đã nghỉ việc.', 409, 'KNL_PROPOSAL_SUBJECT_INACTIVE');

  if (!creationAuthorized(resolved, subjectRow)) fail('Bạn không có thẩm quyền tạo Đề xuất nâng bậc cho nhân sự này.', 403, 'KNL_PROPOSAL_CREATE_OUT_OF_SCOPE');

  const currentGrade = await loadCurrentGrade(subjectEmployeeCode);
  if (!currentGrade.hasBaseline) {
    const message = currentGrade.reason === 'probation'
      ? 'Nhân sự đang trong thời gian thử việc, chưa thiết lập bậc hiện tại — chưa thể tạo Đề xuất nâng bậc.'
      : 'Chưa thiết lập bậc hiện tại cho nhân sự này — chưa thể tạo Đề xuất nâng bậc.';
    fail(message, 409, 'KNL_PROPOSAL_NO_BASELINE_GRADE');
  }

  const proposedGrade = await loadGradeById(proposedGradeId, currentGrade.versionId);
  if (!proposedGrade) fail('Bậc đề xuất không hợp lệ.', 400, 'KNL_PROPOSAL_GRADE_INVALID');
  const nextGrades = await listNextGrades(currentGrade.versionId, currentGrade.gradeNumber);
  if (!nextGrades.some(g => g.id === proposedGrade.id)) fail('Bậc đề xuất phải cao hơn bậc hiện tại và nằm trong tối đa 4 bậc kế tiếp còn hợp lệ trong ladder.', 400, 'KNL_PROPOSAL_GRADE_OUT_OF_RANGE');

  const grantsByCode = await loadActiveGrantsByEmployeeCode();
  const selectedFirstApproverEmployeeCode = code(input.selectedFirstApproverEmployeeCode);
  const chain = resolveApprovalChain({ orgRows, grantsByCode, subjectEmployeeCode, selectedFirstApproverEmployeeCode: selectedFirstApproverEmployeeCode || null });

  const now = new Date().toISOString();
  const insertRow = {
    subject_employee_code: subjectEmployeeCode,
    subject_employee_name: subjectRow.employee_name,
    created_by: a.id, created_by_name: a.name,
    compensation_ladder_id: currentGrade.ladderId,
    compensation_version_id: currentGrade.versionId,
    current_grade_id: currentGrade.gradeId, current_grade_code: currentGrade.gradeCode, current_grade_number: currentGrade.gradeNumber,
    proposed_grade_id: proposedGrade.id, proposed_grade_code: proposedGrade.grade_code, proposed_grade_number: proposedGrade.grade_number,
    reason,
    status: 'pending',
    selected_first_approver_employee_code: selectedFirstApproverEmployeeCode || null,
    routing_snapshot: chain,
    current_step_index: 0,
    updated_at: now
  };

  const insertResult = await db.from(PROPOSALS_TABLE).insert(insertRow).select('*').single();
  throwDb(insertResult.error);
  const proposal = insertResult.data;

  // step 0: propose. Sau đó, nếu creator chính là người đứng đầu 1+ tier
  // liên tiếp (mục 5 batch 2: "không bắt actor tự Agree lần nữa" — tổng quát
  // hoá cho mọi tầng, không riêng Sales), auto-advance kèm log 'agree' ngầm —
  // KHÔNG BAO GIỜ tự động đi qua tier cuối (Admin, tier:'final') — Admin luôn
  // phải approve() tường minh (mục 9: "Admin tạo proposal KHÔNG bypass").
  const steps = [{
    proposal_id: proposal.id, step_index: 0, actor_id: a.id, actor_employee_code: a.employeeCode, actor_name: a.name,
    action: 'propose', suggested_grade_id: proposedGrade.id, suggested_grade_code: proposedGrade.grade_code, suggested_grade_number: proposedGrade.grade_number,
    reason
  }];
  let cursor = 0;
  while (cursor < chain.length - 1 && chain[cursor].employeeCode === a.employeeCode) {
    steps.push({
      proposal_id: proposal.id, step_index: steps.length, actor_id: a.id, actor_employee_code: a.employeeCode, actor_name: a.name,
      action: 'agree', suggested_grade_id: proposedGrade.id, suggested_grade_code: proposedGrade.grade_code, suggested_grade_number: proposedGrade.grade_number,
      reason: 'Tự động — hành động tạo Đề xuất đã thể hiện ý kiến của tầng này (không lặp lại Đồng ý).'
    });
    cursor++;
  }
  const stepsResult = await db.from(STEPS_TABLE).insert(steps);
  throwDb(stepsResult.error);

  if (cursor > 0) {
    const updateResult = await db.from(PROPOSALS_TABLE).update({ current_step_index: cursor, updated_at: new Date().toISOString() }).eq('id', proposal.id).select('*').single();
    throwDb(updateResult.error);
    return { proposal: publicProposal(updateResult.data) };
  }
  return { proposal: publicProposal(proposal) };
}

// ---------------------------------------------------------------------------
// PROCESS (agree / approve / reject) — luôn re-resolve chain từ dữ liệu sống
// (mục 15 batch 1, mục 5/7 batch 2), KHÔNG tin routing_snapshot lúc tạo.
// ---------------------------------------------------------------------------
async function processGradePromotionProposalStep(session, input = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  const a = actor(session);
  const action = text(input.action).toLowerCase();
  if (!['agree', 'reject'].includes(action)) fail('Hành động xử lý không hợp lệ.', 400, 'KNL_PROPOSAL_ACTION_INVALID');

  const proposalId = text(input.proposalId || input.id);
  if (!proposalId) fail('Thiếu mã Đề xuất nâng bậc.', 400, 'KNL_PROPOSAL_ID_REQUIRED');
  const loadResult = await db.from(PROPOSALS_TABLE).select('*').eq('id', proposalId).maybeSingle();
  throwDb(loadResult.error);
  const proposal = loadResult.data;
  if (!proposal) fail('Không tìm thấy Đề xuất nâng bậc.', 404, 'KNL_PROPOSAL_NOT_FOUND');
  if (proposal.status !== 'pending') fail('Đề xuất này đã có quyết định cuối (' + proposal.status + '), không thể xử lý thêm.', 409, 'KNL_PROPOSAL_ALREADY_FINAL');

  const orgRows = await loadKnlOrganizationRows();
  const grantsByCode = await loadActiveGrantsByEmployeeCode();
  const freshChain = resolveApprovalChain({
    orgRows, grantsByCode,
    subjectEmployeeCode: proposal.subject_employee_code,
    selectedFirstApproverEmployeeCode: proposal.selected_first_approver_employee_code
  });

  const idx = proposal.current_step_index;
  if (idx >= freshChain.length) fail('Trạng thái Đề xuất không nhất quán (vượt quá chain xử lý) — cần Admin kiểm tra.', 500, 'KNL_PROPOSAL_STATE_INCONSISTENT');
  const expected = freshChain[idx];
  const isFinalTier = expected.tier === 'final';

  if (isFinalTier) requireApprove(resolved);
  else {
    requireAgreeProposal(resolved);
    if (code(expected.employeeCode) !== a.employeeCode) fail('Không đúng lượt xử lý của bạn cho Đề xuất này.', 403, 'KNL_PROPOSAL_NOT_YOUR_TURN');
  }

  const existingStepsCountResult = await db.from(STEPS_TABLE).select('id', { count: 'exact', head: true }).eq('proposal_id', proposal.id);
  throwDb(existingStepsCountResult.error);
  let nextStepIndex = existingStepsCountResult.count || 0;

  // Broken-route detection (mục 7 batch 2): so với routing_snapshot lúc tạo
  // (hoặc lần re-resolve gần nhất) tại đúng vị trí idx — khác thì audit
  // 'reassign' TRƯỚC KHI ghi nhận action agree/reject của người mới.
  const priorSnapshot = Array.isArray(proposal.routing_snapshot) ? proposal.routing_snapshot : [];
  const priorAtIdx = priorSnapshot[idx];
  if (!isFinalTier && priorAtIdx && code(priorAtIdx.employeeCode) !== code(expected.employeeCode)) {
    const reassignStep = {
      proposal_id: proposal.id, step_index: nextStepIndex, action: 'reassign',
      reassigned_from_employee_code: code(priorAtIdx.employeeCode) || null, reassigned_to_employee_code: code(expected.employeeCode) || null,
      reason: 'Route lại tự động: người xử lý gốc không còn thẩm quyền/phạm vi phụ trách phù hợp tại thời điểm xử lý.'
    };
    const reassignResult = await db.from(STEPS_TABLE).insert(reassignStep);
    throwDb(reassignResult.error);
    nextStepIndex++;
  }

  if (action === 'reject') {
    const rejectReason = text(input.reason);
    if (rejectReason.length < 5) fail('Lý do không đồng ý cần tối thiểu 5 ký tự.', 400, 'KNL_PROPOSAL_REJECT_REASON_REQUIRED');
    const now = new Date().toISOString();
    const updateResult = await db.from(PROPOSALS_TABLE).update({
      status: 'rejected', rejected_reason: rejectReason, rejected_by: a.id, rejected_by_name: a.name, rejected_at: now,
      routing_snapshot: freshChain, updated_at: now
    }).eq('id', proposal.id).select('*').single();
    throwDb(updateResult.error);
    const stepResult = await db.from(STEPS_TABLE).insert({
      proposal_id: proposal.id, step_index: nextStepIndex, actor_id: a.id, actor_employee_code: a.employeeCode, actor_name: a.name,
      action: 'reject', reason: rejectReason
    });
    throwDb(stepResult.error);
    return { proposal: publicProposal(updateResult.data) };
  }

  // action === 'agree' (kể cả tier cuối — action lưu vào steps là 'approve' để timeline rõ ràng)
  const suggestedGradeId = text(input.suggestedGradeId || input.gradeId);
  if (!suggestedGradeId) fail('Vui lòng chọn bậc kiến nghị.', 400, 'KNL_PROPOSAL_SUGGESTED_GRADE_REQUIRED');
  const suggestedGrade = await loadGradeById(suggestedGradeId, proposal.compensation_version_id);
  if (!suggestedGrade) fail('Bậc kiến nghị không hợp lệ.', 400, 'KNL_PROPOSAL_SUGGESTED_GRADE_INVALID');
  if (!(suggestedGrade.grade_number > proposal.current_grade_number && suggestedGrade.grade_number <= proposal.proposed_grade_number)) {
    fail('Bậc kiến nghị phải cao hơn bậc hiện tại và không được vượt quá bậc đề xuất ban đầu.', 400, 'KNL_PROPOSAL_SUGGESTED_GRADE_OUT_OF_RANGE');
  }

  const now = new Date().toISOString();
  const stepAction = isFinalTier ? 'approve' : 'agree';
  const stepResult = await db.from(STEPS_TABLE).insert({
    proposal_id: proposal.id, step_index: nextStepIndex, actor_id: a.id, actor_employee_code: a.employeeCode, actor_name: a.name,
    action: stepAction, suggested_grade_id: suggestedGrade.id, suggested_grade_code: suggestedGrade.grade_code, suggested_grade_number: suggestedGrade.grade_number,
    reason: text(input.note) || null
  });
  throwDb(stepResult.error);

  const patch = { current_step_index: idx + 1, routing_snapshot: freshChain, updated_at: now };
  if (isFinalTier) {
    Object.assign(patch, {
      status: 'approved',
      final_decided_grade_id: suggestedGrade.id, final_decided_grade_code: suggestedGrade.grade_code, final_decided_grade_number: suggestedGrade.grade_number,
      final_decided_by: a.id, final_decided_by_name: a.name, final_decided_at: now
    });
  }
  const updateResult = await db.from(PROPOSALS_TABLE).update(patch).eq('id', proposal.id).select('*').single();
  throwDb(updateResult.error);
  return { proposal: publicProposal(updateResult.data) };
}

// ---------------------------------------------------------------------------
// WITHDRAW
// ---------------------------------------------------------------------------
async function withdrawGradePromotionProposal(session, input = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  const a = actor(session);
  const proposalId = text(input.proposalId || input.id);
  if (!proposalId) fail('Thiếu mã Đề xuất nâng bậc.', 400, 'KNL_PROPOSAL_ID_REQUIRED');
  const reason = text(input.reason);
  if (reason.length < 5) fail('Lý do rút đề xuất cần tối thiểu 5 ký tự.', 400, 'KNL_PROPOSAL_WITHDRAW_REASON_REQUIRED');

  const loadResult = await db.from(PROPOSALS_TABLE).select('*').eq('id', proposalId).maybeSingle();
  throwDb(loadResult.error);
  const proposal = loadResult.data;
  if (!proposal) fail('Không tìm thấy Đề xuất nâng bậc.', 404, 'KNL_PROPOSAL_NOT_FOUND');
  if (proposal.created_by !== a.id && resolved.source !== 'admin_recovery') fail('Chỉ người tạo Đề xuất mới được rút.', 403, 'KNL_PROPOSAL_WITHDRAW_NOT_CREATOR');
  if (proposal.status !== 'pending') fail('Đề xuất đã có quyết định cuối, không thể rút.', 409, 'KNL_PROPOSAL_ALREADY_FINAL');

  const now = new Date().toISOString();
  const updateResult = await db.from(PROPOSALS_TABLE).update({ status: 'withdrawn', withdrawn_reason: reason, withdrawn_by: a.id, withdrawn_by_name: a.name, withdrawn_at: now, updated_at: now }).eq('id', proposal.id).select('*').single();
  throwDb(updateResult.error);
  const existingStepsCountResult = await db.from(STEPS_TABLE).select('id', { count: 'exact', head: true }).eq('proposal_id', proposal.id);
  throwDb(existingStepsCountResult.error);
  const stepResult = await db.from(STEPS_TABLE).insert({ proposal_id: proposal.id, step_index: existingStepsCountResult.count || 0, actor_id: a.id, actor_employee_code: a.employeeCode, actor_name: a.name, action: 'withdraw', reason });
  throwDb(stepResult.error);
  return { proposal: publicProposal(updateResult.data) };
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------
function publicProposal(row) {
  return {
    id: row.id,
    subjectEmployeeCode: row.subject_employee_code, subjectEmployeeName: row.subject_employee_name,
    createdBy: row.created_by, createdByName: row.created_by_name, createdAt: row.created_at,
    ladderId: row.compensation_ladder_id, versionId: row.compensation_version_id,
    currentGradeCode: row.current_grade_code, currentGradeNumber: row.current_grade_number,
    proposedGradeCode: row.proposed_grade_code, proposedGradeNumber: row.proposed_grade_number,
    reason: row.reason, status: row.status,
    selectedFirstApproverEmployeeCode: row.selected_first_approver_employee_code || '',
    routingSnapshot: row.routing_snapshot || [], currentStepIndex: row.current_step_index,
    finalDecidedGradeCode: row.final_decided_grade_code || '', finalDecidedGradeNumber: row.final_decided_grade_number || null,
    finalDecidedByName: row.final_decided_by_name || '', finalDecidedAt: row.final_decided_at || '',
    rejectedReason: row.rejected_reason || '', rejectedByName: row.rejected_by_name || '', rejectedAt: row.rejected_at || '',
    withdrawnReason: row.withdrawn_reason || '', withdrawnByName: row.withdrawn_by_name || '', withdrawnAt: row.withdrawn_at || '',
    updatedAt: row.updated_at
  };
}
function publicStep(row) {
  return {
    stepIndex: row.step_index, actorEmployeeCode: row.actor_employee_code || '', actorName: row.actor_name || '',
    action: row.action, suggestedGradeCode: row.suggested_grade_code || '', suggestedGradeNumber: row.suggested_grade_number || null,
    reason: row.reason || '', reassignedFromEmployeeCode: row.reassigned_from_employee_code || '', reassignedToEmployeeCode: row.reassigned_to_employee_code || '',
    actedAt: row.acted_at
  };
}

async function listMyGradePromotionProposals(session) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  const a = actor(session);
  const result = await db.from(PROPOSALS_TABLE).select('*').or('subject_employee_code.eq.' + a.employeeCode + (a.id ? ',created_by.eq.' + a.id : '')).order('created_at', { ascending: false }).limit(200);
  throwDb(result.error);
  return { proposals: (result.data || []).map(publicProposal) };
}

/* "Cần tôi xử lý" — chỉ áp dụng logic recompute cho các proposal đang pending,
 * số lượng nhỏ (công ty nhỏ) nên chấp nhận recompute chain theo từng dòng. */
async function listProposalsAwaitingMyAction(session) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  const a = actor(session);
  if (resolved.capabilities.agree_proposal !== true && resolved.capabilities.approve !== true && resolved.source !== 'admin_recovery') return { proposals: [] };

  const pendingResult = await db.from(PROPOSALS_TABLE).select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(500);
  throwDb(pendingResult.error);
  const pending = pendingResult.data || [];
  if (!pending.length) return { proposals: [] };

  const orgRows = await loadKnlOrganizationRows();
  const grantsByCode = await loadActiveGrantsByEmployeeCode();
  const mine = pending.filter(row => {
    let chain;
    try { chain = resolveApprovalChain({ orgRows, grantsByCode, subjectEmployeeCode: row.subject_employee_code, selectedFirstApproverEmployeeCode: row.selected_first_approver_employee_code }); }
    catch (_e) { return false; }
    const expected = chain[row.current_step_index];
    if (!expected) return false;
    if (expected.tier === 'final') return resolved.capabilities.approve === true || resolved.source === 'admin_recovery';
    return code(expected.employeeCode) === a.employeeCode;
  });
  return { proposals: mine.map(publicProposal) };
}

async function listVisibleGradePromotionProposals(session, filters = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  requireViewProposals(resolved);
  const a = actor(session);

  const statusFilter = text(filters.status).toLowerCase();
  let query = db.from(PROPOSALS_TABLE).select('*').order('created_at', { ascending: false }).limit(500);
  if (statusFilter && ['pending', 'approved', 'rejected', 'withdrawn'].includes(statusFilter)) query = query.eq('status', statusFilter);
  const result = await query;
  throwDb(result.error);

  if (resolved.source === 'admin_recovery') return { proposals: (result.data || []).map(publicProposal) };

  const orgRows = await loadKnlOrganizationRows();
  const orgByCode = new Map(orgRows.map(row => [code(row.employee_code), row]));
  const visible = (result.data || []).filter(row => {
    if (code(row.subject_employee_code) === a.employeeCode) return true;
    const subjectRow = orgByCode.get(code(row.subject_employee_code));
    if (!subjectRow) return false;
    return proposalScopeAllows(resolved, subjectRow);
  });
  return { proposals: visible.map(publicProposal) };
}

/* Detail: người liên quan trực tiếp (subject/creator/đang-đúng-lượt-xử-lý)
 * luôn xem được kể cả khi không nằm trong proposalScope chung (mục 11: "được
 * xem" của người liên quan trực tiếp workflow khác với "Proposal Visibility"
 * tổng quát — nếu không thì chính người phải xử lý lại không mở được hồ sơ,
 * workflow không chạy được). Ngoài nhóm liên quan trực tiếp, áp dụng đúng
 * proposalScope như listVisibleGradePromotionProposals(). */
async function getGradePromotionProposalDetail(session, input = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  const a = actor(session);
  const proposalId = text(input.proposalId || input.id);
  if (!proposalId) fail('Thiếu mã Đề xuất nâng bậc.', 400, 'KNL_PROPOSAL_ID_REQUIRED');

  const loadResult = await db.from(PROPOSALS_TABLE).select('*').eq('id', proposalId).maybeSingle();
  throwDb(loadResult.error);
  const proposal = loadResult.data;
  if (!proposal) fail('Không tìm thấy Đề xuất nâng bậc.', 404, 'KNL_PROPOSAL_NOT_FOUND');

  const orgRows = await loadKnlOrganizationRows();
  const grantsByCode = await loadActiveGrantsByEmployeeCode();
  let chain = [];
  let isMyTurn = false;
  try {
    chain = resolveApprovalChain({ orgRows, grantsByCode, subjectEmployeeCode: proposal.subject_employee_code, selectedFirstApproverEmployeeCode: proposal.selected_first_approver_employee_code });
    const expected = chain[proposal.current_step_index];
    if (expected) isMyTurn = expected.tier === 'final' ? (resolved.capabilities.approve === true || resolved.source === 'admin_recovery') : code(expected.employeeCode) === a.employeeCode;
  } catch (_e) { /* chain không resolve được (vd subject rời Organization Master) — vẫn cho xem chi tiết nếu có quyền khác bên dưới */ }

  const isDirectlyInvolved = resolved.source === 'admin_recovery' ||
    code(proposal.subject_employee_code) === a.employeeCode ||
    (a.id && proposal.created_by === a.id) ||
    isMyTurn;

  if (!isDirectlyInvolved) {
    requireViewProposals(resolved);
    const subjectRow = orgRows.find(row => code(row.employee_code) === code(proposal.subject_employee_code));
    if (!subjectRow || !proposalScopeAllows(resolved, subjectRow)) fail('Bạn không có quyền xem Đề xuất nâng bậc này.', 403, 'KNL_PROPOSAL_VIEW_DENIED');
  }

  const stepsResult = await db.from(STEPS_TABLE).select('*').eq('proposal_id', proposal.id).order('step_index', { ascending: true });
  throwDb(stepsResult.error);
  return { proposal: publicProposal(proposal), steps: (stepsResult.data || []).map(publicStep), liveChain: chain, isMyTurn };
}

// Danh sách bậc đề xuất được phép chọn khi tạo (bậc hiện tại + tối đa 4 bậc
// kế tiếp) — dùng cho UI tạo đề xuất, tách khỏi createGradePromotionProposal
// để frontend load option trước khi submit.
async function getGradeOptionsForSubject(session, input = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  requirePropose(resolved);
  const subjectEmployeeCode = code(input.employeeCode || input.subjectEmployeeCode);
  if (!subjectEmployeeCode) fail('Thiếu mã nhân viên.', 400, 'KNL_PROPOSAL_SUBJECT_REQUIRED');
  const currentGrade = await loadCurrentGrade(subjectEmployeeCode);
  if (!currentGrade.hasBaseline) return { hasBaseline: false, reason: currentGrade.reason, nextGrades: [] };
  const nextGrades = await listNextGrades(currentGrade.versionId, currentGrade.gradeNumber);
  return {
    hasBaseline: true,
    currentGradeCode: currentGrade.gradeCode, currentGradeNumber: currentGrade.gradeNumber,
    ladderCode: currentGrade.ladderCode, ladderName: currentGrade.ladderName,
    nextGrades
  };
}

module.exports = {
  createGradePromotionProposal,
  processGradePromotionProposalStep,
  withdrawGradePromotionProposal,
  listMyGradePromotionProposals,
  listProposalsAwaitingMyAction,
  listVisibleGradePromotionProposals,
  getGradePromotionProposalDetail,
  getGradeOptionsForSubject,
  // exported for tests only
  resolveApprovalChain, proposalScopeAllows, creationAuthorized, subjectIsApproverRole, loadCurrentGrade, listNextGrades
};
