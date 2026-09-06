/* PHF HR — FINAL MOBILE RESPONSIVE + BRAND regression (2026-09-06).
   Static guards for the exact constraints fixed in this batch, so a future
   edit cannot silently re-introduce the "bó cứng" (desktop-locked) layout.
   Presentation-only; no runtime/DOM needed. */
'use strict';
const fs=require('fs');
const path=require('path');
const R=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

let fails=0;
const ok=(c,m)=>{console.log((c?'ok - ':'FAIL - ')+m);if(!c)fails++;};

// ---- Competition: the A1 source-order regression must stay fixed ----
const comp=R('assets/css/phf-competition.css');
const lastUncond=comp.lastIndexOf('.phf-comp-body{grid-template-columns:256px');
const lastCollapse=comp.lastIndexOf('.phf-comp-body{grid-template-columns:1fr');
ok(lastUncond!==-1,'competition: desktop 2-col .phf-comp-body rule still present');
ok(lastCollapse!==-1,'competition: a .phf-comp-body -> 1fr collapse rule exists');
ok(lastCollapse>lastUncond,'competition: the LAST 1-col collapse comes AFTER the last unconditional 2-col rule (source order wins on phones)');
ok(/\.phf-comp-nav\{[^}]*overflow-x:auto/.test(comp),'competition: in-module nav has a horizontal scroll strip rule');

// ---- Task: nav overflow + list card transform ----
const task=R('assets/css/phf-task.css');
ok(/@media\(max-width:760px\)\{[^@]*\.phft-sidebar\{[^}]*overflow-x:\s*auto/.test(task),'task: .phft-sidebar is the bounded horizontal scroll container on mobile (fixes page-level h-scroll from .phft-nav width:max-content)');
ok(/@media\(max-width:600px\)\{[\s\S]*\.phft-list-table\{[^}]*min-width:0[^}]*display:block/.test(task),'task: .phft-list-table drops its desktop min-width and becomes block on phones');
ok(/@media\(max-width:600px\)\{[\s\S]*\.phft-list-table\s+thead\{display:none\}/.test(task) || /\.phft-list-table colgroup,\.phft-list-table thead\{display:none\}/.test(task),'task: list table head/colgroup hidden on phones (card layout)');
ok(/@media\(max-width:600px\)\{[\s\S]*\.phft-detail-grid\{grid-template-columns:1fr\}/.test(task),'task: detail grid is single-column on phones');

// ---- Global mobile nav: brand alignment, no decorative gradients ----
const nav=R('assets/css/phf-mobile-nav.css');
ok(!/linear-gradient\(/.test(nav),'mobile nav: no decorative gradients');
ok(!/#2f6fed|#4f46e5|#6366f1|rgba\(47,111,237/i.test(nav),'mobile nav: no blue/indigo SaaS accent');
ok(nav.includes('#075d43'),'mobile nav: uses PHF Home green #075d43');
ok(nav.includes('.phf-mnav-drawer-item.is-current'),'mobile nav: current-route highlight retained');
ok(/Menu|phf-mnav-main|phf-mnav="account"/.test(R('assets/js/phf-mobile-nav.js')),'mobile nav: bottom bar behaviour (Menu/Trang chủ/Cá nhân) untouched');

console.log('\nPHF HR mobile responsive + brand: '+(fails?(fails+' FAIL'):'ALL PASS'));
process.exit(fails?1:0);
