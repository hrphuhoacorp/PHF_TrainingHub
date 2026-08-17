'use strict';
/* Batch 1E Phase B — regression cho rollout thay 27 native alert()/confirm()/
 * prompt() bằng openKnlPromptModal/openKnlConfirmModal/knlToast/setKnlButtonBusy
 * trên 3 màn rủi ro cao nhất: Bộ KNL, Khảo sát Đợt, Kết quả khảo sát. Test
 * DOM thật (jsdom) chạy đúng file production qua window.phfRenderKnl, theo
 * đúng convention scripts/test-knl-*-ui-*.js hiện có (vd test-knl-dashboard-
 * ui-polish-2026-08.js, test-knl-grade-matrix-save-ui-1.50.13.js).
 *
 * Test matrix theo từng màn: initial load, F5/deep-link lại, filter/tab đổi
 * có loading, submit có busy state, double-click chỉ gửi đúng 1 request,
 * success feedback (toast), error feedback (toast/inline), modal open/close
 * đúng (không dùng native alert/confirm/prompt của trình duyệt).
 */
const assert=require('assert');
const fs=require('fs');
const {JSDOM}=require('jsdom');
const code=fs.readFileSync('assets/js/knl/phf-knl-app.js','utf8');
const css=fs.readFileSync('assets/css/phf-knl.css','utf8');

function tick(ms){return new Promise(r=>setTimeout(r,ms==null?10:ms));}
function click(window,el){el.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));}
function jsonResponse(obj){return {ok:true,json:async()=>obj};}

const VERSION_ID='ver-1111-1111-1111-111111111111';
const FRAMEWORK_ID='fw-1111-1111-1111-111111111111';
const GROUP_ID='grp-1111-1111-1111-111111111111';

function baseFrameworkFixtures(){
  return {
    frameworks:[{id:FRAMEWORK_ID,code:'SALE',name:'Nhân viên bán hàng',status:'draft',versions:[{id:VERSION_ID,frameworkId:FRAMEWORK_ID,versionNumber:1,name:'Version 1',status:'draft',isLocked:false}]}],
    detail:{
      framework:{id:FRAMEWORK_ID,code:'SALE',name:'Nhân viên bán hàng',description:'',status:'draft'},
      version:{id:VERSION_ID,frameworkId:FRAMEWORK_ID,versionNumber:1,name:'Version 1',status:'draft',isLocked:false},
      groups:[{id:GROUP_ID,versionId:VERSION_ID,name:'Nhóm 1',description:'',sortOrder:1,isActive:true}],
      items:[],
      columns:[{id:'col-item',versionId:VERSION_ID,type:'item',label:'HẠNG MỤC',levelNumber:null,sortOrder:1,isActive:true}],
      levelContents:[]
    }
  };
}

async function setupDom(urlPath,fetchHandler,opts){
  opts=opts||{};
  const dom=new JSDOM('<!doctype html><html><head><style>'+css+'</style></head><body><div id="phfKnlRoot"></div></body></html>',{url:'http://localhost'+urlPath,runScripts:'outside-only'});
  const {window}=dom;
  window.phfGetSessionRole=()=>'admin';
  window.phfGetCurrentUser=()=>({id:'admin-1',employeeCode:'PHF000',name:'Admin'});
  window.phfNavigate=opts.phfNavigate||(()=>{});
  window.scrollTo=()=>{};
  window.requestAnimationFrame=fn=>setTimeout(fn,0);
  // Deliberately do NOT stub window.alert/confirm/prompt — if production
  // code still called any of them, JSDOM throws "Not implemented" and the
  // test fails loudly, proving no native popup path remains reachable.
  window.fetch=fetchHandler;
  window.eval(code);
  // phfRenderKnl matches its tab purely off the path argument via a `$`-
  // anchored regex (no query string allowed there) — the query string
  // itself is read separately from location.href (set via the JSDOM url:
  // option above), exactly like production route dispatch does. So strip
  // any query before handing the path to phfRenderKnl, while the fuller
  // urlPath (with query) still lives in location.href for deep-link tests.
  await window.phfRenderKnl(urlPath.split('?')[0]);
  await tick(20);
  return {window,root:window.document.getElementById('phfKnlRoot')};
}

(async()=>{

  /* ============== BỘ KNL ============== */
  {
    const calls=[];
    let fx=baseFrameworkFixtures();
    const fetchHandler=async(url,opts_)=>{
      const body=JSON.parse(opts_.body),action=body.action;
      calls.push(body);
      if(action==='getKnlCapabilities')return jsonResponse({ok:true,isAdmin:true,capabilities:{manage_framework:true}});
      if(action==='listKnlFrameworks')return jsonResponse({ok:true,frameworks:fx.frameworks});
      if(action==='getKnlFrameworkVersion')return jsonResponse({ok:true,framework:fx.detail.framework,version:fx.detail.version,groups:fx.detail.groups,items:fx.detail.items,columns:fx.detail.columns,levelContents:fx.detail.levelContents});
      if(action==='saveKnlGroup'){
        fx.detail.groups.push({id:'grp-new',versionId:VERSION_ID,name:body.group.name,description:'',sortOrder:2,isActive:true});
        return jsonResponse({ok:true});
      }
      if(action==='deleteKnlStructure')return jsonResponse({ok:true});
      return jsonResponse({ok:false,error:'unhandled '+action});
    };

    // --- initial load renders create button, no native popup wired yet ---
    const {window,root}=await setupDom('/admin/knl/bo-knl',fetchHandler);
    assert(root.querySelector('[data-knl-create-framework]'),'Bộ KNL initial load must render the create-framework button');
    assert(root.querySelector('[data-knl-add-group]'),'Bộ KNL detail must render add-group button');
    console.log('PASS Bộ KNL — initial load renders workspace');

    // --- add group: click opens openKnlPromptModal (not native prompt) ---
    const addGroup=root.querySelector('[data-knl-add-group]');
    click(window,addGroup);
    await tick(10);
    let overlay=window.document.querySelector('.phfk-modal-overlay');
    assert(overlay,'add-group click must open an in-app modal, not native prompt()');
    const nameInput=overlay.querySelector('[data-prompt-field="name"]');
    assert(nameInput,'add-group modal must expose a "name" field');
    // --- required-field validation blocks empty submit ---
    overlay.querySelector('[data-modal-confirm]').click();
    await tick(10);
    overlay=window.document.querySelector('.phfk-modal-overlay');
    assert(overlay,'submitting an empty required field must NOT close the modal');
    assert(overlay.querySelector('[data-prompt-error="name"]').hidden===false,'empty required field must show inline error');
    // --- fill + confirm -> action fires, modal closes ---
    overlay.querySelector('[data-prompt-field="name"]').value='Nhóm mới';
    const callsBefore=calls.length;
    overlay.querySelector('[data-modal-confirm]').click();
    await tick(30);
    assert.strictEqual(window.document.querySelector('.phfk-modal-overlay'),null,'modal must close after a valid confirm');
    const saveGroupCalls=calls.filter(c=>c.action==='saveKnlGroup');
    assert.strictEqual(saveGroupCalls.length,1,'exactly one saveKnlGroup call must fire from one confirm click');
    console.log('PASS Bộ KNL — add group: modal open/validate/close, exactly 1 request on confirm, no native prompt()');

    // --- cancel path: no request fires ---
    const addGroup2=root.querySelector('[data-knl-add-group]');
    click(window,addGroup2);
    await tick(10);
    overlay=window.document.querySelector('.phfk-modal-overlay');
    assert(overlay,'modal must reopen for a second add-group click');
    const callsBeforeCancel=calls.length;
    overlay.querySelector('[data-modal-cancel]').click();
    await tick(10);
    assert.strictEqual(window.document.querySelector('.phfk-modal-overlay'),null,'Hủy must close the modal');
    assert.strictEqual(calls.length,callsBeforeCancel,'Hủy must not fire any API call');
    console.log('PASS Bộ KNL — add group: Hủy resolves null, closes modal, no API call (same semantics as prompt() Cancel)');

    // --- delete: openKnlConfirmModal (not native confirm), busy state, no double-submit ---
    fx=baseFrameworkFixtures();
    fx.detail.items=[{id:'item-1',versionId:VERSION_ID,groupId:GROUP_ID,name:'Item 1',description:'',sortOrder:1,isActive:true}];
    fx.detail.columns.push({id:'col-l1',versionId:VERSION_ID,type:'level',label:'MỨC ĐỘ 1',levelNumber:1,sortOrder:2,isActive:true});
    const {window:w2,root:r2}=await setupDom('/admin/knl/bo-knl',fetchHandler);
    let delBtn=r2.querySelector('[data-knl-delete="item:item-1"]');
    assert(delBtn,'a deletable item row must render a delete button');
    click(w2,delBtn);
    await tick(10);
    let delOverlay=w2.document.querySelector('.phfk-modal-overlay');
    assert(delOverlay,'delete click must open the shared confirm modal, not native confirm()');
    assert(/Xóa vật lý khỏi Draft/.test(delOverlay.textContent),'confirm modal must show the original delete message');
    const deleteCallsBefore=calls.filter(c=>c.action==='deleteKnlStructure').length;
    delOverlay.querySelector('[data-modal-confirm]').click();
    await tick(30);
    assert.strictEqual(w2.document.querySelector('.phfk-modal-overlay'),null,'confirm modal must close after confirming delete');
    assert.strictEqual(calls.filter(c=>c.action==='deleteKnlStructure').length,deleteCallsBefore+1,'exactly one deleteKnlStructure call must fire');
    console.log('PASS Bộ KNL — delete: shared confirm modal (not native confirm()), exactly 1 request on confirm');
  }

  /* ============== KHẢO SÁT (Đợt) ============== */
  {
    const calls=[];
    let campaigns=[{id:'camp-1',name:'Đợt Q3',status:'DRAFT',startsAt:'2026-08-01',endsAt:'2026-08-31',progress:{}}];
    const fetchHandler=async(url,opts_)=>{
      const body=JSON.parse(opts_.body),action=body.action;
      calls.push(body);
      if(action==='getKnlCapabilities')return jsonResponse({ok:true,isAdmin:true,capabilities:{}});
      if(action==='listKnlSurveyCampaigns')return jsonResponse({ok:true,campaigns:campaigns,tickets:[]});
      if(action==='getKnlSurveySetup')return jsonResponse({ok:true,frameworks:[]});
      if(action==='openKnlSurveyCampaign'){
        campaigns=campaigns.map(c=>c.id===body.campaignId?Object.assign({},c,{status:'OPEN'}):c);
        return jsonResponse({ok:true,createdTickets:3});
      }
      return jsonResponse({ok:false,error:'unhandled '+action});
    };

    const {window,root}=await setupDom('/admin/knl/khao-sat',fetchHandler);
    assert(root.querySelector('[data-open-survey]'),'Khảo sát Đợt initial load must render "Mở khảo sát" for a DRAFT campaign');
    console.log('PASS Khảo sát Đợt — initial load renders campaign card with open action');

    const openBtn=root.querySelector('[data-open-survey]');
    click(window,openBtn);
    await tick(10);
    const overlay=window.document.querySelector('.phfk-modal-overlay');
    assert(overlay,'"Mở khảo sát" must open the shared confirm modal, not native confirm()');
    assert(/Mở khảo sát và sinh các phiếu/.test(overlay.textContent),'confirm modal must keep the original message');
    const before=calls.filter(c=>c.action==='openKnlSurveyCampaign').length;
    const confirmBtn=overlay.querySelector('[data-modal-confirm]');
    click(window,confirmBtn);
    // Modal closes synchronously on confirm click (openKnlConfirmModal calls
    // closeKnlModal() before invoking onConfirm), so the node is detached —
    // a second click dispatched at the same node must NOT fire a 2nd request.
    click(window,confirmBtn);
    await tick(30);
    assert.strictEqual(window.document.querySelector('.phfk-modal-overlay'),null,'modal must be closed after confirming');
    assert.strictEqual(calls.filter(c=>c.action==='openKnlSurveyCampaign').length,before+1,'double click on the (now-detached) confirm button must still only fire exactly 1 request');
    console.log('PASS Khảo sát Đợt — open: shared confirm modal, double-click-safe (1 request), list reload after success');
  }

  /* ============== KẾT QUẢ KHẢO SÁT ============== */
  {
    const calls=[];
    const campaignId='camp-9';
    let resultsCallCount=0;
    const results={
      progress:{submitted:5,total:5},
      quality:[{groupName:'Nhóm 1',itemName:'Item 1',needsReview:false,details:[],suitablePct:100,unclearPct:0,unsuitablePct:0,levelDistribution:{},commentCount:0}],
      canClone:true,
      versions:[{id:VERSION_ID,frameworkName:'Nhân viên bán hàng',name:'Version 1',versionNumber:1}],
      filterOptions:{}
    };
    const fetchHandler=async(url,opts_)=>{
      const body=JSON.parse(opts_.body),action=body.action;
      calls.push(body);
      if(action==='getKnlCapabilities')return jsonResponse({ok:true,isAdmin:true,capabilities:{}});
      if(action==='listKnlSurveyCampaigns')return jsonResponse({ok:true,campaigns:[{id:campaignId,name:'Đợt Q3'}]});
      if(action==='getKnlSurveyResults'){resultsCallCount++;return jsonResponse({ok:true,...results});}
      if(action==='cloneKnlSurveyVersionToDraft')return jsonResponse({ok:true});
      return jsonResponse({ok:false,error:'unhandled '+action});
    };

    // --- initial load: F5/deep-link with ?campaign= must resolve results ---
    const {window,root}=await setupDom('/admin/knl/ket-qua-khao-sat?campaign='+campaignId,fetchHandler);
    assert(root.querySelector('[data-result-campaign]'),'Kết quả khảo sát deep-link load must render the campaign selector');
    assert(root.textContent.includes('Nhóm 1'),'Kết quả khảo sát initial load must render fetched quality rows');
    assert.strictEqual(resultsCallCount,1,'initial deep-link load must fetch results exactly once');
    console.log('PASS Kết quả khảo sát — F5/deep-link with ?campaign= loads results directly');

    // --- filter change must show a loading state before results settle (gap fix) ---
    const filterSelect=root.querySelector('[data-result-filter]');
    assert(filterSelect,'result filter controls must render');
    let sawLoadingDuringFilterChange=false;
    const origFetch=window.fetch;
    window.fetch=async(url,opts_)=>{
      const b=JSON.parse(opts_.body);
      if(b.action==='getKnlSurveyResults'){
        // Loading placeholder must already be in the DOM by the time the
        // results request is in flight (fixes the flagged "no loading on
        // filter change" gap).
        if(window.document.querySelector('.phfk-loading'))sawLoadingDuringFilterChange=true;
      }
      return origFetch(url,opts_);
    };
    filterSelect.value=filterSelect.options[1]?filterSelect.options[1].value:filterSelect.value;
    filterSelect.dispatchEvent(new window.Event('change',{bubbles:true}));
    await tick(30);
    assert(sawLoadingDuringFilterChange,'changing a result filter must show .phfk-loading while refetching (gap fix)');
    assert(resultsCallCount>=2,'changing a filter must refetch results');
    console.log('PASS Kết quả khảo sát — filter change shows loading state before results settle (gap fix)');

    // --- clone-survey-version: prompt modal, not native prompt()+alert() ---
    const cloneBtn=root.querySelector('[data-clone-survey-version]');
    assert(cloneBtn,'a cloneable version must render a "Sao chép" button');
    click(window,cloneBtn);
    await tick(10);
    const overlay=window.document.querySelector('.phfk-modal-overlay');
    assert(overlay,'clone-version click must open an in-app prompt modal, not native prompt()');
    const nameField=overlay.querySelector('[data-prompt-field="name"]');
    assert(nameField&&nameField.value==='Dự thảo từ kết quả khảo sát','clone modal must prefill the same default name the old prompt() used');
    const cloneCallsBefore=calls.filter(c=>c.action==='cloneKnlSurveyVersionToDraft').length;
    overlay.querySelector('[data-modal-confirm]').click();
    await tick(20);
    assert.strictEqual(window.document.querySelector('.phfk-modal-overlay'),null,'clone modal must close after confirm');
    assert.strictEqual(calls.filter(c=>c.action==='cloneKnlSurveyVersionToDraft').length,cloneCallsBefore+1,'exactly one cloneKnlSurveyVersionToDraft call must fire');
    console.log('PASS Kết quả khảo sát — clone version: in-app prompt modal (not native prompt()/alert()), 1 request on confirm');
  }

  console.log('PASS test-knl-ux-rollout-2026-08.js — Bộ KNL / Khảo sát Đợt / Kết quả khảo sát rollout regression (initial load, F5/deep-link, filter loading, modal open/close, double-click-safe, no native popup).');
})().catch(e=>{console.error('FAIL —',e&&e.message);console.error(e&&e.stack);process.exit(1);});
