'use strict';

/* READ-ONLY diagnostic for the "/admin/nhan-su > Tài khoản" empty-list incident.
   Mirrors the exact query lib/auth.js#listAccountsForAdmin runs against
   Production, so we can compare real backend counts against what the UI
   claims to show. No writes. */

require('dotenv').config();
const {createClient}=require('@supabase/supabase-js');
const url=String(process.env.SUPABASE_URL||'').trim();
const secret=String(process.env.SUPABASE_SECRET_KEY||'').trim();
const pub=String(process.env.SUPABASE_PUBLISHABLE_KEY||'').trim();
if(!url||!secret){console.error('Missing Supabase env');process.exit(1);}
const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});

(async()=>{
  const {data,error}=await db.from('user_accounts').select('*').order('name',{ascending:true});
  if(error){console.error('QUERY ERROR (this is what listAccountsForAdmin would throw and the GET /api/auth/accounts route would surface as 500):',JSON.stringify(error,null,2));process.exit(1);}
  console.log('Raw row count from user_accounts (same query as listAccountsForAdmin):',data.length);
  const byRole={},byStatus={};
  let withEmployeeCode=0,withEmployeeId=0,withNeither=0;
  data.forEach(r=>{
    const role=String(r.role||'(null)');byRole[role]=(byRole[role]||0)+1;
    const status=String(r.status||'(null)');byStatus[status]=(byStatus[status]||0)+1;
    const hasCode=!!String(r.employee_code||'').trim();
    const hasId=!!String(r.employee_id||'').trim();
    if(hasCode)withEmployeeCode++;
    if(hasId)withEmployeeId++;
    if(!hasCode&&!hasId)withNeither++;
  });
  console.log('By role:',byRole);
  console.log('By status:',byStatus);
  console.log('With employee_code populated:',withEmployeeCode,'/',data.length);
  console.log('With employee_id populated:',withEmployeeId,'/',data.length);
  console.log('With neither employee_code nor employee_id:',withNeither,'/',data.length);
  console.log('Sample first 3 rows (id/email/role/status/employee_code/employee_id/name only):',data.slice(0,3).map(r=>({id:r.id,email:r.email,role:r.role,status:r.status,employee_code:r.employee_code,employee_id:r.employee_id,name:r.name})));

  if(pub){
    const anonDb=createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});
    const anonResult=await anonDb.from('user_accounts').select('*',{head:true,count:'exact'});
    console.log('Anon/publishable-key read of user_accounts -> error:',anonResult.error?anonResult.error.message:null,'count:',anonResult.count);
  }
})().catch(e=>{console.error('FAIL',e&&e.stack||e);process.exit(1);});
