'use strict';
// QTTH Accounting Data V1 — LOCAL :3000 browser gate (HTTP walkthrough of the
// exact requests the screen makes). No pixel check — validates route load,
// runtime bundle, upload endpoint, preview payload sections, review-table
// fields, confirm, bounded drilldown.
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:3000';
const PW = 'LocalParity#2026';
const T07 = path.join(__dirname, '..', 'phf-qtth-input', 'accounting_t07.xlsx');
const PERIOD = '2026-08';

let P = 0, F = 0;
const ck = (n, c, x) => { c ? (P++, console.log('  PASS  ' + n)) : (F++, console.error('  FAIL  ' + n + (x != null ? '  -> ' + x : ''))); };

async function login(email) {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  const sc = r.headers.get('set-cookie') || '';
  const j = await r.json().catch(() => ({}));
  if (!j.ok && !sc) throw new Error('login ' + email + ': ' + r.status + ' ' + JSON.stringify(j));
  return sc.split(',').map((s) => s.split(';')[0].trim()).filter(Boolean).join('; ');
}
async function api(cookie, payload) {
  const r = await fetch(BASE + '/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload) });
  const j = await r.json();
  if (!r.ok || j.ok === false) { const e = new Error((j && (j.message || j.error)) || r.status); e.code = j && j.code; throw e; }
  return j.result !== undefined ? j.result : j;
}

(async () => {
  console.log('QTTH Accounting Data V1 — LOCAL :3000 browser gate\n');

  // ---- A. route + shell + bundle -------------------------------------
  const idx = await (await fetch(BASE + '/')).text();
  const routerJs = await (await fetch(BASE + '/assets/js/phf-url-router.js')).text();
  const appJs = await (await fetch(BASE + '/assets/js/qtth/phf-qtth-accounting.js')).text();
  // local server.js has NO SPA deep-route fallback (every deep path 404s, incl.
  // /admin/thi-dua); the client router owns the route. Verify shell + router entry.
  ck('A. SPA shell served + client router owns /admin/qtth/truth-data/accounting',
    /phfHrRoot/.test(idx) && routerJs.includes('/admin/qtth/truth-data/accounting'));
  ck('bundle phf-qtth-accounting.js served (runtime)', appJs.includes('phfQtthRenderAccounting') && appJs.length > 3000);
  ck('C. screen concept string present', appJs.includes('Dữ liệu chi phí kế toán'));
  ck('B. router registers truth-data/accounting for all 3 roles', /admin\/qtth\/truth-data\/accounting/.test(routerJs) && /hv\/qtth\/truth-data\/accounting/.test(routerJs));
  const payrollJs = await (await fetch(BASE + '/assets/js/qtth/phf-qtth-payroll.js')).text();
  ck('B. truth-data dispatcher routes sub=accounting -> phfQtthRenderAccounting', payrollJs.includes("sub === 'accounting'") && payrollJs.includes('phfQtthRenderAccounting'));
  ck('E. bundle never renders raw 86k rows (drilldown slice(0,500) cap)', appJs.includes('slice(0, 500)') || appJs.includes('slice(0,500)'));
  // UX-only pass: operator-first structure present in the served bundle
  ck('UX. plain-VN summary + grouped review in the served bundle',
    appJs.includes('Tóm tắt kỳ') && appJs.includes('phf-qtth-rgroup') && appJs.includes('Cần rà soát') && !/>NEEDS_REVIEW</.test(appJs));
  ck('UX. technical sections are collapsed folds (phf-qtth-fold, no [open])',
    appJs.includes('phf-qtth-fold') && !appJs.includes('phf-qtth-fold" open'));
  const cssTxt = await (await fetch(BASE + '/assets/css/phf-qtth.css?v=1.71.2_qtth_accounting_ux')).text();
  ck('UX. accounting UX styles served', cssTxt.includes('phf-qtth-rgroup') && cssTxt.includes('phf-qtth-statgrid'));

  // ---- session (operator on the QTTH dev allow-list) -----------------
  let cookie, who = '';
  for (const email of ['thanglv150917@gmail.com', 'hr.phuhoacorp@gmail.com', 'hr.phuhoacorp1@gmail.com']) {
    try { cookie = await login(email); who = email; break; } catch (e) { /* try next */ }
  }
  if (!cookie) { console.error('FATAL: no login worked'); process.exit(2); }
  console.log('  (session = ' + who + ')\n');

  const boot = await api(cookie, { action: 'qtthBootstrap' });
  ck('QTTH bootstrap: canManagePermissions (dev-operator or admin)', boot.capabilities && boot.capabilities.canManagePermissions === true, JSON.stringify(boot.capabilities));

  // ---- D + F. upload the real FAST export via the binary endpoint ----
  const buf = fs.readFileSync(T07);
  const upRes = await fetch(BASE + '/api/qtth-accounting-upload?period=' + PERIOD, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Accounting-Filename': encodeURIComponent('accounting_t07.xlsx'), Cookie: cookie },
    body: buf,
  });
  const upJson = await upRes.json();
  ck('D. binary upload endpoint accepts the real 4MB FAST export (HTTP 200)', upRes.status === 200 && upJson.ok === true, upRes.status + ' ' + JSON.stringify(upJson).slice(0, 200));
  const rep = upJson.data;
  ck('F. preview payload: source/debit/cost-scope rows', rep && rep.totals.sourceRows === 85975 && rep.totals.debitRows === 38768 && rep.totals.costScopeRows === 350, JSON.stringify(rep && rep.totals));
  ck('F. preview payload: included/needsReview/excluded', rep.totals.included === 299 && rep.totals.needsReview === 51 && rep.totals.excluded === 0);
  ck('F. preview payload: amounts', rep.amounts.included === 1003597227 && rep.amounts.needsReview === 45150452 && rep.amounts.costScope === 1048747679, JSON.stringify(rep.amounts));
  ck('F. preview payload: account breakdown (topAccounts)', Array.isArray(rep.topAccounts) && rep.topAccounts.length > 0 && rep.topAccounts[0].account && rep.topAccounts[0].byClass);
  ck('F. preview payload: department breakdown', Array.isArray(rep.departmentBreakdown) && rep.departmentBreakdown.some((d) => d.dept === 'PHF-MKT' && d.outOfMaster === true));
  ck('F. preview payload: warnings', Array.isArray(rep.warnings) && rep.warnings.some((w) => /PHF-MKT/.test(w.reason)));
  ck('H. PHF-MKT warning explicit in totals.outOfMasterDepartments', rep.totals.outOfMasterDepartments.indexOf('PHF-MKT') >= 0);
  ck('G. needsReviewAccounts expose account + amount + note', rep.needsReviewAccounts.every((a) => a.account && typeof a.amount === 'number' && a.note));

  // status shows previewed, not current
  const st1 = await api(cookie, { action: 'qtthAccountingStatus', period_month: PERIOD });
  ck('preview not yet current (must confirm)', st1.exists && !st1.current && st1.versions[0].status === 'previewed');

  // ---- G. review-table drilldown: real per-line evidence -------------
  const rev = await api(cookie, { action: 'qtthAccountingListNormalized', period_month: PERIOD, classification: 'NEEDS_REVIEW' });
  ck('G. NEEDS_REVIEW drilldown returns 51 lines', rev.rowCount === 51, rev.rowCount);
  const r0 = rev.rows[0] || {};
  ck('G. each review line carries Tài khoản / Diễn giải / Số tiền / Mã bp / Ngày / Số ct',
    'taiKhoan' in r0 && 'dienGiai' in r0 && 'phatSinhNo' in r0 && 'maBp' in r0 && 'ngayCt' in r0 && 'soCt' in r0, JSON.stringify(Object.keys(r0)));
  ck('VIETNAMESE_DATE_DISPLAY: ngayCt is DD/MM/YYYY (not ISO datetime)',
    /^\d{2}\/\d{2}\/\d{4}$/.test(r0.ngayCt) && !/T\d\d:\d\d/.test(String(r0.ngayCt)), r0.ngayCt);
  ck('J. drilldown is bounded (<= 5000, never 86k)', rev.rows.length <= 5000);

  // ---- I. confirm / version flow -----------------------------------
  const conf = await api(cookie, { action: 'qtthAccountingConfirm', file_id: rep.fileId });
  ck('I. confirm succeeds', conf && conf.alreadyConfirmed === false, JSON.stringify(conf));
  const st2 = await api(cookie, { action: 'qtthAccountingStatus', period_month: PERIOD });
  ck('I. after confirm: current = V1, import active', st2.current && st2.current.version === 1 && st2.importStatus === 'active');

  const inc = await api(cookie, { action: 'qtthAccountingListNormalized', period_month: PERIOD, account: '64121' });
  ck('J. account drilldown 64121 bounded = 105 INCLUDE lines', inc.rowCount === 105 && inc.rows.every((x) => x.classification === 'INCLUDE'), inc.rowCount);

  const rules = await api(cookie, { action: 'qtthAccountingListRules' });
  ck('rules list served (13 seed rules from DB)', rules.rules.length === 13, rules.rules.length);

  console.log(`\n${P} passed, ${F} failed`);
  process.exit(F ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(3); });
