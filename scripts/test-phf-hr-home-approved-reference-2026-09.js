'use strict';
/* PHF HR Home — approved reference visual rebuild (static source check).
 *
 * assets/js/phf-hr-home.js has no execution harness/exported hooks — same
 * static-source-text approach as test-phf-hr-home-thi-dua-activation-2026-09.js.
 *
 * Covers the "home final.png" approved-reference implementation batch:
 *  - hero copy/tags match the approved target text exactly
 *  - Báo cáo / Quản trị top-nav groups added, mirroring the EXISTING
 *    "Hệ thống & Báo cáo" body group 1:1 (no new module/route invented)
 *  - "Công việc cần chú ý" cell tinting (visual only, same 3 real signals)
 *  - "Thông báo mới" wired to the real, already-live listMyTaskNotifications
 *    action (no fabricated notification feed)
 *  - the non-reference "Góc quản trị" quote card is gone (decorative, no
 *    real data, not part of the approved composition)
 *  - no fabricated metrics anywhere (Số liệu nhanh / Lịch trong tuần stay
 *    honest empty-state, no weather widget — no real data source exists
 *    for either in this codebase)
 */
const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync('assets/js/phf-hr-home.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-hr-home.css', 'utf8');
let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); passed++; console.log('PASS', msg); }

check((src.match(/\(/g) || []).length === (src.match(/\)/g) || []).length, 'JS parens balanced (sanity)');
check((css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length, 'CSS braces balanced');

console.log('\n== HERO — exact approved copy ==');
{
  check(src.includes("Nền tảng phát triển<br>nhân sự tại"), 'H1 matches the approved two-line target copy');
  check(src.includes('Kết nối công việc – Đào tạo – Đánh giá – Thi đua – Quản trị trên một hệ thống, phục vụ người thật, dữ liệu thật, vận hành lâu dài.'),
    'supporting paragraph matches the approved target copy exactly');
  check(src.includes("icon('chart')}Hiệu quả hơn") && src.includes("icon('checklist')}Minh bạch hơn") && src.includes("icon('people')}Phát triển cùng nhau"),
    'the 3 hero concept tags (Hiệu quả hơn / Minh bạch hơn / Phát triển cùng nhau) render with icons, replacing the old generic tags');
  check(!src.includes('Một hệ thống nhân sự thống nhất') && !src.includes('Dữ liệu phục vụ vận hành'),
    'the old placeholder hero tags are gone');
}

console.log('\n== TOP NAV — Báo cáo / Quản trị groups mirror the existing body group ==');
{
  check(/key:'bao-cao',label:'Báo cáo',children:\[\s*\{label:'Báo cáo & Thống kê',soon:true,icon:'chart'\}/.test(src),
    '"Báo cáo" top-nav group added with the SAME soon:true placeholder already used on the Home body card — no new module invented');
  check(/key:'quan-tri',label:'Quản trị',children:\[\s*\{label:'Quản trị hệ thống',href:isAdmin\?'\/admin\/nhan-su':null,disabled:!isAdmin,note:'Dành cho quản trị viên',icon:'gear'\}/.test(src),
    '"Quản trị" top-nav group added, reusing the EXACT existing /admin/nhan-su route + admin-only gate already used by the body card');
}

console.log('\n== "CÔNG VIỆC CẦN CHÚ Ý" — same 3 real signals, now visually tinted ==');
{
  check(css.includes('.phf-hr-attn-cell.is-overdue{background:#fdf1f0'), 'overdue cell gets a pale red tint');
  check(css.includes('.phf-hr-attn-cell.is-soon{background:#fdf6e8'), 'due-soon cell gets a pale yellow tint');
  check(css.includes('.phf-hr-attn-cell.is-attn{background:#eef8f1') && css.includes('.phf-hr-attn-cell.is-attn b{color:#0f7a43}'),
    'attention cell gets a pale green tint (was purple text on white — did not match the reference)');
  check(src.includes("action:'getTaskOverviewV2'"), 'the 3 numbers still come from the same real getTaskOverviewV2 signals — no new data source, styling only');
}

console.log('\n== "THÔNG BÁO MỚI" — real data, not fabricated ==');
{
  check(src.includes("action:'listMyTaskNotifications'"), 'wired to the real, already-live listMyTaskNotifications action (privacy-checked, session-scoped)');
  check(src.includes('Chưa có thông báo mới'), 'honest empty state when the user has zero real notifications — never a fake list');
  check(src.includes('hrTimeAgo'), 'renders a real relative timestamp derived from the actual createdAt field');
}

console.log('\n== NO FABRICATED WIDGETS ==');
{
  check(!/phf-hr-quote|Góc quản trị|HR_QUOTES/.test(src), '"Góc quản trị" decorative quote card removed — not part of the approved reference, no real data');
  check(!/weather|thời tiết|thoi tiet/i.test(src), 'no weather widget added — no real weather data source exists in this codebase');
  check(src.includes('Dữ liệu sẽ hiển thị khi kết nối nguồn.'), '"Số liệu nhanh" keeps its honest empty state — no fabricated headcount/training/competition/checklist numbers');
  check(src.includes('Sự kiện lịch hiển thị khi kết nối nguồn.'), '"Lịch trong tuần" keeps its honest note — no fabricated "N công việc đến hạn hôm nay" count');
}

console.log('\nALL PASS (' + passed + ' checks)');
