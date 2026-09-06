/* PHF HR — FINAL MOBILE CLOSURE regression (2026-09-06).
   Offline jsdom check of assets/js/phf-mobile-nav.js:
   - drawer is role-aware (learner has no admin item; admin has it)
   - PHF Task + Chương trình thi đua reachable from the drawer
   - current route is highlighted (is-current) and Training Hub is not
     falsely highlighted on sub-module routes
   - bottom nav + slide menu now activate on phf-task-mode
   No router change, no new route — reads location.pathname only. */
'use strict';
const {JSDOM}=require('jsdom');
const fs=require('path');
const read=require('fs').readFileSync;
const SRC=read(fs.join(__dirname,'..','assets','js','phf-mobile-nav.js'),'utf8');

let fails=0;
const ok=(c,m)=>{console.log((c?'ok - ':'FAIL - ')+m);if(!c)fails++;};

function boot(route,role,bodyClass){
  const dom=new JSDOM('<!doctype html><body class="'+(bodyClass||'phf-task-mode')+'"></body>',{url:'https://hr.test'+route,runScripts:'outside-only'});
  const w=dom.window;
  w.requestAnimationFrame=(cb)=>cb();
  w.phfGetSessionRole=()=>role;
  w.phfGetCurrentUser=()=>({fullName:'Nguyen Van A'});
  w.phfNavigate=()=>{};
  w.eval(SRC);
  try{w.document.dispatchEvent(new w.Event('DOMContentLoaded'));}catch(e){}
  w.phfOpenMobileSlideMenu();
  const items=[...w.document.querySelectorAll('.phf-mnav-drawer-item')].map(b=>({
    r:b.getAttribute('data-phf-mnav-item'),cur:b.classList.contains('is-current')
  }));
  const accs=[...w.document.querySelectorAll('.phf-mnav-acc-toggle')].map(b=>({
    label:b.textContent.replace(/▾/g,'').trim(),expanded:b.getAttribute('aria-expanded')==='true'
  }));
  return {w,items,accs};
}

let {w,items,accs}=boot('/hv/task/chi-tiet','learner');
ok(accs.length>=3,'drawer renders parent accordion groups (web hierarchy projection): '+accs.map(a=>a.label).join(', '));
ok(accs.some(a=>/Công việc/.test(a.label)),'accordion has "Công việc" parent group');
ok(accs.some(a=>/Đào tạo/.test(a.label)),'accordion has "Đào tạo & Phát triển" parent group');
ok(!/Thưởng Hành động V\.2/.test(w.document.querySelector('.phf-mnav-drawer-items').textContent),'deferred "Thưởng Hành động V.2" is NOT exposed as a destination');
ok(items.some(i=>i.r==='/hv/task'),'learner drawer exposes PHF Task (under Công việc)');
ok(items.some(i=>i.r==='/hv/thi-dua'),'learner drawer exposes Chương trình thi đua');
ok(items.some(i=>i.r==='/hv/home'),'"Trang chủ" standalone link present');
ok(!items.some(i=>i.r==='/admin/nhan-su'),'learner drawer has NO admin item');
ok((items.find(i=>i.r==='/hv/task')||{}).cur,'learner: PHF Task highlighted on /hv/task/chi-tiet');
ok((accs.find(a=>/Công việc/.test(a.label))||{}).expanded,'accordion auto-expands the group containing the current route');
ok(!(items.find(i=>i.r==='/hv')||{}).cur,'learner: Training Hub NOT falsely highlighted on task route');
// no duplicate routes
const routes=items.map(i=>i.r).filter(Boolean);
ok(routes.length===new Set(routes).size,'no duplicate routes in the drawer');
const bn=w.document.querySelector('#phfMobileBottomNav');
ok(bn && !bn.hidden,'bottom nav activates on phf-task-mode');
const btns=[...w.document.querySelectorAll('#phfMobileBottomNav .phf-mnav-btn')].map(b=>b.getAttribute('data-phf-mnav'));
ok(btns.join(',')==='menu,main,account','bottom nav is exactly Menu / Trang chủ / Cá nhân');

({w,items,accs}=boot('/admin/thi-dua/cho-duyet','admin','phf-hr-gateway-mode'));
ok(items.some(i=>i.r==='/admin/nhan-su'),'admin drawer HAS admin group child (Quản trị hệ thống)');
ok((items.find(i=>i.r==='/admin/thi-dua')||{}).cur,'admin: Competition highlighted on review route');
ok(items.some(i=>i.r==='/admin/task'),'admin drawer exposes PHF Task');

({w,items}=boot('/admin/home','admin','phf-hr-mode'));
ok((items.find(i=>i.r==='/admin/home')||{}).cur,'admin: Trang chủ highlighted on /admin/home');
ok(!(items.find(i=>i.r==='/admin')||{}).cur,'admin: Training Hub NOT highlighted on /admin/home');

console.log('\nPHF HR mobile nav final closure: '+(fails?(fails+' FAIL'):'ALL PASS'));
process.exit(fails?1:0);
