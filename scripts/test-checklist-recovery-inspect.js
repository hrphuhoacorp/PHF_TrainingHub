'use strict';

const assert=require('assert');
const Module=require('module');
process.env.SUPABASE_URL='https://mock.invalid';process.env.SUPABASE_SECRET_KEY='mock';

const store={
 checklist_monthly_periods:[{id:'p1',period_month:'2026-07',status:'open'}],
 checklist_monthly_forms:[{id:'f-existing',period_id:'p1',period_month:'2026-07',employee_id:'e1',employee_code:'NV001',employee_name:'Đã có',template_id:'sales',template_version:'1',reviewer_code:'QL1',reviewer_name:'Quản lý',status:'waiting_self',updated_at:'2026-07-01T00:00:00Z'}]
};
class Query{
 constructor(table){this.table=table;this.rows=(store[table]||[]).slice();}
 select(){return this;}
 eq(column,value){this.rows=this.rows.filter(row=>String(row[column]||'')===String(value));return this;}
 limit(){return Promise.resolve({data:this.rows,error:null});}
 maybeSingle(){return Promise.resolve({data:this.rows[0]||null,error:null});}
 then(resolve,reject){return Promise.resolve({data:this.rows,error:null}).then(resolve,reject);}
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
Module._load=function(request,parent,isMain){
 if(request==='@supabase/supabase-js')return {createClient:()=>({from:table=>new Query(table),rpc:async(name,params)=>{rpcCalls.push({name,params});return {data:{ok:true,operationId:'op-1',created:1,skipped:0},error:null};}})};
 if(request==='./checklist-monthly'&&parent&&/checklist-recovery\.js$/.test(parent.filename))return {buildMonthlyCreationState:async()=>prepared};
 return originalLoad.call(this,request,parent,isMain);
};

(async()=>{
 const {inspectMonthlyRecovery,createMissingMonthlyForms}=require('../lib/checklist-recovery');
 const result=await inspectMonthlyRecovery({role:'admin'},{month:'2026-07'});
 assert.strictEqual(result.counts.existing,1);
 assert.strictEqual(result.counts.readyToCreate,1);
 assert.strictEqual(result.groups.readyToCreate[0].employeeCode,'NV002');
 assert.strictEqual(result.counts.missingReviewer,1);
 assert.strictEqual(result.counts.missingAssignment,1);
 assert.strictEqual(result.canCreate,true);
 const created=await createMissingMonthlyForms({role:'admin',account:{id:'admin-1',name:'Admin'}},{month:'2026-07',reason:'Tạo lại phiếu còn thiếu hợp lệ',idempotencyKey:'idem-12345678'});
 assert.strictEqual(created.created,1);assert.strictEqual(rpcCalls.length,1);
 assert.strictEqual(rpcCalls[0].name,'phf_recovery_create_missing_monthly_forms');
 assert.deepStrictEqual(rpcCalls[0].params.p_forms.map(row=>row.employee_code),['NV002']);
 assert.strictEqual(rpcCalls[0].params.p_forms[0].status,'waiting_self');
 await assert.rejects(()=>inspectMonthlyRecovery({role:'learner'},{month:'2026-07'}),error=>error.code==='CHECKLIST_RECOVERY_ADMIN_ONLY');
 store.checklist_monthly_periods[0].status='locked';
 const locked=await inspectMonthlyRecovery({role:'admin'},{month:'2026-07'});
 assert.strictEqual(locked.canCreate,false);assert.strictEqual(locked.counts.blockedLocked,1);
 await assert.rejects(()=>createMissingMonthlyForms({role:'admin',account:{id:'admin-1'}},{month:'2026-07',reason:'Không được tạo trong kỳ khóa',idempotencyKey:'idem-locked-123'}),error=>error.code==='CHECKLIST_RECOVERY_PERIOD_LOCKED');
 console.log('PASS checklist recovery diagnostic preview (mock, không ghi database).');
})().catch(error=>{console.error(error);process.exitCode=1;});
