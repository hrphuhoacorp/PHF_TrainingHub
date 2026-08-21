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
 *
 * EFFECTIVE SNAPSHOT / CARRY-FORWARD (supersede quyết định "exact-period,
 * KHÔNG carry-forward" đã chốt ở Gate 2 — business đã xác nhận lại rule đúng
 * là: nếu 1 kỳ không có thay đổi, cơ cấu/bậc có hiệu lực TRƯỚC ĐÓ vẫn tiếp
 * tục phản ánh, không được coi là "thiếu dữ liệu"). Canonical resolver DUY
 * NHẤT (resolveEffectiveCompensationMap, phía dưới) dùng chung cho KPI/
 * matrix/coverage/trend/range — xem docblock của hàm đó để biết đầy đủ rule.
 * KHÔNG materialize/copy row nào sang tháng mới — thuần read-time resolve.
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
const RANGE_MAX_MONTHS = TREND_MAX_PERIODS; // Batch 2B — tái dùng đúng trần 12 kỳ hiện có, không mở query scope mới.

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
function employeeCodeOf(row) { return text(row && row.employee_code).toUpperCase(); }

function uniquePeople(rows) {
  const byCode = new Map();
  (rows || []).forEach(row => {
    const code = employeeCodeOf(row);
    if (code && !byCode.has(code)) byCode.set(code, row);
  });
  return [...byCode.values()];
}

function matrixPerson(row) {
  return { employeeCode: text(row.employee_code), employeeName: text(row.employee_name), title: text(row.title || row.position) };
}

/*
 * Canonical effective-snapshot resolver — DUY NHẤT dùng chung cho KPI/
 * matrix/coverage/trend/range, tránh duplicate logic. Business rule đã chốt:
 * "nếu sang kỳ mới nhân sự không có thay đổi thì trạng thái/bậc/cơ cấu thu
 * nhập có hiệu lực trước đó phải tiếp tục được phản ánh". Với mỗi employee +
 * selectedPeriod:
 *   - chỉ status='ACTIVE' (VOIDED không bao giờ là nguồn — query DB đã lọc
 *     .eq('status','ACTIVE') trước khi rows tới đây, dòng dưới chỉ tự vệ);
 *   - chỉ row có payroll_period <= selectedPeriod — KHÔNG BAO GIỜ lấy dữ liệu
 *     TƯƠNG LAI áp ngược cho quá khứ (khác 3 resolver "current" không-bound ở
 *     lib/knl-foundation.js — những resolver đó chỉ trả lời "hiện tại là gì",
 *     không an toàn để tái dùng cho 1 kỳ QUÁ KHỨ bất kỳ vì có thể vô tình lấy
 *     đúng dòng MỚI HƠN kỳ đang xem);
 *   - trong các row hợp lệ, chọn payroll_period LỚN NHẤT (gần selectedPeriod
 *     nhất) — đây là "hiệu lực" tại đúng thời điểm selectedPeriod, không phải
 *     "mới nhất tuyệt đối";
 *   - KHÔNG materialize/copy row nào — thuần read-time resolve trong bộ nhớ
 *     trên compensationRows đã tải sẵn (bulk, không query lại DB).
 * Trả về Map<employeeCode, row nguyên vẹn> (không chỉ số tiền) — nơi gọi còn
 * cần structure_snapshot/employment_type/compensation_grade_id (vd grade
 * matrix), không chỉ reference_total.
 */
function resolveEffectiveCompensationMap(compensationRows, selectedPeriod) {
  const map = new Map();
  const period = text(selectedPeriod);
  if (!period) return map;
  (compensationRows || []).forEach(row => {
    if (text(row.status || 'ACTIVE') !== 'ACTIVE') return;
    const rowPeriod = text(row.payroll_period);
    if (!rowPeriod || rowPeriod > period) return;
    const code = employeeCodeOf(row);
    if (!code) return;
    const existing = map.get(code);
    if (!existing || rowPeriod > text(existing.payroll_period)) map.set(code, row);
  });
  return map;
}

/*
 * Salary-grade distribution dùng canonical effective-snapshot resolver ở
 * trên — carry-forward từ row ACTIVE gần nhất <= period nếu nhân sự không có
 * thay đổi đúng kỳ này (supersede quyết định "exact-period" cũ). Vẫn chỉ
 * nhận người đã qua incomeScopeAllows() (incomePeople), vẫn KHÔNG tự đọc lại
 * ladder/grade master hiện hành — structure_snapshot đã đóng băng trên chính
 * row lịch sử được resolve (giữ nguyên grade/framework tại thời điểm ghi).
 */
function buildCompensationGradeMatrix(period, incomePeople, compensationRows) {
  const effectiveAssignments = resolveEffectiveCompensationMap(compensationRows, period);

  const departments = new Map();
  const gradeNumbers = new Set();
  let unassignedCount = 0;

  uniquePeople(incomePeople).forEach(person => {
    const code = employeeCodeOf(person);
    const assignment = effectiveAssignments.get(code) || null;
    if (assignment && text(assignment.employment_type).toUpperCase() === 'PROBATION') return;

    const department = deptOf(person);
    if (!departments.has(department)) departments.set(department, { department, total: 0, assigned: 0, unassigned: 0, ladders: new Map() });
    const departmentBucket = departments.get(department);
    departmentBucket.total += 1;

    const snapshot = assignment && assignment.structure_snapshot && typeof assignment.structure_snapshot === 'object' ? assignment.structure_snapshot : {};
    const gradeNumber = Number(snapshot.gradeNumber);
    const ladderCode = text(snapshot.ladderCode);
    const ladderName = text(snapshot.ladderName) || ladderCode;
    const gradeCode = text(snapshot.gradeCode);
    const validGrade = Boolean(
      assignment &&
      text(assignment.employment_type).toUpperCase() === 'OFFICIAL' &&
      assignment.compensation_grade_id &&
      Number.isInteger(gradeNumber) && gradeNumber > 0 &&
      ladderCode && gradeCode
    );

    if (!validGrade) {
      departmentBucket.unassigned += 1;
      unassignedCount += 1;
      return;
    }

    departmentBucket.assigned += 1;
    gradeNumbers.add(gradeNumber);
    if (!departmentBucket.ladders.has(ladderCode)) {
      departmentBucket.ladders.set(ladderCode, { ladderCode, ladderName, people: [], grades: new Map() });
    }
    const ladderBucket = departmentBucket.ladders.get(ladderCode);
    const personPayload = matrixPerson(person);
    ladderBucket.people.push(personPayload);
    if (!ladderBucket.grades.has(gradeNumber)) {
      ladderBucket.grades.set(gradeNumber, { gradeCode, gradeNumber, people: [] });
    }
    ladderBucket.grades.get(gradeNumber).people.push(personPayload);
  });

  const sortPeople = rows => rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'vi') || a.employeeCode.localeCompare(b.employeeCode));
  return {
    period: text(period) || null,
    gradeNumbers: [...gradeNumbers].sort((a, b) => a - b),
    departments: [...departments.values()].map(department => ({
      department: department.department,
      total: department.total,
      assigned: department.assigned,
      unassigned: department.unassigned,
      ladders: [...department.ladders.values()].map(ladder => ({
        ladderCode: ladder.ladderCode,
        ladderName: ladder.ladderName,
        people: sortPeople(ladder.people),
        grades: [...ladder.grades.values()].map(grade => ({ ...grade, people: sortPeople(grade.people) })).sort((a, b) => a.gradeNumber - b.gradeNumber)
      })).sort((a, b) => a.ladderName.localeCompare(b.ladderName, 'vi') || a.ladderCode.localeCompare(b.ladderCode))
    })).sort((a, b) => a.department.localeCompare(b.department, 'vi')),
    unassignedCount
  };
}

function deltaOf(current, previous) {
  if (current == null || previous == null) return { deltaAmount: null, deltaPct: null };
  const deltaAmount = round0(current - previous);
  const deltaPct = previous > 0 ? Math.round((deltaAmount / previous) * 1000) / 10 : null;
  return { deltaAmount, deltaPct };
}

/*
 * "Kỳ hoàn chỉnh" (period coverage), DETERMINISTIC, không threshold/tỷ lệ tự
 * suy. ĐÃ CẬP NHẬT theo rule Effective Snapshot / Carry-Forward (supersede
 * Gate 2 "exact-period" cũ): coveredCount giờ đếm nhân sự RESOLVE ĐƯỢC effective
 * compensation tại period đó qua resolveEffectiveCompensationMap (carry-forward
 * từ row ACTIVE gần nhất <= period), KHÔNG còn đòi hỏi row đúng y nguyên
 * payroll_period. Một kỳ chỉ còn 'partial'/'empty' khi thực sự có người
 * KHÔNG resolve được gì cả (chưa từng có ACTIVE assignment nào <= period đó
 * — genuinely missing), không còn bị đánh PARTIAL chỉ vì tháng đang xem
 * không ai ghi dòng mới.
 *
 * Denominator (expected population) PHẢI là đúng population mà compensation
 * KPI của Dashboard đang tính trên — tức incomeByEmployeeCodes (active +
 * incomeScopeAllows, KHÔNG phải Organization Master total, KHÔNG lọc theo UI
 * filter phòng ban/chi nhánh/chức danh/bậc KNL — filter đó áp ở tầng khác,
 * period completeness phải là thuộc tính của TOÀN incomeScope, nếu không lọc
 * 1 phòng ban đã-đủ-dữ-liệu sẽ vô tình biến 1 kỳ partial toàn công ty thành
 * "complete" giả). expectedCodes không đổi theo period (income scope không có
 * trục thời gian trong hệ hiện tại — giới hạn kế thừa, không phải phát sinh
 * mới ở batch này; Organization Master cũng không có lịch sử phòng ban/nghỉ
 * việc theo thời gian — limitation riêng, KHÔNG sửa trong batch này).
 *
 * isComplete = expectedCount > 0 && coveredCount === expectedCount (KHÔNG %).
 * isFuture thuần theo lịch (period > nowYm server), ĐỘC LẬP với carry-forward
 * — 1 kỳ tương lai không bao giờ "complete" dù resolve được carry-forward.
 */
function computePeriodCoverage(period, compensationRows, expectedCodes) {
  const nowYm = new Date().toISOString().slice(0, 7);
  const isFuture = text(period) > nowYm;
  const effective = resolveEffectiveCompensationMap(compensationRows, period);
  const actualCodes = new Set();
  expectedCodes.forEach(code => { if (effective.has(code)) actualCodes.add(code); });
  const expectedCount = expectedCodes.size;
  const coveredCount = actualCodes.size;
  const missingCount = Math.max(0, expectedCount - coveredCount);
  const coverageStatus = (expectedCount === 0 || coveredCount === 0)
    ? 'empty'
    : (coveredCount === expectedCount ? 'complete' : 'partial');
  return {
    period: text(period), isFuture, expectedCount, coveredCount, missingCount, coverageStatus,
    isComplete: !isFuture && coverageStatus === 'complete'
  };
}

/*
 * Batch 2B — range/quý filter contract. Backward-compatible: chỉ kích hoạt
 * khi filters có ít nhất 1 trong periodFrom/periodTo/rangePreset; nếu không
 * -> mode 'single', getKnlDashboardOverview chạy đúng nhánh legacy filters.period
 * y nguyên, không một dòng code cũ nào bị ảnh hưởng. quarter_current/
 * quarter_previous/last3 tính theo nowYm (giờ server, cùng nguồn dùng bởi
 * computePeriodCoverage) — KHÔNG tin cậy đồng hồ client.
 */
function ymParts(ym) { const parts = text(ym).split('-'); return { y: Number(parts[0]), m: Number(parts[1]) }; }
function ymAdd(ym, deltaMonths) {
  const { y, m } = ymParts(ym);
  const total = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(total / 12), nm = (total % 12 + 12) % 12 + 1;
  return ny + '-' + (nm < 10 ? '0' + nm : '' + nm);
}
function ymCompare(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
function ymDiffMonths(a, b) { const pa = ymParts(a), pb = ymParts(b); return (pb.y * 12 + pb.m) - (pa.y * 12 + pa.m); }
function enumeratePeriods(start, end) {
  const out = []; let cur = start, guard = 0;
  while (ymCompare(cur, end) <= 0 && guard < RANGE_MAX_MONTHS + 1) { out.push(cur); cur = ymAdd(cur, 1); guard++; }
  return out;
}
function quarterStartOf(ym) { const { y, m } = ymParts(ym); const qm = Math.floor((m - 1) / 3) * 3 + 1; return y + '-' + (qm < 10 ? '0' + qm : '' + qm); }
function quarterEndOf(ym) { return ymAdd(quarterStartOf(ym), 2); }
const YM_RE = /^\d{4}-\d{2}$/;

function resolveRangeWindow(filters, nowYm) {
  const explicitFrom = text(filters.periodFrom);
  const explicitTo = text(filters.periodTo);
  const preset = text(filters.rangePreset);

  if (!explicitFrom && !explicitTo && !preset) return { mode: 'single', rangeStart: null, rangeEnd: null };

  let from = explicitFrom, to = explicitTo;
  if (preset === 'last3') { to = to || nowYm; from = from || ymAdd(to, -2); }
  else if (preset === 'quarter_current') { from = from || quarterStartOf(nowYm); to = to || quarterEndOf(nowYm); }
  else if (preset === 'quarter_previous') { const prevQAnchor = ymAdd(quarterStartOf(nowYm), -1); from = from || quarterStartOf(prevQAnchor); to = to || quarterEndOf(prevQAnchor); }
  else if (preset === 'month') { from = from || text(filters.period) || nowYm; to = to || from; }
  else if (preset === 'custom' || !preset) {
    if (!from || !to) fail('Khoảng thời gian tuỳ chỉnh cần đủ Từ tháng và Đến tháng.', 400, 'KNL_DASHBOARD_RANGE_INVALID');
  } else {
    fail('rangePreset không hợp lệ.', 400, 'KNL_DASHBOARD_RANGE_INVALID');
  }

  if (!YM_RE.test(from) || !YM_RE.test(to)) fail('Khoảng thời gian không hợp lệ.', 400, 'KNL_DASHBOARD_RANGE_INVALID');
  if (ymCompare(from, to) > 0) fail('Từ tháng phải trước hoặc bằng Đến tháng.', 400, 'KNL_DASHBOARD_RANGE_INVALID');
  const span = ymDiffMonths(from, to) + 1;
  if (span > RANGE_MAX_MONTHS) fail('Khoảng thời gian tối đa ' + RANGE_MAX_MONTHS + ' tháng.', 400, 'KNL_DASHBOARD_RANGE_TOO_LONG');
  return { mode: 'range', rangeStart: from, rangeEnd: to };
}

async function getKnlDashboardOverview(session, filters = {}) {
  ensureDb();
  const resolved = await resolveActorGrant(session);
  requireDashboardView(resolved);

  const nowYm = new Date().toISOString().slice(0, 7);
  const rangeWindow = resolveRangeWindow(filters, nowYm);

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
  let incomePeopleFiltered = [];
  let compensationRows = [];
  if (incomeVisible) {
    const eligibleForIncome = uniquePeople(activeRows.filter(row => incomeScopeAllows(resolved, { employeeCode: row.employee_code, department: row.department, branch: row.branch, title: row.title })));
    incomeByEmployeeCodes = new Set(eligibleForIncome.map(row => text(row.employee_code).toUpperCase()));
    incomePeopleFiltered = eligibleForIncome.filter(row => {
      if (fDept && normalizeScopeText(row.department) !== fDept) return false;
      if (fBranch && normalizeScopeText(row.branch) !== fBranch) return false;
      if (fTitle && normalizeScopeText(row.title) !== fTitle) return false;
      const code = employeeCodeOf(row);
      if (fGrade && (!knlByEmployee.get(code) || knlByEmployee.get(code).gradeCode !== fGrade)) return false;
      return true;
    });
    if (incomeByEmployeeCodes.size) {
      const { data, error } = await db
        .from('knl_employee_compensation_assignments')
        .select('employee_code,payroll_period,employment_type,compensation_grade_id,structure_snapshot,reference_total')
        .in('employee_code', [...incomeByEmployeeCodes])
        .eq('status', 'ACTIVE')
        .order('payroll_period', { ascending: false })
        .limit(20000);
      throwDb(error);
      compensationRows = data || [];
    }
  }

  // Kỳ hiện tại/trước — EFFECTIVE SNAPSHOT / CARRY-FORWARD (supersede Gate 2
  // "exact-period" cũ, business đã xác nhận). "periodsPresent" giờ CHỈ còn
  // dùng để: (a) biết earliestPresent (mốc xa nhất có dữ liệu thật, để không
  // vẽ 1 dải lịch trắng vô nghĩa trước khi hệ thống có dữ liệu), (b)
  // meta.availablePeriods cho dropdown "Theo tháng" (không đổi trong batch
  // này). Trục ứng viên cho DEFAULT (không truyền filters.period) giờ là
  // LỊCH liên tục từ earliestPresent tới nowYm (server), KHÔNG còn giới hạn ở
  // "period có row thật" — vì dưới carry-forward, 1 tháng không ai ghi dòng
  // mới hoàn toàn có thể vẫn 'complete' (mọi người carry-forward hợp lệ).
  // Nếu user CHỦ ĐỘNG chọn 1 kỳ cụ thể, request đó luôn được tôn trọng
  // nguyên văn — chỉ default tự động mới cần né kỳ chưa đủ.
  const periodsPresent = [...new Set(compensationRows.map(r => text(r.payroll_period)))].sort().reverse();
  const earliestPresent = periodsPresent.length ? periodsPresent[periodsPresent.length - 1] : null;
  const periodCoverage = new Map();
  function coverageOf(period) {
    if (!periodCoverage.has(period)) periodCoverage.set(period, computePeriodCoverage(period, compensationRows, incomeByEmployeeCodes));
    return periodCoverage.get(period);
  }
  const requestedPeriod = text(filters.period);
  let currentPeriod = requestedPeriod || null;
  if (!currentPeriod && earliestPresent) {
    const candidateStart = ymCompare(earliestPresent, ymAdd(nowYm, -(TREND_MAX_PERIODS - 1))) > 0 ? earliestPresent : ymAdd(nowYm, -(TREND_MAX_PERIODS - 1));
    const candidates = enumeratePeriods(candidateStart, nowYm);
    for (let i = candidates.length - 1; i >= 0 && !currentPeriod; i--) { if (coverageOf(candidates[i]).isComplete) currentPeriod = candidates[i]; }
    // Không có kỳ nào complete -> fallback kỹ thuật an toàn = kỳ gần nowYm
    // nhất còn resolve được GÌ ĐÓ (coveredCount>0, kể cả carry-forward một
    // phần), nhãn thật không giả complete; nếu tuyệt đối không resolve được
    // gì trong cả cửa sổ -> kỳ gần nowYm nhất (để còn hiển thị "empty" trung
    // thực thay vì trắng hoàn toàn không lý do).
    for (let i = candidates.length - 1; i >= 0 && !currentPeriod; i--) { if (coverageOf(candidates[i]).coveredCount > 0) currentPeriod = candidates[i]; }
    if (!currentPeriod && candidates.length) currentPeriod = candidates[candidates.length - 1];
  }
  if (!currentPeriod) currentPeriod = periodsPresent[0] || null; // an toàn tuyệt đối: hoàn toàn không có dữ liệu nào
  let currentPeriodState = currentPeriod ? coverageOf(currentPeriod) : null;
  // previousPeriod ("so với kỳ trước") = THÁNG LỊCH liền trước currentPeriod,
  // nếu bản thân nó cũng complete (carry-forward khiến tháng liền trước hầu
  // như luôn complete 1 khi đã có dữ liệu — không còn cần tìm xa như logic cũ
  // vốn phải dò xa vì dữ liệu thưa theo exact-period). Không tìm xa hơn 1
  // tháng để tránh so sánh nhảy cóc gây hiểu nhầm; không lùi trước
  // earliestPresent (không có gì để carry-forward từ đó).
  let previousPeriod = null;
  if (currentPeriod && currentPeriodState && currentPeriodState.isComplete && earliestPresent) {
    const prevCandidate = ymAdd(currentPeriod, -1);
    if (ymCompare(prevCandidate, earliestPresent) >= 0 && coverageOf(prevCandidate).isComplete) previousPeriod = prevCandidate;
  }

  // Batch 2B — range/quý: kỳ đầu ra (currentPeriod/previousPeriod) bị ghi đè
  // CHỈ khi rangeWindow.mode==='range'. Ở mode 'single', 2 biến trên giữ
  // nguyên giá trị vừa resolve ở trên. snapshotPeriod/comparisonBase giờ
  // cũng carry-forward-aware qua coverageOf() (đã đổi nghĩa coveredCount).
  let periodCoverageRoster = [];
  if (rangeWindow.mode === 'range') {
    const rosterAsc = enumeratePeriods(rangeWindow.rangeStart, rangeWindow.rangeEnd);
    rosterAsc.forEach(p => coverageOf(p));
    const completeInRangeAsc = rosterAsc.filter(p => coverageOf(p).isComplete);
    const resolvableInRangeAsc = rosterAsc.filter(p => coverageOf(p).coveredCount > 0);
    // snapshotPeriod = kỳ complete muộn nhất trong range; nếu không có -> kỳ
    // RESOLVE ĐƯỢC (carry-forward một phần) muộn nhất trong range (nhãn thật,
    // không complete); nếu range trắng hoàn toàn -> null. Luôn bị chặn trong
    // biên [rangeStart,rangeEnd].
    const snapshotPeriod = completeInRangeAsc.length
      ? completeInRangeAsc[completeInRangeAsc.length - 1]
      : (resolvableInRangeAsc.length ? resolvableInRangeAsc[resolvableInRangeAsc.length - 1] : null);
    // comparisonBase = kỳ complete SỚM NHẤT trong range khác snapshotPeriod —
    // KPI biến động = 1 phép trừ đầu range vs cuối range, KHÔNG cộng dồn.
    const comparisonBase = snapshotPeriod
      ? (completeInRangeAsc.find(p => p !== snapshotPeriod) || null)
      : null;
    currentPeriod = snapshotPeriod;
    currentPeriodState = currentPeriod ? coverageOf(currentPeriod) : null;
    previousPeriod = comparisonBase;
    periodCoverageRoster = rosterAsc.map(p => ({ ...coverageOf(p) }));
  } else if (currentPeriodState) {
    periodCoverageRoster = [{ ...currentPeriodState }];
  }

  // Effective snapshot per employee — canonical resolver DUY NHẤT (carry-
  // forward). Trả về row nguyên vẹn nên currentByEmployee/previousByEmployee
  // (chỉ giữ số tiền cho phần KPI/dept phía dưới) tách riêng khỏi map row đầy
  // đủ dùng cho grade matrix.
  const currentEffective = currentPeriod ? resolveEffectiveCompensationMap(compensationRows, currentPeriod) : new Map();
  const previousEffective = previousPeriod ? resolveEffectiveCompensationMap(compensationRows, previousPeriod) : new Map();
  const currentByEmployee = new Map([...currentEffective].map(([code, row]) => [code, Number(row.reference_total || 0)]));
  const previousByEmployee = new Map([...previousEffective].map(([code, row]) => [code, Number(row.reference_total || 0)]));
  const compensationGradeMatrix = incomeVisible ? buildCompensationGradeMatrix(currentPeriod, incomePeopleFiltered, compensationRows) : null;

  // 4) KPI tổng.
  const totalHeadcount = peopleFiltered.length;
  let totalFund = null, avgIncome = null, incomePopulation = null;
  if (incomeVisible) {
    const scopedCurrentCodes = [...currentByEmployee.keys()].filter(code => filteredCodes.has(code) && (!fGrade || (knlByEmployee.get(code) && knlByEmployee.get(code).gradeCode === fGrade)));
    totalFund = round0(scopedCurrentCodes.reduce((sum, code) => sum + currentByEmployee.get(code), 0));
    incomePopulation = scopedCurrentCodes.length;
    avgIncome = incomePopulation ? round0(totalFund / incomePopulation) : null;
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
    return { department, headcount: b.headcount, incomePopulation: incomeVisible ? b.currentCount : null, fund, avgIncome: avg, previousFund: prevFund, deltaAmount, deltaPct, m3plus: null };
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

  // 9) Xu hướng — EFFECTIVE SNAPSHOT / CARRY-FORWARD. Trục là các THÁNG LỊCH
  //    liên tục (không chỉ tháng có row thật — 1 tháng không ai ghi dòng mới
  //    vẫn phải xuất hiện với đúng số carry-forward, không được "biến mất"/
  //    tụt về 0 giả). Mỗi điểm resolve qua canonical resolver, chỉ tính
  //    filteredCodes (tôn trọng UI filter hiện có, giống hành vi cũ). Mode
  //    'range' dùng ĐÚNG trục periodCoverageRoster (đã <=12 tháng); mode
  //    'single' dùng tối đa 12 tháng lịch gần nhất tính đến currentPeriod,
  //    không lùi xa hơn earliestPresent (tránh vẽ dải trắng vô nghĩa trước
  //    khi hệ thống có dữ liệu).
  const trend = [];
  if (incomeVisible && currentPeriod) {
    let trendRoster;
    if (rangeWindow.mode === 'range') {
      trendRoster = periodCoverageRoster.map(p => p.period);
    } else {
      const trendStart = earliestPresent
        ? (ymCompare(earliestPresent, ymAdd(currentPeriod, -(TREND_MAX_PERIODS - 1))) > 0 ? earliestPresent : ymAdd(currentPeriod, -(TREND_MAX_PERIODS - 1)))
        : currentPeriod;
      trendRoster = enumeratePeriods(trendStart, currentPeriod);
    }
    trendRoster.forEach(period => {
      const effective = resolveEffectiveCompensationMap(compensationRows, period);
      let fund = 0, headcount = 0;
      filteredCodes.forEach(code => { const row = effective.get(code); if (row) { fund += Number(row.reference_total || 0); headcount += 1; } });
      const coverage = coverageOf(period);
      trend.push({
        period, fund: round0(fund), headcount, avgIncome: headcount ? round0(fund / headcount) : null,
        coverageStatus: coverage.coverageStatus, isFuture: coverage.isFuture, isComplete: coverage.isComplete
      });
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

  const result = {
    meta: {
      isAdmin,
      peopleScopeType: resolved.peopleScope.type,
      incomeVisible,
      incomeScopeType: incomeScope ? incomeScope.type : null,
      isFullCompanyIncome: incomeVisible ? isFullCompanyIncome : null,
      scopeNote: incomeVisible && !isFullCompanyIncome ? 'Tỷ trọng trong phạm vi được xem' : null,
      currentPeriod, previousPeriod, availablePeriods: periodsPresent.slice(0, TREND_MAX_PERIODS),
      currentPeriodIsFuture: currentPeriodState ? currentPeriodState.isFuture : null,
      currentPeriodStatus: currentPeriodState ? (currentPeriodState.isFuture ? 'future' : currentPeriodState.coverageStatus) : null,
      expectedCount: currentPeriodState ? currentPeriodState.expectedCount : null,
      coveredCount: currentPeriodState ? currentPeriodState.coveredCount : null,
      missingCount: currentPeriodState ? currentPeriodState.missingCount : null,
      comparisonAvailable: Boolean(previousPeriod),
      // Batch 2B — range/quý (additive, không đổi field phía trên). Ở mode
      // 'single' rangeStart/rangeEnd=null, snapshotPeriod/comparisonBase là
      // alias đúng bằng currentPeriod/previousPeriod, periodCoverage có 1
      // phần tử duy nhất — UI phase sau tự do dùng field cũ hoặc field mới.
      rangeMode: rangeWindow.mode,
      rangeStart: rangeWindow.mode === 'range' ? rangeWindow.rangeStart : null,
      rangeEnd: rangeWindow.mode === 'range' ? rangeWindow.rangeEnd : null,
      snapshotPeriod: currentPeriod,
      comparisonBase: previousPeriod,
      periodCoverage: periodCoverageRoster,
      filterOptions,
      generatedAt: new Date().toISOString()
    },
    kpis: { totalHeadcount, totalFund, avgIncome, incomePopulation, m3plus: null },
    deptComposition, deptComparison, knlDistribution, incomeByGrade, drillDown, trend, insights,
    actionStats: { proposalsPending: null, missingKnl: missingKnlCount, surveysExpiringSoon: null }
  };
  if (incomeVisible) result.compensationGradeMatrix = compensationGradeMatrix;
  return result;
}

module.exports = { getKnlDashboardOverview, computePeriodCoverage, resolveRangeWindow };
