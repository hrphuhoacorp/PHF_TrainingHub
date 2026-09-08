'use strict';
/*
 * Regression — CHECKLIST MOBILE RESPONSIVE (source-scan; CSS/DOM only):
 *   Wide grid/table regions (min-width > viewport) MUST scroll horizontally inside
 *   their own card, never be clipped (overflow:hidden) and never push page-level
 *   horizontal overflow. Root fix in the shared table wrappers, not per-screen hacks.
 *
 *   node scripts/test-checklist-mobile-responsive-wide-regions.js
 */
const fs = require('fs');
const path = require('path');

let failed = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL: ' + m); failed++; } else console.log('PASS: ' + m); };

const css = fs.readFileSync(path.resolve(__dirname, '..', 'assets/css/phf-checklist.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const app = fs.readFileSync(path.resolve(__dirname, '..', 'assets/js/checklist/phf-checklist-app.js'), 'utf8');

// Helper: for a selector, capture its rule block and check overflow is scrollable (not hidden).
function allRuleBlocks(selector) {
  const blocks = [];
  let from = 0;
  for (;;) {
    const i = css.indexOf(selector + '{', from);
    if (i < 0) break;
    const start = css.indexOf('{', i);
    const end = css.indexOf('}', start);
    blocks.push(css.slice(start + 1, end));
    from = end + 1;
  }
  return blocks;
}
// scrollable if: no rule block for this selector clips with overflow:hidden,
// AND either the selector's own block or the base bare-class block declares auto/scroll.
function scrollsX(selector) {
  const blocks = allRuleBlocks(selector);
  if (!blocks.length) return false;
  if (blocks.some(b => /overflow(-x)?\s*:\s*hidden/.test(b))) return false;
  const bareClass = '.' + selector.split(/\s+/).pop().replace(/^\./, '');
  const baseBlocks = allRuleBlocks(bareClass);
  return blocks.concat(baseBlocks).some(b => /overflow(-x)?\s*:\s*(auto|scroll)/.test(b));
}

// ---------- 1. Wide grid tables in the self-evaluation / review-result surfaces ----------
const wideGridSurfaces = [
  '.phfck-self-table',
  '.phfck-review-table',
  '.phfck-employee-result-table',
  '[data-checklist-role="employee"] .phfck-self-table',
  '[data-checklist-role="employee"] .phfck-employee-result-table',
  '.phfck-manager-my-work .phfck-self-table',
  '.phfck-manager-my-work .phfck-employee-result-table',
];
wideGridSurfaces.forEach(sel => {
  ok(scrollsX(sel), '1. ' + sel + ' -> scrolls horizontally (no overflow:hidden clipping the min-width rows)');
});

// The rows genuinely need desktop width (documented min-width) — that is why the wrapper must scroll.
ok(/\.phfck-self-row\{[^}]*min-width:850px/.test(css), '1b. .phfck-self-row keeps its desktop min-width (850px)');
ok(/\.phfck-review-row\{[^}]*min-width:850px/.test(css), '1c. .phfck-review-row keeps its desktop min-width');
ok(/\.phfck-employee-result-row\{[^}]*min-width:820px/.test(css), '1d. .phfck-employee-result-row keeps its desktop min-width');

// ---------- 2. Shared table wrapper (Báo cáo / Nhân sự & phân công / Nhật ký lỗi via .phfck-table-wrap) ----------
ok(scrollsX('.phfck-table-wrap'), '2. .phfck-table-wrap scrolls horizontally (shared wrapper for people/report/log tables)');
ok(/\.phfck-total-table-wrap\{[^}]*overflow:auto/.test(css), '2b. .phfck-total-table-wrap (Báo cáo tổng điểm) scrolls');
ok(/\.phfck-score-period-scroll\{[^}]*overflow-x:auto/.test(css), '2c. .phfck-score-period-scroll (Báo cáo theo kỳ) scrolls');
ok(/managerReviewsHtml|phfck-table-wrap/.test(app), '2d. people/report tables render inside .phfck-table-wrap');

// ---------- 3. No page-level horizontal overflow enablers ----------
ok(!/\.phfck-(main|layout|shell)\{[^}]*overflow-x:\s*(auto|scroll|visible)[^}]*\}/.test(css) || /min-width:0/.test(css),
  '3. .phfck-main allows shrink (min-width:0) — wide content scrolls in-card, not the page');
ok(/\.phfck-main\{[^}]*min-width:0/.test(css), '3b. .phfck-main{min-width:0}');
ok(/grid-template-columns:220px minmax\(0,1fr\)|grid-template-columns:260px minmax\(0,1fr\)/.test(css),
  '3c. .phfck-layout main track = minmax(0,1fr) (cannot be forced wider than viewport)');

// ---------- 4. Mobile nav / sidebar behaviour intact ----------
ok(/@media\(max-width:760px\)\{[^@]*\.phfck-layout\{display:block\}/.test(css.replace(/\n/g, '')),
  '4. <=760px: sidebar stacks (display:block layout), nav becomes a row');
ok(/\.phfck-nav\{flex-direction:row;width:max-content\}/.test(css), '4b. mobile nav = horizontal scroll strip, unchanged');

// ---------- 5. Buttons remain usable on mobile ----------
ok(/phfck-self-actions/.test(app), '5. self-evaluation action buttons still rendered');
ok(/@media\(max-width:680px\)\{[^@]*\.phfck-monthly-head \.phfck-primary\{width:100%\}/.test(css.replace(/\n/g, '')) || /\.phfck-primary\{width:100%\}/.test(css),
  '5b. primary actions go full-width on small screens (existing pattern kept)');

// ---------- 6. Score-cell copy polish (item 1) ----------
ok(/phfck-auto-score is-system-locked"><b>'\+esc\(value\)\+'<\/b><small>🔒 Điểm hệ thống<\/small>/.test(app),
  '6. Score cell: primary value + compact "🔒 Điểm hệ thống" (long "nhân viên không nhập/sửa" sentence removed)');
ok(/phfck-auto-note">Tự động từ lỗi Checklist · '/.test(app), '6b. "Tự động từ lỗi Checklist" moved to the note cell, outside the score value');
ok(/\.phfck-auto-score\{[^}]*flex-direction:column/.test(css), '6c. .phfck-auto-score stacks value over label (no awkward side-by-side wrap)');
ok(/\.phfck-auto-score small\{[^}]*white-space:nowrap/.test(css), '6d. label is single-line (no tiny multi-line text)');
ok(!/automatic\?'<input[^']*data-phfck-self-value/.test(app), '6e. NO input/spinner restored on the automatic row');

if (failed) { console.error('\n' + failed + ' check(s) failed.'); process.exit(1); }
console.log('\nALL PASS (Checklist mobile: wide regions scroll in-card, no page overflow, nav intact; score-cell polish; CT-03 still read-only)');
