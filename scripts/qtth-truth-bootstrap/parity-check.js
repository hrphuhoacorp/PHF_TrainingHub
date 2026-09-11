'use strict';
/*
 * PHF HR / QTTH — TRUTH DATA BOOTSTRAP · PARITY CHECKER (Phase 2 gate).
 * Read-only. Compares a target DB against the promotion bundle.
 *
 *   node scripts/qtth-truth-bootstrap/parity-check.js --target-env <db.env> [--schema all|payroll|accounting]
 *
 * PASS iff, for the bundle's periods:
 *   PAYROLL   — every period present, confirmed, row count + personnel-cost total
 *               + reconciliation match the bundle; template fingerprint matches.
 *   ACCOUNTING— 350 cost rows · 334 INCLUDE / 1,026,022,214 · 16 EXCLUDE / 22,725,465
 *               · 0 NEEDS_REVIEW · cost-scope total 1,048,747,679 · Cost Dictionary
 *               entries · operator rules (active/disabled) · rule-history rows
 *               · item decisions · PHF-MKT flagged · no raw 85,975 fact rows.
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { Client } = require(path.join(REPO, 'services/phf-hr-api/node_modules/pg'));
const T = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-template'));
const { normalizeGrid } = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-normalize'));
const COST = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-payroll-cost-model'));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const WHICH = opt('--schema', 'all');
const TARGET_ENV = opt('--target-env');
if (!TARGET_ENV) { console.error('need --target-env'); process.exit(2); }
const BUNDLE = path.join(REPO, 'docs/qtth-truth-bootstrap');

function loadEnv(p) { const o = {}; for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } return o; }
function grid(f) { let s = fs.readFileSync(f, 'utf8'); if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); return s.split(/\r?\n/).map((l) => l.split('\t')); }
const round0 = (x) => Math.round(Number(x) || 0);
const payPeriods = JSON.parse(fs.readFileSync(path.join(BUNDLE, 'payroll_periods.json'), 'utf8'));
const accSummary = JSON.parse(fs.readFileSync(path.join(BUNDLE, 'accounting_summary.json'), 'utf8'));

let P = 0, F = 0;
const ck = (n, c, x) => { c ? (P++, console.log('  PASS  ' + n)) : (F++, console.error('  FAIL  ' + n + (x != null ? '  -> ' + x : ''))); };

const PERIOD_TAG = { '2026-01': 'T1', '2026-02': 'T2', '2026-03': 'T3', '2026-04': 'T4', '2026-05': 'T5', '2026-06': 'T6', '2026-07': 'T7' };

(async () => {
  const env = loadEnv(TARGET_ENV);
  const c = new Client({ host: env.PHF_HR_DB_HOST, port: +env.PHF_HR_DB_PORT, database: env.PHF_HR_DB_NAME, user: env.PHF_HR_DB_RUNTIME_USER || env.PHF_HR_DB_USER, password: env.PHF_HR_DB_RUNTIME_PASSWORD || env.PHF_HR_DB_PASSWORD });
  await c.connect();
  try { await c.query('SET ROLE phf_hr_app'); } catch (_) {}
  const q = (s, p) => c.query(s, p).then((r) => r.rows);
  console.log('parity vs bundle', accSummary.bundleId, '· target', (await q('select current_database() d'))[0].d, '\n');

  if (WHICH === 'all' || WHICH === 'payroll') {
    console.log('== PAYROLL ==');
    for (const per of payPeriods.periods) {
      const imp = (await q('SELECT * FROM payroll.import WHERE period_month = $1', [per.periodMonth]))[0];
      ck(per.periodMonth + ' import present + active', imp && imp.status === 'active' && imp.current_file_id);
      if (!imp) continue;
      const file = (await q('SELECT * FROM payroll.import_file WHERE id = $1', [imp.current_file_id]))[0];
      ck(per.periodMonth + ' current file confirmed', file && file.status === 'confirmed');
      ck(per.periodMonth + ' template fingerprint = bundle', file && file.template_fingerprint === per.templateFingerprint, file && file.template_fingerprint);
      const rows = await q('SELECT * FROM payroll.normalized WHERE file_id = $1', [imp.current_file_id]);
      ck(per.periodMonth + ' normalized row count = ' + per.normalizedRows, rows.length === per.normalizedRows, rows.length);
      const recs = rows.map((r) => ({ employeeCode: r.employee_code, fields: Object.fromEntries(['base_salary_bhxh', 'job_allowance', 'base_standard_total_1', 'std_income_total_1to9', 'worked_salary_total_1', 'allowance_actual_total_2', 'bonus_total_3', 'grand_total_4', 'internal_deduct_total_5', 'income_after_internal_5', 'statutory_deduct_total_6', 'income_after_deduct_6', 'tax_taxable_income', 'tax_assessable_income', 'tax_dependents', 'tax_pit_amount', 'final_net_after_tax', 't13_revenue_bonus', 'reconcile_adjust'].map((k) => [k, r[k] == null ? null : Number(r[k])])), sourceDetail: r.source_detail || {} }));
      const agg = COST.aggregatePeriodCost(recs);
      ck(per.periodMonth + ' personnel-cost total = ' + per.personnelCostTotal.toLocaleString(), round0(agg.totalPersonnelCost) === per.personnelCostTotal, round0(agg.totalPersonnelCost));
    }
  }

  if (WHICH === 'all' || WHICH === 'accounting') {
    console.log('\n== ACCOUNTING ==');
    const imp = (await q("SELECT * FROM accounting.import WHERE period_month = '2026-07'"))[0];
    ck('import 2026-07 present + active', imp && imp.status === 'active' && imp.current_file_id);
    const file = imp ? (await q('SELECT * FROM accounting.import_file WHERE id = $1', [imp.current_file_id]))[0] : null;
    ck('current file confirmed', file && file.status === 'confirmed');
    const g = await q('SELECT classification, count(*) n, COALESCE(SUM(phat_sinh_no),0)::numeric amt FROM accounting.normalized WHERE file_id = $1 GROUP BY 1', [imp.current_file_id]);
    const by = { INCLUDE: { n: 0, amt: 0 }, EXCLUDE: { n: 0, amt: 0 }, NEEDS_REVIEW: { n: 0, amt: 0 } };
    for (const x of g) by[x.classification] = { n: Number(x.n), amt: Number(x.amt) };
    const total = by.INCLUDE.n + by.EXCLUDE.n + by.NEEDS_REVIEW.n;
    ck('cost rows = 350', total === 350, total);
    ck('INCLUDE = 334 / 1,026,022,214', by.INCLUDE.n === 334 && round0(by.INCLUDE.amt) === 1026022214, `${by.INCLUDE.n}/${round0(by.INCLUDE.amt)}`);
    ck('EXCLUDE = 16 / 22,725,465', by.EXCLUDE.n === 16 && round0(by.EXCLUDE.amt) === 22725465, `${by.EXCLUDE.n}/${round0(by.EXCLUDE.amt)}`);
    ck('NEEDS_REVIEW = 0', by.NEEDS_REVIEW.n === 0);
    ck('cost-scope total = 1,048,747,679', round0(by.INCLUDE.amt + by.EXCLUDE.amt + by.NEEDS_REVIEW.amt) === 1048747679);
    ck('I + E + NR reconciles to 350', total === 350);
    const dec = Number((await q('SELECT count(*) n FROM accounting.item_decision'))[0].n);
    ck('item decisions = ' + accSummary.operatorRules.itemDecisions, dec === accSummary.operatorRules.itemDecisions, dec);
    const rulesActive = Number((await q("SELECT count(*) n FROM accounting.classification_rule WHERE origin='operator' AND is_active"))[0].n);
    const rulesDisabled = Number((await q("SELECT count(*) n FROM accounting.classification_rule WHERE origin='operator' AND NOT is_active"))[0].n);
    ck('operator rules active = ' + accSummary.operatorRules.active, rulesActive === accSummary.operatorRules.active, rulesActive);
    ck('operator rules disabled = ' + accSummary.operatorRules.disabled, rulesDisabled === accSummary.operatorRules.disabled, rulesDisabled);
    ck('no operator rule fires on account alone (all combo w/ description allTokens)',
      (await q("SELECT match_value FROM accounting.classification_rule WHERE origin='operator'")).every((r) => {
        const mv = typeof r.match_value === 'string' ? JSON.parse(r.match_value) : r.match_value;
        const all = mv.all || [];
        return all.some((s) => s.matchKind === 'account_exact') && all.some((s) => s.matchKind === 'description' && Array.isArray((s.matchValue || {}).allTokens) && s.matchValue.allTokens.length > 0);
      }));
    const hist = Number((await q('SELECT count(*) n FROM accounting.rule_history'))[0].n);
    ck('rule history rows = ' + accSummary.operatorRules.historyRows, hist === accSummary.operatorRules.historyRows, hist);
    const de = Number((await q('SELECT count(*) n FROM accounting.cost_dictionary_entry e JOIN accounting.cost_dictionary d ON d.id=e.dictionary_id WHERE d.is_current'))[0].n);
    ck('cost dictionary entries = ' + accSummary.costDictionary.entryCount, de === accSummary.costDictionary.entryCount, de);
    ck('PHF-MKT rows flagged out-of-master', (await q("SELECT bool_and(ma_bp_out_of_master) b, count(*) n FROM accounting.normalized WHERE ma_bp='PHF-MKT'"))[0].b === true);
    ck('no 911 double-count in normalized', Number((await q("SELECT count(*) n FROM accounting.normalized WHERE tk_doi_ung LIKE '911%'"))[0].n) === 0);
    ck('NO raw 85,975 fact table (normalized rows per file < 1000)',
      Number((await q('SELECT COALESCE(MAX(n),0) m FROM (SELECT count(*) n FROM accounting.normalized GROUP BY file_id) x'))[0].m) < 1000);
  }

  await c.end();
  console.log(`\n${P} passed, ${F} failed`);
  console.log(F ? 'PARITY = FAIL' : 'PARITY = PASS');
  process.exit(F ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(3); });
