'use strict';

require('dotenv').config();
const assert=require('assert');
const {createClient}=require('@supabase/supabase-js');
const url=String(process.env.SUPABASE_URL||'').trim();
const secret=String(process.env.SUPABASE_SECRET_KEY||'').trim();
assert(url&&secret,'Supabase Production environment is required.');
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const CODE='SMOKE-PROBATION-1500';
const PERIOD='2099-12';
let assignmentId=null;
function check(error,label){if(error)throw new Error(label+': '+error.message);}

(async()=>{
  const existing=await db.from('knl_employee_compensation_assignments').select('id').eq('employee_code',CODE);
  check(existing.error,'preflight');assert.strictEqual(existing.data.length,0,'stale probation smoke fixture exists');
  try{
    const saved=await db.rpc('knl_save_employee_compensation',{
      p_employee_code:CODE,p_employee_name:'Probation Branch Smoke',p_employment_type:'PROBATION',p_payroll_period:PERIOD,
      p_grade_id:null,p_has_professional:true,p_has_management:true,p_has_meal:true,p_meal_amount:910000,
      p_probation_amount:6800000,p_extra_allowances:[{name:'must be cleared',amount:'1'}],p_organization_snapshot:{smoke:true},
      p_reason:'PHF KNL 1.50.0 probation branch smoke',p_actor_id:'probation-smoke-1.50.0',p_actor_name:'PHF KNL Smoke'
    });
    check(saved.error,'probation RPC');assignmentId=saved.data.assignmentId;
    const rowResult=await db.from('knl_employee_compensation_assignments').select('*').eq('id',assignmentId).single();check(rowResult.error,'smoke assignment');
    const row=rowResult.data;
    assert.strictEqual(row.employment_type,'PROBATION');assert.strictEqual(row.compensation_version_id,null);assert.strictEqual(row.compensation_grade_id,null);
    assert.strictEqual(row.has_professional_allowance,false);assert.strictEqual(row.has_management_allowance,false);assert.strictEqual(row.has_meal_allowance,false);
    assert.strictEqual(Number(row.meal_allowance),0);assert.deepStrictEqual(row.extra_allowances,[]);
    assert.strictEqual(Number(row.probation_amount),6800000);assert.strictEqual(Number(row.reference_total),6800000);
    assert.deepStrictEqual(row.structure_snapshot,{employmentType:'PROBATION',probationAmount:6800000});
    const history=await db.from('knl_employee_compensation_history').select('*').eq('assignment_id',assignmentId);check(history.error,'smoke history');
    assert.strictEqual(history.data.length,1);assert.strictEqual(history.data[0].action,'CREATE');
    assert.strictEqual(history.data[0].after_data.compensation_version_id,null);assert.strictEqual(history.data[0].after_data.compensation_grade_id,null);
    console.log('PASS direct Production probation RPC: no grade/version, no PC/meal/extra allowance, correct 6,800,000 snapshot/history.');
  } finally {
    if(assignmentId){
      const historyDelete=await db.from('knl_employee_compensation_history').delete().eq('assignment_id',assignmentId);check(historyDelete.error,'smoke history cleanup');
      const assignmentDelete=await db.from('knl_employee_compensation_assignments').delete().eq('id',assignmentId);check(assignmentDelete.error,'smoke assignment cleanup');
    }
    const remaining=await db.from('knl_employee_compensation_assignments').select('id').eq('employee_code',CODE);check(remaining.error,'cleanup verification');
    assert.strictEqual(remaining.data.length,0,'probation smoke cleanup incomplete');
    console.log('PASS probation smoke cleanup.');
  }
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
