'use strict';

require('dotenv').config();
const assert=require('assert');
const {createClient}=require('@supabase/supabase-js');
const manifest=require('../api/_lib/data/PHF_KNL_COMPENSATION_FOUNDATION_2026_07.json');
const {reconcile}=require('../api/_lib/phf-knl-foundation-reconciliation');

const PERIOD='2026-07';
const EXPECTED={ladders:8,versions:8,grades:88,assignments:36,official:34,probation:2,history:36,seedRuns:1};
const SKIPS=['PHF065','PHF046','PHF035','PHF064'];
const url=String(process.env.SUPABASE_URL||'').trim();
const secret=String(process.env.SUPABASE_SECRET_KEY||'').trim();
assert(url&&secret,'Supabase Production environment is required.');
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
require('../api/_lib/env-identity-guard').logSupabaseIdentityOnce('(scripts/phf-knl-foundation-production-seed.js)');

function check(error,label){if(error)throw new Error(label+': '+error.message);}
function byCode(rows){return new Map(rows.map(row=>[row.employee_code,row]));}
async function all(table,columns='*'){const result=await db.from(table).select(columns);check(result.error,table);return result.data||[];}
async function snapshot(){
  const [ladders,versions,grades,assignments,history,seedRuns]=await Promise.all([
    all('knl_compensation_ladders'),all('knl_compensation_versions'),all('knl_compensation_grades'),
    all('knl_employee_compensation_assignments'),all('knl_employee_compensation_history'),all('knl_compensation_seed_runs')
  ]);
  return{ladders,versions,grades,assignments,history,seedRuns};
}
function counts(s){return{
  ladders:s.ladders.length,versions:s.versions.length,grades:s.grades.length,
  assignments:s.assignments.length,official:s.assignments.filter(x=>x.employment_type==='OFFICIAL').length,
  probation:s.assignments.filter(x=>x.employment_type==='PROBATION').length,
  history:s.history.length,seedRuns:s.seedRuns.length
};}
function assertCounts(actual,expected,label){assert.deepStrictEqual(actual,expected,label+' count mismatch');}
function verifyData(s,preview){
  assertCounts(counts(s),EXPECTED,'Production Foundation');
  const grades=new Map(s.grades.map(row=>[row.id,row]));
  const assignments=byCode(s.assignments);
  assert.strictEqual(new Set(s.assignments.map(row=>row.employee_code+'|'+row.payroll_period)).size,s.assignments.length,'duplicate employee/payroll period');
  assert(s.assignments.every(row=>row.payroll_period===PERIOD),'assignment outside confirmed period');
  for(const code of SKIPS)assert(!assignments.has(code),'Skipped employee unexpectedly has compensation: '+code);
  for(const row of s.assignments){
    assert.deepStrictEqual(row.extra_allowances,[],'personal extra allowance found: '+row.employee_code);
    if(row.employment_type==='PROBATION'){
      assert(['PHF091','PHF092'].includes(row.employee_code),'unexpected probation employee');
      assert.strictEqual(Number(row.probation_amount),6800000,'probation amount mismatch: '+row.employee_code);
      assert.strictEqual(Number(row.reference_total),6800000,'probation total mismatch: '+row.employee_code);
      assert.strictEqual(row.compensation_version_id,null);assert.strictEqual(row.compensation_grade_id,null);
      assert.strictEqual(row.has_professional_allowance,false);assert.strictEqual(row.has_management_allowance,false);
      assert.strictEqual(row.has_meal_allowance,false);assert.strictEqual(Number(row.meal_allowance),0);
      continue;
    }
    const grade=grades.get(row.compensation_grade_id);assert(grade,'missing master grade: '+row.employee_code);
    assert.strictEqual(row.compensation_version_id,grade.version_id,'version/grade mismatch: '+row.employee_code);
    const snap=row.structure_snapshot||{};
    for(const [key,column] of [['baseSalary','base_salary'],['hqcv','hqcv'],['professionalAllowance','professional_allowance'],['managementAllowance','management_allowance']])
      assert.strictEqual(Number(snap[key]),Number(grade[column]),key+' snapshot mismatch: '+row.employee_code);
    assert.strictEqual(snap.gradeCode,grade.grade_code,'mapped grade mismatch: '+row.employee_code);
    const expected=Number(grade.base_salary)+Number(grade.hqcv)
      +(row.has_professional_allowance?Number(grade.professional_allowance):0)
      +(row.has_management_allowance?Number(grade.management_allowance):0)
      +(row.has_meal_allowance?Number(row.meal_allowance):0);
    assert.strictEqual(Number(row.reference_total),expected,'reference total mismatch: '+row.employee_code);
  }
  const candidates=new Map(preview.groups.WILL_ASSIGN.map(row=>[row.employeeCode,row]));
  for(const override of manifest.overrides){
    if(!candidates.has(override.employeeCode))continue;
    const assignment=assignments.get(override.employeeCode);assert(assignment,'seeded override missing: '+override.employeeCode);
    assert.strictEqual(assignment.structure_snapshot.gradeCode,override.mappedGradeCode,'override mismatch: '+override.employeeCode);
  }
  assert.strictEqual(s.history.filter(row=>row.action==='CREATE').length,36,'initial CREATE history mismatch');
  assert.strictEqual(s.history.filter(row=>row.action==='UPDATE').length,0,'unexpected UPDATE history');
  assert.strictEqual(s.seedRuns[0].effective_period,PERIOD,'seed run effective period mismatch');
}

(async()=>{
  const before=await snapshot();
  assertCounts(counts(before),{ladders:0,versions:0,grades:0,assignments:0,official:0,probation:0,history:0,seedRuns:0},'Pre-seed');
  const org=await all('checklist_employee_assignments','employee_code,employee_name,employee_status,department,branch,title,position');
  const preview=reconcile(manifest,org);
  assert.deepStrictEqual(preview.counts,{WILL_ASSIGN:36,SKIP_INACTIVE:2,SKIP_NOT_FOUND:2,NEEDS_REVIEW:0},'Reconciliation gate');
  assert.deepStrictEqual(preview.groups.SKIP_INACTIVE.map(x=>x.employeeCode).sort(),['PHF046','PHF065']);
  assert.deepStrictEqual(preview.groups.SKIP_NOT_FOUND.map(x=>x.employeeCode).sort(),['PHF035','PHF064']);
  assert.strictEqual(manifest.overrides.length,10,'override count');
  const actor={id:'foundation-1.50.0-seed',name:'PHF KNL Foundation 1.50.0'};
  const args={p_manifest:{...manifest,effectivePeriod:PERIOD},p_reconciled_rows:preview.groups.WILL_ASSIGN,p_effective_period:PERIOD,p_actor_id:actor.id,p_actor_name:actor.name};
  const first=await db.rpc('knl_seed_compensation_foundation',args);check(first.error,'first seed');
  assert.strictEqual(first.data.idempotent,false,'first seed must create baseline');
  assert.deepStrictEqual({ladders:first.data.ladders,grades:first.data.grades,assignments:first.data.assignments,probation:first.data.probation,effectivePeriod:first.data.effectivePeriod},{ladders:8,grades:88,assignments:36,probation:2,effectivePeriod:PERIOD});
  const afterFirst=await snapshot();verifyData(afterFirst,preview);
  const second=await db.rpc('knl_seed_compensation_foundation',args);check(second.error,'idempotent seed');
  assert.strictEqual(second.data.idempotent,true,'second seed must be idempotent');
  const afterSecond=await snapshot();verifyData(afterSecond,preview);
  assertCounts(counts(afterSecond),counts(afterFirst),'Idempotent second seed');
  console.log(JSON.stringify({ok:true,effectivePeriod:PERIOD,reconciliation:preview.counts,first:first.data,second:second.data,counts:counts(afterSecond),skipped:SKIPS,overrides:manifest.overrides.length},null,2));
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
