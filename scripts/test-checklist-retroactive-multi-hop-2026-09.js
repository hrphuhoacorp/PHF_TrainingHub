'use strict';
/*
 * Regression Test — 1.76.0 Retroactive-apply multi-hop stale form fix
 * (audit PROD 2026-09-13: mẫu "Kế toán viên – Doanh thu & Công nợ phải thu",
 * template_key=ke-toan-doanh-thu-cnpt, nhân sự PHF008, kỳ 2026-09 — phiếu tháng tụt lại ở
 * template_version='KT.Thu 2.0' trong khi mẫu vừa kích hoạt 'KT Thu 3.9'; xem báo cáo audit).
 *
 * Bug gốc (1.53.0): phf_retroactive_apply_checklist_template chỉ scope phiếu bằng
 * template_version = MỘT p_old_version cụ thể (phiên bản ngay-trước-đó), nên phiếu tụt lại
 * NHIỀU HƠN 1 bậc phiên bản vô hình với batch dù bộ phân loại trạng thái coi nó "an toàn".
 *
 * Fix (1.76.0, scripts/PHF_CHECKLIST_RETROACTIVE_MULTI_HOP_1.76.0.sql +
 * api/_lib/checklist-template-retroactive.js): scope theo "template_version <> phiên bản
 * mới" (bắt mọi bậc tụt lại) và resolve definition CŨ riêng cho TỪNG phiếu theo đúng
 * template_version của phiếu đó — không còn một oldDefinition toàn cục.
 *
 * Test này chạy 100% in-memory/pure-JS trên lõi JS song song với SQL (cùng lý do như
 * scripts/test-checklist-retroactive-engine-2026-08.js: môi trường không có Supabase
 * dev/local riêng để verify RPC PL/pgSQL thật — xem README/báo cáo bàn giao). An toàn chạy
 * lại bất kỳ lúc nào:
 *   node scripts/test-checklist-retroactive-multi-hop-2026-09.js
 */
const assert=require('assert');
const {classifyFormForApply,runRetroactiveBatch,resolveOldDefinitionForForm}=require('../api/_lib/checklist-template-retroactive');

let passCount=0;
function check(label,fn){fn();passCount++;console.log('✓ PASS — '+label);}

function objRow({id,code,name,target,weight,sourceType}){return {id,code,content:name,target,unit:'điểm',weight,source:{type:sourceType||'manual'}};}

/* 4 phiên bản liên tiếp của cùng 1 mẫu, mô phỏng đúng hình dạng case thật:
   V1 ('KT.Thu 2.0') -> V2 -> V3 -> V4 ('KT Thu 3.9'). Dòng 'A' đổi mã ở mỗi bước (giữ id ổn
   định) để test remap theo id xuyên suốt nhiều bậc, không chỉ 1 bậc liền kề. */
function defV1(){return {totalRows:[objRow({id:'A',code:'A',name:'Việc A',target:10,weight:50}),objRow({id:'B',code:'B',name:'Việc B',target:10,weight:50})]};}
function defV2(){return {totalRows:[objRow({id:'A',code:'A2',name:'Việc A (v2)',target:10,weight:50}),objRow({id:'B',code:'B',name:'Việc B',target:10,weight:50})]};}
function defV3(){return {totalRows:[objRow({id:'A',code:'A3',name:'Việc A (v3)',target:10,weight:50}),objRow({id:'B',code:'B',name:'Việc B',target:10,weight:50})]};}
function defV4(){return {totalRows:[objRow({id:'A',code:'A4',name:'Việc A (v4)',target:10,weight:50}),objRow({id:'B',code:'B',name:'Việc B',target:10,weight:50})]};}
function definitionsByVersion(){return {'V1':defV1(),'V2':defV2(),'V3':defV3(),'V4':defV4()};}

/* ---------- 1) Phiếu ở đúng phiên bản-ngay-trước vẫn áp dụng thành công (không hồi quy) ---------- */
check('Phiếu ở đúng phiên bản-ngay-trước (V3->V4, 1 bậc) vẫn được nhận diện applied qua definitionsByVersion',()=>{
  const form={id:'F-IMM',status:'waiting_self',template_version:'V3',self_answers:{},review_answers:{}};
  const r=classifyFormForApply({form,newDefinition:defV4(),resolveOldDefinition:f=>resolveOldDefinitionForForm(f,definitionsByVersion())});
  assert.strictEqual(r.outcome,'applied');
});

/* ---------- 2) Phiếu tụt 3 bậc (V1, template đã lên V4) PHẢI được đưa vào scope và applied ---------- */
check('Phiếu tụt 3 bậc phiên bản (V1, mẫu đã ở V4) vẫn được RPC/engine nhận diện applied — không còn vô hình như bug 1.53.0',()=>{
  const form={id:'F-3HOP',status:'waiting_self',template_version:'V1',self_answers:{},review_answers:{}};
  const r=classifyFormForApply({form,newDefinition:defV4(),resolveOldDefinition:f=>resolveOldDefinitionForForm(f,definitionsByVersion())});
  assert.strictEqual(r.outcome,'applied');
});

/* ---------- 3) Phiếu tụt nhiều bậc VÀ đã có câu trả lời — definition cũ phải lấy đúng từ V1 của phiếu (không phải V3) ---------- */
check('Phiếu tụt nhiều bậc có câu trả lời — remap phải dùng definition CỦA CHÍNH PHIẾU (V1), không dùng nhầm definition của phiên bản khác',()=>{
  const form={id:'F-3HOP-ANSWERED',status:'waiting_review',template_version:'V1',self_answers:{},review_answers:{A:{value:'9'}}};
  const r=classifyFormForApply({form,newDefinition:defV4(),resolveOldDefinition:f=>resolveOldDefinitionForForm(f,definitionsByVersion())});
  assert.strictEqual(r.outcome,'applied');
  // Mã cũ 'A' (đúng theo V1) phải remap sang mã mới 'A4' (V4) theo id ổn định 'A' — nếu lỡ
  // dùng nhầm definition của V3 (mã 'A3') để đối chiếu, oldCode 'A' sẽ không khớp và bị
  // unmapped thay vì remap đúng.
  assert.strictEqual(r.remappedReviewAnswers.A4.value,'9');
});

/* ---------- 4) Không tìm thấy definition cũ của phiếu -> KHÔNG remap, outcome rõ ràng ---------- */
check('Version_no của phiếu không còn tồn tại trong checklist_template_versions -> skipped-missing-old-definition, KHÔNG tự remap bằng definition sai',()=>{
  const form={id:'F-MISSING',status:'waiting_self',template_version:'VANISHED',self_answers:{A:{value:'9'}},review_answers:{}};
  const original=JSON.parse(JSON.stringify(form));
  const r=classifyFormForApply({form,newDefinition:defV4(),resolveOldDefinition:f=>resolveOldDefinitionForForm(f,definitionsByVersion())});
  assert.strictEqual(r.outcome,'skipped-missing-old-definition');
  assert.strictEqual(r.remappedSelfAnswers,undefined);
  assert.deepStrictEqual(form,original); // phiếu (object truyền vào) không bị đụng tới
});

/* ---------- 5) locked/cancelled/reviewed vẫn đúng outcome ngay cả khi KHÔNG có definitionsByVersion cho version của chúng ---------- */
check('locked vẫn skipped-locked dù không có definition cho version của nó (cổng trạng thái chạy TRƯỚC khi resolve old definition)',()=>{
  const form={id:'F-LOCKED',status:'locked',template_version:'VANISHED'};
  const r=classifyFormForApply({form,newDefinition:defV4(),resolveOldDefinition:f=>resolveOldDefinitionForForm(f,definitionsByVersion())});
  assert.strictEqual(r.outcome,'skipped-locked');
});
check('cancelled vẫn skipped-cancelled dù không có definition cho version của nó',()=>{
  const form={id:'F-CANCELLED',status:'cancelled',template_version:'VANISHED'};
  const r=classifyFormForApply({form,newDefinition:defV4(),resolveOldDefinition:f=>resolveOldDefinitionForForm(f,definitionsByVersion())});
  assert.strictEqual(r.outcome,'skipped-cancelled');
});
check('reviewed vẫn requires-reviewed-adjustment dù không có definition cho version của nó',()=>{
  const form={id:'F-REVIEWED',status:'reviewed',template_version:'VANISHED'};
  const r=classifyFormForApply({form,newDefinition:defV4(),resolveOldDefinition:f=>resolveOldDefinitionForForm(f,definitionsByVersion())});
  assert.strictEqual(r.outcome,'requires-reviewed-adjustment');
});

/* ---------- 6) dry-run và apply thật phải đồng nhất counts trên CÙNG fixture multi-hop ---------- */
check('runRetroactiveBatch multi-hop (definitionsByVersion): dry-run và apply thật cho đúng cùng counts trên cùng fixture — preview không được hứa một phạm vi mà apply không đạt tới',()=>{
  const forms=[
    {id:'F-A',status:'waiting_self',template_version:'V3',self_answers:{},review_answers:{}}, // 1 bậc
    {id:'F-B',status:'waiting_self',template_version:'V1',self_answers:{},review_answers:{}}, // 3 bậc — case PHF008 thật
    {id:'F-C',status:'locked',template_version:'V2'},
    {id:'F-D',status:'waiting_self',template_version:'VANISHED',self_answers:{},review_answers:{}} // definition biến mất
  ];
  const dry=runRetroactiveBatch({batchId:'MH-DRY',forms,newDefinition:defV4(),definitionsByVersion:definitionsByVersion(),dryRun:true});
  const real=runRetroactiveBatch({batchId:'MH-REAL',forms,newDefinition:defV4(),definitionsByVersion:definitionsByVersion(),dryRun:false});
  assert.strictEqual(dry.counts.applied,2); // F-A, F-B — CẢ HAI, kể cả phiếu tụt 3 bậc
  assert.strictEqual(dry.counts['skipped-locked'],1); // F-C
  assert.strictEqual(dry.counts['skipped-missing-old-definition'],1); // F-D
  assert.deepStrictEqual(dry.counts,real.counts); // preview (dry-run) phải khớp apply thật, không lệch
});
check('Re-run cùng batch_id (multi-hop) vẫn idempotent — không double-apply phiếu tụt nhiều bậc',()=>{
  const forms=[{id:'F-IDEMPOTENT',status:'waiting_self',template_version:'V1',self_answers:{},review_answers:{}}];
  const run1=runRetroactiveBatch({batchId:'MH-IDEMPOTENT',forms,newDefinition:defV4(),definitionsByVersion:definitionsByVersion(),dryRun:false});
  assert.strictEqual(run1.counts.applied,1);
  const run2=runRetroactiveBatch({batchId:'MH-IDEMPOTENT',forms,newDefinition:defV4(),definitionsByVersion:definitionsByVersion(),dryRun:false,existingLedger:run1.ledger});
  assert.strictEqual(run2.results[0].idempotentReplay,true);
  assert.strictEqual(run2.ledger.size,run1.ledger.size);
});

/* ---------- Không hồi quy: hành vi cũ (oldDefinition toàn cục, không truyền definitionsByVersion) giữ nguyên ---------- */
check('KHÔNG truyền definitionsByVersion -> hành vi y hệt trước 1.76.0 (oldDefinition dùng chung cho mọi phiếu)',()=>{
  const forms=[{id:'F-LEGACY',status:'draft',self_answers:{},review_answers:{}}];
  const batch=runRetroactiveBatch({batchId:'LEGACY-1',forms,oldDefinition:defV1(),newDefinition:defV2(),dryRun:false});
  assert.strictEqual(batch.counts.applied,1);
});

console.log('\n=== Kết quả ===');
console.log(passCount+'/'+passCount+' bước PASS.');
console.log('Toàn bộ chạy in-memory/pure-JS — không kết nối Supabase thật, không ghi Production.');
