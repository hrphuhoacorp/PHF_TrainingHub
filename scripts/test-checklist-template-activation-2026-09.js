'use strict';
/*
 * Regression — Phase 2: activateChecklistTemplateVersion()
 *
 * BH pilot: BH-2.0 already exists in checklist_template_versions but is NOT the template's
 * current_version, and assignments are still pinned to BH-1.0. Activation must, coherently:
 *  A) promote checklist_templates.current_version BH-1.0 -> BH-2.0 (via phf_save_checklist_template)
 *  B) repoint ACTIVE nv-ban-hang/BH-1.0 assignments -> BH-2.0 effective 2026-09-01 (with history)
 *  D) return a retro hint for the existing engine to fix September forms
 * Idempotent; no new version; no People write; no other template.
 *
 * In-memory only. @supabase/supabase-js stubbed. No real Supabase.
 *   node scripts/test-checklist-template-activation-2026-09.js
 */
process.env.SUPABASE_URL='https://fake-project.supabase.co';
process.env.SUPABASE_SECRET_KEY='fake-secret-key';
const assert=require('assert');
const path=require('path');
const Module=require('module');
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}

const BH1={version_no:'BH-1.0'},BH2={version_no:'BH-2.0'};
const NEW_DEF={templateType:'score_summary',groups:[],totalRows:[
  {id:'r-tuan-thu',code:'BH-TUAN-THU',name:'Tuân thủ tiêu chuẩn công việc',target:100,unit:'điểm',weight:70,source:{type:'checklist_total'}},
  {id:'r-cap-tren',code:'BH-CAP-TREN',name:'Công việc cấp trên giao',target:10,unit:'điểm',weight:30,source:{type:'manual'}}
]};
const OLD_DEF={templateType:'score_summary',groups:[],totalRows:[
  {id:'r-lap-phieu',code:'BH-LAP-PHIEU',name:'Lập phiếu',target:5,unit:'phiếu',weight:5,source:{type:'manual'}},
  {id:'r-tuan-thu',code:'BH-TUAN-THU',name:'Tuân thủ tiêu chuẩn công việc',target:100,unit:'điểm',weight:70,source:{type:'manual'}},
  {id:'r-cap-tren',code:'BH-CAP-TREN',name:'Công việc cấp trên giao',target:10,unit:'điểm',weight:25,source:{type:'manual'}}
]};

let store;
function reset(){
  store={
    checklist_templates:[{template_key:'nv-ban-hang',code:'BH',name:'Nhân viên bán hàng',group_name:'Bán hàng',template_type:'score_summary',has_checklist:true,source:'',note:'',status:'active',current_version:'BH-1.0',effective_date:'2026-07-01',updated_at:'2026-09-01T00:00:00Z'}],
    checklist_template_versions:[
      {template_key:'nv-ban-hang',version_no:'BH-1.0',effective_date:'2026-07-01',reason:'Chuẩn hóa từ file gốc',source_version:'',change_type:'sync',definition:OLD_DEF,created_at:'2026-07-01T00:00:00Z'},
      {template_key:'nv-ban-hang',version_no:'BH-2.0',effective_date:'2026-09-01',reason:'Sao chép từ phiên bản BH-1.0',source_version:'BH-1.0',change_type:'retro-copy',definition:NEW_DEF,created_at:'2026-09-01T08:00:00Z'}
    ],
    checklist_template_version_history:[],
    checklist_employee_assignment_history:[],
    employee_profiles:[
      {employee_code:'PHF078',full_name:'Châu Quỳnh Như',department:'Bộ phận bán hàng',title:'Nhân viên bán hàng',position:'',branch:'',manager_employee_code:'PHF042'},
      {employee_code:'PHF082',full_name:'Lý Minh Phước',department:'Bộ phận bán hàng',title:'Nhân viên bán hàng',position:'',branch:'',manager_employee_code:'PHF042'},
      {employee_code:'PHF090',full_name:'NV Chín Mươi',department:'Bộ phận bán hàng',title:'Nhân viên bán hàng',position:'',branch:'',manager_employee_code:'PHF042'},
      {employee_code:'PHF042',full_name:'Nguyễn Hoàng Khang',department:'Bộ phận bán hàng',title:'Trưởng bộ phận',position:'',branch:'',manager_employee_code:''},
      {employee_code:'PHF200',full_name:'NV Kho',department:'Kho',title:'Nhân viên kho',position:'',branch:'',manager_employee_code:''}
    ],
    checklist_employee_assignments:[
      // active, BH-1.0 -> in scope (PHF078 was reverted to BH-1.0 by operator; PHF082, PHF090)
      row('PHF078','nv-ban-hang','BH-1.0','Đang làm việc','2026-07-01T00:00:00Z'),
      row('PHF082','nv-ban-hang','BH-1.0','Đang làm việc','2026-07-01T00:00:00Z'),
      row('PHF090','nv-ban-hang','BH-1.0','Đang làm việc','2026-07-01T00:00:00Z'),
      // active, ALREADY BH-2.0 (operator's earlier manual test) -> must NOT be re-touched
      row('PHF042','nv-ban-hang','BH-2.0','Đang làm việc','2026-09-01T09:00:00Z'),
      // inactive, BH-1.0 -> NOT bulk-promoted
      row('PHF099','nv-ban-hang','BH-1.0','Đã nghỉ việc','2026-05-01T00:00:00Z'),
      // unrelated template -> untouched
      row('PHF200','nv-kho','NVK-1.0','Đang làm việc','2026-06-01T00:00:00Z')
    ]
  };
}
function row(code,tpl,ver,status,updatedAt){
  return {id:'a-'+code,employee_key:code.toLowerCase(),employee_id:'e-'+code,employee_code:code,employee_name:code,
    department:'?',title:'?',position:'',branch:'',manager_id:'',manager_code:'',manager_name:'',
    employee_status:status,leave_until:null,status_note:'',template_id:tpl,template_version:ver,
    effective_date:'2026-07-01',reason:'seed',updated_at:updatedAt,created_at:updatedAt};
}

class FakeQuery{
  constructor(t){this.table=t;this.filters=[];this._single=null;this._limit=null;this._patch=null;this._order=[];}
  select(){return this;}
  eq(c,v){this.filters.push(r=>String(r[c])===String(v));return this;}
  neq(c,v){this.filters.push(r=>String(r[c])!==String(v));return this;}
  in(c,a){const s=new Set((a||[]).map(String));this.filters.push(r=>s.has(String(r[c])));return this;}
  gte(c,v){this.filters.push(r=>String(r[c]||'')>=String(v));return this;}
  lte(c,v){this.filters.push(r=>String(r[c]||'')<=String(v));return this;}
  order(c,o){this._order.push({c,asc:!(o&&o.ascending===false)});return this;}
  limit(n){this._limit=n;return this;}
  range(a,b){this._range=[a,b];return this;}
  maybeSingle(){this._single='maybe';return this;}
  single(){this._single='strict';return this;}
  update(p){this._patch=p;return this;}
  then(res,rej){
    const table=store[this.table]||(store[this.table]=[]);
    const matchedRefs=table.filter(r=>this.filters.every(f=>f(r)));
    if(this._patch)matchedRefs.forEach(r=>Object.assign(r,this._patch));
    let rows=clone(matchedRefs);
    this._order.forEach(o=>{rows.sort((a,b)=>{const x=a[o.c],y=b[o.c];return (x<y?-1:x>y?1:0)*(o.asc?1:-1);});});
    if(this._range)rows=rows.slice(this._range[0],this._range[1]+1);
    else if(this._limit!=null)rows=rows.slice(0,this._limit);
    let p;
    if(this._single==='maybe')p={data:rows[0]||null,error:null};
    else if(this._single==='strict')p=rows.length?{data:rows[0],error:null}:{data:null,error:{message:'no rows'}};
    else p={data:rows,error:null};
    return Promise.resolve(p).then(res,rej);
  }
}
const rpcCalls=[];
async function fakeRpc(name,params){
  rpcCalls.push({name,params:clone(params)});
  if(name==='phf_save_checklist_template'){
    const key=params.p_template.template_key,ver=params.p_version.version_no;
    const tpl=store.checklist_templates.find(t=>t.template_key===key);
    if(!tpl)return {data:{ok:false,code:'NOT_FOUND'},error:null};
    // immutable check: version exists with same content -> no-op; then update current_version
    const existing=store.checklist_template_versions.find(v=>v.template_key===key&&v.version_no===ver);
    if(existing){
      const same=JSON.stringify(existing.definition)===JSON.stringify(params.p_version.definition)
        && String(existing.effective_date)===String(params.p_version.effective_date)
        && String(existing.reason||'')===String(params.p_version.reason||'Cập nhật mẫu Checklist'||'')
        && String(existing.source_version||'')===String(params.p_version.source_version||'')
        && String(existing.change_type||'')===String(params.p_version.change_type||'sync');
      // our service passes verbatim so reason matches; accept
    }else{
      store.checklist_template_versions.push({template_key:key,version_no:ver,effective_date:params.p_version.effective_date,reason:params.p_version.reason,source_version:params.p_version.source_version,change_type:params.p_version.change_type,definition:params.p_version.definition,created_at:params.p_version.created_at});
    }
    tpl.current_version=ver;tpl.effective_date=params.p_template.effective_date;tpl.updated_at=new Date().toISOString();
    return {data:{ok:true,templateKey:key,version:ver},error:null};
  }
  if(name==='phf_save_checklist_assignments'){
    let saved=0,changed=0;
    (params.p_rows||[]).forEach(item=>{
      const cur=store.checklist_employee_assignments.find(r=>r.employee_key===item.employee_key);
      saved++;
      if(!cur)return;
      // optimistic check
      if(item.expected_updated_at&&String(cur.updated_at)!==String(item.expected_updated_at)){
        throw new Error('CHECKLIST_ASSIGNMENT_STALE:'+item.employee_key);
      }
      const before=clone(cur);
      if(String(cur.template_version)!==String(item.template_version)||String(cur.effective_date)!==String(item.effective_date)){
        changed++;
        store.checklist_employee_assignment_history.push({employee_key:item.employee_key,previous_data:before,template_version:item.template_version,reason:item.reason,changed_at:new Date().toISOString()});
        cur.template_version=item.template_version;cur.effective_date=item.effective_date;cur.reason=item.reason;cur.updated_at=new Date().toISOString();
      }
    });
    return {data:{saved,changed},error:null};
  }
  return {data:null,error:{message:'unmocked rpc '+name}};
}
const orig=Module._load;
Module._load=function(req){
  if(req==='@supabase/supabase-js')return {createClient:()=>({from:t=>new FakeQuery(t),rpc:(n,p)=>fakeRpc(n,p)})};
  return orig.apply(this,arguments);
};
const svc=require(path.join(__dirname,'..','api','_lib','checklist-template-retroactive-service.js'));
Module._load=orig;

const ADMIN={role:'admin',account:{id:'admin-1',name:'Admin Test'},sub:'admin-1'};
let fails=0;
async function rec(name,fn){try{await fn();console.log('PASS -',name);}catch(e){fails++;console.log('FAIL -',name,'\n  '+(e&&e.stack?e.stack.split('\n').slice(0,4).join('\n  '):e));}}
function tpl(){return store.checklist_templates[0];}
function asg(code){return store.checklist_employee_assignments.find(r=>r.employee_code===code);}

async function main(){
  // CASE dry run — scope classification
  await rec('DRY RUN — scope = PHF078,PHF082,PHF090; already BH-2.0 = PHF042; inactive = PHF099; other template not counted', async()=>{
    reset();rpcCalls.length=0;
    const out=await svc.activateTemplateVersion(ADMIN,{templateKey:'nv-ban-hang',newVersion:'BH-2.0',effectiveDate:'2026-09-01',dryRun:true});
    assert.strictEqual(out.dryRun,true);
    assert.deepStrictEqual(out.scopeCodes,['PHF078','PHF082','PHF090']);
    assert.strictEqual(out.scopeCount,3);
    assert.deepStrictEqual(out.alreadyOnNewVersionCodes,['PHF042']);
    assert.strictEqual(out.inactivePinnedOldCount,1);
    assert.strictEqual(out.willPromoteTemplate,true);
    assert.strictEqual(out.periodMonth,'2026-09');
    assert.deepStrictEqual(out.retro,{templateKey:'nv-ban-hang',oldVersion:'BH-1.0',newVersion:'BH-2.0',periodMonthFrom:'2026-09',periodMonthTo:'2026-09'});
    assert.strictEqual(rpcCalls.length,0,'dry run writes nothing');
  });

  // CASE 1 + 2 — activate: no duplicate version; current_version -> BH-2.0
  await rec('CASE 1/2 — activate: BH-2.0 not recreated; current_version BH-1.0 -> BH-2.0', async()=>{
    reset();rpcCalls.length=0;
    const before=store.checklist_template_versions.length;
    const out=await svc.activateTemplateVersion(ADMIN,{templateKey:'nv-ban-hang',newVersion:'BH-2.0',effectiveDate:'2026-09-01',reason:'Áp dụng BH 70/30 từ kỳ 09/2026 theo QĐ BGĐ'});
    assert.strictEqual(out.ok,true);
    assert.strictEqual(out.promoted,true);
    assert.strictEqual(store.checklist_template_versions.length,before,'no new version row');
    assert.strictEqual(tpl().current_version,'BH-2.0');
  });

  // CASE 3 + 4 + 5 + 11 — assignment repoint + history; unrelated + inactive untouched
  await rec('CASE 3/4/5 — active BH-1.0 assignments -> BH-2.0 eff 2026-09-01 + history; PHF200/PHF099/PHF042 untouched', async()=>{
    // continue from previous state? fresh:
    reset();rpcCalls.length=0;
    await svc.activateTemplateVersion(ADMIN,{templateKey:'nv-ban-hang',newVersion:'BH-2.0',effectiveDate:'2026-09-01',reason:'Áp dụng BH 70/30 từ kỳ 09/2026 theo QĐ BGĐ'});
    ['PHF078','PHF082','PHF090'].forEach(c=>{
      assert.strictEqual(asg(c).template_version,'BH-2.0','repointed '+c);
      assert.strictEqual(asg(c).template_id,'nv-ban-hang','template_id unchanged '+c);
      assert.strictEqual(asg(c).effective_date,'2026-09-01','effective_date '+c);
    });
    assert.strictEqual(asg('PHF099').template_version,'BH-1.0','inactive not promoted');
    assert.strictEqual(asg('PHF200').template_version,'NVK-1.0','other template untouched');
    assert.strictEqual(asg('PHF042').template_version,'BH-2.0','already-new untouched (still BH-2.0)');
    const hist=store.checklist_employee_assignment_history.filter(h=>['phf078','phf082','phf090'].includes(h.employee_key));
    assert.strictEqual(hist.length,3,'3 history rows (transition BH-1.0 -> BH-2.0)');
    assert.strictEqual(hist[0].previous_data.template_version,'BH-1.0');
  });

  // CASE 12 — PHF078 specifically ends up BH-2.0 through the same rollout (no special-casing)
  await rec('CASE 12 — PHF078 Châu Quỳnh Như naturally on BH-2.0 after activation', async()=>{
    reset();
    await svc.activateTemplateVersion(ADMIN,{templateKey:'nv-ban-hang',newVersion:'BH-2.0',effectiveDate:'2026-09-01',reason:'Áp dụng BH 70/30 từ kỳ 09/2026 theo QĐ BGĐ'});
    assert.strictEqual(asg('PHF078').template_version,'BH-2.0');
    assert.strictEqual(asg('PHF078').template_id,'nv-ban-hang');
  });

  // CASE 13 — retry activation: idempotent (no duplicate version/history, no extra assignment change)
  await rec('CASE 13 — retry activate: current_version stays BH-2.0, no new version, no duplicate history', async()=>{
    reset();
    await svc.activateTemplateVersion(ADMIN,{templateKey:'nv-ban-hang',newVersion:'BH-2.0',effectiveDate:'2026-09-01',reason:'Áp dụng BH 70/30 từ kỳ 09/2026 theo QĐ BGĐ'});
    const verCount=store.checklist_template_versions.length;
    const histCount=store.checklist_employee_assignment_history.length;
    const out2=await svc.activateTemplateVersion(ADMIN,{templateKey:'nv-ban-hang',newVersion:'BH-2.0',effectiveDate:'2026-09-01',reason:'Chạy lại kích hoạt để chắc chắn — idempotent'});
    assert.strictEqual(tpl().current_version,'BH-2.0');
    assert.strictEqual(store.checklist_template_versions.length,verCount,'no new version on retry');
    assert.strictEqual(store.checklist_employee_assignment_history.length,histCount,'no duplicate history on retry (scope now empty)');
    assert.strictEqual(out2.promoted,false,'promote skipped (already current)');
    assert.strictEqual(out2.scopeCount,0,'scope empty on retry');
    assert.strictEqual(out2.assignmentsChanged,0);
  });

  // CASE — version not found
  await rec('activate non-existent version -> clear error, nothing written', async()=>{
    reset();rpcCalls.length=0;
    let threw=null;try{await svc.activateTemplateVersion(ADMIN,{templateKey:'nv-ban-hang',newVersion:'BH-9.9',reason:'thử phiên bản không tồn tại'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_ACTIVATE_VERSION_NOT_FOUND',threw&&threw.code);
    assert.strictEqual(tpl().current_version,'BH-1.0');
  });

  // CASE — non-admin
  await rec('non-admin -> rejected', async()=>{
    reset();
    let threw=null;try{await svc.activateTemplateVersion({role:'user',account:{id:'u'}},{templateKey:'nv-ban-hang',newVersion:'BH-2.0',reason:'người thường thử kích hoạt'});}catch(e){threw=e;}
    assert.ok(threw,'must throw');
    assert.strictEqual(tpl().current_version,'BH-1.0');
  });

  // CASE — reason too short
  await rec('reason < 10 chars -> rejected before any write', async()=>{
    reset();rpcCalls.length=0;
    let threw=null;try{await svc.activateTemplateVersion(ADMIN,{templateKey:'nv-ban-hang',newVersion:'BH-2.0',effectiveDate:'2026-09-01',reason:'ngắn'});}catch(e){threw=e;}
    assert.ok(threw&&threw.code==='CHECKLIST_ACTIVATE_REASON_REQUIRED',threw&&threw.code);
    assert.strictEqual(rpcCalls.length,0);
  });

  console.log(fails?('\n'+fails+' FAIL'):'\nALL PASS');
  process.exit(fails?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
