'use strict';

/* READ-ONLY audit for the Organization Master Cutover investigation. Touches
   nothing. Employee Master (employee_profiles) does not hold organization
   columns yet (pre-Phase-1) — this script establishes the reconciliation
   baseline BEFORE that additive migration is drafted, per PHF decision:
   Employee Master becomes the sole write surface for department/title/
   position/branch/manager; Checklist's own assignment screen keeps write
   only for its operational fields (leave_until/status_note/template/
   effective_date/reason) and becomes read-only for organization fields.

   Compares the two LIVE independent copies of organization data:
     - checklist_employee_assignments (current de-facto org table, per
       PHF_HR_EMPLOYEE_PROFILE_V1_1.46.2.sql's own comment "Organization
       remains owned by checklist_employee_assignments" — the statement this
       cutover retracts)
     - user_accounts (independent department/branch/position columns, no
       known sync path to the table above)
   Also flags the employee_status (checklist) vs employment_status
   (employee_profiles) naming/value overlap so PHF can decide how the two
   reconcile before Phase 1 SQL is drafted.

   Re-run this same script after the Phase 1 additive migration lands (new
   org columns on employee_profiles) to compute the real MATCHED/CONFLICT
   backfill list — for now it only reconciles the two pre-existing sources. */

require('dotenv').config();
const {createClient}=require('@supabase/supabase-js');
const url=String(process.env.SUPABASE_URL||'').trim();
const secret=String(process.env.SUPABASE_SECRET_KEY||'').trim();
if(!url||!secret){console.error('Missing Supabase env');process.exit(1);}
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

async function safe(table,select){
  const r=await db.from(table).select(select||'*');
  if(r.error)return{table,ok:false,error:r.error.message,rows:[]};
  return{table,ok:true,rows:r.data||[]};
}

function norm(value){return String(value==null?'':value).trim();}
function normCode(value){return norm(value).toUpperCase();}
function normField(value){return norm(value).toLowerCase();}

(async()=>{
  const [checklist,accounts,profiles]=await Promise.all([
    safe('checklist_employee_assignments','employee_code,employee_name,department,title,position,branch,manager_code,manager_name,employee_status'),
    safe('user_accounts','employee_code,name,department,branch,position,status'),
    safe('employee_profiles','employee_code,full_name,employment_status')
  ]);

  [checklist,accounts,profiles].forEach(r=>{
    console.log(`\n=== ${r.table} ===`);
    if(!r.ok){console.log('  ERROR/MISSING:',r.error);return;}
    console.log('  rows:',r.rows.length);
  });
  if(!checklist.ok||!accounts.ok||!profiles.ok){console.error('\nFAIL: one or more source tables unreadable, stopping.');process.exit(1);}

  const byCodeChecklist=new Map();
  checklist.rows.forEach(r=>{const c=normCode(r.employee_code);if(c)byCodeChecklist.set(c,r);});
  const byCodeAccounts=new Map();
  accounts.rows.forEach(r=>{const c=normCode(r.employee_code);if(c)byCodeAccounts.set(c,r);});
  const byCodeProfiles=new Map();
  profiles.rows.forEach(r=>{const c=normCode(r.employee_code);if(c)byCodeProfiles.set(c,r);});

  const allCodes=new Set([...byCodeChecklist.keys(),...byCodeAccounts.keys()]);
  console.log('\n=== employee_code universe (org sources only) ===');
  console.log('checklist_employee_assignments distinct codes:',byCodeChecklist.size);
  console.log('user_accounts distinct codes:',byCodeAccounts.size);
  console.log('union:',allCodes.size);

  const ORG_FIELDS=[['department','department'],['branch','branch'],['position','position']];
  const results={MATCHED:[],CHECKLIST_ONLY:[],ACCOUNTS_ONLY:[],CONFLICT:[],BOTH_EMPTY:[]};

  allCodes.forEach(code=>{
    const c=byCodeChecklist.get(code)||null;
    const a=byCodeAccounts.get(code)||null;
    if(c&&!a){results.CHECKLIST_ONLY.push({code,name:c.employee_name,department:c.department,title:c.title,position:c.position,branch:c.branch});return;}
    if(a&&!c){results.ACCOUNTS_ONLY.push({code,name:a.name,department:a.department,position:a.position,branch:a.branch});return;}
    const diffs=ORG_FIELDS.filter(([ck,ak])=>normField(c[ck])!==normField(a[ak])&&(norm(c[ck])||norm(a[ak])));
    if(diffs.length){
      results.CONFLICT.push({code,name:c.employee_name||a.name,diffs:diffs.map(([ck,ak])=>({field:ck,checklist:c[ck],accounts:a[ak]}))});
      return;
    }
    const allEmpty=ORG_FIELDS.every(([ck])=>!norm(c[ck]));
    (allEmpty?results.BOTH_EMPTY:results.MATCHED).push({code,name:c.employee_name,department:c.department,title:c.title,position:c.position,branch:c.branch,managerCode:c.manager_code,managerName:c.manager_name});
  });

  console.log('\n=== ORGANIZATION FIELD RECONCILIATION (checklist_employee_assignments vs user_accounts) ===');
  console.log('MATCHED (department/branch/position agree):',results.MATCHED.length);
  console.log('CHECKLIST_ONLY (no user_accounts row):',results.CHECKLIST_ONLY.length);
  console.log('ACCOUNTS_ONLY (no checklist row):',results.ACCOUNTS_ONLY.length);
  console.log('CONFLICT (both present, org fields disagree):',results.CONFLICT.length);
  console.log('BOTH_EMPTY (no org data on either side):',results.BOTH_EMPTY.length);

  console.log('\n=== FULL TABLE: employee_code | name | Checklist(dept/title/position/branch/manager) | user_accounts(dept/branch/position) | BUCKET ===');
  const bucketOf=new Map();
  Object.entries(results).forEach(([bucket,rows])=>rows.forEach(r=>bucketOf.set(r.code,bucket)));
  [...allCodes].sort().forEach(code=>{
    const c=byCodeChecklist.get(code)||null;
    const a=byCodeAccounts.get(code)||null;
    const name=(c&&c.employee_name)||(a&&a.name)||'';
    const cStr=c?`${c.department||''}/${c.title||''}/${c.position||''}/${c.branch||''}/${c.manager_name||''}`:'(no row)';
    const aStr=a?`${a.department||''}/${a.branch||''}/${a.position||''}`:'(no row)';
    console.log(`${code} | ${name} | ${cStr} | ${aStr} | ${bucketOf.get(code)}`);
  });

  console.log('\n=== CONFLICT field tally (which field disagrees most) ===');
  const fieldTally={};
  results.CONFLICT.forEach(r=>r.diffs.forEach(d=>{fieldTally[d.field]=(fieldTally[d.field]||0)+1;}));
  console.log(fieldTally);
  console.log('\nCONFLICT employee_code list:',results.CONFLICT.map(r=>r.code));
  if(results.CONFLICT.length)console.log('\nCONFLICT detail:',JSON.stringify(results.CONFLICT,null,2));

  console.log('\n=== employee_status (checklist) vs employment_status (employee_profiles) overlap ===');
  const statusPairs=[];
  byCodeChecklist.forEach((c,code)=>{
    const p=byCodeProfiles.get(code);
    if(p)statusPairs.push({code,checklistStatus:c.employee_status,profileStatus:p.employment_status});
  });
  console.log('codes present in both checklist and employee_profiles:',statusPairs.length);
  const statusMismatch=statusPairs.filter(x=>normField(x.checklistStatus)!==normField(x.profileStatus));
  console.log('status value mismatch (raw string compare, labels differ by design — informational only):',statusMismatch.length,'/',statusPairs.length);
  if(statusMismatch.length)console.log('all mismatches:',JSON.stringify(statusMismatch,null,2));

  console.log('\n=== employee_profiles coverage of org-source codes (pre-Phase-1: no org columns exist yet) ===');
  const profileMissingForOrgCode=[...allCodes].filter(code=>!byCodeProfiles.has(code));
  console.log('org-source codes with NO employee_profiles row yet:',profileMissingForOrgCode.length,'/',allCodes.size);

  console.log('\n=== SEED READINESS CLASSIFICATION (informational only — no seed executed) ===');
  console.log('CLEAN (usable as-is for initial Organization Master seed):');
  console.log('  MATCHED:',results.MATCHED.length,'— both sources agree, checklist supplies title+manager.');
  console.log('  CHECKLIST_ONLY:',results.CHECKLIST_ONLY.length,'— single source, no contradiction, checklist is the richer record (has title/manager).');
  console.log('  CLEAN total:',results.MATCHED.length+results.CHECKLIST_ONLY.length);
  console.log('REQUIRES PHF MANUAL REVIEW:');
  console.log('  CONFLICT:',results.CONFLICT.length,'— two sources disagree, cannot auto-pick.');
  console.log('  ACCOUNTS_ONLY:',results.ACCOUNTS_ONLY.length,'— has org data only in user_accounts, missing from checklist entirely (checklist is the richer/expected source — absence is suspicious, needs a reason).');
  console.log('  BOTH_EMPTY:',results.BOTH_EMPTY.length,'— code exists but no org fields populated on either side, nothing to seed from, needs manual entry.');
  console.log('  REVIEW total:',results.CONFLICT.length+results.ACCOUNTS_ONLY.length+results.BOTH_EMPTY.length);
})().catch(e=>{console.error('FAIL',e&&e.stack||e);process.exit(1);});
