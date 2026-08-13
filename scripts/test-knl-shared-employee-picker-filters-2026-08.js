'use strict';
/* Shared KNL employee picker filter regression. DOM-only; no backend mutation. */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const code = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');
const people = [
  {employeeCode:'PHF001',employeeName:'An',department:'Ban giám đốc',branch:'Phú Lợi',title:'Giám đốc'},
  {employeeCode:'PHF002',employeeName:'Bình',department:'Ban giám đốc',branch:'Phú Lợi',title:'Trợ lý Giám đốc'},
  {employeeCode:'PHF003',employeeName:'Chi',department:'Bộ phận bán hàng',branch:'Phú Lợi',title:'Nhân viên'},
  {employeeCode:'PHF004',employeeName:'Dung',department:'Bộ phận bán hàng',branch:'Lái Thiêu',title:'Trưởng ca'},
  {employeeCode:'PHF005',employeeName:'Giang',department:'Bộ phận Tài chính Kế toán',branch:'Phú Lợi',title:'Nhân viên'},
  {employeeCode:'PHF006',employeeName:'Hà',department:'Bộ phận Quản trị tổng hợp',branch:'Ngô Quyền',title:'Trưởng bộ phận'}
];

const dom = new JSDOM('<!doctype html><html><head><style>'+css+'</style></head><body><div id="root"></div></body></html>',{runScripts:'outside-only',url:'http://localhost/admin/knl/co-cau-thu-nhap'});
const { window } = dom;
const exposedCode=code.replace(/\}\)\(\);\s*$/,'window.__knlEmployeePickerHtml=knlEmployeePickerHtml;window.__bindKnlEmployeePicker=bindKnlEmployeePicker;})();');
window.eval(exposedCode);
const root = window.document.getElementById('root');

function mount(ns){
  root.innerHTML=window.__knlEmployeePickerHtml({ns,people});
  window.__bindKnlEmployeePicker(root,ns,()=>{});
  return {
    search:root.querySelector('[data-picker-search="'+ns+'"]'),
    department:root.querySelector('[data-picker-filter="'+ns+':department"]'),
    branch:root.querySelector('[data-picker-filter="'+ns+':branch"]'),
    title:root.querySelector('[data-picker-filter="'+ns+':title"]')
  };
}
function change(el,value){el.value=value;el.dispatchEvent(new window.Event('change',{bubbles:true}));}
function search(el,value){el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));}
function visible(ns){return [...root.querySelectorAll('[data-picker-target="'+ns+'"]')].filter(el=>!el.hidden);}
function count(ns){return root.querySelector('[data-picker-count="'+ns+'"]').textContent;}
function expect(ns,codes,label){
  const cards=[...root.querySelectorAll('[data-picker-target="'+ns+'"]')];
  assert.deepStrictEqual(visible(ns).map(el=>el.dataset.code),codes,label+' — roster');
  cards.forEach(el=>assert.strictEqual(window.getComputedStyle(el).display,el.hidden?'none':'flex',label+' — computed display '+el.dataset.code));
  assert.strictEqual(count(ns),codes.length+' nhân sự phù hợp',label+' — count');
}

function run(ns){
  let f=mount(ns);
  expect(ns,['PHF001','PHF002','PHF003','PHF004','PHF005','PHF006'],ns+' initial backend-scoped roster');
  change(f.department,'Ban giám đốc'); expect(ns,['PHF001','PHF002'],ns+' department only');
  f=mount(ns); change(f.branch,'Phú Lợi'); expect(ns,['PHF001','PHF002','PHF003','PHF005'],ns+' branch only');
  f=mount(ns); change(f.title,'Nhân viên'); expect(ns,['PHF003','PHF005'],ns+' title only');
  f=mount(ns); change(f.department,'Bộ phận bán hàng'); change(f.branch,'Lái Thiêu'); expect(ns,['PHF004'],ns+' department + branch');
  f=mount(ns); change(f.department,'Ban giám đốc'); change(f.title,'Trợ lý Giám đốc'); expect(ns,['PHF002'],ns+' department + title');
  f=mount(ns); change(f.department,'Ban giám đốc'); search(f.search,'phf002'); expect(ns,['PHF002'],ns+' search + filter');
  change(f.department,''); search(f.search,''); expect(ns,['PHF001','PHF002','PHF003','PHF004','PHF005','PHF006'],ns+' reset all');
}

run('income');
run('assign');
assert(css.includes('.phfk-people-card[hidden]{display:none!important}'),'Author display:flex must not override the hidden state');
assert(!code.includes("apiPost('listKnlIncomeTargets',{department"),'Frontend filter must not broaden or replace backend income scope');
console.log('ALL PASS — Shared KNL employee picker filters');
