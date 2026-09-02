'use strict';
/*
 * Regression Test — Draft monthly template resnapshot
 * Checklist Monthly — resnapshotMonthlyDraftTemplate()
 *
 * PROD case: PHF082 / 09-2026 monthly form is "Phiếu nháp · chưa mở" but still snapshots
 * qtth-hcns-nhan-vien / NV-HCNS-1.0 while the current Checklist assignment is
 * Nhân viên bán hàng / BH-1.0 (reviewer already PHF042). Admin must be able to re-snapshot
 * the draft's template from the current assignment WITHOUT deleting the form, and WITHOUT
 * touching the reviewer.
 *
 * In-memory only. @supabase/supabase-js is stubbed. No real Supabase. No DB write.
 *   node scripts/test-checklist-monthly-draft-template-resnapshot-2026-09.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}

const PERIOD='2026-09';
const OLD_T={id:'qtth-hcns-nhan-vien',v:'NV-HCNS-1.0'};
const NEW_T={id:'nhan-vien-ban-hang',v:'BH-1.0'};

function baseForm(over){
  return Object.assign({
    id:'f-082',period_id:'p-2026-09',period_month:PERIOD,status:'draft',
    employee_id:'e-082',employee_code:'PHF082',employee_name:'Lý Minh Phước',
    department:'Phòng HCNS',title:'Nhân viên',branch:'',
    reviewer_id:'e-042',reviewer_code:'PHF042',reviewer_name:'Nguyễn Hoàng Khang',
    template_id:OLD_T.id,template_version:OLD_T.v,template_snapshot:{template:{name:'QTTH HCNS'},version:{version_no:OLD_T.v,definition:{}}},
    score_policy_snapshot:{selfWeight:1,reviewWeight:2},score_formula_version:'v0',
    checklist_score:100,self_answers:{},review_answers:{},final_score:null,
    self_saved_at:null,self_submitted_at:null,review_saved_at:null,review_submitted_at:null,reviewed_by:null,
    pilot_opened_at:null,admin_exception_open:false,updated_at:'2026-09-01T00:00:00Z'
  },over||{});
}

let store;
function resetStore(formOver){
  store={
    checklist_monthly_forms:[baseForm(formOver)],
    checklist_monthly_periods:[{id:'p-2026-09',period_month:PERIOD,status:'draft'}],
    checklist_monthly_form_history:[],
    checklist_employee_assignments:[
      {employee_key:'phf082',employee_id:'e-082',employee_code:'PHF082',employee_name:'Lý Minh Phước',
       department:'Bộ phận bán hàng',title:'Nhân viên bán hàng',branch:'',
       manager_id:'e-042',manager_code:'PHF042',manager_name:'Nguyễn Hoàng Khang',
       employee_status:'Đang làm việc',template_id:NEW_T.id,template_version:NEW_T.v,effective_date:'2026-08-01',updated_at:'2026-08-01T00:00:00Z'}
    ],
    checklist_employee_assignment_history:[],
    checklist_templates:[{template_key:NEW_T.id,name:'Nhân viên bán hàng',status:'active',updated_at:'2026-08-01T00:00:00Z'}],
    checklist_template_versions:[{template_key:NEW_T.id,version_no:NEW_T.v,effective_date:'2026-08-01',created_at:'2026-08-01T00:00:00Z',definition:{criteria:[{code:'C1',name:'Doanh số',weight:1,target:10}]}}],
    checklist_violation_records:[],
    checklist_monthly_score_policies:[],
    checklist_monthly_score_policy_history:[],
    checklist_monthly_kpi_configs:[]
  };
}

class FakeQuery{
  constructor(t){this.table=t;this.filters=[];this._single=null;this._limit=null;this._patch=null;this._insert=null;}
  select(){return this;}
  eq(c,v){this.filters.push(r=>String(r[c])===String(v));return this;}
  neq(c,v){this.filters.push(r=>String(r[c])!==String(v));return this;}
  in(c,a){const s=new Set((a||[]).map(String));this.filters.push(r=>s.has(String(r[c])));return this;}
  gte(c,v){this.filters.push(r=>String(r[c]||'')>=String(v));return this;}
  lte(c,v){this.filters.push(r=>String(r[c]||'')<=String(v));return this;}
  order(){return this;}
  limit(n){this._limit=n;return this;}
  range(){return this;}
  maybeSingle(){this._single='maybe';return this;}
  single(){this._single='strict';return this;}
  update(p){this._patch=p;return this;}
  insert(rows){this._insert=Array.isArray(rows)?rows:[rows];return this;}
  then(res,rej){
    const table=store[this.table]||(store[this.table]=[]);
    if(this._insert){this._insert.forEach(row=>table.push(clone(row)));return Promise.resolve({data:clone(this._insert),error:null}).then(res,rej);}
    const matched=table.filter(r=>this.filters.every(f=>f(r)));
    if(this._patch)matched.forEach(r=>Object.assign(r,this._patch));
    let rows=clone(matched);
    if(this._limit!=null)rows=rows.slice(0,this._limit);
    let p;
    if(this._single==='maybe')p={data:rows[0]||null,error:null};
    else if(this._single==='strict')p=rows.length?{data:rows[0],error:null}:{data:null,error:{message:'no rows'}};
    else p={data:rows,error:null};
    return Promise.resolve(p).then(res,rej);
  }
}
const rpcCalls=[];
async function fakeRpc(name,p){
  rpcCalls.push({name,p});
  if(name==='change_checklist_monthly_reviewer'){
    const f=store.checklist_monthly_forms.find(x=>x.id===p.p_form_id);
    const before={reviewerId:f.reviewer_id,reviewerCode:f.reviewer_code,reviewerName:f.reviewer_name};
    f.reviewer_id=p.p_reviewer_id;f.reviewer_code=p.p_reviewer_code;f.reviewer_name=p.p_reviewer_name;
    return {data:{ok:true,before,after:{reviewerId:f.reviewer_id,reviewerCode:f.reviewer_code,reviewerName:f.reviewer_name}},error:null};
  }
  return {data:null,error:{message:'unmocked rpc '+name}};
}
const orig=Module._load;
Module._load=function(req){
  if(req==='@supabase/supabase-js')return {createClient:()=>({from:t=>new FakeQuery(t),rpc:(n,p)=>fakeRpc(n,p)})};
  return orig.apply(this,arguments);
};
const lib=require(path.join(__dirname,'..','api','_lib','checklist-monthly.js'));
Module._load=orig;

const ADMIN={role:'admin',account:{id:'admin-1',name:'Admin Test'},sub:'admin-1'};
let fails=0;
async function rec(name,fn){try{await fn();console.log('PASS -',name);}catch(e){fails++;console.log('FAIL -',name,'\n  '+(e&&e.stack?e.stack.split('\n').slice(0,4).join('\n  '):e));}}
function form(){return store.checklist_monthly_forms[0];}

async function main(){
  // CASE 1 — stale + draft + no answers -> resnapshot allowed, reviewer preserved, status still draft
  await rec('CASE 1 — stale draft resnapshot to BH-1.0, reviewer PHF042 preserved, status draft, history written', async()=>{
    resetStore();rpcCalls.length=0;
    const out=await lib.resnapshotMonthlyDraftTemplate(ADMIN,{formId:'f-082',reason:'Phân công đã sửa sang Nhân viên bán hàng BH-1.0 trước khi mở kỳ'});
    assert.strictEqual(out.changed,true);
    assert.strictEqual(out.after.templateId,NEW_T.id);
    assert.strictEqual(out.after.templateVersion,NEW_T.v);
    assert.strictEqual(form().template_id,NEW_T.id);
    assert.strictEqual(form().template_version,NEW_T.v);
    assert.ok(form().template_snapshot&&form().template_snapshot.version,'template_snapshot refreshed');
    assert.strictEqual(form().status,'draft');
    assert.strictEqual(form().reviewer_code,'PHF042');
    assert.strictEqual(form().reviewer_name,'Nguyễn Hoàng Khang');
    const h=store.checklist_monthly_form_history.find(x=>x.action==='resnapshot_draft');
    assert.ok(h,'resnapshot_draft history entry exists');
    assert.strictEqual(h.before_data.templateId,OLD_T.id);
    assert.strictEqual(h.after_data.templateId,NEW_T.id);
    assert.strictEqual(h.changed_by_name,'Admin Test');
    assert.ok(String(h.reason||'').length>=10);
  });

  // CASE 2 — already matches current assignment -> no-op
  await rec('CASE 2 — already BH-1.0 -> changed:false, no history, no template rewrite', async()=>{
    resetStore({template_id:NEW_T.id,template_version:NEW_T.v});
    const out=await lib.resnapshotMonthlyDraftTemplate(ADMIN,{formId:'f-082',reason:'kiểm tra không có gì để cập nhật'});
    assert.strictEqual(out.changed,false);
    assert.ok(!store.checklist_monthly_form_history.some(x=>x.action==='resnapshot_draft'));
  });

  // CASE 3 — form opened / waiting_self etc -> rejected
  for(const st of ['waiting_self','waiting_review','reviewed','locked']){
    await rec('CASE 3 — status '+st+' -> rejected NOT_DRAFT', async()=>{
      resetStore({status:st});
      let threw=null;try{await lib.resnapshotMonthlyDraftTemplate(ADMIN,{formId:'f-082',reason:'thử trên phiếu đã mở'});}catch(e){threw=e;}
      assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_RESNAPSHOT_NOT_DRAFT',threw&&threw.code);
      assert.strictEqual(form().template_id,OLD_T.id);
    });
  }

  // CASE 3b — pilot opened -> rejected
  await rec('CASE 3b — pilot_opened_at set -> rejected', async()=>{
    resetStore({pilot_opened_at:'2026-09-02T00:00:00Z'});
    let threw=null;try{await lib.resnapshotMonthlyDraftTemplate(ADMIN,{formId:'f-082',reason:'thử trên phiếu mở thử'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_RESNAPSHOT_PILOT_OPENED',threw&&threw.code);
  });

  // CASE 4 — draft but has self answers -> rejected
  await rec('CASE 4 — draft with self_answers -> rejected HAS_SELF', async()=>{
    resetStore({self_answers:{C1:{value:'8'}}});
    let threw=null;try{await lib.resnapshotMonthlyDraftTemplate(ADMIN,{formId:'f-082',reason:'thử khi đã có tự đánh giá'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_RESNAPSHOT_HAS_SELF',threw&&threw.code);
    assert.strictEqual(form().template_id,OLD_T.id);
  });
  await rec('CASE 4b — draft with review answers -> rejected HAS_REVIEW', async()=>{
    resetStore({review_answers:{C1:{value:'9'}}});
    let threw=null;try{await lib.resnapshotMonthlyDraftTemplate(ADMIN,{formId:'f-082',reason:'thử khi đã có thẩm định'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_RESNAPSHOT_HAS_REVIEW',threw&&threw.code);
  });

  // CASE 5 — reason too short -> rejected, nothing changed
  await rec('CASE 5 — reason < 10 chars -> rejected, no change', async()=>{
    resetStore();
    let threw=null;try{await lib.resnapshotMonthlyDraftTemplate(ADMIN,{formId:'f-082',reason:'ngắn'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_RESNAPSHOT_REASON_REQUIRED',threw&&threw.code);
    assert.strictEqual(form().template_id,OLD_T.id);
  });

  // CASE 6 — after resnapshot, reconcileMissingMonthlyReviewers does NOT revert template or reviewer
  await rec('CASE 6 — reconcileMissingMonthlyReviewers after resnapshot keeps BH-1.0 + PHF042', async()=>{
    resetStore();
    await lib.resnapshotMonthlyDraftTemplate(ADMIN,{formId:'f-082',reason:'Phân công đã sửa sang BH-1.0 trước khi mở kỳ'});
    rpcCalls.length=0;
    const rc=await lib.reconcileMissingMonthlyReviewers(ADMIN,PERIOD);
    assert.strictEqual(form().template_id,NEW_T.id,'template not reverted by reconcile');
    assert.strictEqual(form().template_version,NEW_T.v);
    assert.strictEqual(form().reviewer_code,'PHF042','reviewer not reverted by reconcile');
    assert.ok(!rpcCalls.some(c=>c.name==='change_checklist_monthly_reviewer'),'reconcile did not touch reviewer (already current manager)');
    assert.strictEqual(rc.updated,0);
  });

  // CASE 7 — non-admin rejected
  await rec('CASE 7 — non-admin -> rejected', async()=>{
    resetStore();
    let threw=null;try{await lib.resnapshotMonthlyDraftTemplate({role:'user',account:{id:'u1'}},{formId:'f-082',reason:'người dùng thường thử cập nhật'});}catch(e){threw=e;}
    assert.ok(threw,'must throw for non-admin');
    assert.strictEqual(form().template_id,OLD_T.id);
  });

  console.log(fails?('\n'+fails+' FAIL'):'\nALL PASS');
  process.exit(fails?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
