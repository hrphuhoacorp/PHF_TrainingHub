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

const { getChecklistCurrentScoreReport } = require('./checklist-reports');

const MIN_LIMIT = 1;
const MAX_LIMIT = 10;
const MAX_FILTER_CHARS = 80;

function round2(value) { return Math.round((Number(value) || 0) * 100) / 100; }

function cleanFilter(value) {
  return String(value == null ? '' : value).trim().slice(0, MAX_FILTER_CHARS);
}

function clampLimit(value) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return MIN_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, parsed));
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

module.exports = { getChecklistLowestEmployees };
