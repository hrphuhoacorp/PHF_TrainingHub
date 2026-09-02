'use strict';
/*
 * Regression — per-form template version override: overrideMonthlyFormVersion()
 *
 * Admin intentionally sets ONE monthly form to another valid version of the SAME template,
 * WITHOUT touching checklist_employee_assignments. Reuses the canonical pure engine
 * (diffDefinitions + classifyFormForApply from checklist-template-retroactive.js).
 * Conceptual regression: PHF078 September BH-2.0 -> BH-1.0 -> BH-2.0.
 *
 * In-memory only. @supabase/supabase-js stubbed. No real Supabase.
 *   node scripts/test-checklist-monthly-form-version-override-2026-09.js
 */
process.env.SUPABASE_URL='https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY='fake-secret-key';
const assert=require('assert');
const path=require('path');
const Module=require('module');
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}

const BH1_DEF={templateType:'score_summary',groups:[],totalRows:[
  {id:'BH-LAP-PHIEU',code:'BH-LAP-PHIEU',name:'Lập phiếu',target:5,unit:'phiếu',weight:5,source:{type:'manual'}},
  {id:'HQCV-TUANTHU',code:'HQCV-TUANTHU',name:'Tuân thủ tiêu chuẩn công việc',target:100,unit:'điểm',weight:70,source:{type:'manual'}},
  {id:'HQCV-CAPTREN',code:'HQCV-CAPTREN',name:'Công việc cấp trên giao',target:10,unit:'điểm',weight:25,source:{type:'manual'}}
]};
const BH2_DEF={templateType:'score_summary',groups:[],totalRows:[
  {id:'HQCV-TUANTHU',code:'HQCV-TUANTHU',name:'Tuân thủ tiêu chuẩn công việc',target:100,unit:'điểm',weight:70,source:{type:'checklist_total'}},
  {id:'HQCV-CAPTREN',code:'HQCV-CAPTREN',name:'Công việc cấp trên giao',target:10,unit:'điểm',weight:30,source:{type:'manual'}}
]};
const HCNS_DEF={templateType:'score_summary',groups:[],totalRows:[{id:'X',code:'X',name:'X',target:1,unit:'',weight:100,source:{type:'manual'}}]};

const FID='f-phf078-2026-09';
let store;
function snap(ver,def){return {template:{name:'Nhân viên bán hàng'},version:{version_no:ver,definition:clone(def)}};}
function reset(over){
  store={
    checklist_monthly_forms:[Object.assign({
      id:FID,period_id:'p',period_month:'2026-09',status:'draft',
      employee_id:'e-078',employee_code:'PHF078',employee_name:'Châu Quỳnh Như',
      reviewer_id:'e-042',reviewer_code:'PHF042',reviewer_name:'Nguyễn Hoàng Khang',
      template_id:'nv-ban-hang',template_version:'BH-2.0',template_snapshot:snap('BH-2.0',BH2_DEF),
      self_answers:{},review_answers:{},final_score:null,self_saved_at:null,self_submitted_at:null,
      review_saved_at:null,review_submitted_at:null,reviewed_by:null,pilot_opened_at:null,
      score_formula_version:'v0',updated_at:'2026-09-10T00:00:00Z'
    },over||{})],
    checklist_monthly_form_history:[],
    checklist_template_versions:[
      {template_key:'nv-ban-hang',version_no:'BH-1.0',effective_date:'2026-07-01',reason:'seed',definition:BH1_DEF,created_at:'2026-07-01T00:00:00Z'},
      {template_key:'nv-ban-hang',version_no:'BH-2.0',effective_date:'2026-09-01',reason:'seed',definition:BH2_DEF,created_at:'2026-09-01T00:00:00Z'},
      {template_key:'hcns',version_no:'HCNS-1.0',effective_date:'2026-01-01',reason:'seed',definition:HCNS_DEF,created_at:'2026-01-01T00:00:00Z'}
    ],
    checklist_employee_assignments:[
      {employee_key:'phf078',employee_code:'PHF078',template_id:'nv-ban-hang',template_version:'BH-2.0',updated_at:'2026-09-01T00:00:00Z'}
    ]
  };
}

class FakeQuery{
  constructor(t){this.table=t;this.filters=[];this._single=null;this._limit=null;this._patch=null;this._insert=null;this._order=[];}
  select(){return this;}
  eq(c,v){this.filters.push(r=>String(r[c])===String(v));return this;}
  neq(c,v){this.filters.push(r=>String(r[c])!==String(v));return this;}
  in(c,a){const s=new Set((a||[]).map(String));this.filters.push(r=>s.has(String(r[c])));return this;}
  not(c,op,val){if(op==='in'){const set=new Set(String(val).replace(/[()"]/g,'').split(',').map(s=>s.trim()));this.filters.push(r=>!set.has(String(r[c])));}return this;}
  gte(c,v){this.filters.push(r=>String(r[c]||'')>=String(v));return this;}
  lte(c,v){this.filters.push(r=>String(r[c]||'')<=String(v));return this;}
  order(c,o){this._order.push({c,asc:!(o&&o.ascending===false)});return this;}
  limit(n){this._limit=n;return this;}
  range(){return this;}
  maybeSingle(){this._single='maybe';return this;}
  single(){this._single='strict';return this;}
  update(p){this._patch=p;return this;}
  insert(rows){this._insert=Array.isArray(rows)?rows:[rows];return this;}
  then(res,rej){
    const table=store[this.table]||(store[this.table]=[]);
    if(this._insert){this._insert.forEach(r=>table.push(clone(r)));return Promise.resolve({data:clone(this._insert),error:null}).then(res,rej);}
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
const orig=Module._load;
Module._load=function(req){
  if(req==='@supabase/supabase-js')return {createClient:()=>({from:t=>new FakeQuery(t),rpc:async()=>({data:null,error:{message:'no rpc'}})})};
  return orig.apply(this,arguments);
};
const lib=require(path.join(__dirname,'..','api','_lib','checklist-monthly.js'));
Module._load=orig;

const ADMIN={role:'admin',account:{id:'admin-1',name:'Admin Test'},sub:'admin-1'};
let fails=0;
async function rec(name,fn){try{await fn();console.log('PASS -',name);}catch(e){fails++;console.log('FAIL -',name,'\n  '+(e&&e.stack?e.stack.split('\n').slice(0,4).join('\n  '):e));}}
function form(){return store.checklist_monthly_forms[0];}
function asg(){return store.checklist_employee_assignments[0];}
function hist(){return store.checklist_monthly_form_history.filter(h=>h.action==='manual_version_override');}

async function main(){
  // CASE 1 — dry run diff then apply BH-2.0 -> BH-1.0
  await rec('CASE 1 — dry-run shows diff; apply BH-2.0 -> BH-1.0 succeeds; snapshot + version updated', async()=>{
    reset();
    const dry=await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-1.0',dryRun:true});
    assert.strictEqual(dry.dryRun,true);
    assert.strictEqual(dry.before.templateVersion,'BH-2.0');assert.strictEqual(dry.after.templateVersion,'BH-1.0');
    assert.ok(dry.diff&&dry.diff.added.length===1&&dry.diff.added[0].id==='BH-LAP-PHIEU','diff: BH-LAP-PHIEU added going to BH-1.0');
    assert.strictEqual(dry.classification.outcome,'applied');
    const out=await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-1.0',reason:'Ngoại lệ tháng 09 theo yêu cầu Ban Giám đốc'});
    assert.strictEqual(out.changed,true);
    assert.strictEqual(form().template_version,'BH-1.0');
    assert.strictEqual(form().template_snapshot.version.version_no,'BH-1.0');
    assert.strictEqual(form().template_snapshot.version.definition.totalRows.length,3);
    assert.strictEqual(form().template_id,'nv-ban-hang');
  });

  // CASE 2 — assignment untouched
  await rec('CASE 2 — checklist_employee_assignments unchanged (still BH-2.0)', async()=>{
    assert.strictEqual(asg().template_version,'BH-2.0');
  });

  // CASE 6/7 — reviewer + status preserved
  await rec('CASE 6/7 — reviewer PHF042 preserved, status still draft', async()=>{
    assert.strictEqual(form().reviewer_code,'PHF042');
    assert.strictEqual(form().status,'draft');
  });

  // CASE 4/5 — back to BH-2.0; history has both transitions
  await rec('CASE 4/5 — BH-1.0 -> BH-2.0 succeeds; history: BH-2.0->BH-1.0 then BH-1.0->BH-2.0', async()=>{
    const out=await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-2.0',reason:'Kết thúc ngoại lệ, trả phiếu về BH-2.0 chuẩn'});
    assert.strictEqual(out.changed,true);
    assert.strictEqual(form().template_version,'BH-2.0');
    assert.strictEqual(form().template_snapshot.version.definition.totalRows.length,2);
    const h=hist();
    assert.strictEqual(h.length,2);
    assert.deepStrictEqual([h[0].before_data.templateVersion,h[0].after_data.templateVersion],['BH-2.0','BH-1.0']);
    assert.deepStrictEqual([h[1].before_data.templateVersion,h[1].after_data.templateVersion],['BH-1.0','BH-2.0']);
    assert.strictEqual(asg().template_version,'BH-2.0','assignment still BH-2.0 after round trip');
  });

  // CASE 13 — same-version submit -> no-op, no meaningless history
  await rec('CASE 13 — target === current -> changed:false, no new history', async()=>{
    reset();
    const before=store.checklist_monthly_form_history.length;
    const out=await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-2.0',reason:'thử submit cùng phiên bản'});
    assert.strictEqual(out.changed,false);
    assert.strictEqual(store.checklist_monthly_form_history.length,before);
  });

  // CASE 8 — answers remapped by stable id (row present in both versions)
  await rec('CASE 8 — waiting_review form with self answer on HQCV-CAPTREN -> remapped, preserved', async()=>{
    reset({status:'waiting_review',self_answers:{'HQCV-CAPTREN':{value:'8'}},self_saved_at:'2026-09-11T00:00:00Z'});
    const out=await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-1.0',reason:'Ngoại lệ có dữ liệu tự đánh giá, remap theo id'});
    assert.strictEqual(out.changed,true);
    assert.deepStrictEqual(form().self_answers,{'HQCV-CAPTREN':{value:'8'}});
    assert.strictEqual(form().template_version,'BH-1.0');
  });

  // CASE 8b — answer on a row REMOVED in target -> blocked (skipped-unmapped), no write
  await rec('CASE 8b — answer on row missing in target version -> rejected UNMAPPED, no write', async()=>{
    reset({status:'waiting_review',template_version:'BH-1.0',template_snapshot:snap('BH-1.0',BH1_DEF),self_answers:{'BH-LAP-PHIEU':{value:'2'}},self_saved_at:'x'});
    let threw=null;try{await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-2.0',reason:'thử khi có câu trả lời trên dòng bị xóa'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_OVERRIDE_UNMAPPED',threw&&threw.code);
    assert.strictEqual(form().template_version,'BH-1.0','no write');
  });

  // CASE 9 — version from another template -> rejected
  await rec('CASE 9 — target version from another template (hcns) -> rejected', async()=>{
    reset();
    let threw=null;try{await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'HCNS-1.0',reason:'thử phiên bản mẫu khác'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_OVERRIDE_VERSION_NOT_FOUND',threw&&threw.code);
  });

  // CASE 10 — nonexistent version
  await rec('CASE 10 — nonexistent version -> rejected', async()=>{
    reset();
    let threw=null;try{await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-9.9',reason:'thử phiên bản không tồn tại'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_OVERRIDE_VERSION_NOT_FOUND',threw&&threw.code);
  });

  // CASE 11 — non-admin
  await rec('CASE 11 — non-admin -> rejected', async()=>{
    reset();
    let threw=null;try{await lib.overrideMonthlyFormVersion({role:'user',account:{id:'u'}},{formId:FID,newVersion:'BH-1.0',reason:'người thường thử điều chỉnh'});}catch(e){threw=e;}
    assert.ok(threw,'must throw');
    assert.strictEqual(form().template_version,'BH-2.0');
  });

  // CASE 12 — locked / cancelled / reviewed
  await rec('CASE 12 — locked -> rejected LOCKED', async()=>{
    reset({status:'locked'});
    let threw=null;try{await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-1.0',reason:'thử trên phiếu đã khóa'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_OVERRIDE_LOCKED',threw&&threw.code);
  });
  await rec('CASE 12b — cancelled -> rejected CANCELLED', async()=>{
    reset({status:'cancelled'});
    let threw=null;try{await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-1.0',reason:'thử trên phiếu đã hủy'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_OVERRIDE_CANCELLED',threw&&threw.code);
  });
  await rec('CASE 12c — reviewed -> rejected, points to reviewed-form tool', async()=>{
    reset({status:'reviewed',review_submitted_at:'x',final_score:88});
    let threw=null;try{await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-1.0',reason:'thử trên phiếu đã thẩm định'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_OVERRIDE_REVIEWED',threw&&threw.code);
  });

  // CASE 14 — stale expectedUpdatedAt
  await rec('CASE 14 — stale expectedUpdatedAt -> rejected STALE, no write', async()=>{
    reset();
    let threw=null;try{await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-1.0',reason:'thử với updated_at cũ',expectedUpdatedAt:'2020-01-01T00:00:00Z'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_OVERRIDE_STALE',threw&&threw.code);
    assert.strictEqual(form().template_version,'BH-2.0');
  });

  // CASE — reason too short
  await rec('reason < 10 chars -> rejected before any write', async()=>{
    reset();
    let threw=null;try{await lib.overrideMonthlyFormVersion(ADMIN,{formId:FID,newVersion:'BH-1.0',reason:'ngắn'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_MONTHLY_OVERRIDE_REASON_REQUIRED',threw&&threw.code);
  });

  console.log(fails?('\n'+fails+' FAIL'):'\nALL PASS');
  process.exit(fails?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
