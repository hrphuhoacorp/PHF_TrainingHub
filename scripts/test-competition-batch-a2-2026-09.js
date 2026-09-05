'use strict';
/* PHF HR — Chương trình thi đua · Batch A2 offline regression.
 *
 * SUPERSEDED by scripts/test-competition-c3-ui-2026-09.js (2026-09-04, Batch
 * C3). This test asserted the A2 skeleton's SYNCHRONOUS, static-empty-state
 * rendering ("Thả tim" as a visual-only toggle, no fetch). Batch C3 wired the
 * same module to real DEV data — phfRenderCompetition is now async and calls
 * /api/data — so several of the assertions below (no-fetch, synchronous
 * return, visual-only reaction) no longer hold BY DESIGN and this file will
 * fail if run. Kept for audit history; do not use as a regression gate going
 * forward — use the C3 test instead, which re-asserts everything here that
 * is still true (anonymity, no fabricated numbers, A1 visual baseline, IA)
 * against the new data-driven implementation.
 *
 * UI/IA skeleton only. Asserts, with NO backend:
 *   - all 9 module routes render inside the HR shell without throwing;
 *   - new "Bảng tin" IA (menu item + route + screen) exists and stays anonymous;
 *   - "Thả tim" is a visual-only toggle (no count text, no request);
 *   - anonymous leaderboard: no fabricated points/names, "Vị trí của bạn" block;
 *   - participation progress card renders honest "—" (no fabricated 3/5 etc.);
 *   - review queue still has zero identity inputs;
 *   - menu relabels "Kết quả" → "Bảng xếp hạng & Kết quả", keeps its route;
 *   - CSS brace balance; no runtime network primitive is touched.
 *
 * Feed post fixtures live ONLY in this file — never rendered at runtime.
 */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const appCode = fs.readFileSync('assets/js/competition/phf-competition-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-competition.css', 'utf8');
const routerCode = fs.readFileSync('assets/js/phf-url-router.js', 'utf8');

let passed = 0;
function check(cond, msg){ assert.ok(cond, msg); passed++; console.log('PASS', msg); }

/* ---- 1. CSS brace balance ---- */
check((css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length, 'CSS braces balanced');
check(/\.phf-comp-feed\b/.test(css) && /\.phf-comp-react\b/.test(css) && /\.phf-comp-participation\b/.test(css), 'A2 component styles present & scoped .phf-comp');
check(!/^\s*(?:body|html|:root|img)\b/m.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no global-selector bleed in competition CSS');

/* ---- 2. router wiring ---- */
check(/\/hv\/thi-dua\/bang-tin/.test(routerCode) && /\/ql\/thi-dua\/bang-tin/.test(routerCode) && /\/admin\/thi-dua\/bang-tin/.test(routerCode), 'bang-tin route registered in all 3 namespaces (PHF_ROUTE_MAP)');
check(/\/\^\\\/\(\?:admin\|ql\|hv\)\\\/thi-dua/.test(routerCode), 'competition route handler regex unchanged (namespace guard only)');

const ROUTES = ['/admin/thi-dua','/admin/thi-dua/bang-tin','/admin/thi-dua/bai-cua-toi','/admin/thi-dua/gui','/admin/thi-dua/ket-qua','/admin/thi-dua/cho-duyet','/admin/thi-dua/quan-ly','/admin/thi-dua/xet-duyet','/admin/thi-dua/chot'];

function mount(path, sessionRole){
  const dom = new JSDOM('<!doctype html><html><head><style>'+css+'</style></head><body><div id="phfHrRoot"></div></body></html>',
    { url: 'http://localhost'+path, runScripts: 'outside-only' });
  const { window } = dom;
  window.phfGetSessionRole = () => sessionRole || 'admin';
  window.phfNavigate = () => {};
  window.eval(appCode);
  window.phfRenderCompetition(path);
  return window;
}

/* ---- 3. every route renders ---- */
ROUTES.forEach(function(p){
  const w = mount(p, 'admin');
  const root = w.document.getElementById('phfHrRoot');
  check(root && root.querySelector('.phf-comp-shell'), 'renders shell: '+p);
  check(!/>\s*undefined\s*</.test(root.innerHTML) && !/\bNaN\b/.test(root.innerHTML), 'no undefined/NaN leak: '+p);
});

/* ---- 4. no horizontal overflow risk: shell caps + wrap ---- */
check(/max-width:1560px/.test(css), 'A1 shell 1560px cap preserved (no regression)');
check(/max-width:200px!important/.test(css) && /height:34px!important/.test(css), 'A1 scoped logo tamer preserved');

/* ---- 5. Bảng tin ---- */
const feedW = mount('/admin/thi-dua/bang-tin', 'admin');
const feedRoot = feedW.document.getElementById('phfHrRoot');
check(/Bảng tin/.test(feedRoot.textContent), 'feed screen renders heading');
check(feedRoot.querySelector('[data-comp-feed] .phf-comp-empty'), 'feed renders honest empty state (no seeded posts)');
check(!feedRoot.querySelector('[data-comp-post]'), 'no fabricated feed posts at runtime');
check(/không hiển thị danh tính/.test(feedRoot.textContent), 'feed states anonymity during running campaign');
const feedMenu = Array.from(feedRoot.querySelectorAll('.phf-comp-nav a')).map(a => a.textContent.trim());
check(feedMenu.some(t => /^Bảng tin$/.test(t)), 'menu has Bảng tin item');
check(feedRoot.querySelector('.phf-comp-nav a.is-active') && /Bảng tin/.test(feedRoot.querySelector('.phf-comp-nav a.is-active').textContent), 'sidebar active item = Bảng tin');

/* ---- 6. Thả tim — visual toggle only, on a TEST fixture ---- */
const hooks = feedW.__phfCompetitionTestHooks;
check(typeof hooks.feedPostHtml === 'function', 'feedPostHtml builder exported for tests');
const fixture = hooks.feedPostHtml({ id:'t1', anon_token:'014', when:'2 giờ trước', kind:'Câu hỏi khách hàng', summary:'Khách hỏi về chính sách đổi trả.', campaign_state:'Đang nhận bài' });
check(!/Người tham gia #014[\s\S]*(Nguyễn|Trần|Lê|Phạm|PHF\d{3})/.test(fixture), 'feed card carries anon token, not a real name/code');
feedRoot.querySelector('[data-comp-feed]').innerHTML = fixture;
const react = feedRoot.querySelector('[data-comp-react]');
check(react && react.getAttribute('aria-pressed') === 'false', 'reaction starts unpressed');
check(!/\d/.test(react.textContent), 'reaction control shows no fabricated like count');
react.dispatchEvent(new feedW.Event('click', { bubbles: true }));
check(react.getAttribute('aria-pressed') === 'true' && react.classList.contains('is-on') && /Đã thả tim/.test(react.textContent), 'reaction toggles to pressed visual state');
react.dispatchEvent(new feedW.Event('click', { bubbles: true }));
check(react.getAttribute('aria-pressed') === 'false' && /Thả tim/.test(react.textContent), 'reaction toggles back off');

/* ---- 7. Leaderboard ---- */
const lbW = mount('/hv/thi-dua/ket-qua', 'learner');
const lbRoot = lbW.document.getElementById('phfHrRoot');
check(/Vị trí của bạn/.test(lbRoot.textContent), 'leaderboard has "Vị trí của bạn" block');
const facts = Array.from(lbRoot.querySelectorAll('.phf-comp-you .phf-comp-fact span')).map(s => s.textContent.trim());
check(facts.length >= 3 && facts.every(v => v === '—'), 'your-position metrics all "—" (no fabricated rank/points)');
check(lbRoot.querySelector('.phf-comp-table') && lbRoot.querySelector('.phf-comp-table .phf-comp-empty'), 'anonymous leaderboard table renders empty state, no fake rows');
check(/ẩn danh/.test(lbRoot.textContent) && /Bạn/.test(lbRoot.textContent), 'leaderboard explains anon others + "Bạn" row semantics');
const lbMenu = Array.from(lbRoot.querySelectorAll('.phf-comp-nav a')).map(a => a.textContent.trim());
check(lbMenu.some(t => /Bảng xếp hạng & Kết quả/.test(t)), 'menu relabels Kết quả → Bảng xếp hạng & Kết quả');
check(/\/hv\/thi-dua\/ket-qua/.test(lbRoot.querySelector('.phf-comp-nav a.is-active').getAttribute('href')), 'leaderboard keeps existing /ket-qua route (least-disruptive IA)');

/* ---- 8. Participation progress card ---- */
const ovW = mount('/hv/thi-dua', 'learner');
const ovRoot = ovW.document.getElementById('phfHrRoot');
check(/Tiến độ tham gia/.test(ovRoot.textContent), 'overview shows participation progress card');
const prog = Array.from(ovRoot.querySelectorAll('.phf-comp-prog-cell b')).map(b => b.textContent.trim());
check(prog.length === 3 && prog.every(v => v === '—'), 'participation metrics all "—" (no fabricated 3/5)');
check(ovRoot.querySelector('.phf-comp-participation [data-comp-go$="/thi-dua/gui"]'), 'participation card has CTA to Gửi nội dung');
check(/tách khỏi việc chấm điểm/.test(ovRoot.textContent), 'participation framed as productivity signal, not a review score');

/* ---- 9. anonymity in review queue ---- */
const rqW = mount('/ql/thi-dua/cho-duyet', 'manager');
const rqRoot = rqW.document.getElementById('phfHrRoot');
check(rqRoot.querySelectorAll('input[type="text"], input:not([type]), [name*="name" i], [name*="author" i]').length === 0, 'review queue has zero identity inputs');
check(/không có ô danh tính/.test(rqRoot.textContent), 'review queue states identity is hidden from reviewer');

/* ---- 10. no permission widening / no network in module code ---- */
check(!/fetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new WebSocket/.test(appCode), 'competition module performs no network calls');
const appNoComments = appCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
check(!/localStorage|sessionStorage|indexedDB/.test(appNoComments), 'competition module keeps no client datastore');
check((appCode.match(/roles:\s*\[/g) || []).length === feedW.__phfCompetitionTestHooks.screenKeys.length, 'every screen still declares a role gate (skeleton only, unchanged shape)');

console.log('\nALL PASS ('+passed+' checks)');
