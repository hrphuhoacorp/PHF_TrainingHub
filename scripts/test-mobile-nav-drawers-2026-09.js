/* PHF HR — FINAL MOBILE NAV UX: Task + Competition drawer guards (2026-09-06).
   Static checks that the horizontal module-nav strips are replaced by a
   Classroom-style slide-in drawer, without touching desktop nav, menuModel,
   permissions or business logic. Presentation-only batch. */
'use strict';
const fs=require('fs');
const path=require('path');
const R=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
let fails=0;
const ok=(c,m)=>{console.log((c?'ok - ':'FAIL - ')+m);if(!c)fails++;};

// ---------- GLOBAL: web hierarchy is the source of truth ----------
const home=R('assets/js/phf-hr-home.js');
ok(/window\.phfHrNavModel\s*=\s*hrNavModel/.test(home),'phf-hr-home.js exports hrNavModel as window.phfHrNavModel (web nav = source of truth)');
const mnav=R('assets/js/phf-mobile-nav.js');
ok(/window\.phfHrNavModel/.test(mnav),'phf-mobile-nav.js consumes window.phfHrNavModel (projection, not a 2nd taxonomy)');
ok(/\.filter\(function\(c\)\{return c&&c\.href&&!c\.soon&&!c\.disabled/.test(mnav),'mobile drawer drops soon/disabled children (no deferred destinations)');
ok(/phf-mnav-acc-toggle/.test(mnav)&&/data-phf-mnav-acc/.test(mnav),'mobile drawer renders accordion parent toggles');

// ---------- TASK ----------
const taskJs=R('assets/js/task/phf-task-app.js');
const taskCss=R('assets/css/phf-task.css');
ok(/data-task-mobile-menu/.test(taskJs),'task: hamburger button (data-task-mobile-menu) added to the module header');
ok(/data-task-mobile-close/.test(taskJs)&&/phft-mobile-backdrop/.test(taskJs),'task: drawer close + backdrop added');
ok(/taskUiState\.mobileNavOpen=false;if\(typeof window\.phfNavigate/.test(taskJs),'task: navigateTask() closes the mobile drawer on any navigation');
ok(/is-mobile-nav-open/.test(taskJs)&&/is-mobile-nav-open/.test(taskCss),'task: drawer open-state class wired in JS + CSS');
ok(/@media\(max-width:760px\)\{[\s\S]*\.phft-sidebar\{position:fixed[\s\S]*transform:translateX\(-105%\)/.test(taskCss),'task: ≤760px sidebar is a fixed left slide-in drawer (translateX offscreen)');
ok(/\.phf-task-root-shell\.is-mobile-nav-open \.phft-sidebar\{transform:none/.test(taskCss),'task: open state slides the drawer in');
ok(/@media\(max-width:760px\)\{[\s\S]*\.phft-nav\{display:flex;flex-direction:column/.test(taskCss),'task: in-drawer nav is a vertical list, not a horizontal strip');
// desktop task nav untouched: base grid rule still 2-col
ok(/\.phft-layout\{flex:1;display:grid;grid-template-columns:255px minmax\(0,1fr\)/.test(taskCss),'task: desktop .phft-layout 2-column grid unchanged');

// ---------- COMPETITION ----------
const compJs=R('assets/js/competition/phf-competition-app.js');
const compCss=R('assets/css/phf-competition.css');
ok(/data-comp-mobile-menu/.test(compJs),'competition: hamburger (data-comp-mobile-menu) added to .phf-comp-top');
ok(/data-comp-mobile-close/.test(compJs)&&/phf-comp-mobile-backdrop/.test(compJs),'competition: drawer close + backdrop added');
ok(/is-mnav-open/.test(compJs)&&/is-mnav-open/.test(compCss),'competition: drawer open-state class wired JS + CSS');
ok(/@media \(max-width:1024px\)\{[\s\S]*\.phf-comp-nav\{position:fixed[\s\S]*transform:translateX\(-105%\)/.test(compCss),'competition: ≤1024px nav is a fixed slide-in drawer');
ok(/\.phf-comp\.is-mnav-open \.phf-comp-nav\{transform:none/.test(compCss),'competition: open state slides the drawer in');
// menuModel + capability gates untouched
ok(/if\(cap\.canReview\)\{[\s\S]*'Chờ duyệt'[\s\S]*'Bài tôi đã duyệt'/.test(compJs),'competition: reviewer menuModel items still capability-gated (canReview)');
ok(/if\(cap\.canAdmin\)\{[\s\S]*'Toàn bộ bài dự thi'/.test(compJs),'competition: admin "Toàn bộ bài dự thi" still present + canAdmin-gated');
ok(/grid-template-columns:256px minmax\(0,1fr\)/.test(compCss),'competition: desktop 2-column body grid unchanged');

console.log('\nPHF HR mobile nav drawers (Task + Competition): '+(fails?(fails+' FAIL'):'ALL PASS'));
process.exit(fails?1:0);
