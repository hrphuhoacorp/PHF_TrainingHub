'use strict';
/*
 * Regression — listMonthly(): "Điều chỉnh thủ công" is ACTIVE only while the form version
 * still differs from the current assignment version. A manual_version_override history event
 * is HISTORY, not proof the override still stands.
 *
 * PROD bug: PHF078 form BH-1.0 -> BH-2.0 (assignment also BH-2.0) still showed the badge.
 *
 * In-memory. @supabase/supabase-js stubbed.
 *   node scripts/test-checklist-monthly-version-override-active-2026-09.js
 */
const assert = require('assert');
const path = require('path');
const Module = require('module');
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}

const PERIOD = '2026-09';
const SNAP = { version: { version_no: 'BH-1.0', definition: { totalRows: [{ id:'r1', code:'r1', name:'x', target:10, unit:'điểm', weight:100, source:{type:'manual'} }] } } };
let store;
function reset(){
  store = {
    checklist_monthly_periods: [{ id:'p', period_month:PERIOD, status:'draft' }],
    checklist_monthly_forms: [
      // A: manual override active — form BH-1.0, assignment BH-2.0
      { id:'F-A', period_month:PERIOD, employee_code:'PHF078', employee_name:'Châu Quỳnh Như', department:'Bộ phận bán hàng', title:'NV', branch:'',
        status:'draft', template_id:'nv-ban-hang', template_version:'BH-1.0', template_snapshot:clone(SNAP), checklist_score:100, final_score:null,
        reviewer_id:'e-042', reviewer_code:'PHF042', reviewer_name:'Nguyễn Hoàng Khang', updated_at:'2026-09-10T00:00:00Z' },
      // B: returned to assignment — form BH-2.0, assignment BH-2.0, override history still present
      { id:'F-B', period_month:PERIOD, employee_code:'PHF082', employee_name:'Lý Minh Phước', department:'Bộ phận bán hàng', title:'NV', branch:'',
        status:'draft', template_id:'nv-ban-hang', template_version:'BH-2.0', template_snapshot:clone(SNAP), checklist_score:100, final_score:null,
        reviewer_id:'e-042', reviewer_code:'PHF042', reviewer_name:'Nguyễn Hoàng Khang', updated_at:'2026-09-11T00:00:00Z' },
      // C: ordinary non-manual mismatch — form BH-1.0, assignment BH-2.0, NO override history
      { id:'F-C', period_month:PERIOD, employee_code:'PHF090', employee_name:'NV Chín Mươi', department:'Bộ phận bán hàng', title:'NV', branch:'',
        status:'draft', template_id:'nv-ban-hang', template_version:'BH-1.0', template_snapshot:clone(SNAP), checklist_score:100, final_score:null,
        reviewer_id:'e-042', reviewer_code:'PHF042', reviewer_name:'Nguyễn Hoàng Khang', updated_at:'2026-09-01T00:00:00Z' }
    ],
    checklist_employee_assignments: [
      { employee_key:'phf078', employee_code:'PHF078', employee_name:'Châu Quỳnh Như', department:'Bộ phận bán hàng', title:'NV', branch:'', manager_id:'e-042', manager_code:'PHF042', manager_name:'Nguyễn Hoàng Khang', employee_status:'Đang làm việc', template_id:'nv-ban-hang', template_version:'BH-2.0', effective_date:'2026-09-01' },
      { employee_key:'phf082', employee_code:'PHF082', employee_name:'Lý Minh Phước', department:'Bộ phận bán hàng', title:'NV', branch:'', manager_id:'e-042', manager_code:'PHF042', manager_name:'Nguyễn Hoàng Khang', employee_status:'Đang làm việc', template_id:'nv-ban-hang', template_version:'BH-2.0', effective_date:'2026-09-01' },
      { employee_key:'phf090', employee_code:'PHF090', employee_name:'NV Chín Mươi', department:'Bộ phận bán hàng', title:'NV', branch:'', manager_id:'e-042', manager_code:'PHF042', manager_name:'Nguyễn Hoàng Khang', employee_status:'Đang làm việc', template_id:'nv-ban-hang', template_version:'BH-2.0', effective_date:'2026-09-01' }
    ],
    checklist_violation_records: [],
    checklist_monthly_form_history: [
      // F-A: one override, latest -> BH-1.0 (== form version) -> supports
      { id:'h1', form_id:'F-A', action:'manual_version_override', before_data:{templateVersion:'BH-2.0'}, after_data:{templateVersion:'BH-1.0'}, changed_at:'2026-09-05T00:00:00Z' },
      // F-B: two overrides, latest -> BH-2.0 (== form version) -> history "supports" current state...
      { id:'h2', form_id:'F-B', action:'manual_version_override', before_data:{templateVersion:'BH-2.0'}, after_data:{templateVersion:'BH-1.0'}, changed_at:'2026-09-05T00:00:00Z' },
      { id:'h3', form_id:'F-B', action:'manual_version_override', before_data:{templateVersion:'BH-1.0'}, after_data:{templateVersion:'BH-2.0'}, changed_at:'2026-09-06T00:00:00Z' }
    ]
  };
}

class FakeQuery {
  constructor(t){this.table=t;this.filters=[];this._limit=null;this._single=null;}
  select(){return this;}
  eq(c,v){this.filters.push(r=>String(r[c])===String(v));return this;}
  neq(c,v){this.filters.push(r=>String(r[c])!==String(v));return this;}
  in(c,vs){const s=new Set((vs||[]).map(String));this.filters.push(r=>s.has(String(r[c])));return this;}
  gte(c,v){this.filters.push(r=>String(r[c]||'')>=String(v));return this;}
  lte(c,v){this.filters.push(r=>String(r[c]||'')<=String(v));return this;}
  not(){return this;}
  order(){return this;}
  limit(n){this._limit=n;return this;}
  range(){return this;}
  maybeSingle(){this._single='maybe';return this;}
  single(){this._single='strict';return this;}
  then(res,rej){
    let rows=clone(store[this.table]||[]);this.filters.forEach(f=>{rows=rows.filter(f);});
    if(this._limit!=null)rows=rows.slice(0,this._limit);
    if(this._single==='maybe')return Promise.resolve({data:rows[0]||null,error:null}).then(res,rej);
    if(this._single==='strict')return Promise.resolve(rows.length?{data:rows[0],error:null}:{data:null,error:{message:'no rows'}}).then(res,rej);
    return Promise.resolve({data:rows,error:null}).then(res,rej);
  }
}
const orig=Module._load;
Module._load=function(req){
  if(req==='@supabase/supabase-js')return {createClient:()=>({from:t=>new FakeQuery(t),rpc:()=>Promise.resolve({data:{ok:true},error:null})})};
  return orig.apply(this,arguments);
};
const lib=require(path.join(__dirname,'..','api','_lib','checklist-monthly.js'));
Module._load=orig;

const ADMIN={role:'admin',account:{id:'admin-1',name:'Admin'},sub:'admin-1'};
let fails=0;
async function rec(n,fn){try{await fn();console.log('PASS -',n);}catch(e){fails++;console.log('FAIL -',n,'\n  '+(e&&e.stack?e.stack.split('\n').slice(0,4).join('\n  '):e));}}

async function main(){
  reset();
  const res=await lib.listMonthly(ADMIN,{month:PERIOD});
  const by=Object.fromEntries((res.forms||[]).map(f=>[f.id,f]));

  await rec('CASE 1 — form BH-1.0 vs assignment BH-2.0 + override history -> version_overridden = true, template_outdated = false', async()=>{
    assert.strictEqual(by['F-A'].version_overridden,true);
    assert.strictEqual(by['F-A'].template_outdated,false);
    assert.strictEqual(by['F-A'].template_repairable,false);
    assert.strictEqual(by['F-A'].current_template_version,'BH-2.0');
  });

  await rec('CASE 2 — form BH-2.0 == assignment BH-2.0 (override history present) -> version_overridden = false, no outdated warning', async()=>{
    assert.strictEqual(by['F-B'].version_overridden,false);
    assert.strictEqual(by['F-B'].template_outdated,false);
    // history untouched
    assert.strictEqual(store.checklist_monthly_form_history.filter(h=>h.form_id==='F-B').length,2,'both override history events preserved');
    assert.strictEqual((by['F-B'].history||[]).filter(h=>h.action==='manual_version_override').length,2,'listMonthly still returns both history events');
  });

  await rec('CASE 3 — ordinary non-manual mismatch (no override history) -> version_overridden = false, template_outdated = true (existing behaviour)', async()=>{
    assert.strictEqual(by['F-C'].version_overridden,false);
    assert.strictEqual(by['F-C'].template_outdated,true);
    assert.strictEqual(by['F-C'].template_repairable,true);
  });

  await rec('CASE 4 — version_override_eligible independent of override state (all draft here)', async()=>{
    assert.strictEqual(by['F-A'].version_override_eligible,true);
    assert.strictEqual(by['F-B'].version_override_eligible,true);
    assert.strictEqual(by['F-C'].version_override_eligible,true);
  });

  console.log(fails?('\n'+fails+' FAIL'):'\nALL PASS');
  process.exit(fails?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
