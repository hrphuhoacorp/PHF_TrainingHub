'use strict';
/* PHF HR Home "Số liệu nhanh" — offline targeted regression for the two
 * Supabase-backed aggregate reads (home-quick-stats.js) and the phf-hr-api
 * competition.progress.submittedTotal handler. No network, no real DB. */
const assert = require('assert');
const path = require('path');
const Module = require('module');
const ROOT = path.join(__dirname, '..');
let passed = 0;
function ok(c, m) { assert.ok(c, m); passed++; console.log('PASS', m); }

// ---- stub @supabase/supabase-js so home-quick-stats.js gets a fake client ----
let supaScript = null; // set per-test
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === '@supabase/supabase-js') {
    return { createClient: () => makeFakeSupabase() };
  }
  return origLoad.apply(this, arguments);
};
function makeFakeSupabase() {
  return {
    from(table) {
      const q = { _table: table, _filters: {}, _headCount: null };
      q.select = (cols, opts) => { q._select = cols; if (opts && opts.head) q._head = true; if (opts && opts.count) q._count = opts.count; return q; };
      q.eq = (col, val) => { q._filters[col] = val; return q; };
      q.limit = () => q;
      q.then = (res) => Promise.resolve(supaScript(q)).then(res);
      return q;
    },
  };
}
process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SECRET_KEY = 'fake';
const { getActiveEmployeeCount, getChecklistMonthlyFormCount } = require(path.join(ROOT, 'api/_lib/home-quick-stats'));

(async () => {
  console.log('\n== getActiveEmployeeCount ==');
  supaScript = (q) => {
    ok(q._table === 'employee_profiles', 'reads employee_profiles');
    ok(q._filters.employment_status === 'active', 'filters employment_status = active server-side');
    ok(q._select === 'employee_code', 'selects only the employee_code column (no PII, no full roster)');
    return { data: [{ employee_code: 'PHF001' }, { employee_code: 'phf001' }, { employee_code: ' PHF002 ' }, { employee_code: '' }, { employee_code: null }, { employee_code: 'PHF003' }], error: null };
  };
  let r = await getActiveEmployeeCount();
  ok(JSON.stringify(r) === JSON.stringify({ count: 3 }), 'dedupes by normalized employee_code, drops blanks -> { count: 3 } (got ' + JSON.stringify(r) + ')');

  supaScript = () => ({ data: null, error: { message: 'boom' } });
  let threw = false;
  try { await getActiveEmployeeCount(); } catch (e) { threw = true; ok(e.statusCode === 502, 'source error -> throws (Home turns the cell into "—", never 0)'); }
  ok(threw, 'getActiveEmployeeCount rejects on DB error');

  console.log('\n== getChecklistMonthlyFormCount ==');
  supaScript = (q) => {
    ok(q._table === 'checklist_monthly_forms', 'reads checklist_monthly_forms (the canonical live phiếu table)');
    ok(q._head === true && q._count === 'exact', 'head:true + count:exact — zero rows transferred, bounded server-side count');
    ok(/^\d{4}-(0[1-9]|1[0-2])$/.test(q._filters.period_month), 'period_month filter is a valid YYYY-MM (default = current ICT month)');
    return { count: 128, error: null };
  };
  r = await getChecklistMonthlyFormCount({});
  ok(r.count === 128 && /^\d{4}-\d{2}$/.test(r.month), 'returns { month, count } aggregate only (got ' + JSON.stringify(r) + ')');
  supaScript = (q) => { ok(q._filters.period_month === '2026-03', 'explicit valid month is honoured'); return { count: 5, error: null }; };
  r = await getChecklistMonthlyFormCount({ month: '2026-03' });
  ok(r.month === '2026-03' && r.count === 5, 'explicit month -> { month:"2026-03", count:5 }');
  supaScript = (q) => { ok(/^\d{4}-\d{2}$/.test(q._filters.period_month) && q._filters.period_month !== '2026-13', 'garbage month rejected -> falls back to current ICT month'); return { count: 0, error: null }; };
  await getChecklistMonthlyFormCount({ month: '2026-13' });

  console.log('\n== competition.progress.submittedTotal (phf-hr-api) — source + no-campaign path ==');
  const progress = require(path.join(ROOT, 'services/phf-hr-api/lib/competition-progress'));
  const campaignsMod = require(path.join(ROOT, 'services/phf-hr-api/lib/competition-campaigns'));
  const svcMod = require(path.join(ROOT, 'services/phf-hr-api/lib/competition-service'));
  const fnSrc = progress.submittedTotal.toString();

  ok(typeof progress.submittedTotal === 'function', 'submittedTotal exported from competition-progress.js');
  ok(typeof svcMod.HANDLERS['competition.progress.submittedTotal'] === 'function', 'wired into competition-service.js HANDLERS');
  ok(svcMod.isReadAction('competition.progress.submittedTotal'), 'registered as a READ action (uses the read connection)');
  ok(/status <> 'draft'/.test(fnSrc), "SQL counts non-draft submissions only (submitted/needs_revision/approved/rejected/finalized)");
  ok(/AT TIME ZONE 'Asia\/Ho_Chi_Minh'/.test(fnSrc), 'period bounded by submitted_at in Asia/Ho_Chi_Minh');
  ok(!/status IN \(/.test(fnSrc) && !/effective_score/.test(fnSrc) && !/current_level_order/.test(fnSrc) && !/first_approved_at/.test(fnSrc),
    'NOT filtered by approval / score 0-2-5 / reviewer / leaderboard eligibility');
  ok(!/resolveAuthority|requireCompetitionAdmin|viewParticipationProgress/.test(fnSrc),
    'no capability gate — any authenticated actor may read this identity-free aggregate');
  ok(/campaigns\.getActiveCampaign\(config\)/.test(fnSrc) && !/a4a208be|cau-hoi-khach-hang/.test(fnSrc),
    'active campaign resolved dynamically via getActiveCampaign — no hard-coded campaign id/code');
  ok(/count\(\*\)/.test(fnSrc) && !/SELECT s\.\*|SELECT \*|author_employee_code/.test(fnSrc),
    'returns only count(*) — never selects participant rows/identities');

  const origGetActive = campaignsMod.getActiveCampaign;
  campaignsMod.getActiveCampaign = async () => null; // no active campaign -> must short-circuit BEFORE any readTx
  const out = await progress.submittedTotal({}, {}, {});
  ok(out && out.submittedTotal === 0 && out.campaignId === null, 'no active campaign -> { campaignId:null, submittedTotal:0 } (never touches the DB)');
  ok(/^\d{4}-\d{2}$/.test(out.period), 'period still a valid current ICT month');
  campaignsMod.getActiveCampaign = origGetActive;

  Module._load = origLoad; Module._resolveFilename = origResolve;

  console.log('\nALL PASS (' + passed + ' checks)');
})();
