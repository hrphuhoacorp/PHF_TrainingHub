'use strict';
/*
 * Regression — 3 final Checklist UI fixes (CSS-only, source-scan):
 *   1. Parent nav-group headings clearer/more visual (divider + accent + larger, higher-contrast).
 *   2. On mobile horizontal scroll, table header stays column-aligned with the body
 *      (the head row's first cell is sticky-left together with the body first cells).
 *   3. "Chỉ tiêu" column stays visible (sticky left) while scrolling horizontally so
 *      CT-01/CT-02/CT-03 are always readable.
 *
 * NO business/DB/RPC/permission/score change. No grid-template-columns / gap / min-width change.
 *
 *   node scripts/test-checklist-nav-parent-and-sticky-column.js
 */
const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); failed++; } else console.log('PASS: ' + m); };

const css = fs.readFileSync(path.resolve(__dirname, '..', 'assets/css/phf-checklist.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const app = fs.readFileSync(path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js'), 'utf8');

function block(sel) {
  const i = css.indexOf(sel + '{');
  if (i < 0) return '';
  const s = css.indexOf('{', i), e = css.indexOf('}', s);
  return css.slice(s + 1, e);
}

// ---------- 1. Parent nav-group headings ----------
const ng = block('.phfck-nav-group');
ok(/border-top:1px solid/.test(ng), '1a. nav-group has a top divider between clusters');
ok(/\.phfck-nav-group:first-child\{[^}]*border-top:0/.test(css), '1b. first cluster has no divider');
ok(/\.phfck-nav-group:before\{[^}]*background:rgba\(255,255,255/.test(css), '1c. accent bar before each cluster label');
const ngSpan = block('.phfck-nav-group span');
ok(/font-size:11px/.test(ngSpan), '1d. label bumped to 11px (was 10px)');
ok(/color:rgba\(255,255,255,\.74\)/.test(ngSpan), '1e. label contrast raised to .74 (was .5)');
ok(/@media\(max-width:760px\)\{[^@]*\.phfck-manager-sidebar \.phfck-nav-group\{[^}]*border-right:1px solid/.test(css.replace(/\n/g, '')),
  '1f. mobile: cluster headings become inline separators on the horizontal nav strip (no broken vertical divider)');
ok(/navGroup\('TỔNG QUAN & KẾT QUẢ'[\s\S]{0,180}navGroup\('NHÂN SỰ & PHÂN CÔNG'/.test(app),
  '1g. the 4 locked clusters still rendered via navGroup() (IA unchanged)');

// ---------- 2 + 3. Sticky "Chỉ tiêu" column + header alignment ----------
// one shared rule: `.phfck-self-row>:first-child, .phfck-review-row>:first-child, .phfck-employee-result-row>:first-child{position:sticky;left:0;...background:inherit}`
const stickyRule = css.slice(css.indexOf('.phfck-self-row>:first-child'), css.indexOf('.phfck-self-row>:first-child') + 260);
['.phfck-self-row>:first-child', '.phfck-review-row>:first-child', '.phfck-employee-result-row>:first-child'].forEach(s => {
  ok(stickyRule.includes(s), '2/3a. ' + s + ' is in the shared sticky-left rule');
});
ok(/position:sticky/.test(stickyRule) && /left:0/.test(stickyRule), '2/3b. shared rule = position:sticky; left:0');
ok(/background:inherit/.test(stickyRule), '2/3c. sticky cell background:inherit (opaque, matches its row variant)');
// the head row's first cell is covered by the same "row > :first-child" selector => stays aligned with body when scrolling
ok(/\.phfck-self-row\.is-head>:first-child,\s*\.phfck-review-row\.is-head>:first-child,\s*\.phfck-employee-result-row\.is-head>:first-child\{[^}]*z-index:5/.test(css),
  '2c. head-row first cell gets the top z-index (corner stays above body sticky cells)');
// gradient headers (employee / manager-my-work) need an explicit opaque colour for the sticky cell
ok(/\[data-checklist-role="employee"\] \.phfck-self-row\.is-head>:first-child,[\s\S]{0,220}\{background:#08754f\}/.test(css),
  '2d. gradient headers: sticky first cell gets an explicit opaque green (inherit would be transparent)');
// rows carry an explicit background so background:inherit resolves to an opaque colour
ok(/\.phfck-self-row\{[^}]*background:#fff/.test(css), '3d. .phfck-self-row has an explicit background for inherit to resolve');
ok(/\.phfck-review-row\{[^}]*background:#fff/.test(css), '3e. .phfck-review-row has an explicit background');
ok(/\.phfck-employee-result-row\{[^}]*background:#fff/.test(css), '3f. .phfck-employee-result-row has an explicit background');

// ---------- guardrails: no layout / business change ----------
ok(/\.phfck-self-row\{[^}]*grid-template-columns:minmax\(250px,1\.5fr\) 100px 80px 120px minmax\(180px,1fr\)/.test(css),
  'G1. .phfck-self-row grid-template-columns unchanged');
ok(/\.phfck-self-row\{[^}]*min-width:850px/.test(css) && /\.phfck-review-row\{[^}]*min-width:850px/.test(css),
  'G2. row min-width unchanged (still scrolls, not squeezed)');
ok(/\.phfck-self-table\{[^}]*overflow:auto/.test(css) && /\.phfck-review-table\{[^}]*overflow:auto/.test(css),
  'G3. table containers still overflow:auto (mobile fix from 1.70.2 intact)');
ok(!/automatic\?'<input[^']*data-phfck-self-value/.test(app), 'G4. CT-03 automatic row still has no input (read-only)');
ok(/🔒 Điểm hệ thống<\/small>/.test(app), 'G5. score-cell polish from 1.70.2 intact');

if (failed) { console.error('\n' + failed + ' check(s) failed.'); process.exit(1); }
console.log('\nALL PASS (nav parent headings clearer; "Chỉ tiêu" column sticky + header aligned on horizontal scroll; no layout/business change)');
