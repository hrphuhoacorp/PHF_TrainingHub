'use strict';

/*
 * Dashboard KNL — Gate 2 (nối dữ liệu thật, CHƯA nối AI DeepSeek).
 *
 * MỘT aggregate endpoint duy nhất (đúng mục Q "Performance" của yêu cầu):
 * không N+1 theo từng nhân sự, không tải lịch sử vô hạn. Mọi query là bulk
 * (select nhiều dòng 1 lần), gộp trong bộ nhớ Node.
 *
 * Permission (đã chốt với PHF ở Gate 2 kickoff — KHÔNG tự suy):
 * - dashboard_view (lib/knl-permissions.js) là gate DUY NHẤT quyết định có
 *   được vào Dashboard hay không. Admin có mặc định qua admin_recovery.
 *   Giám đốc/Trợ lý Tiên được PHF cấp thủ công qua màn Phân quyền KNL hiện
 *   có — KHÔNG suy diễn từ preset/tên/employee_code.
 * - dashboard_view KHÔNG quyết định phạm vi dữ liệu. Phạm vi dữ liệu vẫn là
 *   2 trục ĐỘC LẬP đã có sẵn:
 *     - people_scope (subjectMatchesScope, lib/knl-scope.js): chi phối nhân
 *       sự/KNL hiển thị (không phải thu nhập).
 *     - incomeScope (incomeScopeAllows, lib/knl-permissions.js): chi phối
 *       MỌI số liệu có chứa thu nhập (quỹ, bình quân, biến động, tỷ trọng,
 *       bảng so sánh, thu nhập theo bậc, xu hướng, drill-down thu nhập).
 *       KHÔNG suy incomeScope từ people_scope (mục C của yêu cầu Gate 2).
 * - income_view=false (hoặc admin bị recall income_view) => mọi field thu
 *   nhập trả về null, KHÔNG trả salary aggregation (mục T.8).
 *
 * KNL "M3+" / normalize M1-M5: KHÔNG có canonical rank xuyên framework (đã
 * trace — mỗi framework 4 hoặc 5 mức, B-code chỉ có nghĩa trong 1 version).
 * PHF đã chốt STOP KPI này ở Gate 2: kpis.m3plus luôn null, "Phân bố bậc
 * KNL"/"Thu nhập theo bậc KNL" group theo (frameworkCode, gradeCode) THẬT,
 * không ép về M1-M5.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { resolveActorGrant, requireDashboardView, incomeScopeAllows } = require('./knl-permissions');
const { loadKnlOrganizationRows } = require('./knl-people');
const { subjectMatchesScope, normalizeScopeText } = require('./knl-scope');

const configured = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const db = configured ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const UNASSIGNED_DEPARTMENT = 'Chưa xác định';
const TREND_MAX_PERIODS = 12;

function text(v) { return String(v == null ? '' : v).trim(); }
function fail(message, statusCode = 400, code = 'KNL_DASHBOARD_INVALID') { const e = new Error(message); e.statusCode = statusCode; e.code = code; throw e; }
function ensureDb() { if (!db) fail('Supabase chưa được cấu hình cho KNL.', 503, 'SUPABASE_NOT_CONFIGURED'); }
function throwDb(error) {
  if (!error) return;
  const code = text(error.code), message = text(error.message);
  if (code === 'PGRST205' || code === '42P01' || /relation .* does not exist|Could not find the table/i.test(message)) {
    fail('Schema KNL Foundation/Competency chưa được cài đặt đầy đủ.', 503, 'KNL_SCHEMA_MISSING');
  }
  throw error;
}
function round0(n) { return Math.round(Number(n) || 0); }
function deptOf(row) { return text(row && row.department) || UNASSIGNED_DEPARTMENT; }

function deltaOf(current, previous) {
  if (current == null || previous == null) return { deltaAmount: null, deltaPct: null };
  const deltaAmount = round0(current - previous);
  const deltaPct = previous > 0 ? Math.round((deltaAmount / previous) * 1000) / 10 : null;
  return { deltaAmount, deltaPct };
}

async function getKnlDashboardOverview(session, filters = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireDashboardView(resolved);

  const isAdmin = resolved.source === 'admin_recovery';
  const incomeVisible = resolved.capabilities.income_view === true;
  const incomeScope = incomeVisible ? (resolved.row && resolved.row.capabilities && (resolved.row.capabilities.incomeScope || resolved.row.capabilities.income_scope)) : null;
  const isFullCompanyIncome = isAdmin || (incomeScope && incomeScope.type === 'all_company');

  // 1) Org master trong phạm vi people_scope (không phải thu nhập) — active only.
  const orgRows = await loadKnlOrganizationRows();
  const activeRows = orgRows.filter(row => text(row.employee_status) !== 'Đã nghỉ việc');
  const peopleInScope = activeRows.filter(row => subjectMatchesScope(row, resolved.peopleScope, resolved.identity));
  const byEmployeeCode = new Map(peopleInScope.map(row => [text(row.employee_code).toUpperCase(), row]));
  const filterOptions = {
    departments: [...new Set(peopleInScope.map(row => deptOf(row)))].sort(),
    branches: [...new Set(peopleInScope.map(row => text(row.branch)).filter(Boolean))].sort(),
    titles: [...new Set(peopleInScope.map(row => text(row.title)).filter(Boolean))].sort()
  };

  // Filter mục P (cascading trên dataset đã lọc quyền — KHÔNG mở option ngoài scope).
  const fDept = normalizeScopeText(filters.department);
  const fBranch = normalizeScopeText(filters.branch);
  const fTitle = normalizeScopeText(filters.title);
  const fGrade = text(filters.knlGradeCode).toUpperCase();
  const peopleFiltered = peopleInScope.filter(row => {
    if (fDept && normalizeScopeText(row.department) !== fDept) return false;
    if (fBranch && normalizeScopeText(row.branch) !== fBranch) return false;
    if (fTitle && normalizeScopeText(row.title) !== fTitle) return false;
    return true;
  });
  const filteredCodes = new Set(peopleFiltered.map(row => text(row.employee_code).toUpperCase()));

  // 2) KNL competency (is_active=true) — 1 query, group theo (frameworkCode,gradeCode).
  const { data: competencyRows, error: competencyError } = await db
    .from('knl_employee_competency_assignments')
    .select('employee_code,grade_snapshot')
    .eq('is_active', true)
    .limit(5000);
  throwDb(competencyError);
  const knlByEmployee = new Map();
  (competencyRows || []).forEach(row => {
    const code = text(row.employee_code).toUpperCase();
    const snap = row.grade_snapshot || {};
    if (!snap.gradeCode) return;
    knlByEmployee.set(code, { frameworkCode: snap.frameworkCode || '', frameworkName: snap.frameworkName || '', gradeCode: snap.gradeCode, label: snap.label || snap.gradeCode });
  });

  // 3) Thu nhập — chỉ đọc nếu income_view=true, chỉ tính trên nhân sự pass
  //    incomeScopeAllows() (ĐỘC LẬP với people_scope/filter phía trên, mục C).
  let incomeByEmployeeCodes = new Set();
  let compensationRows = [];
  if (incomeVisible) {
    const eligibleForIncome = activeRows.filter(row => incomeScopeAllows(resolved, { employeeCode: row.employee_code, department: row.department, branch: row.branch, title: row.title }));
    incomeByEmployeeCodes = new Set(eligibleForIncome.map(row => text(row.employee_code).toUpperCase()));
    if (incomeByEmployeeCodes.size) {
      const { data, error } = await db
        .from('knl_employee_compensation_assignments')
        .select('employee_code,payroll_period,reference_total')
        .in('employee_code', [...incomeByEmployeeCodes])
        .order('payroll_period', { ascending: false })
        .limit(20000);
      throwDb(error);
      compensationRows = data || [];
    }
  }

  // Kỳ hiện tại/trước = 2 kỳ gần nhất THẬT SỰ CÓ trong dữ liệu (không suy đoán
  // theo lịch — mục F/N: "nếu chưa đủ khoảng thì UI hiển thị phần có data").
  const periodsPresent = [...new Set(compensationRows.map(r => text(r.payroll_period)))].sort().reverse();
  const requestedPeriod = text(filters.period);
  const currentPeriod = (requestedPeriod && periodsPresent.includes(requestedPeriod)) ? requestedPeriod : (periodsPresent[0] || null);
  const currentIdx = currentPeriod ? periodsPresent.indexOf(currentPeriod) : -1;
  const previousPeriod = currentIdx >= 0 ? (periodsPresent[currentIdx + 1] || null) : null;

  // latest-per-employee cho kỳ current/previous (mỗi employee 1 dòng/kỳ do
  // unique(employee_code,payroll_period) ở schema — không cần dedupe thêm).
  const currentByEmployee = new Map();
  const previousByEmployee = new Map();
  compensationRows.forEach(row => {
    const code = text(row.employee_code).toUpperCase();
    if (currentPeriod && row.payroll_period === currentPeriod) currentByEmployee.set(code, Number(row.reference_total || 0));
    if (previousPeriod && row.payroll_period === previousPeriod) previousByEmployee.set(code, Number(row.reference_total || 0));
  });

  // 4) KPI tổng.
  const totalHeadcount = peopleFiltered.length;
  let totalFund = null, avgIncome = null;
  if (incomeVisible) {
    const scopedCurrentCodes = [...currentByEmployee.keys()].filter(code => filteredCodes.has(code) && (!fGrade || (knlByEmployee.get(code) && knlByEmployee.get(code).gradeCode === fGrade)));
    totalFund = round0(scopedCurrentCodes.reduce((sum, code) => sum + currentByEmployee.get(code), 0));
    avgIncome = scopedCurrentCodes.length ? round0(totalFund / scopedCurrentCodes.length) : null;
  }

  // 5) Cơ cấu quỹ theo phòng ban + So sánh phòng ban (group theo deptOf()).
  const deptMap = new Map(); // dept -> { headcount, currentFund, previousFund, currentCount }
  peopleFiltered.forEach(row => {
    const dept = deptOf(row);
    if (!deptMap.has(dept)) deptMap.set(dept, { headcount: 0, currentFund: 0, previousFund: 0, currentCount: 0, previousCount: 0 });
    const bucket = deptMap.get(dept);
    bucket.headcount += 1;
    const code = text(row.employee_code).toUpperCase();
    if (incomeVisible && (!fGrade || (knlByEmployee.get(code) && knlByEmployee.get(code).gradeCode === fGrade))) {
      if (currentByEmployee.has(code)) { bucket.currentFund += currentByEmployee.get(code); bucket.currentCount += 1; }
      if (previousByEmployee.has(code)) { bucket.previousFund += previousByEmployee.get(code); bucket.previousCount += 1; }
    }
  });
  const grandCurrentFund = incomeVisible ? [...deptMap.values()].reduce((s, b) => s + b.currentFund, 0) : 0;

  const deptComposition = [...deptMap.entries()].map(([department, b]) => ({
    department,
    headcount: b.headcount,
    fund: incomeVisible ? round0(b.currentFund) : null,
    sharePct: incomeVisible && grandCurrentFund > 0 ? Math.round((b.currentFund / grandCurrentFund) * 1000) / 10 : null
  })).sort((a, b) => (b.fund || 0) - (a.fund || 0) || b.headcount - a.headcount);

  const deptComparison = [...deptMap.entries()].map(([department, b]) => {
    const fund = incomeVisible ? round0(b.currentFund) : null;
    const avg = incomeVisible && b.currentCount ? round0(b.currentFund / b.currentCount) : null;
    const prevFund = incomeVisible && b.previousCount ? round0(b.previousFund) : null;
    const { deltaAmount, deltaPct } = incomeVisible ? deltaOf(fund, prevFund) : { deltaAmount: null, deltaPct: null };
    return { department, headcount: b.headcount, fund, avgIncome: avg, previousFund: prevFund, deltaAmount, deltaPct, m3plus: null };
  }).sort((a, b) => (b.fund || 0) - (a.fund || 0) || b.headcount - a.headcount);

  // 6) Phân bố bậc KNL — group theo (frameworkCode,gradeCode) THẬT, không ép M1-M5.
  const knlDistroMap = new Map();
  peopleFiltered.forEach(row => {
    const code = text(row.employee_code).toUpperCase();
    const grade = knlByEmployee.get(code);
    if (!grade) return;
    const key = grade.frameworkCode + '|' + grade.gradeCode;
    if (!knlDistroMap.has(key)) knlDistroMap.set(key, { frameworkCode: grade.frameworkCode, frameworkName: grade.frameworkName, gradeCode: grade.gradeCode, label: grade.label, count: 0 });
    knlDistroMap.get(key).count += 1;
  });
  const knlDistribution = [...knlDistroMap.values()].sort((a, b) => a.frameworkCode.localeCompare(b.frameworkCode) || a.gradeCode.localeCompare(b.gradeCode));
  filterOptions.knlGrades = knlDistribution.map(g => ({ code: g.gradeCode, label: g.frameworkCode + ' · ' + g.label }));

  // 7) Thu nhập theo bậc KNL — cần vừa qua peopleScope (đã filteredCodes) vừa
  //    qua incomeScope (currentByEmployee) — giao 2 trục, không suy diễn.
  const incomeByGrade = [];
  if (incomeVisible) {
    const gradeMap = new Map();
    filteredCodes.forEach(code => {
      if (!currentByEmployee.has(code)) return;
      const grade = knlByEmployee.get(code);
      const key = grade ? grade.frameworkCode + '|' + grade.gradeCode : '__NO_KNL__';
      if (!gradeMap.has(key)) gradeMap.set(key, { frameworkCode: grade ? grade.frameworkCode : '', gradeCode: grade ? grade.gradeCode : '', label: grade ? grade.label : 'Chưa có Bậc KNL', count: 0, fund: 0, deltaSum: 0, deltaN: 0 });
      const bucket = gradeMap.get(key);
      bucket.count += 1;
      bucket.fund += currentByEmployee.get(code);
      if (previousByEmployee.has(code)) {
        const { deltaPct } = deltaOf(currentByEmployee.get(code), previousByEmployee.get(code));
        if (deltaPct != null) { bucket.deltaSum += deltaPct; bucket.deltaN += 1; }
      }
    });
    gradeMap.forEach(b => incomeByGrade.push({
      frameworkCode: b.frameworkCode, gradeCode: b.gradeCode, label: b.label, count: b.count,
      avgIncome: round0(b.fund / b.count), avgDeltaPct: b.deltaN ? Math.round((b.deltaSum / b.deltaN) * 10) / 10 : null
    }));
  }

  // 8) Drill-down theo phòng ban — chỉ nhân sự pass CẢ peopleScope lẫn
  //    incomeScope (bảng có cột thu nhập, mục I). Nhân sự không pass income
  //    vẫn hiện (Chức danh/Bậc KNL) nhưng cột thu nhập là null (không leak).
  const drillDown = {};
  peopleFiltered.forEach(row => {
    const dept = deptOf(row);
    const code = text(row.employee_code).toUpperCase();
    const grade = knlByEmployee.get(code) || null;
    const current = incomeVisible && currentByEmployee.has(code) ? currentByEmployee.get(code) : null;
    const previous = incomeVisible && previousByEmployee.has(code) ? previousByEmployee.get(code) : null;
    const { deltaAmount, deltaPct } = deltaOf(current, previous);
    if (!drillDown[dept]) drillDown[dept] = [];
    drillDown[dept].push({
      employeeCode: row.employee_code, employeeName: row.employee_name, title: row.title || row.position || '',
      knlGrade: grade,
      currentIncome: current, previousIncome: previous, deltaAmount, deltaPct,
      profileUrl: '/knl/co-cau-thu-nhap?employee_code=' + encodeURIComponent(row.employee_code)
    });
  });

  // 9) Xu hướng — tối đa 12 kỳ THẬT gần nhất có trong compensationRows đã
  //    lọc incomeScope (không extrapolate mục N).
  const trend = [];
  if (incomeVisible) {
    const perPeriod = new Map();
    compensationRows.forEach(row => {
      const code = text(row.employee_code).toUpperCase();
      if (!filteredCodes.has(code)) return;
      const period = text(row.payroll_period);
      if (!perPeriod.has(period)) perPeriod.set(period, { fund: 0, headcount: 0 });
      const bucket = perPeriod.get(period);
      bucket.fund += Number(row.reference_total || 0);
      bucket.headcount += 1;
    });
    [...perPeriod.keys()].sort().reverse().slice(0, TREND_MAX_PERIODS).reverse().forEach(period => {
      const b = perPeriod.get(period);
      trend.push({ period, fund: round0(b.fund), headcount: b.headcount, avgIncome: b.headcount ? round0(b.fund / b.headcount) : null });
    });
  }

  // 10) Insight rule-based — CHỈ rule có căn cứ rõ trên dữ liệu đã tính ở
  //     trên, wording không kết luận đúng/sai (mục L).
  const insights = [];
  if (incomeVisible && grandCurrentFund > 0 && totalHeadcount > 0) {
    deptComposition.forEach(d => {
      const headcountSharePct = Math.round((d.headcount / totalHeadcount) * 1000) / 10;
      if (d.sharePct != null && d.sharePct - headcountSharePct >= 15) {
        insights.push({ code: 'FUND_SHARE_AHEAD_OF_HEADCOUNT', level: 'attention', message: 'Có chênh lệch: "' + d.department + '" chiếm ' + d.sharePct + '% quỹ thu nhập nhưng chỉ ' + headcountSharePct + '% nhân sự trong phạm vi.' });
      }
    });
  }
  const missingKnlCount = peopleFiltered.filter(row => !knlByEmployee.has(text(row.employee_code).toUpperCase())).length;
  if (missingKnlCount > 0) {
    insights.push({ code: 'MISSING_KNL', level: 'info', message: 'Cần xem thêm: ' + missingKnlCount + ' nhân sự trong phạm vi chưa có Bậc KNL đang áp dụng.' });
  }

  return {
    meta: {
      isAdmin,
      peopleScopeType: resolved.peopleScope.type,
      incomeVisible,
      incomeScopeType: incomeScope ? incomeScope.type : null,
      isFullCompanyIncome: incomeVisible ? isFullCompanyIncome : null,
      scopeNote: incomeVisible && !isFullCompanyIncome ? 'Tỷ trọng trong phạm vi được xem' : null,
      currentPeriod, previousPeriod, availablePeriods: periodsPresent.slice(0, TREND_MAX_PERIODS),
      filterOptions,
      generatedAt: new Date().toISOString()
    },
    kpis: { totalHeadcount, totalFund, avgIncome, m3plus: null },
    deptComposition, deptComparison, knlDistribution, incomeByGrade, drillDown, trend, insights,
    actionStats: { proposalsPending: null, missingKnl: missingKnlCount, surveysExpiringSoon: null }
  };
}

module.exports = { getKnlDashboardOverview };
