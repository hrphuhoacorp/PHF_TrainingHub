'use strict';

/*
 * PHF Task Recurrence V1 — REAL PostgreSQL acceptance (THROWAWAY `phf_hr_e2e`).
 *
 * Runs the ACTUAL engine (services/phf-hr-api/lib/task-recurrence.js) against
 * the disposable E2E database over the local SSH tunnel (127.0.0.1:15432).
 * NO Supabase. NO mail. NO notification. NO prod.
 *
 * Isolation: every per-rule check creates its own dedicated rule and drives it
 * with engine.runRule() (single-rule generation) so sub-tests never interfere.
 * One check exercises the global engine.generateDue() multi-rule + cap path.
 *
 * PREREQUISITE (deployer, one-off): migrations/phf_hr_task_recurrence_v1.sql
 * applied to phf_hr_e2e. Until then this exits with SCHEMA_NOT_APPLIED.
 *
 *   PHF_HR_E2E_ENV=<abs path to e2e-db.env>  node scripts/test-task-recurrence-realdb-v1.js
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { Client } = require(path.join(ROOT, 'services/phf-hr-api/node_modules/pg'));
const engine = require(path.join(ROOT, 'services/phf-hr-api/lib/task-recurrence'));

const ENV_PATH = process.env.PHF_HR_E2E_ENV || path.join(ROOT, '..', 'e2e-db.env');
let PASS = 0, FAIL = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else { FAIL++; fails.push(name); console.log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
}
function dcol(v) {
  if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  return v == null ? null : String(v).slice(0, 10);
}
function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) { console.error('missing env file: ' + ENV_PATH); process.exit(2); }
  const kv = {};
  fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) kv[m[1]] = m[2];
  });
  return {
    PHF_HR_DB_HOST: kv.PHF_HR_DB_HOST || '127.0.0.1',
    PHF_HR_DB_PORT: Number(kv.PHF_HR_DB_PORT || 15432),
    PHF_HR_DB_NAME: kv.PHF_HR_DB_NAME || 'phf_hr_e2e',
    PHF_HR_DB_RUNTIME_USER: kv.PHF_HR_DB_RUNTIME_USER,
    PHF_HR_DB_RUNTIME_PASSWORD: kv.PHF_HR_DB_RUNTIME_PASSWORD,
    SERVICE_TOKEN: 'x'.repeat(40),
  };
}

let SHARED; // one Client reused for setup/inspection (fast over the tunnel)
async function q(sql, params) {
  await SHARED.query('BEGIN');
  await SHARED.query('SET LOCAL ROLE phf_hr_app');
  try { const r = await SHARED.query(sql, params || []); await SHARED.query('COMMIT'); return r; }
  catch (e) { await SHARED.query('ROLLBACK').catch(() => {}); throw e; }
}

const FAMILY = '[RECURRENCE-V1-REALDB]';
const TAG = FAMILY + ' r' + Date.now(); // per-run unique so re-runs never collide (history is append-only)
const CAT = 'RECV1_TEST';
const PRIMARY = 'RECV1_P1';
const AP = [PRIMARY]; // active-primary allow-list for normal (non-inactive) checks
const actor = { employeeCode: 'RECV1', accountId: '' };

async function schemaApplied() {
  const r = await q("select count(*)::int n from information_schema.tables where table_schema='task' and table_name='recurrence_rules'");
  return r.rows[0].n === 1;
}
async function dailySchemaApplied() {
  // migrations/phf_hr_task_recurrence_v1_daily.sql widens frequency_ck to include 'daily'.
  const r = await q("select pg_get_constraintdef(oid) d from pg_constraint where conname='task_recurrence_rules_frequency_ck'");
  return !!(r.rows[0] && /daily/.test(r.rows[0].d));
}
async function neutralizePriorRuns() {
  // recurrence_rule_history is append-only (Z-51 forbid-update/delete trigger) and
  // recurrence_rules FK is ON DELETE RESTRICT, so prior-run fixtures cannot be
  // deleted. Instead END them so the global engine.generateDue() ignores them.
  // Direct UPDATE (test grant), not transitionRule() — no history noise wanted here.
  await q(`UPDATE task.recurrence_rules SET status='ended', ended_at=now()
           WHERE title LIKE $1 AND status <> 'ended'`, [FAMILY + '%']);
}
async function mkWeekly(over) {
  return engine.createRule(loadEnv._cfg, Object.assign({
    title: TAG + ' weekly', content: '', categoryCode: CAT, priority: 'thuong',
    primaryEmployeeCode: PRIMARY, relatedEmployeeCodes: [],
    startDateKey: '2026-01-05', startHour: 9, startMinute: 0, durationMs: 2 * 86400000,
    frequency: 'weekly', weekday: 'T2', endConditionType: 'never', reason: 'test',
  }, over || {}), actor);
}
async function mkMonthly(over) {
  return engine.createRule(loadEnv._cfg, Object.assign({
    title: TAG + ' monthly', content: '', categoryCode: CAT, priority: 'thuong',
    primaryEmployeeCode: PRIMARY, relatedEmployeeCodes: [],
    startDateKey: '2026-01-31', startHour: 9, startMinute: 0, durationMs: 3 * 86400000,
    frequency: 'monthly', dayOfMonth: 31, endConditionType: 'never', reason: 'test',
  }, over || {}), actor);
}
async function mkDaily(over) {
  return engine.createRule(loadEnv._cfg, Object.assign({
    title: TAG + ' daily', content: '', categoryCode: CAT, priority: 'thuong',
    primaryEmployeeCode: PRIMARY, relatedEmployeeCodes: [],
    startDateKey: '2026-01-03', startHour: 9, startMinute: 0, durationMs: 86400000,
    frequency: 'daily', endConditionType: 'never', reason: 'test',
  }, over || {}), actor);
}
const vnNow = (dateKey, h = 12) => Date.parse(engine.vnWallToUtcIso(dateKey, h, 0));
// scoped single-rule run for normal checks (primary treated active, category checked live)
const run1 = (ruleId, dateKey, extra) => engine.runRule(loadEnv._cfg, ruleId, Object.assign({ nowMs: vnNow(dateKey), maxOccurrences: 100, activePrimaryCodes: AP }, extra || {}));

async function occ(ruleId) {
  return (await q(`SELECT occurrence_date::text d, status, skip_reason, generated_task_id, is_catchup, occurrence_index, rule_version_at_claim
    FROM task.recurrence_occurrences WHERE rule_id=$1 ORDER BY occurrence_date`, [ruleId])).rows;
}
async function gens(ruleId) { return (await occ(ruleId)).filter((o) => o.status === 'generated'); }
async function taskRow(id) {
  return (await q(`SELECT task_code, status, flow_type, recurring_series_id::text rsid, recurring_series_version rsv,
    scheduled_occurrence_at, occurrence_period, start_at, deadline FROM task.tasks WHERE id=$1`, [id])).rows[0];
}
async function events(id) {
  return (await q(`SELECT event_type FROM task.events WHERE task_id=$1 ORDER BY occurred_at`, [id])).rows.map((r) => r.event_type);
}

(async () => {
  const cfg = loadEnv();
  loadEnv._cfg = cfg;
  if (!cfg.PHF_HR_DB_RUNTIME_PASSWORD) { console.error('env missing PHF_HR_DB_RUNTIME_PASSWORD'); process.exit(2); }
  SHARED = new Client({ host: cfg.PHF_HR_DB_HOST, port: cfg.PHF_HR_DB_PORT, database: cfg.PHF_HR_DB_NAME, user: cfg.PHF_HR_DB_RUNTIME_USER, password: cfg.PHF_HR_DB_RUNTIME_PASSWORD });
  await SHARED.connect();

  if (!(await schemaApplied())) {
    console.log('\nSCHEMA_NOT_APPLIED — deployer must apply migrations/phf_hr_task_recurrence_v1.sql first.');
    await SHARED.end(); process.exit(3);
  }
  console.log(TAG + ' real-DB acceptance on ' + cfg.PHF_HR_DB_NAME + '\n');
  await neutralizePriorRuns();
  await q(`INSERT INTO task.categories (category_code, display_name, is_active, created_by_employee_code)
    VALUES ($1,$2,true,'RECV1') ON CONFLICT (category_code) DO UPDATE SET is_active=true`, [CAT, TAG + ' category']);

  // [2] weekly rule create
  const w = await mkWeekly();
  ok(w.frequency === 'weekly' && dcol(w.anchor_date) === '2026-01-05', '[2] weekly rule create — anchor snapped to first T2', dcol(w.anchor_date));

  // [3] monthly rule create
  const m = await mkMonthly();
  ok(m.frequency === 'monthly' && m.day_of_month === 31, '[3] monthly rule create — day_of_month=31', m.day_of_month);

  // [D1][D2][D3] daily ("Hàng ngày") — every calendar day incl. weekend, retry-safe
  // 2026-01-03 is a Saturday; run at 2026-01-05 (Mon) -> Sat+Sun+Mon = 3 Tasks.
  const dailyReady = await dailySchemaApplied();
  ok(dailyReady, '[D0] daily migration applied (frequency_ck allows daily) — apply migrations/phf_hr_task_recurrence_v1_daily.sql if this fails');
  if (dailyReady) {
  const dly = await mkDaily();
  ok(dly.frequency === 'daily' && dcol(dly.anchor_date) === '2026-01-03' && dly.weekday === null && dly.day_of_month === null,
    '[D1] daily rule create — anchor = start date, no weekday/day_of_month', dcol(dly.anchor_date));
  await run1(dly.id, '2026-01-05');
  let dg = await gens(dly.id);
  ok(dg.length === 3 && dg.map((x) => x.d).join(',') === '2026-01-03,2026-01-04,2026-01-05',
    '[D2] daily run -> one Task per calendar day incl. Sat/Sun', dg.map((x) => x.d).join(','));
  await run1(dly.id, '2026-01-05', { nowMs: vnNow('2026-01-05', 13) });
  dg = await gens(dly.id);
  ok(dg.length === 3, '[D3] daily re-run -> 0 duplicate Tasks', dg.length);
  }

  // [8] run -> exactly 1 Task for the first due occurrence
  await run1(w.id, '2026-01-05');
  let g = await gens(w.id);
  ok(g.length === 1 && g[0].d === '2026-01-05' && g[0].generated_task_id, '[8] run -> exactly 1 weekly Task (2026-01-05)', g.map((x) => x.d).join(','));

  // [9] run again same instant -> zero new
  await run1(w.id, '2026-01-05', { nowMs: vnNow('2026-01-05', 13) });
  g = await gens(w.id);
  ok(g.length === 1, '[9] run again -> 0 duplicate weekly Tasks', g.length);

  // [10] concurrent/retry: two runs in parallel for a fresh rule's first occurrence
  const wc = await mkWeekly({ title: TAG + ' weekly-concurrent', startDateKey: '2026-02-02' });
  const [r1, r2] = await Promise.allSettled([run1(wc.id, '2026-02-02'), run1(wc.id, '2026-02-02')]);
  g = await gens(wc.id);
  ok(r1.status === 'fulfilled' && r2.status === 'fulfilled' && g.length === 1,
    '[10] concurrent runs -> exactly 1 Task, no error', JSON.stringify([r1.status, r2.status, g.length]));

  // [11][12][13] generated Task shape
  const t = await taskRow(g[0].generated_task_id);
  ok(/^CV-\d/.test(t.task_code || ''), '[11] generated Task has a normal task_code', t.task_code);
  ok(t.rsid === wc.id && t.rsv === wc.rule_version && t.occurrence_period === '2026-02' && !!t.scheduled_occurrence_at,
    '[12] generated Task carries recurrence linkage columns', JSON.stringify({ rsid: t.rsid === wc.id, rsv: t.rsv, period: t.occurrence_period }));
  ok(t.status === 'published' && t.flow_type === 'giao_viec', '[13] generated Task is a normal independent published giao_viec');
  const dc = (await q(`SELECT count(*) c, count(distinct task_code) d FROM task.tasks WHERE recurring_series_id IS NOT NULL`)).rows[0];
  ok(dc.c === dc.d, '[11b] all recurrence-generated task_codes distinct', dc.c + '/' + dc.d);

  // [22] recurring_generated emitted exactly once
  const ev = await events(g[0].generated_task_id);
  ok(ev.filter((x) => x === 'recurring_generated').length === 1 && ev.includes('published'),
    '[22] recurring_generated event emitted once (+ published)', JSON.stringify(ev));

  // [14] unfinished previous occurrence does NOT block next
  const wu = await mkWeekly({ title: TAG + ' weekly-unfinished', startDateKey: '2026-01-05' });
  await run1(wu.id, '2026-01-05');           // occ 1 -> published, left unfinished
  await run1(wu.id, '2026-01-19');           // must still generate occ 2 + 3
  const wug = (await gens(wu.id)).map((o) => o.d);
  ok(wug.join(',') === '2026-01-05,2026-01-12,2026-01-19',
    '[14] unfinished previous occurrence does NOT block next (3 weekly Tasks)', wug.join(','));

  // [15] missed scheduler -> catch-up ascending, is_catchup flagged
  const wk = await mkWeekly({ title: TAG + ' weekly-catchup', startDateKey: '2026-03-02' });
  await run1(wk.id, '2026-03-30');            // 5 Mondays passed at once
  const wkg = await gens(wk.id);
  const asc = wkg.map((o) => o.d);
  const catchupCount = wkg.filter((o) => o.is_catchup).length;
  // the occurrence whose date == "today" (nowMs) is on-time, not a catch-up.
  ok(wkg.length >= 5 && JSON.stringify(asc) === JSON.stringify(asc.slice().sort())
     && catchupCount >= 4 && wkg[wkg.length - 1].d === '2026-03-30' && !wkg[wkg.length - 1].is_catchup,
    '[15] catch-up: overdue occurrences generated ascending, flagged is_catchup (today-occurrence is on-time)',
    asc.join(',') + ' catchup=' + catchupCount);

  // [16][17] pause -> no generation; resume -> no catch-up for the paused window
  const wp = await mkWeekly({ title: TAG + ' weekly-pause', startDateKey: '2026-04-06' });
  await run1(wp.id, '2026-04-06');            // occ 1 generated (2026-04-06)
  await engine.transitionRule(cfg, wp.id, 'pause', { reason: 'test', nowMs: vnNow('2026-04-06') }, actor);
  await run1(wp.id, '2026-04-20');            // paused -> nothing
  ok((await gens(wp.id)).length === 1, '[16] paused rule generates nothing', (await gens(wp.id)).length);
  await engine.transitionRule(cfg, wp.id, 'resume', { reason: 'test', nowMs: vnNow('2026-04-27') }, actor);
  await run1(wp.id, '2026-04-27');
  const wpd = (await gens(wp.id)).map((o) => o.d);
  ok(!wpd.includes('2026-04-13') && !wpd.includes('2026-04-20') && wpd.includes('2026-04-27'),
    '[17] resume: pause-window occurrences NOT caught up', wpd.join(','));

  // [4][5][6][7] month-end fallback across the calendar (single isolated rule, generous budget)
  const me = await mkMonthly({ title: TAG + ' monthly-eom', startDateKey: '2026-01-31' });
  await engine.runRule(cfg, me.id, { nowMs: vnNow('2028-07-01'), maxOccurrences: 60, activePrimaryCodes: AP });
  const med = (await gens(me.id)).map((o) => o.d);
  ok(med.includes('2026-02-28'), '[4] day 31 -> Feb 28 (2026 non-leap)', med.includes('2026-02-28'));
  ok(med.includes('2028-02-29'), '[5] day 31 -> Feb 29 (2028 leap)', med.includes('2028-02-29'));
  ok(med.includes('2026-04-30'), '[6] day 31 -> Apr 30', med.includes('2026-04-30'));
  ok(med.includes('2026-05-31'), '[7] day 31 -> May 31 again', med.includes('2026-05-31'));

  // [18] edit applies only to future unclaimed occurrences
  const we = await mkWeekly({ title: TAG + ' weekly-edit', startDateKey: '2026-06-01' });
  await run1(we.id, '2026-06-01');
  const claimedId = (await occ(we.id))[0].generated_task_id;
  const beforeT = await taskRow(claimedId);
  await engine.updateRule(cfg, we.id, {
    title: TAG + ' weekly-edit-CHANGED', content: 'new', categoryCode: CAT, priority: 'khan_cap',
    primaryEmployeeCode: PRIMARY, relatedEmployeeCodes: [], startDateKey: '2026-06-01',
    startHour: 9, startMinute: 0, durationMs: 2 * 86400000, frequency: 'weekly', weekday: 'T2',
    endConditionType: 'never', reason: 'edit',
  }, actor);
  await run1(we.id, '2026-06-08');
  const weo = await occ(we.id);
  const afterT = await taskRow(claimedId);
  const rv = (await q('SELECT rule_version FROM task.recurrence_rules WHERE id=$1', [we.id])).rows[0].rule_version;
  ok(afterT.deadline.getTime() === beforeT.deadline.getTime() && weo[0].rule_version_at_claim === 1,
    '[18a] already-generated occurrence Task unchanged by rule edit', JSON.stringify({ deadlineSame: afterT.deadline.getTime() === beforeT.deadline.getTime(), rvClaim: weo[0].rule_version_at_claim }));
  ok(rv === 2 && weo.length >= 2 && weo[1].rule_version_at_claim === 2 && !!weo[1].generated_task_id,
    '[18b] rule_version bumped -> next occurrence claimed at v2',
    JSON.stringify({ rv, occ2rv: weo[1] && weo[1].rule_version_at_claim, occ2gen: !!(weo[1] && weo[1].generated_task_id) }));
  // verify the future Task actually carries the edited title/priority
  const futTitle = weo[1] && weo[1].generated_task_id
    ? (await q('SELECT title, priority FROM task.tasks WHERE id=$1', [weo[1].generated_task_id])).rows[0] : null;
  ok(futTitle && futTitle.title === TAG + ' weekly-edit-CHANGED' && futTitle.priority === 'khan_cap',
    '[18c] future occurrence Task = edited template (title + priority)', JSON.stringify(futTitle));

  // [19] stop leaves generated Tasks untouched
  const ws = await mkWeekly({ title: TAG + ' weekly-stop', startDateKey: '2026-07-06' });
  await run1(ws.id, '2026-07-06');
  const stopTaskId = (await occ(ws.id))[0].generated_task_id;
  await engine.transitionRule(cfg, ws.id, 'stop', { reason: 'test' }, actor);
  await engine.runRule(cfg, ws.id, { nowMs: vnNow('2026-07-27'), activePrimaryCodes: AP }); // rule ended -> nothing
  ok((await gens(ws.id)).length === 1 && (await taskRow(stopTaskId)).status === 'published',
    '[19] stop: no new Tasks, existing generated Task untouched');

  // [20] inactive primary -> skipped, no Task, rule stays active
  const wip = await mkWeekly({ title: TAG + ' weekly-inactive-primary', startDateKey: '2026-08-03' });
  await engine.runRule(cfg, wip.id, { nowMs: vnNow('2026-08-03'), activePrimaryCodes: ['SOMEONE_ELSE'] });
  const wipo = await occ(wip.id);
  const wipStatus = (await q('SELECT status FROM task.recurrence_rules WHERE id=$1', [wip.id])).rows[0].status;
  ok(wipo.length === 1 && wipo[0].status === 'skipped' && wipo[0].skip_reason === 'primary_inactive'
     && !wipo[0].generated_task_id && wipStatus === 'active',
    '[20] inactive primary -> skipped (primary_inactive), no Task, rule active', JSON.stringify(wipo[0]));

  // [21] inactive category -> skipped, no Task, rule stays active
  const wic = await mkWeekly({ title: TAG + ' weekly-inactive-category', startDateKey: '2026-08-10' });
  await q('UPDATE task.categories SET is_active=false WHERE category_code=$1', [CAT]);
  await run1(wic.id, '2026-08-10');
  await q('UPDATE task.categories SET is_active=true WHERE category_code=$1', [CAT]);
  const wico = await occ(wic.id);
  const wicStatus = (await q('SELECT status FROM task.recurrence_rules WHERE id=$1', [wic.id])).rows[0].status;
  ok(wico.length === 1 && wico[0].status === 'skipped' && wico[0].skip_reason === 'category_inactive' && wicStatus === 'active',
    '[21] inactive category -> skipped (category_inactive), no Task, rule active', JSON.stringify(wico[0]));

  // ===================================================================
  // MULTI PAUSE/RESUME — a second cycle must never let the first window's
  // occurrences reappear as catch-up. transitionRule('resume') materialises
  // every occurrence inside the just-finished pause window as a persisted
  // 'skipped'/'paused' row.
  // ===================================================================
  const mp = await mkWeekly({ title: TAG + ' multi-pause', startDateKey: '2026-01-05' }); // weekly Monday
  await run1(mp.id, '2026-01-05');                                 // occ 2026-01-05 generated
  // -- cycle A: pause 2026-01-12, resume 2026-01-26  -> window [01-12, 01-26) = {01-12, 01-19}
  await engine.transitionRule(cfg, mp.id, 'pause',  { reason: 'A', nowMs: vnNow('2026-01-12') }, actor);
  await run1(mp.id, '2026-01-20');                                 // paused -> nothing
  await engine.transitionRule(cfg, mp.id, 'resume', { reason: 'A', nowMs: vnNow('2026-01-26') }, actor);
  await run1(mp.id, '2026-01-26');                                 // generates 2026-01-26
  await run1(mp.id, '2026-02-02');                                 // generates 2026-02-02
  // -- cycle B: pause 2026-02-09, resume 2026-02-23 -> window [02-09, 02-23) = {02-09, 02-16}
  await engine.transitionRule(cfg, mp.id, 'pause',  { reason: 'B', nowMs: vnNow('2026-02-09') }, actor);
  await run1(mp.id, '2026-02-16');                                 // paused -> nothing
  await engine.transitionRule(cfg, mp.id, 'resume', { reason: 'B', nowMs: vnNow('2026-02-23') }, actor);
  // -- catch-up far in the future
  await run1(mp.id, '2026-04-06');
  let mpo = await occ(mp.id);
  const mpSkippedPaused = mpo.filter((o) => o.status === 'skipped' && o.skip_reason === 'paused').map((o) => o.d).sort();
  const mpGen = mpo.filter((o) => o.status === 'generated').map((o) => o.d);
  ok(JSON.stringify(mpSkippedPaused) === JSON.stringify(['2026-01-12', '2026-01-19', '2026-02-09', '2026-02-16']),
    '[MP1-4] BOTH pause windows persisted as skipped/paused', mpSkippedPaused.join(','));
  ok(mpo.filter((o) => o.skip_reason === 'paused').every((o) => !o.generated_task_id),
    '[MP5] no Task created for any paused occurrence');
  ok(!mpGen.some((d) => ['2026-01-12', '2026-01-19', '2026-02-09', '2026-02-16'].includes(d))
     && mpGen.includes('2026-01-05') && mpGen.includes('2026-01-26') && mpGen.includes('2026-02-02')
     && mpGen.includes('2026-02-23') && mpGen.includes('2026-03-30'),
    '[MP6] occurrences outside both windows still catch up; window occurrences never generated', mpGen.join(','));
  // -- retry-safety: re-drive cycle B's resume over the same window
  const mpOccBefore = (await occ(mp.id)).length;
  await q(`UPDATE task.recurrence_rules SET status='paused', paused_from='2026-02-09', paused_to=NULL WHERE id=$1`, [mp.id]);
  await engine.transitionRule(cfg, mp.id, 'resume', { reason: 'B-retry', nowMs: vnNow('2026-02-23') }, actor);
  const mpOccAfter = (await occ(mp.id)).length;
  const mpDup = (await q(`SELECT count(*)::int n FROM (SELECT occurrence_date FROM task.recurrence_occurrences WHERE rule_id=$1 GROUP BY 1 HAVING count(*)>1) x`, [mp.id])).rows[0].n;
  ok(mpOccAfter === mpOccBefore && mpDup === 0,
    '[MP7] repeated resume over same window -> no duplicate skipped rows (ON CONFLICT DO NOTHING)',
    JSON.stringify({ before: mpOccBefore, after: mpOccAfter, dups: mpDup }));
  // -- final: another catch-up run still generates nothing new for the windows
  const mpGenBefore = (await gens(mp.id)).length;
  await run1(mp.id, '2026-04-06');
  ok((await gens(mp.id)).length === mpGenBefore, '[MP8] further catch-up runs never regenerate paused-window occurrences');

  // [GD] GLOBAL engine.generateDue — scans every active rule, per-run total cap,
  // safe to re-invoke (the cron calls this every 5 min). Many active fixtures
  // from earlier checks are behind, so a small cap is fully consumed by them.
  const totBefore = (await q(`SELECT count(*)::int n FROM task.recurrence_occurrences`)).rows[0].n;
  const s1 = await engine.generateDue(cfg, { nowMs: vnNow('2026-10-19'), maxTotalPerRun: 5, maxCatchupPerRule: 3, activePrimaryCodes: AP });
  const s2 = await engine.generateDue(cfg, { nowMs: vnNow('2026-10-19'), maxTotalPerRun: 5, maxCatchupPerRule: 3, activePrimaryCodes: AP });
  const totAfter = (await q(`SELECT count(*)::int n FROM task.recurrence_occurrences`)).rows[0].n;
  const dupCheck = (await q(`SELECT count(*)::int n FROM (SELECT rule_id, occurrence_date FROM task.recurrence_occurrences GROUP BY 1,2 HAVING count(*) > 1) x`)).rows[0].n;
  ok(s1.generated === 5 && s1.rulesScanned >= 2 && s2.generated <= 5
     && (totAfter - totBefore) === (s1.generated + s1.skipped + s2.generated + s2.skipped)
     && dupCheck === 0,
    '[GD] generateDue scans multiple rules, honours maxTotalPerRun=5, no (rule_id,date) dup on re-run',
    JSON.stringify({ g1: s1.generated, g2: s2.generated, scanned: s1.rulesScanned, newRows: totAfter - totBefore, dups: dupCheck }));

  // [25] no Supabase in the engine (require/createClient — not the word in a comment)
  const engSrc = fs.readFileSync(path.join(ROOT, 'services/phf-hr-api/lib/task-recurrence.js'), 'utf8');
  const dmSrc = fs.readFileSync(path.join(ROOT, 'services/phf-hr-api/lib/task-recurrence-datemath.js'), 'utf8');
  const bad = /require\(['"][^'"]*supabase[^'"]*['"]\)|createClient\s*\(|@supabase\/supabase-js/;
  ok(!bad.test(engSrc) && !bad.test(dmSrc), '[25] recurrence engine/datemath make no Supabase call');

  console.log('\n==== RECURRENCE_V1_REALDB  PASS=' + PASS + '  FAIL=' + FAIL + ' ====');
  if (FAIL) console.log('failed: ' + fails.join(' | '));
  await SHARED.end();
  process.exit(FAIL ? 1 : 0);
})().catch(async (e) => { console.error('\nHARNESS ERROR:', e); try { await SHARED.end(); } catch (x) {} process.exit(1); });
