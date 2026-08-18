'use strict';

/*
 * KNL Employee Competency Assignment — service layer cho bảng
 * knl_employee_competency_assignments/knl_employee_competency_assignment_history
 * (xem scripts/PHF_KNL_EMPLOYEE_COMPETENCY_ASSIGNMENT_1.52.0.sql — migration
 * đã APPLY Production 2026-08-11, baseline 34 assignment PROVISIONAL đã sống
 * thật; xem scripts/phf-knl-employee-competency-assignment-postwrite-verify.js).
 *
 * Permission (đã chốt, không invent mới):
 * - Self xem KNL của chính mình: KHÔNG cần capability gì (mirror
 *   getKnlEmployeeIncome/getKnlEmployeeCompensationPeriods self-path).
 * - Xem người khác: dùng ĐÚNG view_people/peopleScope hiện hành của
 *   listKnlPeople (lib/knl-people.js) — KHÔNG dùng income_view/incomeScope,
 *   KHÔNG dùng propose/proposalScope, KHÔNG invent scope mới.
 * - Ghi (set/confirm): chỉ Admin (role==='admin'), giống hệt
 *   saveKnlEmployeeIncome/saveKnlCompensationGrades.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveActorGrant, requireAccessKnl } = require('./knl-permissions');
const { loadKnlOrganizationRows } = require('./knl-people');
const { subjectMatchesScope, normalizeScopeText } = require('./knl-scope');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const db = configured ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } }) : null;

function text(v) { return String(v == null ? '' : v).trim(); }
function fail(message, statusCode = 400, code = 'KNL_COMPETENCY_INVALID') { const e = new Error(message); e.statusCode = statusCode; e.code = code; throw e; }
function ensureDb() { if (!db) fail('Supabase chưa được cấu hình cho KNL.', 503, 'SUPABASE_NOT_CONFIGURED'); }
function throwDb(error) {
  if (!error) return;
  const code = text(error.code), message = text(error.message);
  if (code === 'PGRST205' || code === 'PGRST202' || code === '42P01' || code === '42883' || /Could not find the table|Could not find the function|relation .* does not exist|function .* does not exist/i.test(message)) {
    fail('Schema KNL Employee Competency Assignment chưa được cài đặt. Hãy chạy scripts/PHF_KNL_EMPLOYEE_COMPETENCY_ASSIGNMENT_1.52.0.sql (sau khi Technical Lead duyệt).', 503, 'KNL_COMPETENCY_SCHEMA_MISSING');
  }
  if (code === '23P01' || /knl_employee_competency_no_overlap/.test(message)) {
    fail('Khoảng hiệu lực bị chồng lấn với 1 giai đoạn khác của nhân sự này.', 409, 'KNL_COMPETENCY_OVERLAP');
  }
  if (/KNL_COMPETENCY_RETROACTIVE_BEYOND_CURRENT_PERIOD/.test(message)) {
    fail('Không thể chọn ngày hiệu lực trước ngày bắt đầu của giai đoạn đang áp dụng. Sửa 1 giai đoạn đã đóng là nghiệp vụ khác, chưa hỗ trợ.', 409, 'KNL_COMPETENCY_RETROACTIVE_BEYOND_CURRENT_PERIOD');
  }
  if (/KNL_COMPETENCY_REASON_REQUIRED:RETROACTIVE_CHANGE/.test(message)) {
    fail('Ngày hiệu lực ở quá khứ — bắt buộc nhập lý do hồi tố (tối thiểu 5 ký tự).', 400, 'KNL_COMPETENCY_RETROACTIVE_REASON_REQUIRED');
  }
  if (/KNL_COMPETENCY_REASON_REQUIRED:CONFIRM/.test(message)) {
    fail('Xác nhận Chính thức bắt buộc nhập lý do/căn cứ (tối thiểu 5 ký tự).', 400, 'KNL_COMPETENCY_CONFIRM_REASON_REQUIRED');
  }
  if (/KNL_COMPETENCY_GRADE_VERSION_MISMATCH/.test(message)) {
    fail('Bậc không thuộc đúng Framework Version đã chọn.', 400, 'KNL_COMPETENCY_GRADE_VERSION_MISMATCH');
  }
  throw error;
}
/* employeeCode PHẢI đọc từ session.account.employeeCode (mã "PHF012") —
 * KHÔNG đọc session.employeeId (đó là internal linked-employee id kiểu
 * "hv-xxxxxxxxxx", một field khác hoàn toàn, xem lib/auth.js readSession()).
 * Đọc nhầm employeeId từng khiến self-view luôn tra employee_code sai và trả
 * hasAssignment=false dù đã có assignment thật (2026-08-11, PHF012). Cùng
 * pattern đúng với lib/knl-foundation.js actor() (income self-view đã đúng). */
function actor(session) { return { id: text(session?.account?.id || session?.sub) || null, name: text(session?.account?.name || session?.account?.email || session?.email) || null, employeeCode: text(session?.employeeCode || session?.employee_code || session?.account?.employeeCode || session?.account?.employee_code).toUpperCase(), role: text(session?.role).toLowerCase() }; }
function requireAdmin(session) { if (actor(session).role !== 'admin') fail('Chỉ Admin được gán/xác nhận Bậc KNL.', 403, 'KNL_COMPETENCY_ADMIN_REQUIRED'); }

function publicAssignment(row) {
  if (!row) return null;
  return {
    id: row.id, employeeCode: row.employee_code, employeeName: row.employee_name,
    frameworkVersionId: row.framework_version_id, competencyGradeId: row.competency_grade_id,
    status: row.status, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, isActive: row.is_active === true,
    gradeSnapshot: row.grade_snapshot || {}, organizationSnapshot: row.organization_snapshot || {},
    note: row.note || '', reason: row.reason || '', updatedAt: row.updated_at,
    createdByName: row.created_by_name || '', updatedByName: row.updated_by_name || ''
  };
}

async function canViewOther(session, employeeCode) {
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  if (!resolved.capabilities.view_people) return false;
  const rows = await loadKnlOrganizationRows();
  const person = rows.find(r => text(r.employee_code).toUpperCase() === employeeCode);
  if (!person) return false;
  return subjectMatchesScope(person, resolved.peopleScope, resolved.identity);
}

/* Self luôn được xem của chính mình (không cần capability gì, mirror
 * getKnlEmployeeIncome) — người khác phải qua view_people/peopleScope hiện
 * hành, KHÔNG liên quan income_view/incomeScope/propose/proposalScope. */
async function getKnlEmployeeCompetencyAssignment(session, input = {}) {
  ensureDb();
  const a = actor(session), employeeCode = text(input.employeeCode || a.employeeCode).toUpperCase();
  if (!employeeCode) fail('Không xác định được mã nhân viên.', 409, 'KNL_EMPLOYEE_CODE_REQUIRED');
  if (employeeCode !== a.employeeCode && !(await canViewOther(session, employeeCode))) {
    fail('Không có quyền xem Bậc KNL của nhân sự này.', 403, 'KNL_COMPETENCY_VIEW_DENIED');
  }
  const { data, error } = await db.from('knl_employee_competency_assignments').select('*').eq('employee_code', employeeCode).eq('is_active', true).maybeSingle();
  throwDb(error);
  return { employeeCode, current: publicAssignment(data) };
}

/* Batch 1C — authoritative event source cho Section 5. knl_set_employee_
 * competency_assignment() (RPC duy nhất ghi bảng assignments, dùng bởi CẢ
 * baseline seed lẫn Admin thật — xem
 * scripts/PHF_KNL_EMPLOYEE_COMPETENCY_ASSIGNMENT_1.52.0.sql:139-258) LUÔN ghi
 * kèm đúng 1 row vào knl_employee_competency_assignment_history với action do
 * SERVER tự suy (CREATE/CONFIRM/SUPERSEDE/RETROACTIVE_CHANGE — KHÔNG tin
 * client), before_data/after_data đầy đủ. Bảng history này tồn tại từ
 * 1.52.0 nhưng CHƯA từng được đọc ở đâu (đã trace — chỉ RPC ghi, không có
 * service nào SELECT) — trước Batch 1C, frontend tự suy "Nâng bậc/Giảm bậc"
 * bằng cách so 2 phần tử liền kề trong mảng periods (snapshot diff không có
 * evidence là 1 action thật). Giờ join theo assignment_id để lấy action THẬT
 * + before_data.grade_snapshot THẬT — không suy đoán nữa. Cùng gate quyền như
 * trước (canViewOther/self), KHÔNG nới scope, chỉ thêm 1 query cho ĐÚNG
 * employee_code đã pass gate ở trên. */
async function listKnlEmployeeCompetencyHistory(session, input = {}) {
  ensureDb();
  const a = actor(session), employeeCode = text(input.employeeCode || a.employeeCode).toUpperCase();
  if (!employeeCode) fail('Không xác định được mã nhân viên.', 409, 'KNL_EMPLOYEE_CODE_REQUIRED');
  if (employeeCode !== a.employeeCode && !(await canViewOther(session, employeeCode))) {
    fail('Không có quyền xem lịch sử Bậc KNL của nhân sự này.', 403, 'KNL_COMPETENCY_VIEW_DENIED');
  }
  const [assignments, events] = await Promise.all([
    db.from('knl_employee_competency_assignments').select('*').eq('employee_code', employeeCode).order('effective_from', { ascending: false }).limit(100),
    db.from('knl_employee_competency_assignment_history').select('assignment_id,action,before_data').eq('employee_code', employeeCode).order('changed_at', { ascending: false }).limit(100)
  ]);
  throwDb(assignments.error); throwDb(events.error);
  const eventByAssignmentId = new Map((events.data || []).map(e => [e.assignment_id, e]));
  const periods = (assignments.data || []).map(row => {
    const pub = publicAssignment(row);
    const ev = eventByAssignmentId.get(row.id) || null;
    pub.action = ev ? ev.action : null;
    pub.beforeGradeSnapshot = ev && ev.before_data ? (ev.before_data.grade_snapshot || null) : null;
    return pub;
  });
  return { employeeCode, periods };
}

/* Self-view "KNL đang áp dụng": resolve HOÀN TOÀN từ assignment active của
 * chính nhân sự (employeeCode tự suy từ session hoặc same access-rule như
 * getKnlEmployeeCompetencyAssignment) — KHÔNG nhận frameworkVersionId/
 * competencyGradeId từ client, tránh đọc nội dung framework ngoài phạm vi
 * đang được gán. Next grade xác định bằng sort_order kế tiếp trong CÙNG
 * version (không giả định grade_number liên tục / không invent B6).
 */
async function buildCompetencyStandard(frameworkVersionId, gradeRow) {
  if (!gradeRow) return null;
  const { data: requirements, error: reqError } = await db.from('knl_grade_requirements')
    .select('item_id,required_column_id,required_level_number')
    .eq('version_id', frameworkVersionId).eq('grade_id', gradeRow.id);
  throwDb(reqError);
  const itemIds = (requirements || []).map(r => r.item_id);
  const [{ data: groups, error: groupError }, { data: items, error: itemError }, { data: columns, error: columnError }, levelContentsResult] = await Promise.all([
    db.from('knl_competency_groups').select('id,name,sort_order').eq('version_id', frameworkVersionId).order('sort_order'),
    db.from('knl_competency_items').select('id,group_id,name,sort_order').eq('version_id', frameworkVersionId).order('sort_order'),
    db.from('knl_structure_columns').select('id,label').eq('version_id', frameworkVersionId),
    itemIds.length ? db.from('knl_item_level_contents').select('item_id,column_id,content').eq('version_id', frameworkVersionId).in('item_id', itemIds) : Promise.resolve({ data: [], error: null })
  ]);
  [groupError, itemError, columnError, levelContentsResult.error].forEach(err => throwDb(err));

  const reqByItem = new Map((requirements || []).map(r => [r.item_id, r]));
  const columnById = new Map((columns || []).map(c => [c.id, c]));
  const contentByItemColumn = new Map((levelContentsResult.data || []).map(c => [c.item_id + '|' + c.column_id, c.content || '']));

  const groupsOut = (groups || []).map(g => ({
    id: g.id, name: g.name, sortOrder: g.sort_order,
    items: (items || []).filter(it => it.group_id === g.id).map(it => {
      const req = reqByItem.get(it.id);
      if (!req) return null;
      const column = columnById.get(req.required_column_id);
      return {
        id: it.id, name: it.name, sortOrder: it.sort_order,
        requiredLevelNumber: req.required_level_number,
        requiredColumnLabel: column ? column.label : '',
        content: contentByItemColumn.get(it.id + '|' + req.required_column_id) || ''
      };
    }).filter(Boolean)
  })).filter(g => g.items.length);

  return { gradeCode: gradeRow.grade_code, gradeNumber: gradeRow.grade_number, label: gradeRow.label, groups: groupsOut };
}

async function getKnlEmployeeCompetencyStandard(session, input = {}) {
  ensureDb();
  const a = actor(session), employeeCode = text(input.employeeCode || a.employeeCode).toUpperCase();
  if (!employeeCode) fail('Không xác định được mã nhân viên.', 409, 'KNL_EMPLOYEE_CODE_REQUIRED');
  if (employeeCode !== a.employeeCode && !(await canViewOther(session, employeeCode))) {
    fail('Không có quyền xem tiêu chuẩn Bậc KNL của nhân sự này.', 403, 'KNL_COMPETENCY_VIEW_DENIED');
  }
  const { data: row, error } = await db.from('knl_employee_competency_assignments').select('*').eq('employee_code', employeeCode).eq('is_active', true).maybeSingle();
  throwDb(error);
  if (!row) {
    return { employeeCode, hasAssignment: false, assignment: null, framework: null, currentGrade: null, currentStandard: null, nextGrade: null, nextStandard: null, isMaxGrade: false };
  }
  const assignment = publicAssignment(row);

  const [{ data: fv, error: fvError }, { data: grades, error: gradeError }] = await Promise.all([
    db.from('knl_framework_versions').select('id,framework_id,version_number').eq('id', row.framework_version_id).single(),
    db.from('knl_grade_definitions').select('id,grade_code,grade_number,sort_order,label').eq('version_id', row.framework_version_id).order('sort_order')
  ]);
  throwDb(fvError); throwDb(gradeError);
  const { data: fw, error: fwError } = await db.from('knl_frameworks').select('code,name').eq('id', fv.framework_id).single();
  throwDb(fwError);

  const sortedGrades = (grades || []).slice().sort((x, y) => Number(x.sort_order) - Number(y.sort_order));
  const currentGradeRow = sortedGrades.find(g => g.id === row.competency_grade_id);
  if (!currentGradeRow) fail('Bậc KNL đang gán không còn tồn tại trong framework version.', 409, 'KNL_COMPETENCY_GRADE_MISSING');
  const nextGradeRow = sortedGrades.find(g => Number(g.sort_order) > Number(currentGradeRow.sort_order));
  const isMaxGrade = !nextGradeRow;
  /* Toàn bộ chuỗi bậc thật của version (kể cả bậc TRƯỚC current) — chỉ
   * code/number/label (rẻ, đã có sẵn sortedGrades trong bộ nhớ), KHÔNG build
   * full standard cho từng bậc ở đây để tránh query thừa. Frontend cần danh
   * sách đầy đủ để điều hướng 2 chiều (xem bậc thấp hơn lẫn cao hơn current);
   * standard chi tiết của từng bậc lấy qua getKnlEmployeeCompetencyGradeStandard
   * khi thật sự cần (lazy), vẫn tự resolve version từ assignment như cũ. */
  const allGrades = sortedGrades.map(g => ({ code: g.grade_code, number: g.grade_number, label: g.label }));

  const [currentStandard, nextStandard] = await Promise.all([
    buildCompetencyStandard(row.framework_version_id, currentGradeRow),
    buildCompetencyStandard(row.framework_version_id, nextGradeRow)
  ]);

  return {
    employeeCode, hasAssignment: true, assignment,
    framework: { code: fw.code, name: fw.name, versionNumber: fv.version_number },
    currentGrade: { code: currentGradeRow.grade_code, number: currentGradeRow.grade_number, label: currentGradeRow.label },
    currentStandard,
    nextGrade: nextGradeRow ? { code: nextGradeRow.grade_code, number: nextGradeRow.grade_number, label: nextGradeRow.label } : null,
    nextStandard,
    isMaxGrade,
    allGrades
  };
}

/* Bậc bổ sung ("+ Xem thêm Bx") — employeeCode resolve self/view_people
 * GIỐNG HỆT getKnlEmployeeCompetencyStandard; framework_version_id LUÔN tự
 * suy từ assignment active của chính nhân sự đó (KHÔNG bao giờ tin
 * frameworkVersionId từ client) — gradeCode chỉ được chấp nhận nếu thuộc
 * đúng version đó, nên không thể dùng để đọc nội dung framework khác ngoài
 * phạm vi đang được gán. */
async function getKnlEmployeeCompetencyGradeStandard(session, input = {}) {
  ensureDb();
  const a = actor(session), employeeCode = text(input.employeeCode || a.employeeCode).toUpperCase();
  if (!employeeCode) fail('Không xác định được mã nhân viên.', 409, 'KNL_EMPLOYEE_CODE_REQUIRED');
  if (employeeCode !== a.employeeCode && !(await canViewOther(session, employeeCode))) {
    fail('Không có quyền xem tiêu chuẩn Bậc KNL của nhân sự này.', 403, 'KNL_COMPETENCY_VIEW_DENIED');
  }
  const gradeCode = text(input.gradeCode).toUpperCase();
  if (!gradeCode) fail('Mã bậc là bắt buộc.', 400, 'KNL_COMPETENCY_GRADE_CODE_REQUIRED');
  const { data: row, error } = await db.from('knl_employee_competency_assignments').select('framework_version_id').eq('employee_code', employeeCode).eq('is_active', true).maybeSingle();
  throwDb(error);
  if (!row) fail('Nhân sự chưa có Khung năng lực đang áp dụng.', 409, 'KNL_COMPETENCY_NO_ASSIGNMENT');
  const { data: gradeRow, error: gradeError } = await db.from('knl_grade_definitions').select('id,grade_code,grade_number,sort_order,label').eq('version_id', row.framework_version_id).eq('grade_code', gradeCode).maybeSingle();
  throwDb(gradeError);
  if (!gradeRow) fail('Bậc yêu cầu không thuộc đúng Khung năng lực đang áp dụng của nhân sự này.', 404, 'KNL_COMPETENCY_GRADE_NOT_FOUND');
  const standard = await buildCompetencyStandard(row.framework_version_id, gradeRow);
  return { employeeCode, grade: { code: gradeRow.grade_code, number: gradeRow.grade_number, label: gradeRow.label }, standard };
}

/* Admin-only. Một lời gọi duy nhất cho mọi tình huống (CREATE baseline,
 * SUPERSEDE đổi bậc/framework, CONFIRM PROVISIONAL->CONFIRMED, hồi tố) — RPC
 * tự suy action, không tin action truyền từ client (xem file .sql). */
async function setKnlEmployeeCompetencyAssignment(session, input = {}) {
  ensureDb(); requireAdmin(session);
  const code = text(input.employeeCode).toUpperCase();
  if (!code) fail('Mã nhân viên là bắt buộc.');
  const rows = await loadKnlOrganizationRows();
  const person = rows.find(r => text(r.employee_code).toUpperCase() === code);
  if (!person) fail('Nhân sự không có trong organization hiện hành.', 404, 'KNL_EMPLOYEE_NOT_FOUND');
  const a = actor(session);
  const { data, error } = await db.rpc('knl_set_employee_competency_assignment', {
    p_employee_code: code,
    p_employee_name: text(person.employee_name),
    p_framework_version_id: text(input.frameworkVersionId),
    p_competency_grade_id: text(input.competencyGradeId),
    p_status: text(input.status || 'PROVISIONAL').toUpperCase(),
    p_effective_from: text(input.effectiveFrom) || new Date().toISOString().slice(0, 10),
    p_note: text(input.note),
    p_organization_snapshot: { employeeCode: code, employeeName: text(person.employee_name), department: text(person.department), branch: text(person.branch), title: text(person.title) },
    p_reason: text(input.reason),
    p_actor_id: a.id, p_actor_name: a.name
  });
  throwDb(error);
  return { assignment: data };
}

/* PHF AI V2 Batch 1 (2026-08-18) — aggregate read cho câu hỏi kiểu "có ai
 * đang ở trạng thái Bậc năng lực tạm thời không". KHÔNG tạo permission engine
 * mới: gate ĐÚNG HỆT listKnlPeople() (lib/knl-people.js) — requireAccessKnl +
 * view_people + subjectMatchesScope(peopleScope) trên TOÀN BỘ organization
 * rows trước, rồi mới truy vấn assignments giới hạn trong đúng tập
 * employee_code đã qua scope (KHÔNG bao giờ query rồi lọc sau — nếu danh
 * sách trong phạm vi rỗng, KHÔNG query bảng assignment). */
const SCOPE_LIST_LIMIT = 500;
async function listKnlEmployeeCompetencyAssignmentsInScope(session, filters = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireAccessKnl(resolved);
  if (!resolved.capabilities.view_people) fail('Tài khoản chưa được cấp quyền xem Nhân sự KNL.', 403, 'KNL_VIEW_PEOPLE_DENIED');

  const rows = await loadKnlOrganizationRows();
  const inScope = rows.filter(r => subjectMatchesScope(r, resolved.peopleScope, resolved.identity));
  const codes = [...new Set(inScope.map(r => text(r.employee_code).toUpperCase()).filter(Boolean))];
  if (!codes.length) return { assignments: [] };

  const status = text(filters.status).toUpperCase();
  let query = db.from('knl_employee_competency_assignments').select('*').eq('is_active', true).in('employee_code', codes);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.limit(SCOPE_LIST_LIMIT);
  throwDb(error);

  const byCode = new Map(inScope.map(r => [text(r.employee_code).toUpperCase(), r]));
  return {
    assignments: (data || []).map(row => {
      const pub = publicAssignment(row);
      const person = byCode.get(text(row.employee_code).toUpperCase());
      pub.department = person ? text(person.department) : '';
      pub.branch = person ? text(person.branch) : '';
      pub.title = person ? text(person.title) : '';
      return pub;
    })
  };
}

module.exports = { getKnlEmployeeCompetencyAssignment, listKnlEmployeeCompetencyHistory, getKnlEmployeeCompetencyStandard, getKnlEmployeeCompetencyGradeStandard, setKnlEmployeeCompetencyAssignment, listKnlEmployeeCompetencyAssignmentsInScope };
