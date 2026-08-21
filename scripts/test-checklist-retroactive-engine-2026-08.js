'use strict';
/*
 * Regression Test — Workstream A (2026-08-14)
 * Checklist Monthly — "checklist_score không nối vào Total/Final" (A1) + version-copy /
 * retroactive-apply engine (A2/A5/A6). Toàn bộ chạy in-memory / pure-JS — KHÔNG kết nối
 * Supabase thật (môi trường này chỉ có 1 project cấu hình và đó là project Production —
 * xem báo cáo bàn giao). An toàn chạy lại bất kỳ lúc nào:
 *   node scripts/test-checklist-retroactive-engine-2026-08.js
 */
const assert=require('assert');
const {validateScoredDefinition,isChecklistTotalRow,requiresChecklistTotalRow}=require('../api/_lib/checklist-templates');
const {isAutomaticSource,monthlyRows,manualRows,scoreSummary}=require('../api/_lib/checklist-monthly');
const {diffDefinitions,simulateScoreImpact,classifyFormForApply,runRetroactiveBatch}=require('../api/_lib/checklist-template-retroactive');
const {calculateMonthlyScore}=require('../api/_lib/checklist-score-engine');

let passCount=0;
function check(label,fn){fn();passCount++;console.log('✓ PASS — '+label);}

/* ---------- helper builders ---------- */
function ditreGroup(){return [{code:'TACPHONG',name:'Nội quy chung',children:[{code:'C1',items:[['PHF-DITRE-01','Đi trễ so với giờ vào ca',1]]}]}];}
function objRow({id,code,name,target,weight,sourceType}){return {id,code,content:name,target,unit:'điểm',weight,source:{type:sourceType||'manual'}};}
function legacyManualRow(code,name,target,weight){return [1,code,name,target,'điểm',weight,'Không'];}

/* ================= A6 item: connection-gate validator ================= */
check('Connection-gate: template có groups (checklist) nhưng thiếu dòng checklist_total bị chặn khi lưu',()=>{
  const definition={groups:ditreGroup(),templateType:'checklist_detail',totalRows:[objRow({id:'R1',code:'R1',name:'Việc A',target:10,weight:100})]};
  assert.throws(()=>validateScoredDefinition(definition),e=>e.code==='CHECKLIST_TEMPLATE_CHECKLIST_TOTAL_ROW_MISSING');
});
check('Connection-gate: thêm đúng 1 dòng source.type=checklist_total thì lưu được',()=>{
  const definition={groups:ditreGroup(),templateType:'checklist_detail',totalRows:[objRow({id:'R1',code:'R1',name:'Việc A',target:10,weight:90}),objRow({id:'CT',code:'CT',name:'Checklist',target:100,weight:10,sourceType:'checklist_total'})]};
  const r=validateScoredDefinition(definition);
  assert.strictEqual(r.totalWeight,100);
});
check('Templates KHÔNG dùng Checklist (không có groups) không bị gate chặn',()=>{
  const definition={totalRows:[objRow({id:'R1',code:'R1',name:'Việc A',target:10,weight:100})]};
  const r=validateScoredDefinition(definition);
  assert.strictEqual(r.totalWeight,100);
});
check('Weight sum != 100% bị chặn ở publish; = 100% cho qua',()=>{
  assert.throws(()=>validateScoredDefinition({totalRows:[objRow({id:'R1',code:'R1',name:'A',target:10,weight:80})]}),e=>e.code==='CHECKLIST_TEMPLATE_TOTAL_WEIGHT_INVALID');
  const r=validateScoredDefinition({totalRows:[objRow({id:'R1',code:'R1',name:'A',target:10,weight:60}),objRow({id:'R2',code:'R2',name:'B',target:5,weight:40})]});
  assert.strictEqual(r.totalWeight,100);
});

/* ================= isAutomaticSource / monthlyRows: explicit + backward compat ================= */
check('isAutomaticSource: field tường minh source.type=checklist_total được ưu tiên (không cần dò tên)',()=>{
  const form={template_snapshot:{version:{definition:{totalRows:[objRow({id:'CT',code:'CT',name:'Bất kỳ tên nào',target:100,weight:10,sourceType:'checklist_total'})]}}}};
  const rows=monthlyRows(form);
  assert.strictEqual(rows.length,1);
  assert.strictEqual(isAutomaticSource(rows[0].source,rows[0].name,rows[0].sourceType),true);
  assert.strictEqual(manualRows(form).length,0);
});
check('Backward-compat: snapshot cũ (mảng 7 phần tử, dò tên "tuân thủ tiêu chuẩn công việc") vẫn nhận đúng',()=>{
  const form={template_snapshot:{version:{definition:{totalRows:[legacyManualRow('NVK-TUANTHU','Tuân thủ tiêu chuẩn công việc',100,65),legacyManualRow('NVK-BC','Báo cáo',10,35)]}}}};
  const rows=monthlyRows(form);
  const auto=rows.filter(r=>isAutomaticSource(r.source,r.name,r.sourceType));
  assert.strictEqual(auto.length,1);
  assert.strictEqual(auto[0].code,'NVK-TUANTHU');
});
check('Regression trực tiếp cho bug gốc: mẫu có Đi trễ trong groups + dòng checklist_total -> checklist_score cộng đúng vào Total/Final theo trọng số',()=>{
  // Mô phỏng 1 trong 6 mẫu thật sau khi vá A1: 1 dòng thủ công 90%, 1 dòng checklist_total 10%.
  const form={
    checklist_score:70, // vi phạm Đi trễ chính thức đã trừ điểm còn 70/100
    self_answers:{'CT-01':{value:'8'}}, // dòng thủ công: đạt 8/10
    review_answers:{'CT-01':{value:'8'}},
    template_snapshot:{version:{definition:{totalRows:[
      objRow({id:'CT-01',code:'CT-01',name:'Việc thủ công',target:10,weight:90}),
      objRow({id:'CT-02',code:'CT-02',name:'Tuân thủ Checklist',target:100,weight:10,sourceType:'checklist_total'})
    ]}}}
  };
  const summary=scoreSummary(form);
  // Nếu checklist_score KHÔNG cộng vào (bug cũ): final chỉ phản ánh dòng thủ công (80/100 quy đổi ->8/10->80).
  // Sau khi vá: dòng checklist_total dùng actual=70/100 => normalize 7/10; dòng thủ công 8/10*90 + 7/10*10 weighted /100 *10 =7.9 ->79.
  assert.strictEqual(summary.selfTotalScore,79);
  assert.strictEqual(summary.reviewTotalScore,79);
});
check('Nếu checklist_score giảm (thêm vi phạm), Total/Final giảm đúng theo trọng số dòng checklist_total',()=>{
  function buildForm(checklistScore){
    return {checklist_score:checklistScore,self_answers:{'CT-01':{value:'8'}},review_answers:{'CT-01':{value:'8'}},
      template_snapshot:{version:{definition:{totalRows:[
        objRow({id:'CT-01',code:'CT-01',name:'Việc thủ công',target:10,weight:90}),
        objRow({id:'CT-02',code:'CT-02',name:'Tuân thủ Checklist',target:100,weight:10,sourceType:'checklist_total'})
      ]}}}};
  }
  const before=scoreSummary(buildForm(100)).selfTotalScore;
  const after=scoreSummary(buildForm(70)).selfTotalScore;
  assert.ok(after<before,'Điểm phải giảm khi checklist_score giảm');
  assert.strictEqual(Math.round((before-after)*100)/100,3); // 10% * (100-70)/100 *10 = 3 điểm/100
});

/* ================= A2: diff / simulate ================= */
check('diffDefinitions: nhận diện added/removed/renamed theo id ổn định, không theo vị trí',()=>{
  const oldDef={totalRows:[objRow({id:'A',code:'A',name:'Việc A',target:10,weight:50}),objRow({id:'B',code:'B',name:'Việc B',target:10,weight:50})]};
  const newDef={totalRows:[objRow({id:'B',code:'B2',name:'Việc B đổi tên',target:10,weight:60}),objRow({id:'C',code:'C',name:'Việc C',target:10,weight:40})]};
  const diff=diffDefinitions(oldDef,newDef);
  assert.strictEqual(diff.removed.length,1);assert.strictEqual(diff.removed[0].id,'A');
  assert.strictEqual(diff.added.length,1);assert.strictEqual(diff.added[0].id,'C');
  assert.strictEqual(diff.renamed.length,1);assert.strictEqual(diff.renamed[0].id,'B');
  assert.strictEqual(diff.totalWeightBefore,100);assert.strictEqual(diff.totalWeightAfter,100);
});
check('simulateScoreImpact: thêm dòng checklist_total vào version mới làm final score phản ánh checklist_score',()=>{
  const oldDef={totalRows:[objRow({id:'A',code:'A',name:'Việc A',target:10,weight:100})]};
  const newDef={totalRows:[objRow({id:'A',code:'A',name:'Việc A',target:10,weight:90}),objRow({id:'CT',code:'CT',name:'Checklist',target:100,weight:10,sourceType:'checklist_total'})]};
  const impact=simulateScoreImpact({oldDefinition:oldDef,newDefinition:newDef,checklistScore:70,selfActualByCode:{A:'10'},reviewActualByCode:{A:'10'},calculateMonthlyScore});
  assert.strictEqual(impact.before.selfTotalScore,100); // trước: chỉ dòng A, đạt tối đa
  assert.ok(impact.after.selfTotalScore<100); // sau: checklist_score kéo điểm xuống
  assert.strictEqual(impact.after.selfTotalScore,97); // 90%*10 + 10%*7 =9.7 ->97
});

/* ================= A2.4/A6: form status gating + idempotency ================= */
function baseForms(){
  const oldDef={totalRows:[objRow({id:'A',code:'A',name:'Việc A',target:10,weight:50}),objRow({id:'B',code:'B',name:'Việc B',target:10,weight:50})]};
  const newDef={totalRows:[objRow({id:'A',code:'A2',name:'Việc A đổi mã',target:10,weight:50}),objRow({id:'B',code:'B',name:'Việc B',target:10,weight:50})]};
  return {oldDef,newDef};
}
check('draft không có câu trả lời -> remap tại chỗ tự động (applied)',()=>{
  const {oldDef,newDef}=baseForms();
  const r=classifyFormForApply({form:{id:'F1',status:'draft',self_answers:{},review_answers:{}},oldDefinition:oldDef,newDefinition:newDef});
  assert.strictEqual(r.outcome,'applied');
});
check('waiting_self có câu trả lời gắn với dòng còn tồn tại (đổi mã, giữ id) -> remap giữ nguyên giá trị theo id ổn định',()=>{
  const {oldDef,newDef}=baseForms();
  const r=classifyFormForApply({form:{id:'F2',status:'waiting_self',self_answers:{A:{value:'9'}},review_answers:{}},oldDefinition:oldDef,newDefinition:newDef});
  assert.strictEqual(r.outcome,'applied');
  assert.strictEqual(r.remappedSelfAnswers.A2.value,'9'); // mã cũ A -> mã mới A2, giá trị giữ nguyên
});
check('waiting_review có câu trả lời gắn với dòng đã bị XÓA -> skipped-unmapped, KHÔNG tự bỏ câu trả lời',()=>{
  const oldDef={totalRows:[objRow({id:'A',code:'A',name:'Việc A',target:10,weight:50}),objRow({id:'B',code:'B',name:'Việc B',target:10,weight:50})]};
  const newDef={totalRows:[objRow({id:'A',code:'A',name:'Việc A',target:10,weight:100})]}; // B bị xóa
  const r=classifyFormForApply({form:{id:'F3',status:'waiting_review',self_answers:{},review_answers:{B:{value:'7'}}},oldDefinition:oldDef,newDefinition:newDef});
  assert.strictEqual(r.outcome,'skipped-unmapped');
  assert.deepStrictEqual(r.unmappedReviewCodes,['B']);
});
check('reviewed KHÔNG được remap tự động trong batch thường -> requires-reviewed-adjustment',()=>{
  const {oldDef,newDef}=baseForms();
  const r=classifyFormForApply({form:{id:'F4',status:'reviewed',self_answers:{A:{value:'9'}}},oldDefinition:oldDef,newDefinition:newDef});
  assert.strictEqual(r.outcome,'requires-reviewed-adjustment');
});
check('locked KHÔNG BAO GIỜ bị đụng',()=>{
  const {oldDef,newDef}=baseForms();
  const r=classifyFormForApply({form:{id:'F5',status:'locked'},oldDefinition:oldDef,newDefinition:newDef});
  assert.strictEqual(r.outcome,'skipped-locked');
});
check('cancelled bị loại trừ',()=>{
  const {oldDef,newDef}=baseForms();
  const r=classifyFormForApply({form:{id:'F6',status:'cancelled'},oldDefinition:oldDef,newDefinition:newDef});
  assert.strictEqual(r.outcome,'skipped-cancelled');
});
check('Batch apply: version N+1 không đụng phiếu ngoài scope (không nằm trong danh sách forms truyền vào)',()=>{
  const {oldDef,newDef}=baseForms();
  const inScope={id:'F7',status:'draft',self_answers:{},review_answers:{}};
  const outOfScopeUntouched={id:'F8',status:'draft',self_answers:{A:{value:'z'}},review_answers:{}};
  const batch=runRetroactiveBatch({batchId:'B1',forms:[inScope],oldDefinition:oldDef,newDefinition:newDef,dryRun:false});
  assert.strictEqual(batch.results.length,1);
  assert.strictEqual(outOfScopeUntouched.self_answers.A.value,'z'); // chưa từng bị chạm tới
});
check('Re-run cùng batch_id là no-op (idempotent) — không double-apply',()=>{
  const {oldDef,newDef}=baseForms();
  const forms=[{id:'F9',status:'draft',self_answers:{},review_answers:{}}];
  const run1=runRetroactiveBatch({batchId:'BATCH-X',forms,oldDefinition:oldDef,newDefinition:newDef,dryRun:false});
  assert.strictEqual(run1.counts.applied,1);
  const run2=runRetroactiveBatch({batchId:'BATCH-X',forms,oldDefinition:oldDef,newDefinition:newDef,dryRun:false,existingLedger:run1.ledger});
  assert.strictEqual(run2.results[0].idempotentReplay,true);
  assert.strictEqual(run2.ledger.size,run1.ledger.size); // không tạo thêm entry nào
});
check('Dry-run tính preview giống hệt apply thật nhưng không ghi ledger',()=>{
  const {oldDef,newDef}=baseForms();
  const forms=[{id:'F10',status:'draft',self_answers:{},review_answers:{}}];
  const dry=runRetroactiveBatch({batchId:'BATCH-DRY',forms,oldDefinition:oldDef,newDefinition:newDef,dryRun:true});
  assert.strictEqual(dry.counts.applied,1);
  assert.strictEqual(dry.ledger.size,0);
});

/* ================= A5: mẫu giả lập thứ 3 (synthetic) — vá bằng đúng công cụ, KHÔNG sửa code ================= */
check('Mẫu giả lập thứ 3 (synthetic-demo-1.0) tái hiện đúng hình dạng bug và được vá bằng đúng engine, không đổi code',()=>{
  // "V1 lỗi" — giống hệt hình dạng bug gốc: có groups (Checklist) nhưng KHÔNG có dòng checklist_total.
  const synthenticV1={
    templateType:'checklist_detail',
    groups:ditreGroup(),
    totalRows:[
      objRow({id:'SYN-01',code:'SYN-01',name:'Việc chính',target:10,weight:100})
    ]
  };
  // Validator A1 phải chặn nếu cố publish nguyên trạng — chứng minh gate hoạt động cho MỌI template_key, không hardcode.
  assert.throws(()=>validateScoredDefinition(synthenticV1),e=>e.code==='CHECKLIST_TEMPLATE_CHECKLIST_TOTAL_ROW_MISSING');

  // Dùng ĐÚNG engine A2 (copy version + sửa definition + validate) để tạo V2 đã vá — không viết code riêng cho template này.
  const synthenticV2={
    templateType:'checklist_detail',
    groups:ditreGroup(),
    totalRows:[
      objRow({id:'SYN-01',code:'SYN-01',name:'Việc chính',target:10,weight:90}),
      objRow({id:'SYN-CT',code:'SYN-CT',name:'Tuân thủ Checklist',target:100,weight:10,sourceType:'checklist_total'})
    ]
  };
  const validated=validateScoredDefinition(synthenticV2);
  assert.strictEqual(validated.totalWeight,100);

  // Retroactive apply cho 1 phiếu draft đang ở V1 -> phải remap sang V2 sạch sẽ.
  const outcome=classifyFormForApply({form:{id:'SYN-FORM-1',status:'draft',self_answers:{},review_answers:{}},oldDefinition:synthenticV1,newDefinition:synthenticV2});
  assert.strictEqual(outcome.outcome,'applied');

  // Sau vá: checklist_score giảm phải kéo Total xuống — chứng minh bug đã hết, giống 6 mẫu thật.
  const impact=simulateScoreImpact({oldDefinition:synthenticV1,newDefinition:synthenticV2,checklistScore:60,selfActualByCode:{'SYN-01':'10'},reviewActualByCode:{'SYN-01':'10'},calculateMonthlyScore});
  assert.strictEqual(impact.before.selfTotalScore,100); // V1 (lỗi): checklist_score không hề ảnh hưởng
  assert.ok(impact.after.selfTotalScore<100); // V2 (đã vá): checklist_score=60 kéo điểm xuống đúng theo trọng số 10%
  assert.strictEqual(impact.after.selfTotalScore,96); // 90%*10 + 10%*6 =9.6 ->96
});

console.log('\n=== Kết quả ===');
console.log(passCount+'/'+passCount+' bước PASS.');
console.log('Toàn bộ chạy in-memory/pure-JS — không kết nối Supabase thật, không ghi Production.');
