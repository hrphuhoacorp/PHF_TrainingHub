'use strict';
/*
 * READ-ONLY diagnostic — PROD Manager "kỳ 08/2026 không xuất hiện ở Thẩm định".
 * Zero writes. Fail-closed unless SUPABASE_URL points at PHF_HR_MAIN.
 *
 * Usage (MAIN creds must be exported in the shell, NOT written to .env):
 *   SUPABASE_URL=https://byhpcexmjzqpctyvfczd.supabase.co \
 *   SUPABASE_SECRET_KEY=<service_role_key> \
 *   node scripts/checklist-08-2026-blocker-trace-readonly.js --manager <MGR_EMP_CODE> [--emp <EMP_CODE> --emp <EMP_CODE> ...] [--period 2026-08]
 *
 * Reproduces exactly what api/_lib/checklist-monthly.js:myMonthlyReviewSummaries()
 * + monthlyReviewVisible() + getChecklistMonthlyReviewAccess() would compute for
 * that manager, using the SAME subjectMatchesScope() source of truth.
 */
const { createClient } = require('@supabase/supabase-js');
const { subjectMatchesScope } = require('../api/_lib/checklist-scope');

const MAIN_REF = 'byhpcexmjzqpctyvfczd';
const url = String(process.env.SUPABASE_URL || '').trim();
const key = String(process.env.SUPABASE_SECRET_KEY || '').trim();
if (!url || !key) { console.error('ABORT: SUPABASE_URL / SUPABASE_SECRET_KEY not set (export MAIN creds for this one command).'); process.exit(2); }
if (!url.includes(MAIN_REF)) { console.error('ABORT (fail-closed): SUPABASE_URL is not PHF_HR_MAIN (' + MAIN_REF + '). Got host: ' + url.replace(/^https?:\/\//,'').split('.')[0]); process.exit(2); }

const args = process.argv.slice(2);
function opt(name){ const i = args.indexOf(name); return i >= 0 ? args[i+1] : ''; }
function optAll(name){ const out=[]; args.forEach((a,i)=>{ if(a===name && args[i+1]) out.push(args[i+1]); }); return out; }
const MGR = String(opt('--manager') || '').toUpperCase().trim();
const EMPS = optAll('--emp').map(s => s.toUpperCase().trim()).filter(Boolean);
const PERIOD = /^\d{4}-\d{2}$/.test(opt('--period')) ? opt('--period') : '2026-08';

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const U = v => String(v == null ? '' : v).toUpperCase().trim();
const T = v => String(v == null ? '' : v).trim();

(async () => {
  console.log('=== READ-ONLY trace · MAIN ' + MAIN_REF + ' · period ' + PERIOD + (MGR ? ' · manager ' + MGR : '') + ' ===\n');

  // 1) Period row
  const per = await db.from('checklist_monthly_periods').select('*').eq('period_month', PERIOD).maybeSingle();
  if (per.error) throw per.error;
  console.log('[1] checklist_monthly_periods ' + PERIOD + ':');
  if (!per.data) { console.log('    >>> NO ROW. Period never created. → ROOT CAUSE D2 (Admin must sync kỳ ' + PERIOD + '). Stopping deep checks.\n'); }
  else console.log('    status=' + per.data.status + '  self_due_at=' + per.data.self_due_at + '  review_due_at=' + per.data.review_due_at + '  scheduled_lock_at=' + per.data.scheduled_lock_at + '  locked_at=' + (per.data.locked_at || '—'));

  // 2) Forms for the period
  const forms = await db.from('checklist_monthly_forms')
    .select('id,period_month,employee_id,employee_code,employee_name,department,title,branch,reviewer_id,reviewer_code,reviewer_name,status,self_submitted_at,review_submitted_at,admin_exception_open,pilot_opened_at')
    .eq('period_month', PERIOD).order('employee_code', { ascending: true }).limit(2000);
  if (forms.error) throw forms.error;
  const rows = forms.data || [];
  console.log('\n[2] checklist_monthly_forms ' + PERIOD + ': ' + rows.length + ' rows');
  const byStatus = {};
  rows.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  console.log('    by status: ' + JSON.stringify(byStatus));
  if (!rows.length) { console.log('    >>> NO FORMS for ' + PERIOD + '. → ROOT CAUSE D2. No permission change. Stopping.\n'); return; }

  const focus = rows.filter(r => !EMPS.length || EMPS.includes(U(r.employee_code)) || (MGR && (U(r.reviewer_code) === MGR)));
  console.log('\n[3] Forms in focus (' + (EMPS.length ? 'employee filter' : (MGR ? 'reviewer_code == manager, or all' : 'all')) + '): ' + focus.length);
  (focus.length ? focus : rows).slice(0, 40).forEach(r => {
    console.log('    ' + U(r.employee_code).padEnd(10) + ' ' + T(r.employee_name).padEnd(22).slice(0,22)
      + ' status=' + T(r.status).padEnd(14)
      + ' reviewer_code=' + (T(r.reviewer_code) || '—').padEnd(10)
      + ' reviewer_id=' + (T(r.reviewer_id) || '—').padEnd(12)
      + ' reviewer_name=' + (T(r.reviewer_name) || '—')
      + (r.admin_exception_open ? '  admin_exception_open=TRUE' : '')
      + (r.pilot_opened_at ? '  pilot' : ''));
  });

  if (!MGR) { console.log('\n(no --manager given; add it to evaluate monthlyReviewVisible / review_scope)\n'); return; }

  // 4) Manager identity + grant (mirrors actor() + getChecklistMonthlyReviewAccess)
  const mgrAsg = await db.from('checklist_employee_assignments')
    .select('employee_id,employee_code,employee_name,department,branch,manager_code,employee_status')
    .eq('employee_code', MGR).maybeSingle();
  if (mgrAsg.error) throw mgrAsg.error;
  console.log('\n[4] Manager assignment (' + MGR + '): ' + (mgrAsg.data
    ? 'employee_id=' + mgrAsg.data.employee_id + ' dept=' + mgrAsg.data.department + ' branch=' + mgrAsg.data.branch + ' status=' + mgrAsg.data.employee_status
    : 'NOT FOUND in checklist_employee_assignments'));
  const mgrId = T(mgrAsg.data && mgrAsg.data.employee_id);

  const today = new Date().toISOString().slice(0, 10);
  const gr = await db.from('checklist_permission_grants')
    .select('id,account_id,employee_code,preset_code,capabilities,view_scope,review_scope,effective_from,effective_to,is_active,updated_at')
    .or('employee_code.eq.' + MGR)
    .order('effective_from', { ascending: false }).limit(20);
  if (gr.error) throw gr.error;
  const grants = (gr.data || []);
  const activeReview = grants.filter(g => g.is_active === true && T(g.effective_from) <= today && (!g.effective_to || T(g.effective_to) >= today))
    .find(g => g.capabilities && g.capabilities.review_monthly === true) || null;
  console.log('\n[5] Grants for ' + MGR + ': ' + grants.length + ' row(s)');
  grants.forEach(g => console.log('    preset=' + T(g.preset_code).padEnd(18) + ' active=' + g.is_active + ' from=' + g.effective_from + ' to=' + (g.effective_to || '∞')
    + ' review_monthly=' + !!(g.capabilities && g.capabilities.review_monthly)
    + ' review_scope=' + JSON.stringify(g.review_scope)));
  if (!activeReview) {
    console.log('\n    >>> NO ACTIVE grant with capabilities.review_monthly for ' + MGR
      + '. → getChecklistMonthlyReviewAccess returns canReview:false → manager sees NOTHING (any period). ROOT CAUSE #4 (grant). No code fix — Admin re-grant.\n');
    return;
  }
  const reviewScope = activeReview.review_scope || { type: 'none', values: [] };
  const identity = { id: mgrId, employeeCode: MGR };

  // 6) For each period form: would monthlyReviewVisible() keep it?
  //    access.people = current assignments, NOT 'Đã nghỉ việc', matched by review_scope.
  const asg = await db.from('checklist_employee_assignments')
    .select('employee_id,employee_code,employee_name,department,title,branch,manager_id,manager_code,employee_status')
    .neq('employee_status', 'Đã nghỉ việc').limit(5000);
  if (asg.error) throw asg.error;
  const inScope = new Set();
  const inScopeCodes = new Set();
  (asg.data || []).forEach(r => {
    if (subjectMatchesScope(r, reviewScope, identity)) { inScope.add(T(r.employee_id)); inScopeCodes.add(U(r.employee_code)); }
  });
  const asgByCode = new Map((asg.data || []).map(r => [U(r.employee_code), r]));
  // also load departed to explain drops
  const departed = await db.from('checklist_employee_assignments')
    .select('employee_code,employee_status').eq('employee_status', 'Đã nghỉ việc').limit(5000);
  const departedSet = new Set((departed.data || []).map(r => U(r.employee_code)));

  console.log('\n[6] monthlyReviewVisible() evaluation for ' + PERIOD + ' forms where this manager plausibly is the reviewer:');
  const cand = rows.filter(r => U(r.reviewer_code) === MGR || (mgrId && T(r.reviewer_id) === mgrId) || (EMPS.length && EMPS.includes(U(r.employee_code))));
  if (!cand.length) console.log('    (no ' + PERIOD + ' form has reviewer_code/reviewer_id == this manager' + (EMPS.length ? ', and none of --emp match' : '') + ')');
  cand.forEach(r => {
    const code = U(r.employee_code);
    const visible = inScope.has(T(r.employee_id)) || inScopeCodes.has(code);
    const cur = asgByCode.get(code);
    const isRevSnap = U(r.reviewer_code) === MGR || (mgrId && T(r.reviewer_id) === mgrId);
    let why = visible ? 'VISIBLE (employee still matches current review_scope)' : 'DROPPED';
    if (!visible) {
      if (departedSet.has(code)) why += ' — employee is Đã nghỉ việc';
      else if (!cur) why += ' — no current assignment row';
      else why += ' — current dept/branch/manager no longer in review_scope (cur: dept=' + cur.department + ' branch=' + cur.branch + ' mgr=' + cur.manager_code + ')';
    }
    console.log('    ' + code.padEnd(10) + ' form.status=' + T(r.status).padEnd(14) + ' reviewerSnapshot==manager? ' + (isRevSnap ? 'YES' : 'no') + '  → ' + why);
  });

  const droppedButOwned = cand.filter(r => {
    const code = U(r.employee_code);
    const visible = inScope.has(T(r.employee_id)) || inScopeCodes.has(code);
    const isRevSnap = U(r.reviewer_code) === MGR || (mgrId && T(r.reviewer_id) === mgrId);
    return !visible && isRevSnap;
  });
  console.log('\n=== VERDICT ===');
  if (droppedButOwned.length) {
    console.log('ROOT CAUSE D (historical read): ' + droppedButOwned.length + ' form(s) of ' + PERIOD
      + ' have reviewer snapshot == this manager but are DROPPED by monthlyReviewVisible() because the employee no longer matches the manager\'s CURRENT review_scope.');
    console.log('Minimal historical-read fix (NO permission/DB/schema change): in monthlyReviewVisible(), also return true when');
    console.log('  (actor.employeeCode && form.reviewer_code.toUpperCase() === actor.employeeCode) || (actor.employeeId && form.reviewer_id === actor.employeeId)');
    console.log('This surfaces ONLY the appraiser\'s own recorded past forms; it does not widen current appraisal authority.');
  } else if (cand.length) {
    console.log('All ' + PERIOD + ' forms owned by this manager are VISIBLE server-side → the 09-only dropdown is a FRONTEND issue (root cause A / roster edge). Staged 1.69.1 UI hardening applies.');
  } else {
    console.log('No ' + PERIOD + ' form is owned by this manager (reviewer_code/reviewer_id). Either wrong manager code, or the reviewer was never assigned. Not a permission bug.');
  }
})().catch(e => { console.error('ERROR:', e && e.message ? e.message : e); process.exit(1); });
