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
  pass(/^[↑↓=]/.test(d.kpi.activity.delta) && /^[↑↓=]/.test(d.kpi.completed.delta), 'KPI: activity + completed carry a deterministic ↑/↓/= delta');

  const sigJoined = d.attention.join(' || ');
  pass(d.attention.length >= 1 && d.attention.length <= 5, 'attention: 1–5 deterministic signals');
  pass(/Hiện có 3 công việc đang quá hạn/.test(sigJoined), 'attention: overdue-now count signal');
  pass(/quá hạn trên 7 ngày/.test(sigJoined), 'attention: overdue > 7 days signal (O1, O3)');
  pass(/Bộ phận nhiều việc quá hạn nhất/.test(sigJoined), 'attention: top overdue department signal');
  pass(/quá hạn từ trước đầu tuần báo cáo/.test(sigJoined), 'attention: overdue carried from before the report week');

  pass(d.topTasks.length >= 1 && d.topTasks.length <= 5, 'top tasks: 3–5 max');
  pass(d.topTasks[0].task_code === 'O3' || d.topTasks[0].task_code === 'O1', 'top tasks: most-overdue first (O1/O3, longest overdue)');
  pass(/Quá hạn \d+ ngày/.test(d.topTasks[0].reason), 'top tasks: reason string "Quá hạn N ngày"');
  const staleTop = d.topTasks.find((t) => /chưa cập nhật/.test(t.reason));
  pass(!!staleTop, 'top tasks: at least one reason notes "N ngày chưa cập nhật"');

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
