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
const seeded=process.argv.includes('--seeded');
const TABLES=[
  'knl_grade_definitions','knl_grade_requirements','knl_compensation_ladders',
  'knl_compensation_versions','knl_compensation_grades',
  'knl_employee_compensation_assignments','knl_employee_compensation_history',
  'knl_compensation_audit','knl_compensation_seed_runs'
];
const RPCS=[
  'knl_save_grade_matrix','knl_set_version_effectivity','knl_activate_due_versions',
  'knl_activate_due_compensation_versions','knl_save_employee_compensation',
  'knl_seed_compensation_foundation','knl_clone_version'
];
function check(error,label){if(error){error.message=label+': '+error.message;throw error;}}
async function openApi(){const response=await fetch(url+'/rest/v1/',{headers:{apikey:secret,Authorization:'Bearer '+secret}});assert.strictEqual(response.status,200,'Production OpenAPI unavailable');return response.json();}

(async()=>{
  const spec=await openApi();
  TABLES.forEach(name=>{assert(spec.paths['/'+name],'Missing Production table path '+name);assert(spec.definitions[name],'Missing Production definition '+name);});
  RPCS.forEach(name=>assert(spec.paths['/rpc/'+name],'Missing Production RPC '+name));
  const versionProps=spec.definitions.knl_framework_versions.properties;
  ['lifecycle_status','effective_from','effective_to','activated_at'].forEach(name=>assert(versionProps[name],'Missing knl_framework_versions.'+name));
  const requirementProps=spec.definitions.knl_grade_requirements.properties;
  assert(/knl_framework_versions/.test(requirementProps.version_id.description||''),'Grade requirement version FK missing');
  // PostgREST emits direct single-column FK descriptions but omits the three
  // composite (id,version_id) FK descriptions. Their DDL is covered by the
  // migration contract test; no INSERT/DELETE probe is used in READ_ONLY mode.
  const assignmentProps=spec.definitions.knl_employee_compensation_assignments.properties;
  assert(/knl_compensation_versions/.test(assignmentProps.compensation_version_id.description||''),'Compensation version FK missing');
  assert(/knl_compensation_grades/.test(assignmentProps.compensation_grade_id.description||''),'Compensation grade FK missing');

  const counts={};
  for(const table of TABLES){
    const result=await db.from(table).select('*',{head:true,count:'exact'});check(result.error,'service-role read '+table);counts[table]=Number(result.count||0);
    const denied=await publicDb.from(table).select('*',{head:true,count:'exact'});assert(denied.error,'Public/anon direct read unexpectedly allowed '+table);
  }
  assert.strictEqual(counts.knl_grade_definitions,0,'Competency grade definitions must remain empty before framework configuration');
  if(seeded){
    assert.deepStrictEqual(counts,{knl_grade_definitions:0,knl_grade_requirements:0,knl_compensation_ladders:8,knl_compensation_versions:8,knl_compensation_grades:88,knl_employee_compensation_assignments:36,knl_employee_compensation_history:36,knl_compensation_audit:0,knl_compensation_seed_runs:1},'Seeded Foundation counts');
  }else{
    assert.strictEqual(counts.knl_employee_compensation_assignments,0,'Compensation assignments must be empty before seed');
    assert.strictEqual(counts.knl_compensation_seed_runs,0,'Seed runs must be empty before seed');
  }

  const {data:frameworks,error:frameworkError}=await db.from('knl_frameworks').select('id,code').order('code');check(frameworkError,'frameworks');
  const {data:versions,error:versionError}=await db.from('knl_framework_versions').select('id,framework_id,status,is_locked,lifecycle_status,effective_from,effective_to,activated_at').order('framework_id');check(versionError,'versions');
  assert.strictEqual(frameworks.length,11,'Official framework count changed');
  assert.strictEqual(versions.length,11,'Official framework version count changed');
  assert(versions.every(v=>v.lifecycle_status==='DRAFT'&&!v.effective_from&&!v.effective_to&&!v.activated_at),'Existing versions must remain unactivated after additive migration');

  console.log(JSON.stringify({
    ok:true,mode:'READ_ONLY',state:seeded?'SEEDED':'PRE_SEED',tables:TABLES.length,rpcs:RPCS.length,
    frameworkCount:frameworks.length,versionCount:versions.length,lifecycle:{DRAFT:versions.filter(v=>v.lifecycle_status==='DRAFT').length},
    counts,rlsRevoke:'anon denied on all Foundation tables',
    guards:'RPC exposure verified; immutable/delete guards are DDL + local SQL-test evidence because strict READ_ONLY mode calls no mutation endpoint',
    compositeFk:'DDL contract verified; PostgREST omits composite FK descriptions'
  },null,2));
})().catch(error=>{console.error('FAIL',error.stack||error);process.exitCode=1;});
