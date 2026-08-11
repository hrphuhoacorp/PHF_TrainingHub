'use strict';

/*
 * KNL Employee Competency Assignment — service layer cho bảng
 * knl_employee_competency_assignments/knl_employee_competency_assignment_history
 * (xem scripts/PHF_KNL_EMPLOYEE_COMPETENCY_ASSIGNMENT_1.52.0.sql —
 * CHƯA APPLY Production, file này viết trước để sẵn sàng khi migration được
 * duyệt; gọi RPC sẽ fail với KNL_COMPETENCY_SCHEMA_MISSING cho tới lúc đó).
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
function actor(session) { return { id: text(session?.account?.id || session?.sub) || null, name: text(session?.account?.name || session?.account?.email || session?.email) || null, employeeCode: text(session?.employeeId || session?.employeeCode || session?.account?.employeeCode).toUpperCase(), role: text(session?.role).toLowerCase() }; }
function requireAdmin(session) { if (actor(session).role !== 'admin') fail('Chỉ Admin được gán/xác nhận Bậc KNL.', 403, 'KNL_COMPETENCY_ADMIN_REQUIRED'); }

function publicAssignment(row) {
  if (!row) return null;
  return {
    id: row.id, employeeCode: row.employee_code, employeeName: row.employee_name,
    frameworkVersionId: row.framework_version_id, competencyGradeId: row.competency_grade_id,
    status: row.status, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, isActive: row.is_active === true,
    gradeSnapshot: row.grade_snapshot || {}, organizationSnapshot: row.organization_snapshot || {},
    note: row.note || '', reason: row.reason || '', updatedAt: row.updated_at
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

async function listKnlEmployeeCompetencyHistory(session, input = {}) {
  ensureDb();
  const a = actor(session), employeeCode = text(input.employeeCode || a.employeeCode).toUpperCase();
  if (!employeeCode) fail('Không xác định được mã nhân viên.', 409, 'KNL_EMPLOYEE_CODE_REQUIRED');
  if (employeeCode !== a.employeeCode && !(await canViewOther(session, employeeCode))) {
    fail('Không có quyền xem lịch sử Bậc KNL của nhân sự này.', 403, 'KNL_COMPETENCY_VIEW_DENIED');
  }
  const { data, error } = await db.from('knl_employee_competency_assignments').select('*').eq('employee_code', employeeCode).order('effective_from', { ascending: false }).limit(100);
  throwDb(error);
  return { employeeCode, periods: (data || []).map(publicAssignment) };
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

module.exports = { getKnlEmployeeCompetencyAssignment, listKnlEmployeeCompetencyHistory, setKnlEmployeeCompetencyAssignment };
