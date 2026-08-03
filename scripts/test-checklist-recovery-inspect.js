'use strict';

const assert=require('assert');
const Module=require('module');
process.env.SUPABASE_URL='https://mock.invalid';process.env.SUPABASE_SECRET_KEY='mock';

const store={
 checklist_monthly_periods:[{id:'p1',period_month:'2026-07',status:'open'}],
 checklist_monthly_forms:[{id:'f-existing',period_id:'p1',period_month:'2026-07',employee_id:'e1',employee_code:'NV001',employee_name:'Đã có',template_id:'sales',template_version:'1',reviewer_code:'QL1',reviewer_name:'Quản lý',status:'waiting_self',self_answers:{C1:{value:'8'}},self_total_score:80,updated_at:'2026-07-01T00:00:00Z'}],
 checklist_monthly_form_history:[{id:'h1',form_id:'f-existing'}],
 checklist_notifications:[{id:'n1',subject_type:'monthly_form',subject_id:'f-existing'}]
};
class Query{
 constructor(table){this.table=table;this.rows=(store[table]||[]).slice();}
 select(_fields,options={}){this.head=options.head===true;return this;}
 eq(column,value){this.rows=this.rows.filter(row=>String(row[column]||'')===String(value));return this;}
 limit(){return Promise.resolve({data:this.rows,error:null});}
 maybeSingle(){return Promise.resolve({data:this.rows[0]||null,error:null});}
 then(resolve,reject){return Promise.resolve({data:this.head?null:this.rows,error:null,count:this.head?this.rows.length:null}).then(resolve,reject);}
}
const prepared={
 assignmentState:{snapshots:[
  {employee_id:'e1',employee_code:'NV001',employee_name:'Đã có',employee_status:'Đang làm việc',template_id:'sales',template_version:'1',manager_code:'QL1'},
  {employee_id:'e2',employee_code:'NV002',employee_name:'Sẵn sàng',employee_status:'Đang làm việc',template_id:'sales',template_version:'1',manager_id:'m1',manager_code:'QL1',manager_name:'Quản lý'},
  {employee_id:'e3',employee_code:'NV003',employee_name:'Thiếu reviewer',employee_status:'Đang làm việc',template_id:'sales',template_version:'1'},
  {employee_id:'e4',employee_code:'NV004',employee_name:'Thiếu phân công mẫu',employee_status:'Đang làm việc',template_id:''}
 ]},
 rows:[
  {period_month:'2026-07',employee_id:'e1',employee_code:'NV001',employee_name:'Đã có',template_id:'sales',template_version:'1',reviewer_code:'QL1',template_snapshot:{version:{definition:{rows:[]}}},checklist_score:100,score_formula_version:'v2'},
  {period_month:'2026-07',employee_id:'e2',employee_code:'NV002',employee_name:'Sẵn sàng',template_id:'sales',template_version:'1',reviewer_id:'m1',reviewer_code:'QL1',reviewer_name:'Quản lý',template_snapshot:{version:{definition:{rows:[]}}},checklist_score:95,score_formula_version:'v2'},
  {period_month:'2026-07',employee_id:'e3',employee_code:'NV003',employee_name:'Thiếu reviewer',template_id:'sales',template_version:'1',template_snapshot:{version:{definition:{rows:[]}}},checklist_score:100,score_formula_version:'v2'}
 ],
 missing:[],sourceRevision:{current_count:4}
};
const originalLoad=Module._load;
const rpcCalls=[];
const idempotentResults=new Map();
Module._load=function(request,parent,isMain){
 if(request==='@supabase/supabase-js')return {createClient:()=>({from:table=>new Query(table),rpc:async(name,params)=>{rpcCalls.push({name,params});const key=name+'|'+params.p_idempotency_key;if(idempotentResults.has(key))return {data:{...idempotentResults.get(key),idempotent:true},error:null};const data=name==='phf_recovery_delete_monthly_form'?{ok:true,operationId:'op-delete',formId:params.p_form_id,deletedHistory:1,deletedNotifications:1}:{ok:true,operationId:'op-1',created:1,skipped:0};idempotentResults.set(key,data);return {data,error:null};}})};
 if(request==='./checklist-monthly'&&parent&&/checklist-recovery\.js$/.test(parent.filename))return {buildMonthlyCreationState:async()=>prepared};
 return originalLoad.call(this,request,parent,isMain);
};

(async()=>{
 const {inspectMonthlyRecovery,createMissingMonthlyForms,getMonthlyDeletePreview,deleteMonthlyFormException}=require('../lib/checklist-recovery');
 const result=await inspectMonthlyRecovery({role:'admin'},{month:'2026-07'});
 assert.strictEqual(result.counts.existing,1);
 assert.strictEqual(result.counts.readyToCreate,1);
 assert.strictEqual(result.groups.readyToCreate[0].employeeCode,'NV002');
 assert.strictEqual(result.counts.missingReviewer,1);
 assert.strictEqual(result.counts.missingAssignment,1);
 assert.strictEqual(result.canCreate,true);
 prepared.assignmentState.snapshots.push({employee_id:'e7',employee_code:'NV007',employee_name:'Media',employee_status:'Đang làm việc',template_id:'nv-marketing',template_version:'1',manager_code:'QL1',manager_name:'Quản lý'});
 prepared.rows.push({period_month:'2026-07',employee_id:'e7',employee_code:'NV007',employee_name:'Media',template_id:'nv-marketing',template_version:'1',reviewer_code:'QL1',reviewer_name:'Quản lý',template_snapshot:{version:{definition:{totalRows:[['','MKT-1','KPI',10,'',100]]},monthly_source:{type:'current_config',periodMonth:'2026-07'}}},checklist_score:100,score_formula_version:'v2'});
 const marketing=await inspectMonthlyRecovery({role:'admin'},{month:'2026-07'});assert(marketing.groups.readyToCreate.some(row=>row.employeeCode==='NV007'));
 prepared.assignmentState.snapshots.pop();prepared.rows.pop();
 const created=await createMissingMonthlyForms({role:'admin',account:{id:'admin-1',name:'Admin'}},{month:'2026-07',reason:'Tạo lại phiếu còn thiếu hợp lệ',idempotencyKey:'idem-12345678'});
 assert.strictEqual(created.created,1);assert.strictEqual(rpcCalls.length,1);
 assert.strictEqual(rpcCalls[0].name,'phf_recovery_create_missing_monthly_forms');
 assert.deepStrictEqual(rpcCalls[0].params.p_forms.map(row=>row.employee_code),['NV002']);
 assert.strictEqual(rpcCalls[0].params.p_forms[0].status,'waiting_self');
 const createdAgain=await createMissingMonthlyForms({role:'admin',account:{id:'admin-1',name:'Admin'}},{month:'2026-07',reason:'Tạo lại phiếu còn thiếu hợp lệ',idempotencyKey:'idem-12345678'});assert.strictEqual(createdAgain.idempotent,true);
 const preview=await getMonthlyDeletePreview({role:'admin'},{formId:'f-existing'});
 assert.strictEqual(preview.allowed,true);assert.strictEqual(preview.counts.history,1);assert.strictEqual(preview.counts.notifications,1);
 assert.deepStrictEqual(preview.form.selfAnswers,{C1:{value:'8'}});
 store.checklist_monthly_forms[0].status='waiting_review';assert.strictEqual((await getMonthlyDeletePreview({role:'admin'},{formId:'f-existing'})).allowed,true);
 store.checklist_monthly_forms[0].status='reviewed';const reviewed=await getMonthlyDeletePreview({role:'admin'},{formId:'f-existing'});assert.strictEqual(reviewed.requiresPilotTestConfirmation,true);assert.strictEqual(reviewed.blockCode,'CHECKLIST_RECOVERY_DELETE_REVIEWED_CONFIRM_REQUIRED');
 store.checklist_monthly_forms[0].status='waiting_self';
 const deleted=await deleteMonthlyFormException({role:'admin',account:{id:'admin-1',name:'Admin'}},{formId:'f-existing',expectedUpdatedAt:'2026-07-01T00:00:00Z',reason:'Xóa phiếu Pilot theo yêu cầu kiểm thử',idempotencyKey:'delete-12345678',confirmDelete:true});
 assert.strictEqual(deleted.operationId,'op-delete');const deleteCall=rpcCalls.find(call=>call.name==='phf_recovery_delete_monthly_form');assert(deleteCall);assert.strictEqual(deleteCall.params.p_confirm_delete,true);
 await assert.rejects(()=>deleteMonthlyFormException({role:'admin'},{formId:'f-existing',expectedUpdatedAt:'2026-07-01T00:00:00Z',reason:'Xóa phiếu Pilot theo yêu cầu kiểm thử',idempotencyKey:'delete-no-confirm',confirmDelete:false}),error=>error.code==='CHECKLIST_RECOVERY_DELETE_CONFIRM_REQUIRED'&&error.statusCode===400);
 await assert.rejects(()=>createMissingMonthlyForms({role:'admin'},{month:'2026-07',reason:'ngắn',idempotencyKey:'short-reason-key'}),error=>error.code==='CHECKLIST_RECOVERY_REASON_REQUIRED'&&error.statusCode===400);
 await assert.rejects(()=>deleteMonthlyFormException({role:'learner'},{formId:'f-existing'}),error=>error.code==='CHECKLIST_RECOVERY_ADMIN_ONLY'&&error.statusCode===403);
 await assert.rejects(()=>inspectMonthlyRecovery({role:'learner'},{month:'2026-07'}),error=>error.code==='CHECKLIST_RECOVERY_ADMIN_ONLY');
 store.checklist_monthly_periods[0].status='locked';
 store.checklist_monthly_forms[0].status='locked';const lockedDelete=await getMonthlyDeletePreview({role:'admin'},{formId:'f-existing'});assert.strictEqual(lockedDelete.allowed,false);assert.strictEqual(lockedDelete.blockCode,'CHECKLIST_RECOVERY_DELETE_LOCKED');
 const locked=await inspectMonthlyRecovery({role:'admin'},{month:'2026-07'});
 assert.strictEqual(locked.canCreate,false);assert.strictEqual(locked.counts.blockedLocked,1);
 await assert.rejects(()=>createMissingMonthlyForms({role:'admin',account:{id:'admin-1'}},{month:'2026-07',reason:'Không được tạo trong kỳ khóa',idempotencyKey:'idem-locked-123'}),error=>error.code==='CHECKLIST_RECOVERY_PERIOD_LOCKED'&&error.statusCode===409);
 console.log('PASS checklist recovery diagnostic preview (mock, không ghi database).');
})().catch(error=>{console.error(error);process.exitCode=1;});
