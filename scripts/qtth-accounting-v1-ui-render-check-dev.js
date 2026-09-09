'use strict';
/*
 * PHF HR — QTTH · Accounting Data V1 · Operator-UX render check (offline, no
 * DB/network). Sandbox-loads phf-qtth-accounting.js and renders each block from
 * the REAL T07 funnel (services/phf-hr-api/lib/qtth-accounting-normalize).
 * Asserts the Operator-UX contract: plain Vietnamese, period summary first,
 * NEEDS_REVIEW grouped (8 groups, no 51-row wall by default), technical
 * sections collapsed, PHF-MKT plain-VN warning, Vietnamese dates.
 *
 * Run: node scripts/qtth-accounting-v1-ui-render-check-dev.js
 */
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..');
const { runFunnel } = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-accounting-normalize'));
const { SEED_RULES } = require(path.join(REPO, 'services/phf-hr-api/lib/qtth-accounting-classify'));
const T07 = path.join(REPO, 'phf-qtth-input', 'accounting_t07.xlsx');

let P = 0, F = 0;
const ck = (n, c, x) => { c ? (P++, console.log('  PASS  ' + n)) : (F++, console.error('  FAIL  ' + n + (x != null ? '  -> ' + x : ''))); };

(async () => {
  if (!fs.existsSync(T07)) { console.error('MISSING ' + T07); process.exit(2); }
  const { report } = await runFunnel(fs.readFileSync(T07), { rules: SEED_RULES });

  const src = fs.readFileSync(path.join(REPO, 'assets/js/qtth/phf-qtth-accounting.js'), 'utf8');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const window = { __qtthShared: { esc, currentPeriod: () => '2026-07' } };
  const document = { addEventListener() {} };
  new Function('window', 'document', src)(window, document);
  const H = window.__qtthAccountingTestHooks;
  ck('test hooks exposed', H && typeof H.summaryBlock === 'function' && typeof H.reviewGroupsBlock === 'function');

  console.log('\nQTTH Accounting Data V1 — Operator-UX render check\n');

  // ---- A. TÓM TẮT KỲ leads, plain Vietnamese --------------------------
  const summary = H.summaryBlock(report);
  ck('A. summary leads with Tóm tắt kỳ', /Tóm tắt kỳ/.test(summary));
  ck('A. plain-VN stat labels present', ['Dữ liệu nguồn', 'Chi phí phát hiện', 'Đã nhận diện', 'Cần rà soát'].every((s) => summary.includes(s)));
  ck('A. shows the canonical numbers', summary.includes('85.975') && summary.includes('350') && summary.includes('299') && summary.includes('51'));
  ck('9. no engineering terms leak into the summary', !/NEEDS_REVIEW|INCLUDED|cost scope|normalized|classification rule/i.test(summary));

  // ---- C. NEEDS REVIEW — GROUP FIRST, no 51-row wall -----------------
  const groups = H.reviewGroupsBlock(report);
  const groupCount = (groups.match(/phf-qtth-rgroup"/g) || []).length + (groups.match(/phf-qtth-rgroup /g) || []).length;
  ck('C. exactly 8 account groups rendered', groupCount === 8, groupCount);
  const CANON = ['64177', '6423', '6414', '6422', '64274', '64188', '64273', '64178'];
  ck('C. all 8 canonical unresolved accounts shown', CANON.every((a) => groups.includes('<b>' + a + '</b>')));
  ck('C. default render shows ZERO raw review rows (groups collapsed)', !/<tbody>\s*<tr>/.test(groups) && !groups.includes('phf-qtth-table-compact'), 'found a rendered row table');
  ck('C. each group has a "Xem N khoản" drill button', (groups.match(/data-acc-toggle=/g) || []).length === 8);
  ck('C. no final INCLUDE/EXCLUDE decision buttons yet', !/Đưa vào khoản này|Loại trừ khoản này|data-acc-decide/.test(groups));

  // account-group drilldown (simulate one open) — reviewGroupsBlock reads A.openAcct
  // via module state; exercise reviewGroupDetail indirectly is covered by the
  // live browser gate. Here assert the toggle wiring + count text.
  ck('C. group row shows count + amount', groups.includes('khoản · ') && /đ<\/span>/.test(groups));

  // ---- 5/6. TECHNICAL SECTIONS collapsed ---------------------------
  window.__accModule_A = null;
  const tech = H.techDetails(report, { versions: [{ version: 1, status: 'previewed', sourceRows: 85975, included: 299, needsReview: 51 }] });
  ck('5. technical sections are <details> and NOT open by default', /<details class="phf-qtth-fold">/.test(tech) && !/<details class="phf-qtth-fold" open/.test(tech));
  ck('6. "Chi tiết theo tài khoản" collapsed', tech.includes('Chi tiết theo tài khoản') && !/open>[^<]*Chi tiết theo tài khoản/.test(tech));
  ck('5. Danh mục phí + Bộ quy tắc phân loại are collapsed folds', tech.includes('>Danh mục phí</summary>') && tech.includes('Bộ quy tắc phân loại'));

  // ---- 7. DEPARTMENT SUMMARY — PHF-MKT plain-VN warning ------------
  const dept = H.deptSummaryBlock(report);
  ck('7. PHF-MKT shown as a chip', dept.includes('PHF-MKT'));
  ck('7. PHF-MKT warning in plain Vietnamese, not "lỗi/thất bại/failed"',
    /chưa nằm trong danh mục bộ phận chuẩn/.test(dept) && !/lỗi|thất bại|failed|error/i.test(dept));
  ck('7. warning states the value is kept, not dropped/renamed', /giữ nguyên/.test(dept));

  // ---- 4/9. Vietnamese date display -------------------------------
  ck('4. fmtDate ISO+TZ -> DD/MM/YYYY', H.fmtDate('2026-07-30T17:00:00.000Z') === '30/07/2026', H.fmtDate('2026-07-30T17:00:00.000Z'));
  ck('4. fmtDate passthrough DD/MM/YYYY', H.fmtDate('31/07/2026') === '31/07/2026');
  ck('4. fmtDate plain ISO date -> DD/MM/YYYY', H.fmtDate('2026-07-31') === '31/07/2026');

  // ---- 8. BUTTON HIERARCHY ---------------------------------------
  const bar = H.actionBar(report, { current: null, versions: [{ version: 1, status: 'previewed', fileId: 'x' }] });
  ck('8. primary action = "Rà soát N khoản" (before confirm text)', /Rà soát 51 khoản/.test(bar));
  ck('8. confirm present but secondary (ghost) + states unresolved remain', /phf-qtth-btn ghost" data-acc-confirm/.test(bar) && /vẫn còn 51 khoản chưa rà soát/.test(bar));

  console.log(`\n${P} passed, ${F} failed`);
  process.exit(F ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(3); });
