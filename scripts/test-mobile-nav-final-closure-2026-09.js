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
  return {w,items};
}

let {w,items}=boot('/hv/task/chi-tiet','learner');
ok(items.some(i=>i.r==='/hv/task'),'learner drawer exposes PHF Task');
ok(items.some(i=>i.r==='/hv/thi-dua'),'learner drawer exposes Chương trình thi đua');
ok(!items.some(i=>i.r==='/admin/nhan-su'),'learner drawer has NO admin Nhân sự item');
ok((items.find(i=>i.r==='/hv/task')||{}).cur,'learner: PHF Task highlighted on /hv/task/chi-tiet');
ok(!(items.find(i=>i.r==='/hv')||{}).cur,'learner: Training Hub NOT falsely highlighted on task route');
const bn=w.document.querySelector('#phfMobileBottomNav');
ok(bn && !bn.hidden,'bottom nav activates on phf-task-mode');

({w,items}=boot('/admin/thi-dua/cho-duyet','admin','phf-hr-gateway-mode'));
ok(items.some(i=>i.r==='/admin/nhan-su'),'admin drawer HAS Nhân sự & phân quyền');
ok((items.find(i=>i.r==='/admin/thi-dua')||{}).cur,'admin: Competition highlighted on review route');
ok(items.some(i=>i.r==='/admin/task'),'admin drawer exposes PHF Task');

({w,items}=boot('/admin/home','admin','phf-hr-mode'));
ok((items.find(i=>i.r==='/admin/home')||{}).cur,'admin: Trang chủ highlighted on /admin/home');
ok(!(items.find(i=>i.r==='/admin')||{}).cur,'admin: Training Hub NOT highlighted on /admin/home');

console.log('\nPHF HR mobile nav final closure: '+(fails?(fails+' FAIL'):'ALL PASS'));
process.exit(fails?1:0);
