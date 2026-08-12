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
  if (errCode === 'PGRST205' || errCode === '42P01' || /Could not find the table|relation .* does not exist|schema cache|function public\.knl_grade_promotion_(propose|transition)/i.test(message)) {
    fail('Schema Đề xuất nâng bậc chưa được cài đặt. Hãy chạy ' + MIGRATION + '.', 503, 'KNL_PROPOSAL_SCHEMA_MISSING');
  }
  if (errCode === '23505' || /PROPOSAL_ALREADY_ACTIVE|duplicate key.*knl_grade_promotion_proposal_active_uq/i.test(message)) fail('Nhân sự này đã có 1 Đề xuất nâng bậc đang xử lý (chỉ được tối đa 1 đề xuất active).', 409, 'KNL_PROPOSAL_ALREADY_ACTIVE');
  // RPC atomic transition: PROPOSAL_STATE_CHANGED = optimistic-concurrency guard
  // trong knl_grade_promotion_transition() đã kích hoạt (mục 1 batch 2.1) —
  // nghĩa là trạng thái/step đã đổi giữa lúc Node đọc để tính toán và lúc ghi
  // (người khác vừa xử lý xong, hoặc request trùng lặp) — toàn bộ transaction
  // đã rollback, KHÔNG có gì bị ghi đè. Dịch thành 409 rõ ràng cho actor thử lại.
  if (/PROPOSAL_STATE_CHANGED/i.test(message)) fail('Đề xuất này vừa được xử lý bởi người khác (hoặc trạng thái vừa thay đổi) — vui lòng tải lại và thử lại.', 409, 'KNL_PROPOSAL_STATE_CHANGED');
  if (/PROPOSAL_NOT_FOUND/i.test(message)) fail('Không tìm thấy Đề xuất nâng bậc.', 404, 'KNL_PROPOSAL_NOT_FOUND');
  throw error;
}
/* employeeCode PHẢI đọc từ session.account.employeeCode / session.employeeCode
 * (mã "PHF012") — KHÔNG session.employeeId (internal linked-employee id kiểu
 * "hv-xxxxxxxxxx" của module Training Hub, khác hoàn toàn hệ mã Organization
 * Master mà chain/permission dùng, xem lib/auth.js readSession()). Cùng đúng
 * pattern đã sửa ở lib/knl-competency.js:actor() (2026-08-11) và
 * lib/knl-foundation.js:actor() — trace 2026-08-12 xác nhận đây là bug tương
 * tự khiến approver không bao giờ khớp routing_snapshot (KNL_PROPOSAL_NOT_YOUR_TURN
 * sai, "Cần tôi xử lý" rỗng sai, auto-skip creator=approver không chạy). */
function actor(session) {
  return {
    id: text(session?.account?.id || session?.sub) || null,
    name: text(session?.account?.name || session?.account?.email || session?.email) || null,
    employeeCode: code(session?.employeeCode || session?.employee_code || session?.account?.employeeCode || session?.account?.employee_code),
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

/* Creation authority (mục 3 batch 1, đánh giá lại ở mục 4 batch 2.1): self
 * luôn được (nếu có propose), Admin luôn được, ngoài ra dùng people_scope
 * hiện có ("phạm vi phụ trách hợp lệ") — KHÔNG dùng proposalScope cho việc
 * này (proposalScope CHỈ cho visibility).
 *
 * ĐÁNH GIÁ SEMANTIC (mục 4 batch 2.1, evidence-based, giữ nguyên data model):
 * yêu cầu nghiệp vụ định nghĩa creation scope cho cấp quản lý là "nhân sự
 * thuộc phạm vi phụ trách hợp lệ" — CHỮ Y HỆT đã dùng để mô tả people_scope
 * ngay từ đầu (xem lib/knl-scope.js dòng đầu: "department: nhân sự cùng
 * phòng ban do Admin gán", "employees: danh sách nhân sự cụ thể do Admin gán
 * trực tiếp" — đây chính là định nghĩa "phạm vi phụ trách" của người quản lý,
 * không phải một khái niệm "visibility" tách biệt). Dữ liệu thật (batch 1
 * TRACE) cũng xác nhận: PHF004/010/032 dùng ĐÚNG 1 people_scope duy nhất cho
 * cả view_people và agree_proposal trên cùng 1 dòng grant — chưa có tiền lệ
 * nào trong hệ thống về việc 1 account cần "xem" rộng hơn "quản lý". Vì vậy
 * reuse people_scope cho creation/processing là ĐÚNG semantic với policy đã
 * chốt, không cần proposalCreateScope riêng.
 *
 * Giới hạn đã biết (KHÔNG phải bug, là giới hạn của model 1-scope/grant hiện
 * tại): nếu tương lai PHF cần 1 account "xem roster rộng hơn phạm vi được tạo
 * proposal" (vd người làm báo cáo toàn công ty nhưng chỉ được đề xuất cho
 * phòng mình), model hiện tại KHÔNG biểu diễn được (đổi people_scope sẽ đổi
 * cả 2 chiều cùng lúc) — khi đó mới cần proposalCreateScope tách biệt. Không
 * có bằng chứng nghiệp vụ nào yêu cầu điều này ở batch hiện tại nên KHÔNG tự
 * ý đổi data model (đúng chỉ đạo "KHÔNG tự thay đổi nếu chưa chứng minh cần"). */
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

/* subjectIsApproverRole — BATCH 2.1 HARDENING (mục 2): title KHÔNG còn được
 * dùng làm authorization fallback dưới bất kỳ hình thức nào, kể cả gián tiếp
 * để định hình chain. Title là presentation/org context (Organization
 * Master) — quyền xử lý CHỈ dựa trên identity + active permission grant
 * (capabilities.agree_proposal + people_scope), không có ngoại lệ, không
 * hard-code employee_code cụ thể nào. Nếu subject (kể cả một Trưởng ca theo
 * title) chưa có grant agree_proposal thật, họ được coi như KHÔNG có thẩm
 * quyền tự xử lý — hệ thống fail-closed thay vì suy đoán từ title. */
function subjectIsApproverRole(subjectRow, grantsByCode) {
  const grant = grantsByCode.get(code(subjectRow.employee_code));
  return Boolean(grant && grant.capabilities && grant.capabilities.agree_proposal === true);
}

// Có ít nhất 1 tài khoản đang active được cấp agree_proposal với scope
// sales_all_branches không? Dùng để phân biệt rõ 2 loại lỗi khi tạo proposal
// Sales: "bạn chưa chọn" (KNL_PROPOSAL_SALES_APPROVER_REQUIRED, người dùng tự
// sửa được) vs "hệ thống chưa cấu hình quyền nào cho vai trò này"
// (KNL_PROPOSAL_SALES_NOT_CONFIGURED, mục 2 batch 2.1 — "báo configuration
// missing phù hợp", cần Admin xử lý, không phải lỗi của actor).
function hasAnySalesApproverConfigured(grantsByCode) {
  for (const grant of grantsByCode.values()) {
    if (grant.capabilities && grant.capabilities.agree_proposal === true && grant.people_scope && grant.people_scope.type === 'sales_all_branches') return true;
  }
  return false;
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
    // Fail-closed rõ ràng (mục 2 batch 2.1): nếu KHÔNG có tài khoản nào đang
    // được cấp agree_proposal+sales_all_branches, đây là lỗi cấu hình hệ
    // thống — không phải lỗi actor quên chọn — báo đúng nguyên nhân, không
    // âm thầm mở quyền tạm cho bất kỳ ai (kể cả một Trưởng ca theo title).
    if (!hasAnySalesApproverConfigured(grantsByCode)) fail('Chưa có Trưởng ca Bán hàng nào được Admin cấp quyền xử lý Đề xuất nâng bậc (agree_proposal). Vui lòng liên hệ Admin cấu hình quyền trước khi tạo đề xuất.', 409, 'KNL_PROPOSAL_SALES_NOT_CONFIGURED');
    const selected = code(selectedFirstApproverEmployeeCode);
    if (!selected) fail('Vui lòng chọn một Trưởng ca Bán hàng hợp lệ để xử lý đề xuất.', 400, 'KNL_PROPOSAL_SALES_APPROVER_REQUIRED');
    if (selected === code(subject.employee_code)) fail('Không thể tự chọn chính mình xử lý đề xuất của bản thân (không tồn tại self-agree).', 400, 'KNL_PROPOSAL_SALES_APPROVER_SELF_NOT_ALLOWED');
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

  // step 0: propose. Sau đó, nếu creator chính là người đứng đầu 1+ tier
  // liên tiếp (mục 5 batch 2: "không bắt actor tự Agree lần nữa" — tổng quát
  // hoá cho mọi tầng, không riêng Sales), auto-advance kèm log 'agree' ngầm —
  // KHÔNG BAO GIỜ tự động đi qua tier cuối (Admin, tier:'final') — Admin luôn
  // phải approve() tường minh (mục 9: "Admin tạo proposal KHÔNG bypass").
  // BATCH 2.1: current_step_index đã tính TRƯỚC, gửi thẳng vào RPC atomic
  // knl_grade_promotion_propose() — không còn insert rồi update rời.
  const steps = [{
    step_index: 0, actor_id: a.id, actor_employee_code: a.employeeCode, actor_name: a.name,
    action: 'propose', suggested_grade_id: proposedGrade.id, suggested_grade_code: proposedGrade.grade_code, suggested_grade_number: proposedGrade.grade_number,
    reason
  }];
  let cursor = 0;
  while (cursor < chain.length - 1 && chain[cursor].employeeCode === a.employeeCode) {
    steps.push({
      step_index: steps.length, actor_id: a.id, actor_employee_code: a.employeeCode, actor_name: a.name,
      action: 'agree', suggested_grade_id: proposedGrade.id, suggested_grade_code: proposedGrade.grade_code, suggested_grade_number: proposedGrade.grade_number,
      reason: 'Tự động — hành động tạo Đề xuất đã thể hiện ý kiến của tầng này (không lặp lại Đồng ý).'
    });
    cursor++;
  }

  const proposalPayload = {
    subject_employee_code: subjectEmployeeCode,
    subject_employee_name: subjectRow.employee_name,
    created_by: a.id, created_by_name: a.name,
    compensation_ladder_id: currentGrade.ladderId,
    compensation_version_id: currentGrade.versionId,
    current_grade_id: currentGrade.gradeId, current_grade_code: currentGrade.gradeCode, current_grade_number: currentGrade.gradeNumber,
    proposed_grade_id: proposedGrade.id, proposed_grade_code: proposedGrade.grade_code, proposed_grade_number: proposedGrade.grade_number,
    reason,
    selected_first_approver_employee_code: selectedFirstApproverEmployeeCode || null,
    routing_snapshot: chain,
    current_step_index: cursor
  };

  const rpcResult = await db.rpc('knl_grade_promotion_propose', { p_proposal: proposalPayload, p_steps: steps });
  throwDb(rpcResult.error);
  return { proposal: publicProposal(rpcResult.data) };
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

  // BATCH 2.1: existingStepsCount dùng để đánh số step_index tuần tự cho
  // hiển thị — KHÔNG còn là cơ chế bảo vệ concurrency (đó là việc của
  // p_expected_status/p_expected_step_index trong RPC, xem dưới). Toàn bộ
  // patch + steps (kể cả reassign nếu có) được gom vào MỘT lệnh RPC atomic
  // duy nhất — không còn insert/update rời nhau (mục 1 batch 2.1).
  const existingStepsCountResult = await db.from(STEPS_TABLE).select('id', { count: 'exact', head: true }).eq('proposal_id', proposal.id);
  throwDb(existingStepsCountResult.error);
  let nextStepIndex = existingStepsCountResult.count || 0;
  const steps = [];

  // Broken-route detection (mục 7 batch 2): so với routing_snapshot lúc tạo
  // (hoặc lần re-resolve gần nhất) tại đúng vị trí idx — khác thì audit
  // 'reassign' cùng transaction với action agree/reject của người mới.
  const priorSnapshot = Array.isArray(proposal.routing_snapshot) ? proposal.routing_snapshot : [];
  const priorAtIdx = priorSnapshot[idx];
  if (!isFinalTier && priorAtIdx && code(priorAtIdx.employeeCode) !== code(expected.employeeCode)) {
    steps.push({
      step_index: nextStepIndex, action: 'reassign',
      reassigned_from_employee_code: code(priorAtIdx.employeeCode) || null, reassigned_to_employee_code: code(expected.employeeCode) || null,
      reason: 'Route lại tự động: người xử lý gốc không còn thẩm quyền/phạm vi phụ trách phù hợp tại thời điểm xử lý.'
    });
    nextStepIndex++;
  }

  const now = new Date().toISOString();

  if (action === 'reject') {
    const rejectReason = text(input.reason);
    if (rejectReason.length < 5) fail('Lý do không đồng ý cần tối thiểu 5 ký tự.', 400, 'KNL_PROPOSAL_REJECT_REASON_REQUIRED');
    steps.push({ step_index: nextStepIndex, actor_id: a.id, actor_employee_code: a.employeeCode, actor_name: a.name, action: 'reject', reason: rejectReason });
    const patch = { status: 'rejected', rejected_reason: rejectReason, rejected_by: a.id, rejected_by_name: a.name, rejected_at: now, routing_snapshot: freshChain };
    const rpcResult = await db.rpc('knl_grade_promotion_transition', { p_proposal_id: proposal.id, p_expected_status: 'pending', p_expected_step_index: idx, p_patch: patch, p_steps: steps });
    throwDb(rpcResult.error);
    return { proposal: publicProposal(rpcResult.data) };
  }

  // action === 'agree' (kể cả tier cuối — action lưu vào steps là 'approve' để timeline rõ ràng)
  const suggestedGradeId = text(input.suggestedGradeId || input.gradeId);
  if (!suggestedGradeId) fail('Vui lòng chọn bậc kiến nghị.', 400, 'KNL_PROPOSAL_SUGGESTED_GRADE_REQUIRED');
  const suggestedGrade = await loadGradeById(suggestedGradeId, proposal.compensation_version_id);
  if (!suggestedGrade) fail('Bậc kiến nghị không hợp lệ.', 400, 'KNL_PROPOSAL_SUGGESTED_GRADE_INVALID');
  if (!(suggestedGrade.grade_number > proposal.current_grade_number && suggestedGrade.grade_number <= proposal.proposed_grade_number)) {
    fail('Bậc kiến nghị phải cao hơn bậc hiện tại và không được vượt quá bậc đề xuất ban đầu.', 400, 'KNL_PROPOSAL_SUGGESTED_GRADE_OUT_OF_RANGE');
  }

  const stepAction = isFinalTier ? 'approve' : 'agree';
  steps.push({
    step_index: nextStepIndex, actor_id: a.id, actor_employee_code: a.employeeCode, actor_name: a.name,
    action: stepAction, suggested_grade_id: suggestedGrade.id, suggested_grade_code: suggestedGrade.grade_code, suggested_grade_number: suggestedGrade.grade_number,
    reason: text(input.note) || null
  });

  const patch = { current_step_index: idx + 1, routing_snapshot: freshChain };
  if (isFinalTier) {
    Object.assign(patch, {
      status: 'approved',
      final_decided_grade_id: suggestedGrade.id, final_decided_grade_code: suggestedGrade.grade_code, final_decided_grade_number: suggestedGrade.grade_number,
      final_decided_by: a.id, final_decided_by_name: a.name, final_decided_at: now
    });
  }
  const rpcResult = await db.rpc('knl_grade_promotion_transition', { p_proposal_id: proposal.id, p_expected_status: 'pending', p_expected_step_index: idx, p_patch: patch, p_steps: steps });
  throwDb(rpcResult.error);
  return { proposal: publicProposal(rpcResult.data) };
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
  const existingStepsCountResult = await db.from(STEPS_TABLE).select('id', { count: 'exact', head: true }).eq('proposal_id', proposal.id);
  throwDb(existingStepsCountResult.error);
  const steps = [{ step_index: existingStepsCountResult.count || 0, actor_id: a.id, actor_employee_code: a.employeeCode, actor_name: a.name, action: 'withdraw', reason }];
  const patch = { status: 'withdrawn', withdrawn_reason: reason, withdrawn_by: a.id, withdrawn_by_name: a.name, withdrawn_at: now };
  // p_expected_step_index=null: withdraw hợp lệ ở bất kỳ step_index nào miễn còn 'pending' (mục 13 batch 1).
  const rpcResult = await db.rpc('knl_grade_promotion_transition', { p_proposal_id: proposal.id, p_expected_status: 'pending', p_expected_step_index: null, p_patch: patch, p_steps: steps });
  throwDb(rpcResult.error);
  return { proposal: publicProposal(rpcResult.data) };
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

/* getGradePromotionApproverOptions — MỚI (2026-08-12, batch redesign "Tạo đề
 * xuất"), THUẦN READ, KHÔNG business rule mới. Trước đây field "Mã Trưởng ca
 * xử lý" là input tự do, chỉ validate ĐÚNG predicate này lúc submit (xem
 * resolveApprovalChain() nhánh Sales, dòng approverQualifies phía trên) — hàm
 * này CHỈ liệt kê trước, bằng ĐÚNG cùng 1 predicate
 * (capabilities.agree_proposal===true + subjectMatchesScope(subject,
 * grant.people_scope, ...)), để UI hiển thị picker thay vì bắt gõ tay. Payload
 * submit (selectedFirstApproverEmployeeCode) và validate lúc tạo proposal
 * KHÔNG đổi — hàm createGradePromotionProposal() vẫn tự re-validate độc lập,
 * hàm ở đây không phải nguồn duy nhất quyết định quyền, chỉ hỗ trợ UI. */
async function getGradePromotionApproverOptions(session, input = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  requirePropose(resolved);
  const subjectEmployeeCode = code(input.employeeCode || input.subjectEmployeeCode);
  if (!subjectEmployeeCode) fail('Thiếu mã nhân viên.', 400, 'KNL_PROPOSAL_SUBJECT_REQUIRED');

  const orgRows = await loadKnlOrganizationRows();
  const subjectRow = findOrgRow(orgRows, subjectEmployeeCode);
  if (!subjectRow) fail('Không tìm thấy nhân sự trong Organization Master.', 404, 'KNL_PROPOSAL_SUBJECT_NOT_FOUND');

  const grantsByCode = await loadActiveGrantsByEmployeeCode();
  const isSalesSubject = normalizeScopeText(subjectRow.department) === normalizeScopeText(SALES_ALL_BRANCHES_DEPARTMENT);
  if (!isSalesSubject || subjectIsApproverRole(subjectRow, grantsByCode)) {
    return { required: false, configured: true, approvers: [] };
  }
  if (!hasAnySalesApproverConfigured(grantsByCode)) {
    return { required: true, configured: false, approvers: [] };
  }

  const approvers = [];
  grantsByCode.forEach((grant, candidateCode) => {
    if (!grant.capabilities || grant.capabilities.agree_proposal !== true) return;
    if (candidateCode === code(subjectRow.employee_code)) return; // self-agree không được phép, đúng resolveApprovalChain
    const row = findOrgRow(orgRows, candidateCode);
    if (!row || row.employee_status === 'Đã nghỉ việc') return;
    if (!subjectMatchesScope(subjectRow, grant.people_scope, { employeeCode: candidateCode })) return;
    approvers.push({ employeeCode: candidateCode, employeeName: row.employee_name, title: row.title || '', department: row.department || '', branch: row.branch || '' });
  });
  return { required: true, configured: true, approvers };
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
  getGradePromotionApproverOptions,
  // exported for tests only
  resolveApprovalChain, proposalScopeAllows, creationAuthorized, subjectIsApproverRole, loadCurrentGrade, listNextGrades
};
