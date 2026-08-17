'use strict';
/* Phase A — standalone regression cho 3 primitive UX mới thêm vào
 * assets/js/knl/phf-knl-app.js: openKnlPromptModal, setKnlButtonBusy,
 * knlToast. CHƯA gắn vào 27 native alert()/confirm()/prompt() call site
 * (đó là Phase B) — bài test này chỉ chứng minh 3 primitive hoạt động độc
 * lập, đúng contract mô tả trong scratchpad inventory. */
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const rawCode = fs.readFileSync('assets/js/knl/phf-knl-app.js', 'utf8');
const css = fs.readFileSync('assets/css/phf-knl.css', 'utf8');
// The module is a closed `(function(){...})();` IIFE — no functions are on
// window normally (consistent with the rest of this codebase/tests, which
// only ever drive it through the public window.phfRenderKnl entry point +
// DOM). Phase A has no UI wiring yet to drive these 3 primitives through
// DOM, so for this isolation test only, inject a window export line just
// before the IIFE's closing `})();` in the in-memory copy of the source —
// this does NOT modify the actual source file on disk.
const EXPORT_MARKER = /\}\)\(\);\s*$/;
if(!EXPORT_MARKER.test(rawCode)) throw new Error('Expected file to end with "})();" — update injection marker.');
const code = rawCode.replace(EXPORT_MARKER,
  'window.__knlPromptModal=openKnlPromptModal;' +
  'window.__setKnlButtonBusy=setKnlButtonBusy;' +
  'window.__knlToast=knlToast;' +
  'window.__knlExportToast=knlExportToast;' +
  '\n})();');

function click(window, el){ el.dispatchEvent(new window.MouseEvent('click',{bubbles:true})); }
function tick(){ return new Promise(resolve=>setTimeout(resolve,10)); }

(async()=>{
  const dom = new JSDOM('<!doctype html><html><head><style>'+css+'</style></head><body><div id="phfKnlRoot"></div></body></html>',{url:'http://localhost/admin/knl/bo-knl',runScripts:'outside-only'});
  const {window}=dom;
  window.phfGetSessionRole=()=>'admin';
  window.phfGetCurrentUser=()=>({id:'admin-1',employeeCode:'PHF000',name:'Admin'});
  window.phfNavigate=()=>{};
  window.scrollTo=()=>{};
  window.requestAnimationFrame=fn=>setTimeout(fn,0);
  window.fetch=async()=>({ok:true,json:async()=>({ok:false,error:'not used in this test'})});

  // Minimal phfToast stub (mirrors real signature in phf-learner-app.js)
  // so knlToast has something real to delegate to and we can assert on it.
  const toastCalls=[];
  window.phfToast=function(type,title,message,timeout,key){
    toastCalls.push({type:type,title:title,message:message,timeout:timeout,key:key});
  };

  window.eval(code);

  // ---------- 1) openKnlPromptModal: happy path, single field ----------
  {
    const p = window.__knlPromptModal({
      title:'Tên nhóm năng lực',
      fields:[{name:'name',label:'Tên nhóm năng lực',value:'',required:true}]
    });
    await tick();
    const overlay = window.document.querySelector('.phfk-modal-overlay');
    assert(overlay, 'openKnlPromptModal phải render .phfk-modal-overlay (tái dùng openKnlModal)');
    assert.strictEqual(window.document.querySelectorAll('.phfk-modal-actions button').length, 2, 'Phải có đúng 2 nút Hủy/Xác nhận');
    const input = overlay.querySelector('[data-prompt-field="name"]');
    assert(input, 'Phải render input cho field "name"');
    input.value='Nhóm bán hàng';
    overlay.querySelector('[data-modal-confirm]').click();
    const result = await p;
    assert.deepEqual(result, {name:'Nhóm bán hàng'}, 'Resolve phải trả object keyed theo field name, đã trim');
    assert.strictEqual(window.document.querySelector('.phfk-modal-overlay'), null, 'Modal phải tự đóng sau khi confirm hợp lệ');
  }

  // ---------- 2) openKnlPromptModal: required validation blocks submit ----------
  {
    const p = window.__knlPromptModal({
      title:'Tên hạng mục',
      fields:[{name:'name',label:'Tên hạng mục',value:'',required:true}]
    });
    await tick();
    let overlay = window.document.querySelector('.phfk-modal-overlay');
    overlay.querySelector('[data-modal-confirm]').click(); // empty required field
    await tick();
    overlay = window.document.querySelector('.phfk-modal-overlay');
    assert(overlay, 'Modal KHÔNG được đóng khi validation fail (khác với prompt() vốn luôn đóng)');
    const err = overlay.querySelector('[data-prompt-error="name"]');
    assert(err && err.hidden===false, 'Phải hiện lỗi inline cho field rỗng bắt buộc');
    assert(err.textContent.length>0, 'Thông báo lỗi phải có nội dung');
    // now fill and confirm
    overlay.querySelector('[data-prompt-field="name"]').value='Chăm sóc khách hàng';
    overlay.querySelector('[data-modal-confirm]').click();
    const result = await p;
    assert.deepEqual(result, {name:'Chăm sóc khách hàng'});
  }

  // ---------- 3) openKnlPromptModal: custom validate() using other fields ----------
  {
    const p = window.__knlPromptModal({
      title:'Đặt hiệu lực',
      fields:[
        {name:'period',label:'Kỳ hiệu lực (YYYY-MM)',value:'',required:true},
        {name:'effectiveFrom',label:'Ngày hiệu lực',value:'',required:false,
          validate:function(v,values){
            if(v && values.period && v.indexOf(values.period)!==0) return 'Ngày hiệu lực phải thuộc kỳ đã chọn.';
            return null;
          }}
      ]
    });
    await tick();
    const overlay = window.document.querySelector('.phfk-modal-overlay');
    overlay.querySelector('[data-prompt-field="period"]').value='2026-09';
    overlay.querySelector('[data-prompt-field="effectiveFrom"]').value='2026-08-01';
    overlay.querySelector('[data-modal-confirm]').click();
    await tick();
    const err = overlay.querySelector('[data-prompt-error="effectiveFrom"]');
    assert(err && err.hidden===false, 'Cross-field validate() phải chặn submit khi ngày không thuộc kỳ');
    overlay.querySelector('[data-prompt-field="effectiveFrom"]').value='2026-09-01';
    overlay.querySelector('[data-modal-confirm]').click();
    const result = await p;
    assert.deepEqual(result, {period:'2026-09',effectiveFrom:'2026-09-01'}, 'Sau khi sửa đúng, cross-field validate phải cho qua');
  }

  // ---------- 4) openKnlPromptModal: cancel button resolves null ----------
  {
    const p = window.__knlPromptModal({title:'X',fields:[{name:'a',label:'A'}]});
    await tick();
    const overlay = window.document.querySelector('.phfk-modal-overlay');
    overlay.querySelector('[data-modal-cancel]').click();
    const result = await p;
    assert.strictEqual(result, null, 'Bấm Hủy phải resolve(null) — cùng semantics với prompt() Cancel');
    assert.strictEqual(window.document.querySelector('.phfk-modal-overlay'), null, 'Modal phải đóng sau Hủy');
  }

  // ---------- 5) openKnlPromptModal: outside click resolves null ----------
  {
    const p = window.__knlPromptModal({title:'X',fields:[{name:'a',label:'A'}]});
    await tick();
    const overlay = window.document.querySelector('.phfk-modal-overlay');
    click(window, overlay); // click on overlay itself, not the modal box
    const result = await p;
    assert.strictEqual(result, null, 'Click ra ngoài overlay phải resolve(null), không treo Promise');
  }

  // ---------- 6) openKnlPromptModal: Escape resolves null ----------
  {
    const p = window.__knlPromptModal({title:'X',fields:[{name:'a',label:'A'}]});
    await tick();
    const overlay = window.document.querySelector('.phfk-modal-overlay');
    overlay.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    const result = await p;
    assert.strictEqual(result, null, 'Esc phải resolve(null), không treo Promise');
  }

  // ---------- 7) setKnlButtonBusy: busy toggles disabled+text, restores original ----------
  {
    const btn = window.document.createElement('button');
    btn.textContent='Lưu';
    window.document.body.appendChild(btn);
    window.__setKnlButtonBusy(btn, true, 'Đang lưu…');
    assert.strictEqual(btn.disabled, true, 'busy=true phải disable nút');
    assert.strictEqual(btn.textContent, 'Đang lưu…', 'busy=true phải đổi nhãn');
    window.__setKnlButtonBusy(btn, false);
    assert.strictEqual(btn.disabled, false, 'busy=false phải enable lại nút');
    assert.strictEqual(btn.textContent, 'Lưu', 'busy=false phải khôi phục nhãn gốc');
  }

  // ---------- 8) setKnlButtonBusy: idempotent against double-click / re-entry ----------
  {
    const btn = window.document.createElement('button');
    btn.textContent='Xuất Excel';
    window.document.body.appendChild(btn);
    window.__setKnlButtonBusy(btn, true, 'Đang xuất…');
    // Simulate a second click while already busy: caller sets busy=true again.
    window.__setKnlButtonBusy(btn, true, 'NHÃN KHÁC NẾU BỊ GỌI LẠI');
    assert.strictEqual(btn.textContent, 'Đang xuất…', 'Gọi busy=true lần 2 khi đã busy phải là no-op (không ghi đè nhãn/không mất originalText)');
    window.__setKnlButtonBusy(btn, false);
    assert.strictEqual(btn.textContent, 'Xuất Excel', 'Sau no-op re-entry, busy=false vẫn phải khôi phục đúng nhãn gốc ban đầu');
  }

  // ---------- 9) setKnlButtonBusy: busy=false without prior busy=true is a no-op ----------
  {
    const btn = window.document.createElement('button');
    btn.textContent='Không đổi';
    window.document.body.appendChild(btn);
    window.__setKnlButtonBusy(btn, false);
    assert.strictEqual(btn.textContent, 'Không đổi', 'busy=false khi chưa từng busy=true không được đụng vào nút');
    assert.strictEqual(btn.disabled, false);
  }

  // ---------- 10) setKnlButtonBusy: guards null button ----------
  {
    assert.doesNotThrow(function(){ window.__setKnlButtonBusy(null, true); window.__setKnlButtonBusy(null, false); }, 'Phải guard button null/undefined, không throw');
  }

  // ---------- 11) knlToast: delegates to window.phfToast with all args ----------
  {
    toastCalls.length=0;
    window.__knlToast('success','Đã lưu','Lưu thành công.',3000,'test-key');
    assert.strictEqual(toastCalls.length, 1, 'knlToast phải gọi đúng 1 lần window.phfToast');
    assert.deepEqual(toastCalls[0], {type:'success',title:'Đã lưu',message:'Lưu thành công.',timeout:3000,key:'test-key'}, 'knlToast phải forward đủ 5 tham số cho window.phfToast');
  }

  // ---------- 12) knlToast: safe no-op if window.phfToast is unavailable ----------
  {
    const saved = window.phfToast;
    window.phfToast = undefined;
    assert.doesNotThrow(function(){ window.__knlToast('error','X','Y'); }, 'knlToast không được throw khi window.phfToast chưa sẵn sàng (vd load sớm)');
    window.phfToast = saved;
  }

  // ---------- 13) knlExportToast (existing wrapper) still works after delegating to knlToast ----------
  {
    toastCalls.length=0;
    window.__knlExportToast('success','Đã tạo file Excel','test.xlsx');
    assert.strictEqual(toastCalls.length, 1, 'knlExportToast (refactor để gọi knlToast) vẫn phải bắn đúng 1 toast — không phá hành vi export hiện có');
    assert.strictEqual(toastCalls[0].title, 'Đã tạo file Excel');
  }

  console.log('PASS — test-knl-ux-primitives-2026-08.js (13 assertions across openKnlPromptModal / setKnlButtonBusy / knlToast)');
})().catch(function(e){
  console.error('FAIL —', e && e.message);
  console.error(e && e.stack);
  process.exit(1);
});
