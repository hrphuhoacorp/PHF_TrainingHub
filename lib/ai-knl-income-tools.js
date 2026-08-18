'use strict';

/* PHF AI V2 Batch 1 (2026-08-18) — Income + Competency-status READ-ONLY
   adapter cho DeepSeek tool-calling. KHONG tao permission engine moi, KHONG
   tu query Supabase truc tiep tu file nay - moi ham chi la lop mong goi LAI
   dung service KNL da co san va tu resolve quyen qua CHINH cac ham do:

   - get_employee_income: doc lai lib/knl-foundation.js#getKnlEmployeeIncome
     - tu xem cua chinh minh luon duoc, xem nguoi khac PHAI qua
     incomeScopeAllows() (lib/knl-permissions.js) - permission nay chay BEN
     TRONG getKnlEmployeeIncome TRUOC KHI ham tra du lieu, khong phai check
     rieng o adapter nay roi moi goi ham - neu khong du quyen, ham goc throw
     403 KNL_INCOME_VIEW_DENIED truoc khi bat ky field thu nhap nao duoc tao
     ra, nen KHONG co du lieu nhay cam nao lot vao model context truoc khi
     permission duoc xac nhan.
   - get_employee_competency_status: doc lai lib/knl-competency.js#
     getKnlEmployeeCompetencyAssignment - GIONG HET quyen UI Nhan su KNL/
     Gan bac nang luc dang doi hoi hom nay (self luon duoc, xem nguoi khac
     qua view_people/peopleScope, KHONG lien quan income_view/incomeScope).
     Day la "Bac KNL" (competency_grade_id, thang B1..Bn rieng cua KNL,
     PROVISIONAL/CONFIRMED) - KHAC "Bac nhan su/luong" (compensation_grade_id
     tra ve tu get_employee_income) - 2 nguon KHAC NHAU, khong duoc dong
     nhat, xem SYSTEM_PROMPT#BAC KHONG PHAI MOT NGUON DUY NHAT o
     lib/ai-sandbox.js.
   - list_provisional_competency_status: doc lai lib/knl-competency.js#
     listKnlEmployeeCompetencyAssignmentsInScope - gate GIONG HET
     listKnlPeople() (requireAccessKnl + view_people + peopleScope) truoc
     khi truy van bang assignment, khong bao gio tra nhan su ngoai scope. */

const { getKnlEmployeeIncome } = require('./knl-foundation');
const { getKnlEmployeeCompetencyAssignment, listKnlEmployeeCompetencyAssignmentsInScope } = require('./knl-competency');
const { loadKnlOrganizationRows } = require('./knl-people');

const MAX_EMPLOYEE_CODE_CHARS = 32;
const MAX_PROVISIONAL_ITEMS = 20;

function text(value) { return String(value == null ? '' : value).trim(); }
function cleanEmployeeCode(value) { return text(value).slice(0, MAX_EMPLOYEE_CODE_CHARS).toUpperCase(); }

const STATUS_LABEL_VI = { PROVISIONAL: 'Tạm thời', CONFIRMED: 'Đã xác nhận' };
function statusLabelVi(status) { return STATUS_LABEL_VI[text(status).toUpperCase()] || ''; }

async function selfEmployeeCodeFromOrg(session) {
  // Cung pattern selfEmployeeCode() da dung o lib/ai-knl-framework-tools.js -
  // KHONG doc session.employeeId (internal id), CHI doc employeeCode chuan.
  const code = text(session?.employeeCode || session?.employee_code || session?.account?.employeeCode || session?.account?.employee_code).toUpperCase();
  return code;
}

async function employeeExists(employeeCode) {
  const rows = await loadKnlOrganizationRows();
  return rows.some(r => text(r.employee_code).toUpperCase() === employeeCode);
}

/* get_employee_income - thu nhap hien tai + Bac luong (compensation grade)
   cua 1 nhan vien (mac dinh chinh nguoi hoi). KHONG hard-code ten nhan vien
   nao - employeeCode luon tu tham so hoac tu session. */
async function getEmployeeIncomeForAi(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const asOf = new Date().toISOString();
  let employeeCode = cleanEmployeeCode(input.employeeCode);
  if (!employeeCode) employeeCode = await selfEmployeeCodeFromOrg(session);
  if (!employeeCode) return { available: false, asOf, employeeCode: '', reason: 'employee_code_required' };

  const exists = await employeeExists(employeeCode);
  if (!exists) return { available: false, asOf, employeeCode, reason: 'employee_not_found' };

  // KHONG bat loi permission o day - de getKnlEmployeeIncome tu throw (403
  // KNL_INCOME_VIEW_DENIED) NEU khong du quyen, TRUOC KHI tra bat ky field
  // thu nhap nao. executeToolCall() (lib/ai-tool-registry.js) se bat loi nay
  // va tra {error:'TOOL_UNAVAILABLE'} chung, KHONG lo ly do/du lieu that.
  const result = await getKnlEmployeeIncome(session, { employeeCode });
  const current = result.current;
  if (!current) return { available: true, asOf, employeeCode, hasCurrentIncome: false, current: null, reason: 'no_active_income_record' };

  return {
    available: true,
    asOf,
    employeeCode,
    hasCurrentIncome: true,
    current: {
      payrollPeriod: current.payrollPeriod,
      employmentType: current.employmentType,
      compensationGradeCode: current.gradeCode || '',
      compensationGradeNumber: current.gradeNumber || 0,
      ladderName: current.ladderName || '',
      baseSalary: current.baseSalary,
      hqcv: current.hqcv,
      hasProfessionalAllowance: current.isProfessionalAllowance === true,
      professionalAllowance: current.professionalAllowance,
      hasManagementAllowance: current.isManagementAllowance === true,
      managementAllowance: current.managementAllowance,
      hasMealAllowance: current.isMealAllowance === true,
      mealAllowance: current.mealAllowance,
      probationAmount: current.probationAmount,
      extraAllowances: Array.isArray(current.extraAllowances) ? current.extraAllowances : [],
      totalReferenceIncome: current.totalReferenceIncome,
      updatedAt: current.updatedAt
    }
  };
}

/* get_employee_competency_status - Bac KNL (competency grade, DOC LAP voi
   Bac luong o tren) + trang thai Tam thoi/Da xac nhan cua 1 nhan vien. */
async function getEmployeeCompetencyStatusForAi(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const asOf = new Date().toISOString();
  let employeeCode = cleanEmployeeCode(input.employeeCode);
  if (!employeeCode) employeeCode = await selfEmployeeCodeFromOrg(session);
  if (!employeeCode) return { available: false, asOf, employeeCode: '', reason: 'employee_code_required' };

  const exists = await employeeExists(employeeCode);
  if (!exists) return { available: false, asOf, employeeCode, reason: 'employee_not_found' };

  // Cung nguyen tac voi getEmployeeIncomeForAi - KHONG bat loi permission o
  // day, de getKnlEmployeeCompetencyAssignment tu throw (403
  // KNL_COMPETENCY_VIEW_DENIED) neu khong du view_people/peopleScope.
  const result = await getKnlEmployeeCompetencyAssignment(session, { employeeCode });
  const current = result.current;
  if (!current) return { available: true, asOf, employeeCode, hasAssignment: false, current: null, reason: 'no_active_assignment' };

  return {
    available: true,
    asOf,
    employeeCode,
    hasAssignment: true,
    current: {
      status: current.status,
      statusLabel: statusLabelVi(current.status),
      isSelfReportedOrProvisional: text(current.status).toUpperCase() === 'PROVISIONAL',
      effectiveFrom: current.effectiveFrom,
      gradeSnapshot: current.gradeSnapshot || {},
      frameworkVersionId: current.frameworkVersionId
    }
  };
}

/* list_provisional_competency_status - danh sach nhan su dang o trang thai
   Bac nang luc TAM THOI (PROVISIONAL), CHI trong dung pham vi peopleScope
   cua actor dang hoi (lib/knl-competency.js#listKnlEmployeeCompetencyAssignmentsInScope
   da loc scope TRUOC khi query bang assignment). */
async function listProvisionalCompetencyForAi(session) {
  const asOf = new Date().toISOString();
  const result = await listKnlEmployeeCompetencyAssignmentsInScope(session, { status: 'PROVISIONAL' });
  const items = Array.isArray(result.assignments) ? result.assignments : [];
  return {
    asOf,
    total: items.length,
    truncated: items.length >= MAX_PROVISIONAL_ITEMS,
    items: items.slice(0, MAX_PROVISIONAL_ITEMS).map(a => ({
      employeeCode: a.employeeCode,
      employeeName: a.employeeName || '',
      department: a.department || '',
      branch: a.branch || '',
      title: a.title || '',
      statusLabel: statusLabelVi(a.status),
      effectiveFrom: a.effectiveFrom,
      gradeSnapshot: a.gradeSnapshot || {}
    }))
  };
}

module.exports = { getEmployeeIncomeForAi, getEmployeeCompetencyStatusForAi, listProvisionalCompetencyForAi };
