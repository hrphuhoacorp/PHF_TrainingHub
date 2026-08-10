'use strict';
/* 1.50.13 P0 regression: "Lưu ma trận" phải luôn gọi RPC với payload đúng và
   luôn có feedback loading/success/error rõ ràng — không silent fail. Đây là
   test DOM thật (jsdom) chạy đúng file production assets/js/knl/phf-knl-app.js,
   không phải bản chép tay, để chứng minh: (1) handler được gọi, (2) payload
   gửi saveKnlGradeMatrix đúng, (3) saveKnlGradeMatrix RPC thực sự được gọi,
   cho cả 3 case: matrix đã lưu + đổi 1 M-level; matrix đã lưu + thêm/xóa bậc;
   matrix rỗng + prefill B1..Bn + save lần đầu. Cũng verify lỗi RPC không bị
   swallow (status line hiện lỗi thật, không phải im lặng). */
const assert=require('assert');
const fs=require('fs');
const {JSDOM}=require('jsdom');
const code=fs.readFileSync('assets/js/knl/phf-knl-app.js','utf8');

const FRAMEWORK_ID='f1111111-1111-4111-8111-111111111111';
const VERSION_ID='v2222222-2222-4222-8222-222222222222';
const GROUP_ID='g3333333-3333-4333-8333-333333333333';
const ITEMS=[0,1].map(n=>({id:'item-'+n,versionId:VERSION_ID,groupId:GROUP_ID,name:'Item '+n,description:'',sortOrder:n+1,isActive:true}));
const COLUMNS=[{id:'col-item',versionId:VERSION_ID,type:'item',label:'HẠNG MỤC',levelNumber:null,sortOrder:1,isActive:true}]
  .concat([1,2,3,4,5].map(n=>({id:'col-l'+n,versionId:VERSION_ID,type:'level',label:'MỨC ĐỘ '+n,levelNumber:n,sortOrder:n+1,isActive:true})));
const GRADES=[1,2,3,4,5].map(n=>({id:'grade-'+n,versionId:VERSION_ID,gradeCode:'B'+n,gradeNumber:n,label:'Bậc '+n,sortOrder:n}));
const REQUIREMENTS=[];
ITEMS.forEach(item=>{GRADES.forEach(g=>{REQUIREMENTS.push({itemId:item.id,gradeId:g.id,requiredColumnId:'col-l'+g.gradeNumber,requiredLevelNumber:g.gradeNumber});});});

function jsonResponse(obj){return {ok:true,json:async()=>obj};}
function columnsForLevelCount(n){return [{id:'col-item',versionId:VERSION_ID,type:'item',label:'HẠNG MỤC',levelNumber:null,sortOrder:1,isActive:true}]
  .concat(Array.from({length:n},(_,i)=>i+1).map(k=>({id:'col-l'+k,versionId:VERSION_ID,type:'level',label:'MỨC ĐỘ '+k,levelNumber:k,sortOrder:k+1,isActive:true})));}

async function setupDom(gradeState,failSave,levelCount){
  levelCount=levelCount||5;
  const columns=gradeState==='empty'?columnsForLevelCount(levelCount):COLUMNS;
  const dom=new JSDOM('<!doctype html><html><body><div id="phfKnlRoot"></div></body></html>',{url:'http://localhost/hr/knl/tieu-chuan-bac?version='+VERSION_ID,runScripts:'outside-only'});
  const {window}=dom;
  const savedCalls=[];
  window.phfGetSessionRole=()=>'admin';
  window.phfGetCurrentUser=()=>({id:'admin1',email:'admin@phf.local',accountId:'admin1'});
  window.phfNavigate=()=>{};
  window.confirm=()=>true;
  window.prompt=()=>'Bậc mới';
  window.alert=()=>{};
  window.requestAnimationFrame=(fn)=>setTimeout(fn,0);
  window.scrollTo=()=>{};
  window.fetch=async(url,opts)=>{
    const body=JSON.parse(opts.body),action=body.action;
    if(action==='getKnlCapabilities')return jsonResponse({ok:true,isAdmin:true,capabilities:{manage_framework:true},presetCode:'ADMIN'});
    if(action==='listKnlFrameworks')return jsonResponse({ok:true,frameworks:[{id:FRAMEWORK_ID,code:'KNL_TEST',name:'Test',status:'draft',versions:[{id:VERSION_ID,frameworkId:FRAMEWORK_ID,versionNumber:1,name:'Version 1',status:'draft',isLocked:false,lifecycleStatus:'DRAFT',effectiveFrom:'',effectiveTo:'',activatedAt:'',updatedAt:''}]}]});
    if(action==='getKnlFrameworkVersion')return jsonResponse({ok:true,framework:{id:FRAMEWORK_ID,code:'KNL_TEST',name:'Test',status:'draft',versions:[]},version:{id:VERSION_ID,frameworkId:FRAMEWORK_ID,versionNumber:1,name:'Version 1',status:'draft',isLocked:false,lifecycleStatus:'DRAFT',effectiveFrom:'',effectiveTo:'',activatedAt:'',updatedAt:''},groups:[{id:GROUP_ID,versionId:VERSION_ID,name:'Nhóm 1',description:'',sortOrder:1,isActive:true}],items:ITEMS,columns:columns,levelContents:[]});
    if(action==='getKnlGradeMatrix')return jsonResponse({ok:true,grades:gradeState==='empty'?[]:GRADES,requirements:gradeState==='empty'?[]:REQUIREMENTS});
    if(action==='saveKnlGradeMatrix'){
      savedCalls.push(body);
      await new Promise(r=>setTimeout(r,15));
      if(failSave)return jsonResponse({ok:false,error:'KNL_VERSION_IMMUTABLE: Version đã khóa hoặc không còn là Draft.'});
      return jsonResponse({ok:true,saved:{grades:body.grades.length,requirements:body.requirements.length}});
    }
    return jsonResponse({ok:false,error:'unhandled action '+action});
  };
  window.eval(code);
  await window.phfRenderKnl('/hr/knl/tieu-chuan-bac');
  await new Promise(r=>setTimeout(r,20));
  return {window,root:window.document.getElementById('phfKnlRoot'),savedCalls};
}

async function clickSaveAndObserve(root){
  const before=root.querySelector('[data-grade-save]');
  assert(before,'save button must exist in the DOM');
  assert(!before.hasAttribute('disabled'),'save button must not be disabled before click in a valid mutable state');
  const clickPromise=before.onclick();
  assert(typeof before.onclick==='function','save button must have an onclick handler bound');
  await new Promise(r=>setTimeout(r,0));
  const midFlight=root.querySelector('[data-grade-save]');
  assert(midFlight.hasAttribute('disabled'),'save button must be disabled while a save request is in flight (loading feedback)');
  assert(/Đang lưu/.test(midFlight.textContent),'save button must show a loading label while in flight');
  const midStatus=root.querySelector('[data-grade-status]');
  assert(midStatus&&/Đang lưu/.test(midStatus.textContent),'a visible loading status line must appear while saving');
  await clickPromise;
  await new Promise(r=>setTimeout(r,20));
}

(async()=>{
  // Case 1: matrix đã lưu -> đổi 1 M-level -> Save
  {
    const {root,savedCalls}=await setupDom('saved',false);
    const cell=root.querySelector('[data-grade-cell]');
    assert(cell,'a saved matrix must render editable M-level cells');
    cell.value=cell.querySelector('option:last-child').value;
    await clickSaveAndObserve(root);
    assert.strictEqual(savedCalls.length,1,'saveKnlGradeMatrix RPC must be called exactly once');
    assert.strictEqual(savedCalls[0].grades.length,5,'edited-cell case must submit all 5 previously-saved grades');
    assert.strictEqual(savedCalls[0].requirements.length,10,'edited-cell case must submit all item x grade requirements (2 items x 5 grades)');
    const status=root.querySelector('[data-grade-status]');
    assert(status&&/thành công/.test(status.textContent),'a visible success message must appear after a successful save');
  }
  console.log('PASS Case 1: matrix đã lưu + đổi 1 M-level -> handler gọi, payload đúng, RPC thực thi, loading->success hiển thị');

  // Case 2a: matrix đã lưu -> thêm bậc -> Save
  {
    const {root,savedCalls}=await setupDom('saved',false);
    const addBtn=root.querySelector('[data-grade-add]');
    assert(addBtn,'add-grade control must be available on an already-saved matrix (this was the P0 the previous commit fixed)');
    addBtn.onclick();
    await clickSaveAndObserve(root);
    assert.strictEqual(savedCalls.length,1);
    assert.strictEqual(savedCalls[0].grades.length,6,'add-grade case must submit the original 5 grades plus the new one');
  }
  console.log('PASS Case 2a: matrix đã lưu + thêm bậc -> handler gọi, payload đúng, RPC thực thi');

  // Case 2b: matrix đã lưu -> xóa bậc (với confirmation) -> Save
  {
    const {window,root,savedCalls}=await setupDom('saved',false);
    let confirmCalled=false;
    window.confirm=(msg)=>{confirmCalled=true;assert(/Bỏ bậc/.test(msg),'delete must ask a specific confirmation message');return true;};
    const delBtn=root.querySelector('[data-grade-remove]');
    assert(delBtn,'remove-grade control must be available on an already-saved matrix');
    delBtn.onclick();
    assert(confirmCalled,'deleting a grade must trigger a confirmation dialog');
    await clickSaveAndObserve(root);
    assert.strictEqual(savedCalls.length,1);
    assert.strictEqual(savedCalls[0].grades.length,4,'delete-grade case must submit 4 remaining grades, renumbered contiguously');
    assert.deepStrictEqual(savedCalls[0].grades.map(g=>g.gradeCode),['B1','B2','B3','B4'],'remaining grades must be renumbered contiguously (B1..B4)');
  }
  console.log('PASS Case 2b: matrix đã lưu + xóa bậc -> confirm() bắt buộc, payload đúng, RPC thực thi');

  // Case 3: matrix rỗng -> prefill B1..Bn (levelCols.length=5) -> Save lần đầu
  {
    const {root,savedCalls}=await setupDom('empty',false);
    const cells=root.querySelectorAll('[data-grade-cell]');
    assert(cells.length>0,'empty matrix must render an editable prefilled grid, not a dead end');
    const grades=root.querySelectorAll('thead th');
    assert.strictEqual(grades.length-1,5,'prefill must generate exactly one bậc per active level column (5 levels -> B1..B5)');
    await clickSaveAndObserve(root);
    assert.strictEqual(savedCalls.length,1);
    assert.strictEqual(savedCalls[0].grades.length,5,'first save of an empty matrix must submit the prefilled B1..B5');
    savedCalls[0].grades.forEach((g,i)=>{assert.strictEqual(g.gradeCode,'B'+(i+1));assert(!g.id,'newly prefilled grades must not carry a backend id before their first save');});
    assert.strictEqual(savedCalls[0].requirements.length,10,'2 items x 5 grades untouched must still submit every cell');
    savedCalls[0].requirements.forEach(r=>{
      const diagonalLevel=Number(r.gradeCode.slice(1));
      assert.strictEqual(r.requiredLevelNumber,diagonalLevel,'2026-08-11 rule: an untouched cell on a brand-new empty matrix must default to the diagonal baseline Bn->Mn, not a uniform M1');
    });
  }
  console.log('PASS Case 3: matrix rỗng + prefill diagonal B1/M1..Bn/Mn + Save lần đầu -> handler gọi, payload đúng theo baseline đường chéo, RPC thực thi');

  // Case 3b: matrix rỗng 4 mức -> diagonal phải dừng đúng ở B4/M4 (không lấy nhầm bậc/level của case 5 mức)
  {
    const {root,savedCalls}=await setupDom('empty',false,4);
    await clickSaveAndObserve(root);
    assert.strictEqual(savedCalls.length,1);
    assert.strictEqual(savedCalls[0].grades.length,4,'4-level framework must prefill exactly B1..B4, not B1..B5');
    savedCalls[0].requirements.forEach(r=>{
      const diagonalLevel=Number(r.gradeCode.slice(1));
      assert.strictEqual(r.requiredLevelNumber,diagonalLevel,'4-level empty matrix must also default diagonally (B1/M1..B4/M4)');
    });
  }
  console.log('PASS Case 3b: framework 4 mức, matrix rỗng -> diagonal B1/M1..B4/M4 đúng theo levelCount thật, không hard-code 5');

  // Case 3c: đã lưu matrix rồi Admin thêm bậc mới -> bậc mới KHÔNG áp dụng diagonal
  // (rule chỉ áp dụng cho "grade matrix mới", không phải bậc thêm vào matrix đã có).
  {
    const {root,savedCalls}=await setupDom('saved',false);
    const addBtn=root.querySelector('[data-grade-add]');
    addBtn.onclick();
    await clickSaveAndObserve(root);
    const newGradeReqs=savedCalls[0].requirements.filter(r=>r.gradeCode==='B6');
    assert(newGradeReqs.length>0,'the newly added B6 must still submit requirement rows');
    newGradeReqs.forEach(r=>assert.strictEqual(r.requiredLevelNumber,1,'a bậc added to an ALREADY-SAVED matrix must keep defaulting to M1, diagonal only applies to a brand-new empty matrix'));
  }
  console.log('PASS Case 3c: thêm bậc vào matrix đã lưu -> bậc mới vẫn mặc định M1, không áp dụng diagonal (đúng phạm vi rule)');

  // Error path: RPC failure must surface visibly, never silently swallowed.
  {
    const {root,savedCalls}=await setupDom('saved',true);
    const before=root.querySelector('[data-grade-save]');
    await before.onclick();
    await new Promise(r=>setTimeout(r,20));
    const after=root.querySelector('[data-grade-save]');
    assert(!after.hasAttribute('disabled'),'after a failed save the button must re-enable so Admin can retry');
    assert.strictEqual(after.textContent,'Lưu ma trận','after a failed save the label must revert from the loading state');
    const status=root.querySelector('[data-grade-status]');
    assert(status&&/KNL_VERSION_IMMUTABLE/.test(status.textContent),'an RPC error must be shown verbatim near the button, not swallowed silently');
    assert.strictEqual(savedCalls.length,1,'the failed RPC must still have been called exactly once');
  }
  console.log('PASS Error path: saveKnlGradeMatrix RPC failure hiển thị lỗi rõ ràng, không silent fail, nút re-enable để retry');

  console.log('PASS KNL grade matrix Save UI 1.50.13: click luôn gọi đúng handler/payload/RPC cho cả 3 case bắt buộc + loading/success/error luôn hiển thị.');
})().catch(e=>{console.error(e);process.exit(1);});
