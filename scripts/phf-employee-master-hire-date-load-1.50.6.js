'use strict';

/* PHF Employee Master — Ngày vào làm (hire_date) batch load, 1.50.6.
   Scope: ONLY public.employee_profiles.hire_date, ONLY for the 37 employee_code
   already confirmed MATCHED + EMPTY_SYSTEM_CAN_FILL by the prior read-only
   master-data audit (source file 10082026-132639-FileMauHSNS.xlsx).

   Writes go exclusively through lib/employee-master.js#saveProfile (which calls
   ensureProfile internally) — the same code path the real Employee Master admin
   UI uses — so validation, defaults and employee_master_history are identical to
   a manual save. No other field is ever passed in, so every other column falls
   back to `existing.*` (unchanged) or the migration's own defaults on create.

   Idempotent: a row already holding the exact file date is left untouched
   (UNCHANGED, no history row). A row holding a DIFFERENT non-empty date is
   never overwritten — recorded as CONFLICT and skipped entirely, per gate.
   Does not touch employees/user_accounts/checklist_employee_assignments and
   never creates a new employee/account/checklist assignment. */

require('dotenv').config();
const assert=require('assert');
const {createClient}=require('@supabase/supabase-js');
const {saveProfile}=require('../lib/employee-master');

const url=String(process.env.SUPABASE_URL||'').trim();
const secret=String(process.env.SUPABASE_SECRET_KEY||'').trim();
if(!url||!secret){console.error('Missing Supabase env');process.exit(1);}
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

const SESSION={role:'admin',sub:'system-hire-date-load-1.50.6',account:{id:'system-hire-date-load-1.50.6',name:'PHF Employee Master — batch load Ngày vào làm'}};
const REASON='Nạp Ngày vào làm từ file HSNS đã đối chiếu (10082026-132639-FileMauHSNS.xlsx); reconciliation MATCHED + EMPTY_SYSTEM_CAN_FILL — PHF HR Master Data Audit.';

/* employee_code -> file StartWorkDate (YYYY-MM-DD). Exactly the 37 MATCHED rows;
   SYSTEM_ONLY (PHF046, PHF065, blank-code account) and FILE_ONLY (PHF035,
   PHF064, PHF093) are intentionally absent per the confirmed reconciliation. */
const MATCHED=[
  ['PHF002','2019-10-29'],['PHF018','2023-09-15'],['PHF020','2022-06-28'],['PHF041','2024-08-16'],
  ['PHF042','2024-12-23'],['PHF060','2025-07-10'],['PHF076','2026-03-23'],['PHF077','2026-03-27'],
  ['PHF078','2026-03-27'],['PHF079','2026-03-30'],['PHF082','2026-04-16'],['PHF084','2026-04-18'],
  ['PHF085','2026-04-22'],['PHF087','2026-05-12'],['PHF089','2026-05-15'],['PHF091','2026-06-06'],
  ['PHF092','2026-06-29'],['PHF026','2023-05-03'],['PHF081','2026-04-10'],['PHF090','2026-05-16'],
  ['PHF036','2023-09-02'],['PHF038','2025-02-28'],['PHF080','2026-04-09'],['PHF005','2024-04-12'],
  ['PHF034','2022-11-23'],['PHF073','2026-03-05'],['PHF012','2025-04-03'],['PHF007','2025-02-18'],
  ['PHF008','2025-06-04'],['PHF056','2025-06-23'],['PHF071','2025-11-24'],['PHF051','2025-06-16'],
  ['PHF028','2019-01-01'],['PHF069','2025-11-03'],['PHF004','2019-10-29'],['PHF010','2019-02-05'],
  ['PHF032','2021-07-02']
];

async function run(){
  assert.strictEqual(MATCHED.length,37,'MATCHED list must be exactly the 37 reconciled rows');

  const org=await db.from('checklist_employee_assignments').select('employee_code,employee_name');
  if(org.error)throw org.error;
  const nameByCode=new Map(org.data.map(r=>[String(r.employee_code||'').trim().toUpperCase(),r.employee_name]));

  const results={created:[],filled:[],unchanged:[],conflict:[]};
  for(const [rawCode,fileDate] of MATCHED){
    const code=rawCode.toUpperCase();
    const existing=await db.from('employee_profiles').select('*').ilike('employee_code',code).maybeSingle();
    if(existing.error)throw existing.error;
    const row=existing.data;

    if(row&&row.hire_date){
      if(row.hire_date===fileDate){results.unchanged.push(code);continue;}
      results.conflict.push({code,existingHireDate:row.hire_date,fileDate});
      continue;
    }

    const fullName=nameByCode.get(code)||code;
    const wasNew=!row;
    const {profile}=await saveProfile(SESSION,{employeeCode:code,fullName,hireDate:fileDate,reason:REASON});
    assert.strictEqual(profile.hire_date,fileDate,'hire_date must be set exactly as provided, code '+code);
    assert.strictEqual(profile.employee_code,code,'employee_code must be preserved exactly, code '+code);
    (wasNew?results.created:results.filled).push(code);
  }

  console.log('=== MUTATION RESULT ===');
  console.log('CREATE (new employee_profiles row):',results.created.length,results.created);
  console.log('FILL (existing row, hire_date was empty):',results.filled.length,results.filled);
  console.log('UNCHANGED (already matches file date):',results.unchanged.length,results.unchanged);
  console.log('CONFLICT (existing date differs from file — skipped, not overwritten):',results.conflict.length,results.conflict);
  assert.strictEqual(results.created.length+results.filled.length+results.unchanged.length+results.conflict.length,37,'every MATCHED row must land in exactly one bucket');

  // READ-ONLY verify: re-read all 37 fresh from the DB after mutation.
  const codes=MATCHED.map(([c])=>c.toUpperCase());
  const verify=await db.from('employee_profiles').select('employee_code,full_name,hire_date').in('employee_code',codes);
  if(verify.error)throw verify.error;
  const byCode=new Map(verify.data.map(r=>[r.employee_code.toUpperCase(),r]));
  console.log('\n=== VERIFY (read-only, post-mutation) ===');
  console.log('employee_code | full_name | hire_date');
  let missing=0,mismatched=0;
  MATCHED.forEach(([code,fileDate])=>{
    const r=byCode.get(code.toUpperCase());
    if(!r){missing++;console.log(code,'| MISSING employee_profiles row');return;}
    const ok=r.hire_date===fileDate||results.conflict.some(c=>c.code===code.toUpperCase());
    if(!ok)mismatched++;
    console.log(code,'|',r.full_name,'|',r.hire_date,ok?'':'  <== UNEXPECTED');
  });
  console.log('\nRows present:',verify.data.length,'/ 37. Missing:',missing,'Unexpected mismatch:',mismatched);

  const historyCount=await db.from('employee_master_history').select('id',{head:true,count:'exact'}).eq('domain','profile').eq('reason',REASON);
  if(historyCount.error)throw historyCount.error;
  console.log('employee_master_history rows written under this batch reason:',historyCount.count);

  return results;
}

run().catch(e=>{console.error('FAIL',e&&e.stack||e);process.exit(1);});
