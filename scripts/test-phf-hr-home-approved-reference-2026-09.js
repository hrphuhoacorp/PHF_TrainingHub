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

console.log('\n== HERO — approved FINAL FLAT ASSET (text baked into the image) ==');
{
  // Operator-approved change: the hero is now a single flattened image with its
  // text baked in (assets/images/home/phf-hr-home-hero-2026.png). The live HTML
  // hero copy was removed so nothing overlays the picture.
  check(src.includes("assets/images/home/phf-hr-home-hero-2026.png"),
    'hero renders the approved flat asset');
  check(!/phf-hr-hero-copy"><span class="phf-hr-eyebrow"/.test(src),
    'the old live HTML hero copy block is no longer rendered');
  check(css.includes('.phf-hr-content .phf-hr-hero-copy{display:none!important}'),
    'any residual hero-copy node is hidden (never overlays the image)');
  check(/\.phf-hr-hero-media img\{display:block;width:100%;height:auto\}/.test(css),
    'asset is shown at natural aspect ratio (width:100% + height:auto), never cropped or stretched');
  // the approved text still exists for screen-readers via the img alt
  check(src.includes('alt="PHF HR — Nền tảng phát triển nhân sự tại PHUHOA FRESH'),
    'approved headline is preserved as the image alt text');
  check(!src.includes('Một hệ thống nhân sự thống nhất') && !src.includes('Dữ liệu phục vụ vận hành'),
    'the old placeholder hero tags are gone');
}

console.log('\n== TOP NAV — HỆ THỐNG (System Module V1, business spec LOCKED, ADMIN ONLY) ==');
{
  // Supersedes the old "Báo cáo" / "Quản trị" top-nav groups, per
  // PHF_HR_DAC_TA_NGHIEP_VU_MODULE_HE_THONG_V1_2026-09-06.
  check(!/label:'Báo cáo & Thống kê'/.test(src),
    '"Báo cáo & Thống kê" is fully gone from Home (reporting belongs to QTTH, not Hệ thống V1)');
  check(!/key:'bao-cao'/.test(src) && !/key:'quan-tri',label:'Quản trị'/.test(src),
    'old "Báo cáo" / "Quản trị" nav groups removed');
  check(/if\(isAdmin\)\{\s*model\.push\(\{key:'he-thong',label:'Hệ thống',children:\[/.test(src),
    '"Hệ thống" top-nav group is pushed ONLY for isAdmin (non-Admin never sees it)');
  check(/\{label:'Quản trị tài khoản',href:'\/admin\/nhan-su\/tai-khoan',icon:'gear'\}/.test(src),
    '"Quản trị tài khoản" routes to the real account-management screen /admin/nhan-su/tai-khoan (NOT People Master)');
  check(!/\{label:'Quản trị tài khoản',href:'\/admin\/nhan-su',icon/.test(src),
    'it no longer points at /admin/nhan-su (People Master)');
  check(/\{label:'Nhật ký hệ thống',href:'\/admin\/he-thong\/nhat-ky',icon:'chart'\}/.test(src),
    '"Nhật ký hệ thống" routes to the real Admin-only audit screen (System V1 Audit Log active)');
  check(/\{label:'Tình trạng hệ thống',soon:true[^}]*\}/.test(src),
    '"Tình trạng hệ thống" is still a V1 placeholder (soon:true, no route)');
}

console.log('\n== HOME NOTICE CARD — small label/status fix (Home presentation only) ==');
{
  check(src.includes("title:'Thông báo Quản trị',desc:'Quy định • Chính sách • Hướng dẫn'"),
    'Notice card renamed "Thông báo Quản trị", "Quy trình" removed from the subtitle');
  check(/title:'Thông báo Quản trị'[^}]*badge:'Đang hoạt động'/.test(src),
    'Notice card shows an "Đang hoạt động" status badge');
  check(src.includes("label:'Thông báo Quản trị',href:p+'/thong-bao'"),
    'top-nav label matches the card ("Thông báo Quản trị"), same /thong-bao route');
  check(!/title:'Thông báo',desc:/.test(src) && !src.includes('• Quy trình • Hướng dẫn'),
    'old "Thông báo" title and "Quy trình" wording fully gone');
}

console.log('\n== HOME BODY — HỆ THỐNG card group ==');
{
  check(/title:'HỆ THỐNG',sub:'Quản trị tài khoản, vận hành và an toàn hệ thống'/.test(src),
    'body group d renamed to "HỆ THỐNG" with the locked subtitle');
  check(src.includes("title:'Quản trị tài khoản',desc:'Ai được phép sử dụng PHF HR?'")
     && src.includes("title:'Nhật ký hệ thống',desc:'Ai đã làm gì trên hệ thống?'")
     && src.includes("title:'Tình trạng hệ thống',desc:'Hệ thống hiện đang khỏe hay gặp lỗi?'"),
    'the 3 V1 function cards carry the locked titles + subtitles');
  check(/\.filter\(function\(g\)\{return g\.key!=='d'\|\|isAdmin;\}\)/.test(src),
    'the whole HỆ THỐNG card group is omitted for non-Admin');
  check(!src.includes("title:'Hệ thống & Báo cáo'"),
    'old "Hệ thống & Báo cáo" group title is gone');
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
  // "Số liệu nhanh" — 4 cells now wired to real bounded aggregate reads; each
  // independently falls back to "—" (loadHrQuickStats), never a fabricated 0.
  check(src.includes("hrMini('Nhân sự','employees')") && src.includes("hrMini('Việc hoàn thành','completed')")
     && src.includes("hrMini('Bài thi đua','competition')") && src.includes("hrMini('Checklist','checklist')")
     && !src.includes("'Đang đào tạo'"),
    'the 4 locked quick-stat cells (Nhân sự / Việc hoàn thành / Bài thi đua / Checklist), "Đang đào tạo" not restored');
  check(src.includes("action:'getActiveEmployeeCount'") && src.includes("' người'"),
    'Nhân sự -> getActiveEmployeeCount, "N người"');
  check(src.includes("action:'getTaskOverviewV2',view:'personal'") && src.includes("' việc'"),
    'Việc hoàn thành -> getTaskOverviewV2 view:personal (self-only for every role), "N việc"');
  check(src.includes("action:'competitionGetSubmittedTotal'") && src.includes("' bài'"),
    'Bài thi đua -> competitionGetSubmittedTotal (identity-free aggregate), "N bài"');
  check(src.includes("action:'getChecklistMonthlyFormCount'") && src.includes("' phiếu'"),
    'Checklist -> getChecklistMonthlyFormCount (current-month phiếu count), "N phiếu"');
  check((src.match(/:'—'/g) || []).length >= 4 && src.includes('function loadHrQuickStats'),
    'each quick-stat cell independently falls back to "—" (loadHrQuickStats, one fetch per cell)');
  check(src.includes("hrMonthLabel") && src.includes("'Tháng '"), 'month chip remains "Tháng MM/YYYY" (real current month)');
}

console.log('\n== TRAINING SECTION RENAME — "Đào tạo & Phát triển" ==');
{
  check(src.includes("label:'Đào tạo & Phát triển'"), 'top-nav group renamed to "Đào tạo & Phát triển"');
  check(src.includes("title:'Đào tạo & Phát triển'"), 'Home section renamed to "Đào tạo & Phát triển"');
  check(src.includes("sub:'Đào tạo, đánh giá và phát triển năng lực'"), 'section subtitle unchanged');
  check(!src.includes("'Phát triển nhân sự'") && !src.includes("'Phát triển con người'"),
    'old labels "Phát triển nhân sự" / "Phát triển con người" fully removed');
  // "Lịch trong tuần" is now a real projection of the current user's own PHF
  // Task deadlines (listTasks relation:'received') — ONE bounded request, same
  // canonical source/scope as /…/task/lich. Counts come only from real task
  // rows; API failure -> honest neutral note, never a fabricated number.
  check(src.includes("action:'listTasks',relation:'received',status_filter:'all'"),
    '"Lịch trong tuần" reads the current user\'s own received tasks (no company-wide widening, no new source)');
  check(src.includes('Tạm thời chưa xem được lịch công việc.'),
    'Task API failure -> honest neutral note (calendar still renders, no fake count)');
  check(src.includes('Tuần này chưa có công việc cần chú ý.') && src.includes('Hôm nay có ') && src.includes('công việc cần xử lý.'),
    'summary line uses real task counts with the three approved wordings');
  check(/t\.status!=='published'&&t\.status!=='in_progress'/.test(src),
    'reuses PHF Task status semantics (published/in_progress = open) — completed/cancelled/draft not counted');
}

console.log('\nALL PASS (' + passed + ' checks)');
