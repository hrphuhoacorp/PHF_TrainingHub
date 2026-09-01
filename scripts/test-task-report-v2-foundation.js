'use strict';

/*
 * PHF Task — Báo cáo V2 (Gate V2-R2) — foundation test.
 *
 * HTTP, real local server (server.js) via local-parity orchestrator
 * (phf-hr-api -> throwaway PostgreSQL over SSH tunnel), real logins. READ
 * ONLY — zero writes, zero DB mutation. Complements
 * scripts/test-task-overview-v2-foundation.js (Tổng quan, unchanged/still
 * passing) — this file covers the 4 NEW Báo cáo V2 actions (Person/
 * Department/Category/Trend) + dimension-filtered drilldown.
 *
 *   node scripts/test-task-report-v2-foundation.js
 */

const assert = require('assert');
const BASE = process.env.PHF_TASK_LOCAL_BASE || 'http://127.0.0.1:3000';
const PW = 'LocalParity#2026';
let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; fails.push(name); console.log('  FAIL  ' + name + (detail ? ' -> ' + JSON.stringify(detail) : '')); }
}

async function login(email) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  const sc = r.headers.get('set-cookie') || '';
  const j = await r.json();
  if (!j.ok) throw new Error('login ' + email + ': ' + JSON.stringify(j));
  return sc.split(',').map(s => s.split(';')[0].trim()).filter(s => /=/.test(s)).join('; ');
}
async function api(cookie, payload, _tries) {
  // The local-parity backend runs the throwaway DB over an SSH tunnel behind a
  // 6s read-bridge timeout. Firing several FULL-POPULATION reporting actions
  // concurrently (this file's Promise.all batches) can push individual calls
  // past that cap purely from DB/connection-pool contention — a test-infra
  // capacity limit, not a code defect (the product now fires ONE bundle call,
  // see getTaskReportV2Bundle). Retry a transient 5xx once before failing.
  const tries = _tries || 3;
  let last = null;
  for (let k = 0; k < tries; k++) {
    const r = await fetch(BASE + '/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload) });
    let j; try { j = await r.json(); } catch (e) { j = {}; }
    last = { status: r.status, ok: j.ok === true, code: j.code || '', result: j.result };
    if (last.ok || r.status < 500) return last;
    await new Promise((res) => setTimeout(res, 1200));
  }
  return last;
}
function period() { return { type: 'month', anchor_date: new Date().toISOString().slice(0, 10) }; }

const PERSONAS = {
  ADMIN: { email: 'hr.phuhoacorp@gmail.com', code: '', label: 'Admin hệ thống' },
  GD: { email: 'tranthuthuy@phuhoafresh.com', code: 'PHF002', label: 'Giám đốc — Trần Thu Thủy' },
  TBP: { email: 'thanglv150917@gmail.com', code: 'PHF012', label: 'TBP QTTH — Lê Vĩnh Thắng' },
  NV: { email: 'phuoclyminh789@gmail.com', code: 'PHF082', label: 'NV QTTH — Lý Minh Phước' },
};

(async () => {
  const cookies = {};
  for (const [k, p] of Object.entries(PERSONAS)) cookies[k] = await login(p.email);
  console.log('Đã đăng nhập 4 persona.');

  // =========================================================================
  // PART 0 — foundation reuse sanity: cả 4 action mới + Overview đều PASS 200,
  // cùng report_contract_version, cùng effective_scope semantics đã verify ở
  // V2-R1 (OVERVIEW_REPORT_SINGLE_CANONICAL_FOUNDATION — cùng resolveOverviewContext()).
  // =========================================================================
  console.log('\n[0] 4 action Báo cáo V2 mới — real data, PostgreSQL-only');
  const [person, dept, cat, trend, overview] = await Promise.all([
    api(cookies.ADMIN, { action: 'getTaskReportV2PersonAnalysis', period: period() }),
    api(cookies.ADMIN, { action: 'getTaskReportV2DepartmentAnalysis', period: period() }),
    api(cookies.ADMIN, { action: 'getTaskReportV2CategoryAnalysis', period: period() }),
    api(cookies.ADMIN, { action: 'getTaskReportV2Trend', period: period() }),
    api(cookies.ADMIN, { action: 'getTaskOverviewV2', period: period() }),
  ]);
  ok(person.ok, 'REPORT_PERSON_ANALYSIS: 200', person);
  ok(dept.ok, 'REPORT_DEPARTMENT_ANALYSIS: 200', dept);
  ok(cat.ok, 'REPORT_CATEGORY_ANALYSIS: 200', cat);
  ok(trend.ok, 'REPORT_TREND: 200', trend);
  ok(overview.ok, 'overview (baseline for cross-check): 200', overview);
  ok(Array.isArray(person.result && person.result.people), 'person.people là mảng', person.result);
  ok(Array.isArray(dept.result && dept.result.departments), 'dept.departments là mảng', dept.result);
  ok(Array.isArray(cat.result && cat.result.categories), 'cat.categories là mảng', cat.result);
  ok(trend.result && typeof trend.result.trend_supported === 'boolean', 'trend.trend_supported là boolean', trend.result);
  ok(trend.result && trend.result.trend_supported === true && Array.isArray(trend.result.buckets) && trend.result.buckets.length > 0, 'REPORT_TREND: month có buckets thật (daily)', trend.result && trend.result.buckets && trend.result.buckets.length);

  // PERF (2026-09-02) — getTaskReportV2Bundle: ONE request, ONE authorized
  // population, every section computed from it. Each section object MUST be
  // byte-identical to its standalone action's result (the frontend now fires
  // only this call for Overview + Báo cáo).
  const bundle = await api(cookies.ADMIN, { action: 'getTaskReportV2Bundle', period: period(), sections: ['overview', 'trend', 'person', 'department', 'category'] });
  ok(bundle.ok, 'BUNDLE: 200', bundle);
  const bSec = (bundle.result && bundle.result.sections) || {};
  const stable = (o) => JSON.stringify(o);
  ok(stable(bSec.overview) === stable(overview.result), 'BUNDLE.overview === standalone getTaskOverviewV2');
  ok(stable(bSec.trend) === stable(trend.result), 'BUNDLE.trend === standalone getTaskReportV2Trend');
  ok(stable(bSec.person) === stable(person.result), 'BUNDLE.person === standalone getTaskReportV2PersonAnalysis');
  ok(stable(bSec.department) === stable(dept.result), 'BUNDLE.department === standalone getTaskReportV2DepartmentAnalysis');
  ok(stable(bSec.category) === stable(cat.result), 'BUNDLE.category === standalone getTaskReportV2CategoryAnalysis');
  ok(bundle.result && bundle.result.nav_signals && typeof bundle.result.nav_signals.hasManagedPeople === 'boolean' && typeof bundle.result.nav_signals.canManageTaskPermissions === 'boolean', 'BUNDLE.nav_signals carries the two authority booleans (managed-scope probe reuse)');
  ok(bundle.result && bundle.result.effective_scope === overview.result.effective_scope, 'BUNDLE.effective_scope matches the standalone');

  // =========================================================================
  // PART 1 — RELATED_NO_DOUBLE_COUNT — sum(workload) theo CẢ 3 chiều
  // (Person/Department/Category) phải BẰNG NHAU và bằng đúng tổng population
  // trừ cancelled (status_breakdown không có cancelled) — chứng minh KHÔNG có
  // chiều nào bị fan-out/double-count so với chiều khác.
  // =========================================================================
  console.log('\n[1] RELATED_NO_DOUBLE_COUNT — 3 chiều group-by cho cùng 1 tổng');
  const sb = overview.result.status_breakdown;
  const expectedWorkloadTotal = sb.not_started + sb.in_progress + sb.overdue + sb.completed;
  const personWorkloadTotal = (person.result.people || []).reduce((a, p) => a + p.workload, 0);
  const deptWorkloadTotal = (dept.result.departments || []).reduce((a, d) => a + d.workload, 0);
  const catWorkloadTotal = (cat.result.categories || []).reduce((a, c) => a + c.workload, 0);
  ok(personWorkloadTotal === expectedWorkloadTotal, 'sum(person.workload) === total non-cancelled population', { personWorkloadTotal, expectedWorkloadTotal });
  ok(deptWorkloadTotal === expectedWorkloadTotal, 'sum(department.workload) === total non-cancelled population', { deptWorkloadTotal, expectedWorkloadTotal });
  ok(catWorkloadTotal === expectedWorkloadTotal, 'sum(category.workload) === total non-cancelled population', { catWorkloadTotal, expectedWorkloadTotal });
  console.log('  DATA: expectedWorkloadTotal=' + expectedWorkloadTotal + ' person=' + personWorkloadTotal + ' dept=' + deptWorkloadTotal + ' category=' + catWorkloadTotal);

  // =========================================================================
  // PART 2 — CANCELLED_EXCLUDED (workload) — không bucket nào trong Person/
  // Department/Category có workload lớn hơn expectedWorkloadTotal của riêng nó
  // (đã verify ở trên bằng tổng), và các field completed_* cũng không thể lớn
  // hơn workload (cancelled không có completed_at hợp lệ trong kỳ vì predicate
  // completed yêu cầu status='completed').
  // =========================================================================
  console.log('\n[2] CANCELLED_EXCLUDED — completed_in_period luôn <= workload cho mọi nhóm');
  const allGroupsOk = [].concat(person.result.people, dept.result.departments, cat.result.categories)
    .every((g) => g.completed_in_period <= g.workload && g.completed_on_time + g.completed_late <= g.completed_in_period);
  ok(allGroupsOk, 'mọi nhóm (person/dept/category): completed_in_period <= workload, completed_on_time+late <= completed_in_period', null);

  // =========================================================================
  // PART 3 — SELF_TASK_SEMANTICS — Person analysis loại self-task khỏi
  // performance (completed_on_time/late), Overview KHÔNG loại — nên
  // determinable count (on_time+late) tổng hợp từ Person <= Overview. Đây là
  // structural invariant ĐÚNG BẤT KỂ dữ liệu hiện có bao nhiêu self-task.
  // =========================================================================
  console.log('\n[3] SELF_TASK_SEMANTICS — Person performance <= Overview performance (Person loại self-task)');
  const personDeterminable = (person.result.people || []).reduce((a, p) => a + p.completed_on_time + p.completed_late, 0);
  const overviewOnTime = overview.result.metrics.on_time_rate.value;
  const overviewCompletedInPeriod = overview.result.metrics.completed_in_period.value;
  // Overview không loại self-task nên determinable count của nó = completed_in_period
  // trừ đi số completed KHÔNG xác định được on_time (event thiếu/mismatch) — ta
  // không có con số đó qua API public, nên chỉ assert bất đẳng thức cấu trúc:
  // personDeterminable KHÔNG BAO GIỜ được vượt quá overviewCompletedInPeriod
  // (self-task-excluded subset luôn <= full set).
  ok(personDeterminable <= overviewCompletedInPeriod, 'sum(person determinable on_time+late) <= overview completed_in_period (self-task exclusion không thể LÀM TĂNG số liệu)', { personDeterminable, overviewCompletedInPeriod });
  console.log('  DATA: personDeterminable=' + personDeterminable + ' overviewCompletedInPeriod=' + overviewCompletedInPeriod + ' overviewOnTimeRate=' + overviewOnTime);

  // =========================================================================
  // PART 4 — CROSS_DEPARTMENT_PRIMARY_ATTRIBUTION — mọi department bucket có
  // department hợp lệ (không rỗng — dùng nhãn "(Chưa xác định)" thay vì bỏ
  // sót), và tổng vẫn khớp (đã verify Part 1) => không Task liên phòng ban nào
  // bị đếm 2 lần cho 2 phòng.
  // =========================================================================
  console.log('\n[4] CROSS_DEPARTMENT_PRIMARY_ATTRIBUTION');
  ok((dept.result.departments || []).every((d) => typeof d.department === 'string' && d.department.length > 0), 'mọi department bucket có tên hợp lệ (kể cả "(Chưa xác định)")', dept.result.departments);

  // =========================================================================
  // PART 5 — REPORT_DRILLDOWN — dimension-filtered drilldown khớp đúng bucket
  // KPI của TỪNG nhóm (Person/Department/Category) — cùng invariant KPI<->
  // drilldown đã chứng minh ở V2-R1, nay mở rộng cho 3 chiều mới.
  // =========================================================================
  console.log('\n[5] REPORT_DRILLDOWN — dimension filter khớp đúng KPI của từng nhóm');
  if (person.result.people.length) {
    const top = person.result.people[0]; // workload cao nhất
    const dd = await api(cookies.ADMIN, { action: 'listTaskOverviewV2Drilldown', metric_id: 'workload', employee_code: top.employee_code, limit: 100, offset: 0, period: period() });
    ok(dd.ok && dd.result.total_count === top.workload, 'drilldown(workload, employee_code=' + top.employee_code + ').total_count === person.workload=' + top.workload, dd.result && dd.result.total_count);
    ok((dd.result.tasks || []).every((t) => t.primary_employee_code === top.employee_code), 'mọi task trong drilldown đều có primary_employee_code khớp filter', dd.result.tasks && dd.result.tasks[0]);
  } else {
    console.log('  (Không có người nào trong Person analysis — bỏ qua assert cụ thể, population rỗng cho ADMIN là bất thường nhưng không phải lỗi test này.)');
  }
  if (dept.result.departments.length) {
    const topDept = dept.result.departments[0];
    const dd = await api(cookies.ADMIN, { action: 'listTaskOverviewV2Drilldown', metric_id: 'workload', department: topDept.department, limit: 100, offset: 0, period: period() });
    ok(dd.ok && dd.result.total_count === topDept.workload, 'drilldown(workload, department=' + topDept.department + ').total_count === dept.workload=' + topDept.workload, dd.result && dd.result.total_count);
  }
  if (cat.result.categories.length) {
    const topCat = cat.result.categories[0];
    const dd = await api(cookies.ADMIN, { action: 'listTaskOverviewV2Drilldown', metric_id: 'workload', category_code: topCat.category_code, limit: 100, offset: 0, period: period() });
    ok(dd.ok && dd.result.total_count === topCat.workload, 'drilldown(workload, category_code=' + topCat.category_code + ').total_count === category.workload=' + topCat.workload, dd.result && dd.result.total_count);
  }

  // =========================================================================
  // PART 6 — PERMISSION_CONTRACT_V1 / RECEIVED_RELATIONSHIP_ONLY across đủ 4
  // action mới — population theo đúng effective_scope (managed cho company-
  // tier/TBP, self cho NV) — TBP <= GĐ, NV <= TBP, giống hệt bất đẳng thức đã
  // chứng minh ở V2-R1 cho Overview, nay re-verify cho Person analysis.
  // =========================================================================
  console.log('\n[6] Permission — Person analysis workload theo đúng scope actorType');
  const [personGd, personTbp, personNv] = await Promise.all([
    api(cookies.GD, { action: 'getTaskReportV2PersonAnalysis', period: period() }),
    api(cookies.TBP, { action: 'getTaskReportV2PersonAnalysis', period: period() }),
    api(cookies.NV, { action: 'getTaskReportV2PersonAnalysis', period: period() }),
  ]);
  const sumWorkload = (r) => (r.result.people || []).reduce((a, p) => a + p.workload, 0);
  ok(personGd.result.effective_scope === 'managed', 'GD effective_scope=managed (Person analysis)', personGd.result.effective_scope);
  ok(personTbp.result.effective_scope === 'managed', 'TBP effective_scope=managed (Person analysis)', personTbp.result.effective_scope);
  ok(personNv.result.effective_scope === 'self', 'NV effective_scope=self (Person analysis)', personNv.result.effective_scope);
  ok(sumWorkload(personTbp) <= sumWorkload(personGd), 'TBP tổng workload <= GD (managed-graph bounded, không company-wide leak)', { tbp: sumWorkload(personTbp), gd: sumWorkload(personGd) });
  ok(sumWorkload(personNv) <= sumWorkload(personTbp), 'NV tổng workload <= TBP (self-only bounded)', { nv: sumWorkload(personNv), tbp: sumWorkload(personTbp) });
  ok(personNv.result.people.every((p) => p.employee_code === PERSONAS.NV.code), 'NV Person analysis chỉ chứa chính NV (self-only, không leak sang employee khác)', personNv.result.people);

  // =========================================================================
  // PART 7 — PERIOD_TIMEZONE_BOUNDARY — resolvePeriodWindow (pure, in-process,
  // không qua HTTP) đúng nửa-mở [start, endExclusive) theo ICT UTC+7.
  // =========================================================================
  console.log('\n[7] PERIOD_TIMEZONE_BOUNDARY — pure unit check (in-process)');
  const engine = require('../api/_lib/task-reporting-v2');
  const dayWindow = engine.resolvePeriodWindow('day', '2026-08-15');
  assert.strictEqual(dayWindow.start, '2026-08-14T17:00:00.000Z', 'day 2026-08-15 ICT start = 2026-08-14T17:00:00Z (UTC+7)'); PASS++;
  assert.strictEqual(dayWindow.endExclusive, '2026-08-15T17:00:00.000Z', 'day 2026-08-15 ICT end = 2026-08-15T17:00:00Z'); PASS++;
  console.log('  PASS  day window ICT boundary đúng UTC+7 (start=' + dayWindow.start + ', end=' + dayWindow.endExclusive + ')');
  const monthWindow = engine.resolvePeriodWindow('month', '2026-08-15');
  assert.strictEqual(monthWindow.start, '2026-07-31T17:00:00.000Z', 'month 08/2026 ICT start = 2026-07-31T17:00:00Z'); PASS++;
  assert.strictEqual(monthWindow.endExclusive, '2026-08-31T17:00:00.000Z', 'month 08/2026 ICT end = 2026-08-31T17:00:00Z (01/09 ICT midnight)'); PASS++;
  console.log('  PASS  month window ICT boundary đúng UTC+7 (start=' + monthWindow.start + ', end=' + monthWindow.endExclusive + ')');
  const invalidAnchor = engine.resolvePeriodWindow('month', 'not-a-date');
  ok(invalidAnchor.start === engine.resolvePeriodWindow('month', new Date().toISOString().slice(0, 10)).start, 'anchor_date không hợp lệ -> fallback về hôm nay (không throw, không NaN)', invalidAnchor);

  // =========================================================================
  // PART 8 — empty/zero cases — NV (population nhỏ nhất, nhiều khả năng rỗng
  // ở vài chiều) không lỗi 500, luôn trả mảng rỗng hợp lệ chứ không throw.
  // =========================================================================
  console.log('\n[8] Empty/zero cases');
  const [deptNv, catNv, trendNv] = await Promise.all([
    api(cookies.NV, { action: 'getTaskReportV2DepartmentAnalysis', period: period() }),
    api(cookies.NV, { action: 'getTaskReportV2CategoryAnalysis', period: period() }),
    api(cookies.NV, { action: 'getTaskReportV2Trend', period: { type: 'year', anchor_date: '2020-01-01' } }),
  ]);
  ok(deptNv.ok && Array.isArray(deptNv.result.departments), 'NV department analysis 200, mảng hợp lệ (có thể rỗng)', deptNv.result);
  ok(catNv.ok && Array.isArray(catNv.result.categories), 'NV category analysis 200, mảng hợp lệ (có thể rỗng)', catNv.result);
  ok(trendNv.ok && trendNv.result.trend_supported === true && Array.isArray(trendNv.result.buckets), 'NV trend năm 2020 (chắc chắn rỗng) — vẫn 200, buckets toàn 0, không lỗi', trendNv.result);
  if (trendNv.ok) ok(trendNv.result.buckets.every((b) => b.created_in_period === 0 && b.completed_in_period === 0), 'buckets năm 2020 toàn 0 (đúng vì population thật không có dữ liệu 2020)', trendNv.result.buckets.slice(0, 2));
  const emptyDrill = await api(cookies.NV, { action: 'listTaskOverviewV2Drilldown', metric_id: 'workload', category_code: 'KHONG_TON_TAI_XYZ', limit: 20, offset: 0, period: period() });
  ok(emptyDrill.ok && emptyDrill.result.total_count === 0 && emptyDrill.result.tasks.length === 0 && emptyDrill.result.has_more === false, 'drilldown với category_code không tồn tại -> total_count=0, has_more=false (không lỗi)', emptyDrill.result);
  const onTimeRateNv = deptNv.ok ? null : null;
  ok(!Number.isNaN(overview.result.metrics.on_time_rate.value) , 'on_time_rate không NaN kể cả khi mẫu số nhỏ', overview.result.metrics.on_time_rate);

  console.log('\nPHF Task Report V2 Foundation: ' + PASS + '/' + (PASS + FAIL) + ' PASS');
  if (FAIL > 0) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error('SCRIPT ERROR:', e); process.exit(1); });
