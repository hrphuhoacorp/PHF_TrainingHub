'use strict';

require('dotenv').config();
const assert=require('assert');
const {createClient}=require('@supabase/supabase-js');

const url=String(process.env.SUPABASE_URL||'').trim();
const secret=String(process.env.SUPABASE_SECRET_KEY||'').trim();
const publishable=String(process.env.SUPABASE_PUBLISHABLE_KEY||'').trim();
assert(url&&secret&&publishable,'Missing Supabase Production environment.');
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const publicDb=createClient(url,publishable,{auth:{persistSession:false,autoRefreshToken:false}});

const NEW_RPCS=['knl_clone_compensation_version','knl_save_compensation_grades','knl_schedule_compensation_version'];
const BASELINE_TABLES=[
  'knl_compensation_ladders','knl_compensation_versions','knl_compensation_grades',
  'knl_employee_compensation_assignments','knl_employee_compensation_history','knl_compensation_audit'
];
function check(error,label){if(error){error.message=label+': '+error.message;throw error;}}
async function openApi(){const response=await fetch(url+'/rest/v1/',{headers:{apikey:secret,Authorization:'Bearer '+secret}});assert.strictEqual(response.status,200,'Production OpenAPI unavailable');return response.json();}

(async()=>{
  const spec=await openApi();
  NEW_RPCS.forEach(name=>assert(spec.paths['/rpc/'+name],'Missing Production RPC '+name));

  const counts={};
  for(const table of BASELINE_TABLES){
    const result=await db.from(table).select('*',{head:true,count:'exact'});check(result.error,'service-role read '+table);counts[table]=Number(result.count||0);
    const denied=await publicDb.from(table).select('*',{head:true,count:'exact'});assert(denied.error,'Public/anon direct read unexpectedly allowed '+table);
  }
  assert.strictEqual(counts.knl_compensation_ladders,8,'Ladder baseline changed — expected 8 ngạch');
  assert.strictEqual(counts.knl_compensation_versions,8,'Version baseline changed — expected 8 version (1 per ladder)');
  assert.strictEqual(counts.knl_compensation_grades,88,'Grade baseline changed — expected 88 bậc');
  assert.strictEqual(counts.knl_employee_compensation_assignments,36,'Assignment baseline changed — expected 36 (34 official + 2 probation)');
  assert.strictEqual(counts.knl_employee_compensation_history,36,'History baseline changed — expected 36');

  const {data:ladders,error:ladderErr}=await db.from('knl_compensation_ladders').select('id,code').order('code');check(ladderErr,'ladders');
  const {data:versions,error:versionErr}=await db.from('knl_compensation_versions').select('id,ladder_id,version_number,status,effective_period').order('ladder_id');check(versionErr,'versions');
  assert(versions.every(v=>v.status==='ACTIVE'),'All 8 baseline versions must remain ACTIVE (untouched) after additive migration');
  assert.strictEqual(new Set(versions.map(v=>v.ladder_id)).size,8,'Each of the 8 ladders must still have exactly one baseline version');

  const {data:probation,error:probationErr}=await db.from('knl_employee_compensation_assignments').select('employee_code,employment_type,probation_amount').eq('employment_type','PROBATION').order('employee_code');check(probationErr,'probation rows');
  assert.strictEqual(probation.length,2,'Probation assignment count changed');

  console.log(JSON.stringify({
    ok:true,mode:'READ_ONLY',newRpcsVisible:NEW_RPCS,
    baselineCounts:counts,ladderCount:ladders.length,
    allBaselineVersionsActiveAndUnmodified:true,
    probationCount:probation.length,
    note:'anon/publishable denied on all compensation tables; service-role read confirms 8/8/88/36/36 baseline unchanged by 1.50.3 migration.'
  },null,2));
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
