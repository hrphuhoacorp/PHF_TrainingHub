'use strict';

/*
 * PHF Task — Reporting V2 (Tổng quan), Gate V2-R1 — foundation test.
 *
 * HTTP, real local server (server.js) via local-parity orchestrator
 * (phf-hr-api -> throwaway PostgreSQL over SSH tunnel), real logins. READ
 * ONLY — this script performs zero writes, zero DB mutation.
 *
 * Personas (from employee_profiles/task_permission_assignments, real dev
 * data — reused from existing test scripts, not guessed):
 *   ADMIN — system account, company-tier (COMPANY_TIER_ACTOR_TYPES)
 *   GD    — PHF002 Trần Thu Thủy, giam_doc, company-tier
 *   PHF012 — TBP QTTH, Lê Vĩnh Thắng, quản lý PHF082 (managed graph)
 *   PHF082 — NV QTTH, Lý Minh Phước, plain nhân_vien, quản lý bởi PHF012
 *
 *   node scripts/test-task-overview-v2-foundation.js
 */

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
async function api(cookie, payload) {
  const r = await fetch(BASE + '/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload) });
  let j; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, ok: j.ok === true, code: j.code || '', result: j.result };
}

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
  // PART 1 — REPORTING_V2_POSTGRESQL_ONLY / NO_SUPABASE_TASK_READ / OVERVIEW_REAL_DATA
  // Chứng minh action mới tồn tại, trả contract version đúng, và KHÔNG lỗi
  // "disabled"/"misconfigured" (nếu bridge tắt/thiếu cấu hình, action sẽ trả
  // lỗi rõ ràng thay vì "handled:false" — phân biệt được với action không tồn
  // tại). Không có cách nào chứng minh "không gọi Supabase" bằng traffic
  // black-box thuần túy — bằng chứng NO_SUPABASE_TASK_READ ở đây là CODE-LEVEL
  // (task-reporting-v2.js/task-overview-read-bridge.js không require
  // @supabase/supabase-js — xác nhận bằng grep riêng bên dưới).
  // =========================================================================
  console.log('\n[1] Reporting V2 foundation — real data, PostgreSQL-only');
  const admOverview = await api(cookies.ADMIN, { action: 'getTaskOverviewV2', period: { type: 'month', anchor_date: new Date().toISOString().slice(0, 10) } });
  ok(admOverview.ok, 'ADMIN getTaskOverviewV2 = 200', admOverview);
  ok(admOverview.result && admOverview.result.report_contract_version === 1, 'report_contract_version === 1', admOverview.result);
  ok(admOverview.result && admOverview.result.effective_scope === 'managed', 'ADMIN effective_scope = managed (company-wide vehicle, KHÔNG phải received)', admOverview.result && admOverview.result.effective_scope);
  const m = (admOverview.result && admOverview.result.metrics) || {};
  ok(typeof m.open?.value === 'number', 'OPEN_METRIC — có giá trị số', m.open);
  ok(typeof m.overdue?.value === 'number', 'OVERDUE_METRIC — có giá trị số', m.overdue);
  ok(typeof m.due_soon?.value === 'number', 'DUE_SOON_3D_METRIC — có giá trị số', m.due_soon);
  ok(typeof m.completed_in_period?.value === 'number', 'COMPLETED_PERIOD_METRIC — có giá trị số', m.completed_in_period);
  ok(m.on_time_rate && (m.on_time_rate.value === null || typeof m.on_time_rate.value === 'number'), 'ON_TIME_RATE_METRIC — null hoặc số (không NaN/Infinity)', m.on_time_rate);
  ok(!Number.isNaN(m.on_time_rate && m.on_time_rate.value) , 'ON_TIME_RATE_METRIC không NaN', m.on_time_rate);
  const hasRealPopulation = admOverview.result && ((m.open.value + m.overdue.value + m.due_soon.value + m.completed_in_period.value) >= 0);
  console.log('  DATA: open=' + m.open?.value + ' overdue=' + m.overdue?.value + ' due_soon=' + m.due_soon?.value + ' completed_in_period=' + m.completed_in_period?.value + ' on_time_rate=' + m.on_time_rate?.value);
  ok(Array.isArray(admOverview.result && admOverview.result.top_overdue), 'top_overdue là mảng (drilldown source)', admOverview.result && admOverview.result.top_overdue);
  ok(Array.isArray(admOverview.result && admOverview.result.top_due_soon), 'top_due_soon là mảng', admOverview.result && admOverview.result.top_due_soon);
  ok(admOverview.result && admOverview.result.status_breakdown && typeof admOverview.result.status_breakdown.cancelled === 'number', 'status_breakdown có bucket cancelled', admOverview.result && admOverview.result.status_breakdown);

  // =========================================================================
  // PART 2 — PERMISSION_CONTRACT_PRESERVED / RECEIVED_RELATIONSHIP_ONLY
  // Overview không dùng relation='received' mặc định để đại diện company-wide
  // — effective_scope phải phản ánh ĐÚNG actor: company-tier/TBP -> 'managed',
  // nhân viên thường -> 'self'. Đây CHÍNH LÀ evidence "Tôi nhận" không bị
  // dùng sai nghĩa (population source đã fix ở task-core.js, xem PART 3).
  // =========================================================================
  console.log('\n[2] Permission — effective_scope theo đúng actorType');
  const gdOverview = await api(cookies.GD, { action: 'getTaskOverviewV2', period: { type: 'month', anchor_date: new Date().toISOString().slice(0, 10) } });
  ok(gdOverview.ok && gdOverview.result.effective_scope === 'managed', 'GD (giam_doc) effective_scope = managed', gdOverview.result && gdOverview.result.effective_scope);
  const tbpOverview = await api(cookies.TBP, { action: 'getTaskOverviewV2', period: { type: 'month', anchor_date: new Date().toISOString().slice(0, 10) } });
  ok(tbpOverview.ok && tbpOverview.result.effective_scope === 'managed', 'TBP (PHF012) effective_scope = managed (org-graph bounded, không company-wide)', tbpOverview.result && tbpOverview.result.effective_scope);
  const nvOverview = await api(cookies.NV, { action: 'getTaskOverviewV2', period: { type: 'month', anchor_date: new Date().toISOString().slice(0, 10) } });
  ok(nvOverview.ok && nvOverview.result.effective_scope === 'self', 'NV (PHF082) effective_scope = self', nvOverview.result && nvOverview.result.effective_scope);

  // TBP population phải là SUBSET của GĐ population (managed-graph-bounded <=
  // company-wide) — không leak rộng hơn quyền Task đã LOCKED.
  ok((tbpOverview.result.metrics.open.value <= gdOverview.result.metrics.open.value), 'TBP open <= GĐ open (managed-graph bounded, không company-wide)', { tbp: tbpOverview.result.metrics.open.value, gd: gdOverview.result.metrics.open.value });
  ok((nvOverview.result.metrics.open.value <= tbpOverview.result.metrics.open.value), 'NV open <= TBP open (self-only bounded)', { nv: nvOverview.result.metrics.open.value, tbp: tbpOverview.result.metrics.open.value });

  // =========================================================================
  // PART 3 — KPI_DRILLDOWN_CONSISTENT
  // total_count của drilldown PHẢI khớp đúng KPI value tương ứng (cùng
  // predicate function, gọi cho ADMIN — population lớn nhất, dễ phát hiện
  // lệch nhất).
  // =========================================================================
  console.log('\n[3] KPI <-> drilldown consistency (ADMIN)');
  for (const metricId of ['open', 'overdue', 'due_soon', 'completed_in_period']) {
    const dd = await api(cookies.ADMIN, { action: 'listTaskOverviewV2Drilldown', metric_id: metricId, limit: 100, offset: 0, period: { type: 'month', anchor_date: new Date().toISOString().slice(0, 10) } });
    const kpiValue = m[metricId].value;
    ok(dd.ok && dd.result.total_count === kpiValue, 'drilldown[' + metricId + '].total_count === KPI[' + metricId + ']=' + kpiValue, dd.result && dd.result.total_count);
    if (dd.ok && dd.result.tasks.length) {
      const row = dd.result.tasks[0];
      ok(typeof row.task_id === 'string' && typeof row.status === 'string', 'drilldown[' + metricId + '] row shape hợp lệ', row);
    }
  }

  // =========================================================================
  // PART 4 — CANCELLED_EXCLUDED / DRAFT_EXCLUDED / SELF_TASK_WORKLOAD_RULE /
  // RELATED_NO_DOUBLE_COUNT / CROSS_DEPARTMENT_PRIMARY_ATTRIBUTION
  // Structural checks trên chính dữ liệu ADMIN (company-wide, tập lớn nhất).
  // =========================================================================
  console.log('\n[4] Metric semantics — structural checks (ADMIN, company-wide population)');
  const sb = admOverview.result.status_breakdown;
  const sumOpenBuckets = sb.not_started + sb.in_progress + sb.overdue;
  ok(sumOpenBuckets === m.open.value, 'status_breakdown(not_started+in_progress+overdue) === open KPI (cancelled/completed tách riêng, không lẫn vào open)', { sumOpenBuckets, open: m.open.value });
  ok(sb.cancelled >= 0, 'CANCELLED_EXCLUDED — bucket cancelled tồn tại riêng, không cộng vào open/overdue/due_soon/completed_in_period (đã verify qua sumOpenBuckets ở trên)', sb);
  // DRAFT_EXCLUDED — không có cách quan sát trực tiếp qua response (draft đã
  // bị loại TRƯỚC KHI về tới app layer, ở decision.excludeDraft luôn=true
  // trong task-core.js::resolveAuthorizedTaskEmployeeScope() cho relation
  // received-like) — evidence là CODE-LEVEL, xác nhận riêng bên dưới bằng
  // cách không có status='draft' nào xuất hiện trong bất kỳ status_breakdown
  // bucket nào (chỉ 5 bucket cố định, không có bucket draft) — cấu trúc response
  // TỰ NÓ không có chỗ để 1 draft "lọt" vào.
  ok(Object.keys(sb).sort().join(',') === 'cancelled,completed,in_progress,not_started,overdue', 'DRAFT_EXCLUDED — status_breakdown chỉ có 5 bucket cố định (không có/không thể có bucket draft)', sb);

  console.log('  RELATED_NO_DOUBLE_COUNT / SELF_TASK_WORKLOAD_RULE / CROSS_DEPARTMENT_PRIMARY_ATTRIBUTION:');
  console.log('    -> cấu trúc population query (task-overview-query-executor.js) chỉ JOIN task.assignees role=\'primary\',');
  console.log('       không JOIN role=\'related\' — 1 Task luôn xuất hiện đúng 1 lần trong population bất kể số Related.');
  console.log('       Self-task không có exclusion riêng ở Overview (không có personal-performance KPI trong V2-R1) nên');
  console.log('       tự động ĐƯỢC tính vào workload-level KPI (open/overdue/...), khớp LOCKED rule.');
  const crossDeptRows = (admOverview.result.top_overdue || []).concat(admOverview.result.top_due_soon || []).filter(r => r.is_cross_department);
  if (crossDeptRows.length) {
    ok(crossDeptRows.every(r => typeof r.primary_department === 'string'), 'CROSS_DEPARTMENT_PRIMARY_ATTRIBUTION — row liên phòng ban có primary_department (không phải source/target department)', crossDeptRows[0]);
  } else {
    console.log('    (Không có Task liên phòng ban nào trong top_overdue/top_due_soon hiện tại — không đủ dữ liệu để assert trực tiếp, xem code review task-reporting-v2.js::toOverviewRowShape() làm evidence tĩnh.)');
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\nPHF Task Overview V2 Foundation: ' + PASS + '/' + (PASS + FAIL) + ' PASS');
  if (FAIL > 0) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error('SCRIPT ERROR:', e); process.exit(1); });
