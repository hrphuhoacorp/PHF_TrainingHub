'use strict';

/* PHF AI Sandbox - Checklist READ-ONLY adapter cho DeepSeek tool-calling.
   TUYET DOI khong ghi/sua/xoa gi. Khong tu query Supabase, khong tu dinh
   nghia lai cong thuc diem: goi LAI dung ham da duoc kiem chung cua
   Checklist (lib/checklist-reports.js#getChecklistCurrentScoreReport),
   chinh la nguon "Dashboard Diem Checklist - che do HIEN TAI" ma man Bao
   cao Checklist dang dung (cong thuc 100 - tong points cua violation
   record_status='official', is_test=false, trong ky; nguon nhan su tu
   checklist_employee_assignments qua getChecklistReportAccess - cung
   quyen voi man Bao cao, khong tao permission moi). Xem TRACE report cho
   boi canh day du. */

const { getChecklistCurrentScoreReport, getChecklistViolationWorkflowSummary, getChecklistMonthlyReport } = require('./checklist-reports');
const { listChecklistViolations } = require('./checklist-violations');

const MIN_LIMIT = 1;
const MAX_LIMIT = 10;
const MAX_FILTER_CHARS = 80;
const MAX_EMPLOYEE_CODE_CHARS = 32;
const MAX_ISSUES_RETURNED = 30;
const MAX_TOP_CRITERIA = 10;

function round2(value) { return Math.round((Number(value) || 0) * 100) / 100; }

function cleanFilter(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_FILTER_CHARS);
}

function cleanEmployeeCode(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_EMPLOYEE_CODE_CHARS).toUpperCase();
}

function clampLimit(value) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return MIN_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
}

// Ky hien tai (UTC) - chi tinh khoang ngay, KHONG dinh nghia lai cong thuc
// diem/policy nao. Dung de gioi han listChecklistViolations() dung dung
// "ky hien hanh" giong het getChecklistCurrentScoreReport().
function currentMonthBounds() {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1) - 86400000);
  const fmt = d => d.toISOString().slice(0, 10);
  return { monthLabel: `${y}-${String(m + 1).padStart(2, '0')}`, dateFrom: fmt(start), dateTo: fmt(end) };
}

/* Nhan vien co diem Checklist hien tai (ky hien hanh) thap nhat.
   getChecklistCurrentScoreReport() da tu phan biet "chua co diem" (nhan
   vien khong thuoc pham vi checklist_employee_assignments dang hoat dong
   -> khong xuat hien trong report.employees) voi "diem 0/diem cao" (nhan
   vien trong pham vi, diem la so thuc te 100-tong points, ke ca 100 khi
   chua co loi nao) - o day KHONG tu bia them logic null nao khac. Chi tra
   ve TOP `limit` nguoi diem thap nhat cho DeepSeek, khong tra ca bang
   (yeu cau privacy cua batch nay). */
async function getChecklistLowestEmployees(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const limit = clampLimit(input.limit);
  const department = cleanFilter(input.department);
  const branch = cleanFilter(input.branch);

  const report = await getChecklistCurrentScoreReport(session, { department, branch });
  const employees = Array.isArray(report.employees) ? report.employees : [];

  const sorted = employees.slice().sort((a, b) =>
    (a.currentScore - b.currentScore) ||
    String(a.employeeCode).localeCompare(String(b.employeeCode))
  );

  return {
    asOf: report.generatedAt || new Date().toISOString(),
    month: report.month || '',
    scope: report.scope && report.scope.role === 'admin' ? 'all_company' : 'scoped',
    employees: sorted.slice(0, limit).map(e => ({
      employeeCode: e.employeeCode,
      employeeName: e.employeeName,
      department: e.department,
      branch: e.branch,
      checklistScore: round2(e.currentScore)
    }))
  };
}

/* Lỗi đang làm giảm điểm Checklist của 1 nhân viên trong kỳ hiện tại.
   Dung LAI listChecklistViolations() (lib/checklist-violations.js) - cung
   ham va cung permission engine (resolveViolationPermission/
   requireViolationPermission/allowedCodes) voi man Nhat ky loi that su
   dang dung. workflowStatus:'official' + is_test=false la dung invariant
   score engine da dung (xem getChecklistCurrentScoreReport). Neu
   employeeCode ngoai pham vi quyen cua actor, ham goc tu tra rong (khong
   loi, khong leak) - o day khong can them logic chan nao khac.
   repeatSameDayCount la field co san tu chinh ham goc (khong tu tinh lai
   policy lap lai) - dung de tra loi "lap lai trong ngay" o muc do nhe. */
async function getChecklistEmployeeIssues(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const employeeCode = cleanEmployeeCode(input.employeeCode);
  const { monthLabel, dateFrom, dateTo } = currentMonthBounds();
  if (!employeeCode) {
    return { employeeCode: '', month: monthLabel, asOf: new Date().toISOString(), issueCount: 0, totalPointsDeducted: 0, issues: [] };
  }

  const result = await listChecklistViolations(session, {
    employeeCode, workflowStatus: 'official', dateFrom, dateTo, pageSize: 50, page: 1
  });
  const records = Array.isArray(result.records) ? result.records : [];

  const issues = records
    .map(row => ({
      criterionCode: String(row.criterion_code || ''),
      criterionName: String(row.criterion_name || ''),
      group: String(row.criterion_group || ''),
      points: round2(row.points),
      occurredDate: String(row.occurred_date || ''),
      repeatSameDayCount: Number(row.repeatSameDayCount || 1)
    }))
    .sort((a, b) => (b.points - a.points) || a.occurredDate.localeCompare(b.occurredDate))
    .slice(0, MAX_ISSUES_RETURNED);

  return {
    employeeCode,
    month: monthLabel,
    asOf: new Date().toISOString(),
    issueCount: issues.length,
    totalPointsDeducted: round2(issues.reduce((sum, item) => sum + item.points, 0)),
    issues
  };
}

/* Tong quan Checklist trong ky: KPI xu ly loi (reuse
   getChecklistViolationWorkflowSummary - dung nguon voi Dashboard/Bao cao)
   + top tieu chi lap nhieu nhat (group-by tu monthly.violations[] cua
   getChecklistMonthlyReport - da permission-scoped san, KHONG tu query
   Supabase, KHONG tu dinh nghia lai nguong "lap lai" cua chinh sach
   repeat-violation - chi dem so lan xuat hien thuc te trong ky). */
async function getChecklistViolationSummary(session) {
  const [workflow, monthly] = await Promise.all([
    getChecklistViolationWorkflowSummary(session, {}),
    getChecklistMonthlyReport(session, {})
  ]);

  if (!workflow.canView) {
    return { month: '', asOf: new Date().toISOString(), totals: null, topRepeatedCriteria: [] };
  }

  const violations = Array.isArray(monthly.violations) ? monthly.violations : [];
  const byCriterion = new Map();
  violations.forEach(v => {
    const key = v.criterionCode || v.criterionName || 'khac';
    const row = byCriterion.get(key) || { criterionCode: v.criterionCode || '', criterionName: v.criterionName || '', group: v.group || '', occurrenceCount: 0, totalPoints: 0 };
    row.occurrenceCount += 1;
    row.totalPoints += Number(v.points || 0);
    byCriterion.set(key, row);
  });
  const topRepeatedCriteria = [...byCriterion.values()]
    .map(row => ({ ...row, totalPoints: round2(row.totalPoints) }))
    .sort((a, b) => (b.occurrenceCount - a.occurrenceCount) || (b.totalPoints - a.totalPoints))
    .slice(0, MAX_TOP_CRITERIA);

  return {
    month: workflow.month || monthly.month || '',
    asOf: new Date().toISOString(),
    totals: workflow.summary || null,
    topRepeatedCriteria
  };
}

module.exports = { getChecklistLowestEmployees, getChecklistEmployeeIssues, getChecklistViolationSummary };
