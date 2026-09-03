'use strict';

/*
 * PHF Task — MAIL V1 Increment 2 — Weekly Report + Admin Mail Settings.
 * Offline: no DB, no network, no Brevo, no BREVO_API_KEY.
 *
 * Covers: period math (Mon/Sun ICT + year boundary + prev week), deterministic
 * report content (KPI + deltas + overdue>7 + department aggregation + top-task
 * ranking + next-7-days + not-supported omission + zero tasks + long titles +
 * HTML escaping + single CTA), settings CRUD (default OFF / normalized unique
 * email / enable-disable / remove / schema-missing), weekly idempotency
 * (dedupe key + ON CONFLICT + intra-batch dedup + disabled/flag-off inert),
 * and the static wiring (cron route + secret, vercel.json, data.js actions).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SVC = path.join(ROOT, 'services', 'phf-hr-api', 'lib');
const API = path.join(ROOT, 'api', '_lib');

let passed = 0;
function pass(c, m) { assert.ok(c, m); passed += 1; console.log('  PASS  ' + m); }
function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); }

// ---- inject a fake phf-hr-api db BEFORE requiring the settings/outbox libs ----
const DB_PATH = require.resolve(path.join(SVC, 'db.js'));
let FAKE_DB = null;
require.cache[DB_PATH] = {
  id: DB_PATH, filename: DB_PATH, loaded: true, exports: {
    withTaskReadTransaction: async (_c, fn) => fn(FAKE_DB.client()),
    withTaskWriteTransaction: async (_c, fn) => fn(FAKE_DB.client()),
  },
};

function makeFakeDb(opts) {
  const o = opts || {};
  const store = { settings: { weekly_report_enabled: false }, recipients: [], outbox: [] };
  const client = () => ({
    async query(sql, params) {
      const s = String(sql);
      if (/information_schema\.tables/.test(s)) return { rows: [{ n: o.noSchema ? 0 : 1 }] };
      if (/SELECT weekly_report_enabled/.test(s)) return { rows: [{ weekly_report_enabled: store.settings.weekly_report_enabled, updated_at: null }] };
      if (/UPDATE task\.mail_settings/.test(s)) { store.settings.weekly_report_enabled = params[0]; return { rowCount: 1 }; }
      if (/SELECT id, email, label, is_enabled, created_at FROM task\.mail_recipients/.test(s) || /SELECT email, label FROM task\.mail_recipients/.test(s)) {
        return { rows: store.recipients.filter((r) => (/is_enabled = true/.test(s) ? r.is_enabled : true)).map((r, i) => ({ ...r, created_at: i })) };
      }
      if (/INSERT INTO task\.mail_recipients/.test(s)) {
        const email = params[0];
        const existing = store.recipients.find((r) => r.email === email);
        if (existing) { existing.is_enabled = true; existing.label = params[1] || existing.label; return { rowCount: 1, rows: [existing] }; }
        const row = { id: 'r' + (store.recipients.length + 1), email, label: params[1] || null, is_enabled: true };
        store.recipients.push(row); return { rowCount: 1, rows: [row] };
      }
      if (/UPDATE task\.mail_recipients SET is_enabled/.test(s)) {
        const row = store.recipients.find((r) => r.id === params[0]);
        if (!row) return { rowCount: 0, rows: [] };
        row.is_enabled = params[1]; return { rowCount: 1, rows: [row] };
      }
      if (/DELETE FROM task\.mail_recipients/.test(s)) {
        const i = store.recipients.findIndex((r) => r.id === params[0]);
        if (i < 0) return { rowCount: 0, rows: [] };
        const [row] = store.recipients.splice(i, 1); return { rowCount: 1, rows: [row] };
      }
      if (/INSERT INTO task\.mail_outbox/.test(s)) {
        const dedupe = params[1];
        if (store.outbox.some((x) => x.dedupe_key === dedupe)) return { rowCount: 0, rows: [] };
        store.outbox.push({ dedupe_key: dedupe, payload: params[0] });
        return { rowCount: 1, rows: [{ id: 'o' + store.outbox.length }] };
      }
      return { rows: [], rowCount: 0 };
    },
  });
  return { client, store };
}

const settings = require(path.join(SVC, 'task-mail-settings'));
const outbox = require(path.join(SVC, 'task-mail-outbox'));
const weekly = require(path.join(API, 'task-weekly-report'));

(async function run() {
  // =====================================================================
  // A. PERIOD MATH
  // =====================================================================
  {
    // Wednesday 16/09/2026 12:00 ICT -> report week Mon 07/09 .. Sun 13/09
    const now = Date.UTC(2026, 8, 16, 5, 0, 0); // 12:00 ICT
    const p = weekly.computeWeeklyPeriod(now);
    pass(p.label === '07/09/2026 - 13/09/2026', 'period: previous Mon–Sun in Asia/Ho_Chi_Minh (' + p.label + ')');
    pass(p.startKey === '2026-09-07', 'period: startKey = previous Monday date');
    pass(p.prev.label === '31/08/2026 - 06/09/2026', 'period: previous-week comparison window (' + p.prev.label + ')');
  }
  {
    // Monday 04/01/2027 09:00 ICT -> report week Mon 28/12/2026 .. Sun 03/01/2027 (year boundary)
    const now = Date.UTC(2027, 0, 4, 2, 0, 0);
    const p = weekly.computeWeeklyPeriod(now);
    pass(p.label === '28/12/2026 - 03/01/2027', 'period: year/month boundary handled (' + p.label + ')');
    pass(p.startKey === '2026-12-28', 'period: year-boundary startKey');
  }
  {
    // Sunday 06/09/2026 23:30 ICT still belongs to the week whose report covers 24/08..30/08
    const now = Date.UTC(2026, 8, 6, 16, 30, 0);
    const p = weekly.computeWeeklyPeriod(now);
    pass(p.label === '24/08/2026 - 30/08/2026', 'period: Sunday-evening anchor resolves to the right week');
  }

  // =====================================================================
  // B. REPORT CONTENT (deterministic)
  // =====================================================================
  const nowMs = Date.UTC(2026, 8, 14, 3, 0, 0); // Mon 14/09 10:00 ICT -> week 07/09..13/09
  const iso = (y, mo, d, h) => new Date(Date.UTC(y, mo, d, (h || 0) - 7)).toISOString();
  const org = new Map([
    ['S1', { department: 'Bán hàng' }], ['S2', { department: 'Bán hàng' }],
    ['K1', { department: 'Kho' }], ['H1', { department: 'HCNS' }],
  ]);
  const T = (o) => Object.assign({
    task_id: 'x', task_code: 'CV-X', title: 'Việc', status: 'in_progress', primary_employee_code: 'S1',
    deadline: null, completed_at: null, on_time: null,
    created_at: iso(2026, 6, 1, 9), published_at: iso(2026, 6, 1, 9), last_progress_at: iso(2026, 8, 12, 9),
  }, o);
  const tasks = [
    T({ task_code: 'C1', status: 'completed', completed_at: iso(2026, 8, 9, 12), deadline: iso(2026, 8, 10, 17), on_time: true, primary_employee_code: 'K1' }),   // completed on-time in window
    T({ task_code: 'C2', status: 'completed', completed_at: iso(2026, 8, 12, 12), deadline: iso(2026, 8, 8, 17), on_time: false, primary_employee_code: 'H1' }),  // completed LATE in window
    T({ task_code: 'C3', status: 'completed', completed_at: iso(2026, 8, 2, 12), deadline: iso(2026, 8, 2, 17), on_time: true, primary_employee_code: 'S1' }),    // completed BEFORE window
    T({ task_code: 'O1', status: 'in_progress', deadline: iso(2026, 8, 1, 17), last_progress_at: iso(2026, 7, 20, 9), primary_employee_code: 'S1' }),            // overdue >7d, carried, stale
    T({ task_code: 'O2', status: 'in_progress', deadline: iso(2026, 8, 12, 17), last_progress_at: iso(2026, 8, 13, 9), primary_employee_code: 'S2' }),           // overdue ~2d, fresh
    T({ task_code: 'O3', status: 'in_progress', deadline: iso(2026, 8, 5, 17), last_progress_at: null, primary_employee_code: 'K1' }),                            // overdue >7d, carried, no activity
    T({ task_code: 'D1', status: 'in_progress', deadline: iso(2026, 8, 18, 17), last_progress_at: iso(2026, 7, 30, 9), primary_employee_code: 'S1' }),           // due in 4d, stale
    T({ task_code: 'D2', status: 'in_progress', deadline: iso(2026, 8, 20, 17), last_progress_at: iso(2026, 8, 13, 9), primary_employee_code: 'S2' }),           // due in 6d, fresh
    T({ task_code: 'X1', status: 'cancelled', deadline: iso(2026, 8, 3, 17), primary_employee_code: 'K1' }),                                                     // cancelled -> not open
    T({ task_code: 'A1', status: 'in_progress', created_at: iso(2026, 8, 10, 9), published_at: iso(2026, 8, 10, 9), deadline: iso(2026, 9, 30, 17), last_progress_at: iso(2026, 8, 11, 9), primary_employee_code: 'H1' }), // created in window
  ];
  const d = weekly.buildWeeklyReportData(tasks, org, nowMs);

  pass(d.kpi.completed.value === 2 && d.kpi.completed.comparable === true, 'KPI: completed-in-window = 2 (C1, C2)');
  pass(d.kpi.completedLate.value === 1, 'KPI: completed-late-in-window = 1 (C2)');
  pass(d.kpi.overdue.value === 3 && d.kpi.overdue.comparable === false, 'KPI: overdue-now = 3 (O1,O2,O3), current snapshot, no delta');
  pass(d.kpi.inProgress.comparable === false, 'KPI: "đang thực hiện" is current snapshot, no week-over-week delta');
  pass(/^(▲ \d+|▼ \d+|—)$/.test(d.kpi.activity.delta.text) && ['up', 'down', 'flat'].includes(d.kpi.activity.delta.dir),
    'KPI: comparable KPIs carry a deterministic {text: ▲/▼/—, dir} delta');
  pass(d.kpi.inProgress.delta === null && d.kpi.overdue.delta === null, 'KPI: no fabricated delta for "Đang thực hiện" / "Quá hạn"');

  const sigJoined = d.attention.join(' || ');
  pass(d.attention.length >= 1 && d.attention.length <= 5, 'attention: 1–5 deterministic signals');
  pass(/Hiện có 3 công việc đang quá hạn/.test(sigJoined), 'attention: overdue-now count signal');
  pass(/quá hạn trên 7 ngày/.test(sigJoined), 'attention: overdue > 7 days signal (O1, O3)');
  pass(/Bộ phận nhiều việc quá hạn nhất/.test(sigJoined), 'attention: top overdue department signal');
  pass(/quá hạn từ trước đầu tuần báo cáo/.test(sigJoined), 'attention: overdue carried from before the report week');

  pass(d.topTasks.length >= 1 && d.topTasks.length <= 5, 'top tasks: 3–5 max');
  pass(d.topTasks[0].task_code === 'O3' || d.topTasks[0].task_code === 'O1', 'top tasks: most-overdue first (O1/O3, longest overdue)');
  pass(/Quá hạn \d+ ngày/.test(d.topTasks[0].reason), 'top tasks: reason string "Quá hạn N ngày"');
  const staleTop = d.topTasks.find((t) => /Tiến độ chưa cập nhật \d+ ngày/.test(t.reason));
  pass(!!staleTop, 'top tasks: stale wording is "Tiến độ chưa cập nhật N ngày"');
  pass(!d.topTasks.some((t) => /\d+ ngày chưa cập nhật/.test(t.reason)), 'top tasks: old wording "N ngày chưa cập nhật" is gone');

  const deptCodes = d.departments.map((r) => r.department);
  pass(deptCodes.length >= 2 && deptCodes.every((x) => ['Bán hàng', 'Kho', 'HCNS'].includes(x)),
    'departments: aggregated by Primary\'s org department');
  const kho = d.departments.find((r) => r.department === 'Kho');
  pass(kho && kho.overdue === 1 && kho.completed === 1, 'departments: per-dept overdue + completed-in-window counts');
  pass(d.departments[0].overdue >= d.departments[d.departments.length - 1].overdue, 'departments: sorted by overdue desc');

  pass(d.nextWeek.length >= 1 && d.nextWeek.length <= 5 && /đến hạn trong 7 ngày tới/.test(d.nextWeek.join(' ')),
    'next week: deterministic "due in next 7 days" line');
  pass(Array.isArray(d.notSupported) && d.notSupported.length >= 1, 'not-supported: signals that cannot be computed are listed, not invented');

  // zero tasks
  const dz = weekly.buildWeeklyReportData([], org, nowMs);
  const rz = weekly.renderWeeklyReport(dz);
  pass(rz.subject.startsWith('Báo cáo công việc tuần ') && /<table/.test(rz.html), 'render: zero tasks still produces a valid report');
  pass(dz.kpi.completed.value === 0 && dz.topTasks.length === 0, 'render: zero tasks -> all counts 0, no top tasks');

  // long Vietnamese title + HTML escaping + single CTA
  const dl = weekly.buildWeeklyReportData([
    T({ task_code: 'L1', status: 'in_progress', deadline: iso(2026, 8, 1, 17),
      title: '<script>x</script> Rà soát & đối chiếu ' + 'công việc '.repeat(60) + 'trước 17:00', primary_employee_code: 'S1' }),
  ], org, nowMs);
  const rl = weekly.renderWeeklyReport(dl);
  pass(!/<script>x<\/script>/.test(rl.html) && rl.html.includes('&lt;script&gt;x&lt;/script&gt;'), 'render: HTML-escapes dynamic task titles');
  pass(rl.html.includes('&amp;') , 'render: escapes & in titles');
  pass((rl.html.match(/MỞ PHF TASK/g) || []).length === 1, 'render: exactly ONE primary CTA "MỞ PHF TASK — XEM BÁO CÁO CHI TIẾT"');
  pass(rl.html.includes('MỞ PHF TASK — XEM BÁO CÁO CHI TIẾT') && /href="https:\/\//.test(rl.html), 'render: CTA is the approved label with an absolute URL');
  pass(rl.html.includes('Email được gửi tự động từ hệ thống PHF Task.'), 'render: approved footer');
  pass(!/<script|onclick=|<svg|fonts\.googleapis|<link/i.test(rl.html), 'render: no JS / SVG / remote fonts');
  pass(rl.subject === 'Báo cáo công việc tuần ' + dl.period.label, 'render: subject = "Báo cáo công việc tuần <DD/MM/YYYY> - <DD/MM/YYYY>"');

  // ---- B2. SELF-TASK: NOT excluded + no KPI subline ------------------------
  pass(!/Trong đó:\s*\d+ việc tự giao/.test(weekly.renderWeeklyReport(d).html),
    'self-task: KPI "Công việc có hoạt động" has NO "Trong đó: X việc tự giao" subline');
  {
    const pOrg = new Map([['P1', { department: 'Bán hàng', fullName: 'Phan Văn Tự' }], ['P2', { department: 'Kho' }]]);
    const pTasks = [
      // P1: self-task that is overdue + a self-task completed LATE this week -> must appear in attention & workload
      T({ task_code: 'SLF-OD', status: 'in_progress', deadline: iso(2026, 8, 1, 17), last_progress_at: iso(2026, 7, 10, 9), primary_employee_code: 'P1', source_of_work: 'self_assigned' }),
      T({ task_code: 'SLF-LATE', status: 'completed', completed_at: iso(2026, 8, 10, 12), deadline: iso(2026, 8, 6, 17), on_time: false, primary_employee_code: 'P1', source_of_work: 'self_assigned' }),
      T({ task_code: 'AB-OD', status: 'in_progress', deadline: iso(2026, 8, 8, 17), last_progress_at: iso(2026, 8, 9, 9), primary_employee_code: 'P2', source_of_work: 'assigned_by_other' }),
    ];
    const dp = weekly.buildWeeklyReportData(pTasks, pOrg, nowMs);
    const p1a = dp.attentionPeople.find((x) => x.employee_code === 'P1');
    pass(p1a && p1a.overdue === 1 && p1a.late === 1 && p1a.total === 2, 'self-task: a self_assigned task still counts in overdue + completed-late attention');
    const p1w = dp.workloadPeople.find((x) => x.employee_code === 'P1');
    pass(p1w && p1w.source.self_assigned === 1, 'self-task: still counted in workload + shown as its own source, not hidden');
  }

  // ---- B2b. NHÂN SỰ CẦN CHÚ Ý — deterministic top 3 -----------------------
  const atOrg = new Map([['A', {}], ['B', {}], ['C', {}], ['D', {}], ['E', {}]]);
  const atTasks = [
    // A: 3 overdue + 1 late-in-week = total 4
    T({ task_code: 'A-1', status: 'in_progress', deadline: iso(2026, 8, 1, 17), primary_employee_code: 'A' }),
    T({ task_code: 'A-2', status: 'in_progress', deadline: iso(2026, 8, 2, 17), primary_employee_code: 'A' }),
    T({ task_code: 'A-3', status: 'in_progress', deadline: iso(2026, 8, 3, 17), primary_employee_code: 'A' }),
    T({ task_code: 'A-4', status: 'completed', completed_at: iso(2026, 8, 10, 9), deadline: iso(2026, 8, 6, 17), on_time: false, primary_employee_code: 'A' }),
    // B: 2 overdue + 2 late = total 4  (tie with A on total; A wins on overdue count)
    T({ task_code: 'B-1', status: 'in_progress', deadline: iso(2026, 8, 5, 17), primary_employee_code: 'B' }),
    T({ task_code: 'B-2', status: 'in_progress', deadline: iso(2026, 8, 6, 17), primary_employee_code: 'B' }),
    T({ task_code: 'B-3', status: 'completed', completed_at: iso(2026, 8, 9, 9), deadline: iso(2026, 8, 4, 17), on_time: false, primary_employee_code: 'B' }),
    T({ task_code: 'B-4', status: 'completed', completed_at: iso(2026, 8, 11, 9), deadline: iso(2026, 8, 4, 17), on_time: false, primary_employee_code: 'B' }),
    // C: 2 overdue only = total 2
    T({ task_code: 'C-1', status: 'in_progress', deadline: iso(2026, 8, 7, 17), primary_employee_code: 'C' }),
    T({ task_code: 'C-2', status: 'in_progress', deadline: iso(2026, 8, 8, 17), primary_employee_code: 'C' }),
    // D: 1 late-in-week only = total 1
    T({ task_code: 'D-1', status: 'completed', completed_at: iso(2026, 8, 12, 9), deadline: iso(2026, 8, 6, 17), on_time: false, primary_employee_code: 'D' }),
    // E: completed ON TIME + a historical late OUTSIDE the report week -> total 0, must NOT appear
    T({ task_code: 'E-1', status: 'completed', completed_at: iso(2026, 8, 10, 9), deadline: iso(2026, 8, 12, 17), on_time: true, primary_employee_code: 'E' }),
    T({ task_code: 'E-2', status: 'completed', completed_at: iso(2026, 7, 15, 9), deadline: iso(2026, 7, 10, 17), on_time: false, primary_employee_code: 'E' }),
  ];
  const dat = weekly.buildWeeklyReportData(atTasks, atOrg, nowMs);
  pass(dat.attentionPeople.length === 3, 'attention people: top 3 (A,B,C — D drops off, E excluded)');
  pass(dat.attentionPeople.map((p) => p.employee_code).join(',') === 'A,B,C',
    'attention people: sort TOTAL desc -> overdue desc (A[4o=3]>B[4o=2]>C[2])');
  const A = dat.attentionPeople[0];
  pass(A.overdue === 3 && A.late === 1 && A.total === 4, 'attention people: A = 3 quá hạn + 1 hoàn thành trễ (report week)');
  const B = dat.attentionPeople[1];
  pass(B.late === 2, 'attention people: B late = 2 report-week LATE completions, historical late excluded');
  pass(!dat.attentionPeople.some((p) => p.employee_code === 'E'),
    'attention people: E excluded — completed on time; the July late completion is outside the report week');
  pass(dat.attentionPeople.every((p) => (p.overdue + p.late) === p.total && p.total > 0),
    'attention people: total always reconciles = overdue + late');
  // tie-break by employee_code ASC when everything else equal
  {
    const tieOrg = new Map([['Z9', {}], ['A1', {}]]);
    const tieTasks = [
      T({ task_code: 'T-Z', status: 'in_progress', deadline: iso(2026, 8, 5, 17), last_progress_at: iso(2026, 8, 5, 9), primary_employee_code: 'Z9' }),
      T({ task_code: 'T-A', status: 'in_progress', deadline: iso(2026, 8, 5, 17), last_progress_at: iso(2026, 8, 5, 9), primary_employee_code: 'A1' }),
    ];
    const dt = weekly.buildWeeklyReportData(tieTasks, tieOrg, nowMs);
    pass(dt.attentionPeople[0].employee_code === 'A1', 'attention people: full tie -> employee_code ASC');
  }
  // display name fallback + neutral empty state
  {
    const dnOrg = new Map([['NN', { fullName: 'Ngô Thị Nga' }], ['CC', {}]]);
    const dnTasks = [
      T({ task_code: 'AN', status: 'in_progress', deadline: iso(2026, 8, 1, 17), primary_employee_code: 'NN' }),
      T({ task_code: 'AC', status: 'in_progress', deadline: iso(2026, 8, 1, 17), primary_employee_code: 'CC' }),
    ];
    const rdn = weekly.renderWeeklyReport(weekly.buildWeeklyReportData(dnTasks, dnOrg, nowMs)).html;
    pass(/Ngô Thị Nga — \d+ việc cần chú ý/.test(rdn), 'attention people: render uses fullName');
    pass(/CC — \d+ việc cần chú ý/.test(rdn), 'attention people: render falls back to employee_code');
    const empty = weekly.renderWeeklyReport(weekly.buildWeeklyReportData([
      T({ task_code: 'OK1', status: 'completed', completed_at: iso(2026, 8, 10, 9), deadline: iso(2026, 8, 12, 17), on_time: true, primary_employee_code: 'NN' }),
    ], dnOrg, nowMs)).html;
    pass(/Không có nhân sự nào có công việc quá hạn hoặc hoàn thành trễ/.test(empty), 'attention people: neutral empty state, no scolding language');
    pass(!/kém|tệ|vi phạm|yếu/i.test(empty), 'attention people: no judgemental wording');
  }

  // ---- B2c. KHỐI LƯỢNG CÔNG VIỆC — predicate + source reconcile ------------
  {
    const wOrg = new Map([['W1', { fullName: 'Vương Văn Một' }]]);
    const wTasks = [
      T({ task_code: 'W-S', status: 'in_progress', deadline: iso(2026, 9, 30, 17), primary_employee_code: 'W1', source_of_work: 'self_assigned' }),
      T({ task_code: 'W-A', status: 'in_progress', deadline: iso(2026, 9, 30, 17), primary_employee_code: 'W1', source_of_work: 'assigned_by_other' }),
      T({ task_code: 'W-P', status: 'published', deadline: iso(2026, 9, 30, 17), primary_employee_code: 'W1', source_of_work: 'proposal' }),
      T({ task_code: 'W-U', status: 'in_progress', deadline: iso(2026, 9, 30, 17), primary_employee_code: 'W1', source_of_work: 'mystery-value' }),
      // NOT open -> excluded from workload
      T({ task_code: 'W-DONE', status: 'completed', completed_at: iso(2026, 8, 9, 9), deadline: iso(2026, 8, 9, 17), on_time: true, primary_employee_code: 'W1', source_of_work: 'assigned_by_other' }),
      T({ task_code: 'W-CANC', status: 'cancelled', deadline: iso(2026, 8, 9, 17), primary_employee_code: 'W1', source_of_work: 'self_assigned' }),
    ];
    const dw = weekly.buildWeeklyReportData(wTasks, wOrg, nowMs);
    const w1 = dw.workloadPeople.find((x) => x.employee_code === 'W1');
    pass(w1.total === 4, 'workload: predicate = current OPEN tasks only (published|in_progress) — completed/cancelled excluded');
    const s = w1.source;
    pass(s.self_assigned === 1 && s.assigned_by_other === 1 && s.proposal === 1 && s.unknown === 1,
      'workload: 4-way source_of_work breakdown, unknown = unrecognised enum ("mystery-value")');
    pass(s.self_assigned + s.assigned_by_other + s.proposal + s.unknown === w1.total,
      'workload: source parts always reconcile with the total');
    const rw = weekly.renderWeeklyReport(dw).html;
    pass(/Vương Văn Một — 4 việc/.test(rw), 'workload: render "<name> — N việc"');
    pass(/1 tự giao · 1 được giao · 1 từ đề xuất · 1 chưa xác định nguồn/.test(rw),
      'workload: proposal + unknown are NOT collapsed into "được giao"');
    // categories with count 0 are hidden
    const dw0 = weekly.buildWeeklyReportData([
      T({ task_code: 'X1', status: 'in_progress', deadline: iso(2026, 9, 30, 17), primary_employee_code: 'W1', source_of_work: 'assigned_by_other' }),
      T({ task_code: 'X2', status: 'in_progress', deadline: iso(2026, 9, 30, 17), primary_employee_code: 'W1', source_of_work: 'assigned_by_other' }),
    ], wOrg, nowMs);
    const rw0 = weekly.renderWeeklyReport(dw0).html;
    pass(/2 được giao/.test(rw0) && !/tự giao|từ đề xuất|chưa xác định nguồn/.test(rw0),
      'workload: only source categories with count > 0 are shown');
    pass(dw.workloadPeople.length <= 3, 'workload: top 3 max');
  }

  // ---- B3. DISPLAY NAME in "Công việc cần nhìn ngay" ------------------------
  const nameOrg = new Map([['S1', { department: 'Bán hàng', fullName: 'Trần Thị Hằng' }], ['K1', { department: 'Kho' }]]);
  const nameTasks = [
    T({ task_code: 'N1', status: 'in_progress', deadline: iso(2026, 8, 1, 17), last_progress_at: iso(2026, 7, 20, 9), primary_employee_code: 'S1' }), // has fullName
    T({ task_code: 'N2', status: 'in_progress', deadline: iso(2026, 8, 2, 17), last_progress_at: iso(2026, 7, 20, 9), primary_employee_code: 'K1' }), // no fullName -> code
  ];
  const dn = weekly.buildWeeklyReportData(nameTasks, nameOrg, nowMs);
  const n1 = dn.topTasks.find((t) => t.task_code === 'N1');
  const n2 = dn.topTasks.find((t) => t.task_code === 'N2');
  pass(n1.primary_full_name === 'Trần Thị Hằng', 'display name: topTasks carries fullName from orgIndex');
  pass(n2.primary_full_name === '', 'display name: empty when orgIndex has no fullName');
  const rn = weekly.renderWeeklyReport(dn);
  pass(rn.html.includes('Phụ trách: Trần Thị Hằng'), 'display name: render uses fullName when present');
  pass(rn.html.includes('Phụ trách: K1'), 'display name: render falls back to employee code when no fullName');

  // ---- B4. BRAND SHELL (sync with transactional Mail V1) -------------------
  const rb = weekly.renderWeeklyReport(weekly.buildWeeklyReportData(tasks, org, nowMs)).html;
  pass(rb.includes('assets/logo/phf-logo.png') && /alt="PHUHOA FRESH"/.test(rb), 'brand: canonical assets/logo/phf-logo.png in the header (not redrawn)');
  const remoteSrcs = rb.match(/src="https?:\/\/[^"]+"/gi) || [];
  pass(remoteSrcs.length === 1 && /\/assets\/logo\/phf-logo\.png"$/.test(remoteSrcs[0]) && /^src="https:\/\//.test(remoteSrcs[0]),
    'brand: the only remote src is the brand logo, derived from BASE_URL (no hardcoded host)');
  pass(!/#0f172a/i.test(rb) && !/background:#0f172a|background:#000/i.test(rb), 'brand: no navy / black header');
  pass(rb.includes("Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"),
    'brand: exact PHF Task production font stack');
  pass(/color:#0e5b43;font-size:13px;font-weight:700;letter-spacing:2px;">PHF TASK/.test(rb), 'brand: "PHF TASK" wordmark green #0e5b43, weight 700');
  pass(/background:#0f7a43;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700[^"]*">MỞ PHF TASK — XEM BÁO CÁO CHI TIẾT/.test(rb),
    'brand: single CTA #0f7a43 white weight 700, weekly label kept');
  pass((rb.match(/MỞ PHF TASK/g) || []).length === 1, 'brand: exactly ONE CTA');
  pass(rb.includes('Email được gửi tự động từ hệ thống PHF Task.') && rb.includes('Không trả lời email này.'),
    'brand: 2-line footer incl. "Không trả lời email này."');
  pass(!/font-weight:800/.test(rb), 'brand: no 800 weight (title/CTA are 700, matching PHF Task)');
  pass(/Tuần \d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4}/.test(rb), 'brand: period shown in the body');

  // ---- B5. MANAGEMENT NOTE (once, before CTA, quiet) ----------------------
  pass((rb.match(/Quản trị tốt bắt đầu từ những điều được ghi nhận\./g) || []).length === 1,
    'management note: appears exactly once');
  pass(rb.indexOf('Quản trị tốt bắt đầu') < rb.indexOf('MỞ PHF TASK — XEM BÁO CÁO CHI TIẾT'),
    'management note: placed before the CTA');
  pass(rb.includes('để việc phối hợp và xử lý dựa trên thông tin thay vì trí nhớ.'), 'management note: full approved body text');
  pass(/background:#f1f7f4;border:1px solid #d7e8df;border-radius:10px[^"]*"><div style="font-size:13px;font-weight:700;color:#0e5b43/.test(rb),
    'management note: light-green card, green 700 heading, no icon/uppercase');
  pass(!/BÁO CÁO|⚠|WARNING/i.test(rb.split('Quản trị tốt')[1].split('MỞ PHF TASK')[0]), 'management note: no warning icon / uppercase banner');

  // ---- B6. DELTA SEMANTIC COLOURS ---------------------------------------
  // completed UP -> green ; completed-late UP -> red ; activity -> always grey
  const cu = weekly.buildWeeklyReportData([
    T({ task_code: 'CU1', status: 'completed', completed_at: iso(2026, 8, 10, 9), deadline: iso(2026, 8, 12, 17), on_time: true, primary_employee_code: 'S1' }),
    T({ task_code: 'CU2', status: 'completed', completed_at: iso(2026, 8, 11, 9), deadline: iso(2026, 8, 5, 17), on_time: false, primary_employee_code: 'S1' }),
  ], org, nowMs);
  const rcu = weekly.renderWeeklyReport(cu).html;
  pass(/Hoàn thành<\/td>[^]*?color:#0f7a43;">▲ \d+<\/span>/.test(rcu), 'delta colour: "Hoàn thành" increase renders green (#0f7a43)');
  pass(/Hoàn thành trễ<\/td>[^]*?color:#b91c1c;">▲ \d+<\/span>/.test(rcu), 'delta colour: "Hoàn thành trễ" increase renders red (#b91c1c)');
  pass(/Công việc có hoạt động trong tuần<\/td>[^]*?color:#6b7280;">▲ \d+<\/span>/.test(rcu),
    'delta colour: activity delta is neutral grey regardless of direction');
  // a completion that lands only in the PREVIOUS window -> current delta decreases
  const cdData = weekly.buildWeeklyReportData([
    T({ task_code: 'PW1', status: 'completed', completed_at: iso(2026, 8, 3, 9), deadline: iso(2026, 8, 4, 17), on_time: true, primary_employee_code: 'S1' }),
  ], org, nowMs);
  pass(cdData.kpi.completed.delta.dir === 'down' && cdData.kpi.completed.value === 0,
    'delta: prev-week-only completion -> current 0, delta dir "down"');


  // =====================================================================
  // C. SETTINGS CRUD (fake db)
  // =====================================================================
  FAKE_DB = makeFakeDb();
  {
    const s0 = await settings.getMailSettings({});
    pass(s0.schemaReady === true && s0.weeklyReportEnabled === false && s0.recipients.length === 0,
      'settings: default weekly_report_enabled = false, no recipients');

    await settings.addRecipient({}, { email: '  BGD@PhuHoa.COM  ', label: 'BGĐ' });
    const s1 = await settings.getMailSettings({});
    pass(s1.recipients.length === 1 && s1.recipients[0].email === 'bgd@phuhoa.com', 'settings: add recipient normalizes (trim + lowercase)');

    const dup = await settings.addRecipient({}, { email: 'bgd@phuhoa.com', label: 'BGĐ 2' });
    const s2 = await settings.getMailSettings({});
    pass(s2.recipients.length === 1, 'settings: duplicate email -> upsert, not a 2nd row (unique)');

    let bad = false;
    try { await settings.addRecipient({}, { email: 'not-an-email' }); } catch (e) { bad = e.code === 'MAIL_RECIPIENT_EMAIL_INVALID'; }
    pass(bad, 'settings: invalid email rejected server-side');

    const rid = s2.recipients[0].id;
    await settings.setRecipientEnabled({}, { id: rid, enabled: false });
    pass((await settings.getMailSettings({})).recipients[0].isEnabled === false, 'settings: disable recipient (soft)');
    await settings.setRecipientEnabled({}, { id: rid, enabled: true });

    await settings.setWeeklyReportEnabled({}, { enabled: true });
    pass((await settings.getMailSettings({})).weeklyReportEnabled === true, 'settings: master weekly toggle persists');

    await settings.removeRecipient({}, { id: rid });
    pass((await settings.getMailSettings({})).recipients.length === 0, 'settings: remove recipient hard-deletes the row');

    let nf = false;
    try { await settings.removeRecipient({}, { id: 'nope' }); } catch (e) { nf = e.statusCode === 404; }
    pass(nf, 'settings: remove unknown id -> 404');
  }
  {
    FAKE_DB = makeFakeDb({ noSchema: true });
    const s = await settings.getMailSettings({});
    pass(s.schemaReady === false, 'settings: schema not applied -> schemaReady:false (never throws on read)');
    let threw = false;
    try { await settings.setWeeklyReportEnabled({}, { enabled: true }); } catch (e) { threw = e.statusCode === 503; }
    pass(threw, 'settings: write before migration -> 503 MAIL_SETTINGS_SCHEMA_MISSING');
  }

  // Admin-only gate is present (static)
  const actSrc = stripComments(fs.readFileSync(path.join(API, 'task-mail-settings-actions.js'), 'utf8'));
  pass(/requireTaskAdmin\(session\)/.test(actSrc) && (actSrc.match(/requireTaskAdmin/g) || []).length >= 6,
    'settings actions: every action calls requireTaskAdmin (non-admin denied)');
  pass(/previewWeeklyReport/.test(actSrc) && !/bridgeEnqueueWeeklyReport|sendTransactionalEmail/.test(actSrc),
    'settings actions: preview renders only — never enqueues or sends');

  // =====================================================================
  // D. WEEKLY IDEMPOTENCY (fake db)
  // =====================================================================
  FAKE_DB = makeFakeDb();
  {
    const p = { periodKey: '2026-09-07', periodLabel: '07/09/2026 - 13/09/2026', subject: 'S', html: '<p>x</p>',
      recipients: [{ email: 'a@x.com' }, { email: 'B@x.com' }, { email: 'a@x.com' }] };
    const r1 = await outbox.enqueueWeeklyReportRows({}, p);
    pass(r1.inserted === 2 && r1.total === 2, 'weekly enqueue: 3 recipients w/ 1 dup -> 2 rows (intra-batch dedup)');
    pass(FAKE_DB.store.outbox[0].dedupe_key === 'weekly:2026-09-07:a@x.com', 'weekly enqueue: dedupe_key = weekly:<periodStart>:<normalised email>');
    const r2 = await outbox.enqueueWeeklyReportRows({}, p);
    pass(r2.inserted === 0 && r2.skippedExisting === 2, 'weekly enqueue: re-run same period -> ON CONFLICT, 0 new rows (idempotent)');
    let badKey = false;
    try { await outbox.enqueueWeeklyReportRows({}, Object.assign({}, p, { periodKey: 'nope' })); } catch (e) { badKey = e.code === 'WEEKLY_PERIOD_KEY_INVALID'; }
    pass(badKey, 'weekly enqueue: invalid periodKey rejected');
  }

  // generator inert unless BOTH gates true (mock the bridge)
  {
    const BR = require.resolve(path.join(API, 'task-mail-bridge.js'));
    const WK = require.resolve(path.join(API, 'task-weekly-report.js'));
    const realBridge = require.cache[BR];
    let mockSettings = { schemaReady: true, weeklyReportEnabled: false, recipients: [] };
    require.cache[BR] = { id: BR, filename: BR, loaded: true, exports: {
      isMailBridgeEnabled: () => true,
      bridgeGetMailSettings: async () => mockSettings,
      bridgeEnqueueWeeklyReport: async () => ({ inserted: 99 }),
    } };
    delete require.cache[WK];
    const w = require(WK);

    delete process.env.PHF_TASK_WEEKLY_REPORT_ENABLED;
    let s = await w.runWeeklyReport({});
    pass(s.enqueued === 0 && /PHF_TASK_WEEKLY_REPORT_ENABLED/.test(s.note || ''), 'generator: inert when env flag PHF_TASK_WEEKLY_REPORT_ENABLED != true');

    process.env.PHF_TASK_WEEKLY_REPORT_ENABLED = 'true';
    s = await w.runWeeklyReport({});
    pass(s.enqueued === 0 && /weekly_report_enabled = false/.test(s.note || ''), 'generator: inert when task.mail_settings.weekly_report_enabled = false');

    mockSettings = { schemaReady: true, weeklyReportEnabled: true, recipients: [] };
    s = await w.runWeeklyReport({});
    pass(s.enqueued === 0 && /no enabled recipients/.test(s.note || ''), 'generator: inert when no enabled recipients (both gates on, list empty)');

    delete process.env.PHF_TASK_WEEKLY_REPORT_ENABLED;
    require.cache[BR] = realBridge;
    delete require.cache[WK];
  }

  // =====================================================================
  // E. STATIC WIRING
  // =====================================================================
  const cron = fs.readFileSync(path.join(ROOT, 'api', 'checklist-monthly-cron.js'), 'utf8');
  pass(/__phf_cron.*task-weekly-report|task-weekly-report.*__phf_cron/.test(cron) && /TASK_WEEKLY_REPORT_CRON_SECRET/.test(cron),
    'wiring: /api/task-weekly-report-cron route + its own Bearer secret');
  pass(/runWeeklyReport\(/.test(cron), 'wiring: cron calls runWeeklyReport');
  const vj = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  pass(/api\/task-weekly-report-cron/.test(vj), 'wiring: vercel.json rewrites /api/task-weekly-report-cron (no native Vercel cron)');
  pass(!/"crons"/.test(vj), 'wiring: still no Vercel native cron block');
  const dataJs = fs.readFileSync(path.join(ROOT, 'api', 'data.js'), 'utf8');
  for (const a of ['taskMailSettingsGet', 'taskMailSetWeeklyEnabled', 'taskMailAddRecipient', 'taskMailSetRecipientEnabled', 'taskMailRemoveRecipient', 'taskMailWeeklyPreview']) {
    pass(dataJs.includes("case '" + a + "'") && dataJs.includes("'" + a + "'"), 'wiring: data.js dispatches + manifests ' + a);
  }
  const mig = fs.readFileSync(path.join(ROOT, 'migrations', 'phf_hr_task_mail_settings_v1.sql'), 'utf8');
  pass(/create table task\.mail_settings/.test(mig) && /create table task\.mail_recipients/.test(mig) && /weekly_report_enabled boolean not null default false/.test(mig),
    'migration: mail_settings + mail_recipients, weekly default false');
  pass(!/task\.mail_outbox/.test(mig), 'migration: settings migration does NOT touch the transactional outbox');

  console.log('\n' + passed + ' checks passed.');
})().catch((e) => { console.error('\nFAIL:', (e && e.stack) || e); process.exit(1); });
