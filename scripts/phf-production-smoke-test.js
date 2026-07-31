'use strict';
const assert=require('assert');
const base=String(process.env.PHF_SMOKE_BASE_URL||'http://localhost:3000').replace(/\/$/,'');
async function req(path,opts={}){const r=await fetch(base+path,opts);let j={};try{j=await r.json()}catch{}return {r,j};}
(async()=>{
  let x=await req('/api/health'); assert.equal(x.r.status,200,`health ${x.r.status} ${JSON.stringify(x.j)}`); assert.equal(x.j.ok,true);
  x=await req('/api/data'); assert.equal(x.r.status,401,'unauth /api/data must be 401');
  x=await req('/admin/classroom',{headers:{accept:'text/html'}}); assert.equal(x.r.status,200,`deep link shell ${x.r.status}`);

  const phfHrRoutes=['/admin/home','/ql/home','/hv/home','/admin','/ql','/hv','/admin/knl','/ql/knl','/hv/knl'];
  for(const route of phfHrRoutes){
    x=await req(route,{headers:{accept:'text/html'}});
    assert.equal(x.r.status,200,`phf hr deep link ${route} ${x.r.status}`);
  }
  const checklistAdminRoutes=[
    '/admin/checklist',
    '/admin/checklist/nhan-su',
    '/admin/checklist/mau',
    '/admin/checklist/ghi-nhan-loi',
    '/admin/checklist/viec-can-xu-ly',
    '/admin/checklist/phieu-danh-gia-thang',
    '/admin/checklist/bao-cao',
    '/admin/checklist/cai-dat'
  ];
  for(const route of checklistAdminRoutes){
    x=await req(route,{headers:{accept:'text/html'}});
    assert.equal(x.r.status,200,`checklist deep link ${route} ${x.r.status}`);
  }
  const roles=['ADMIN','MANAGER','LEARNER'];
  for(const role of roles){
    const email=process.env[`PHF_SMOKE_${role}_EMAIL`], password=process.env[`PHF_SMOKE_${role}_PASSWORD`];
    if(!email||!password){console.log(`SKIP ${role}: thiếu biến môi trường`);continue;}
    x=await req('/api/auth/login',{method:'POST',headers:{'content-type':'application/json','origin':base},body:JSON.stringify({email,password})});
    assert.equal(x.r.status,200,`${role} login failed ${JSON.stringify(x.j)}`);
    const cookie=x.r.headers.get('set-cookie'); assert(cookie,`${role} missing cookie`);
    const y=await req('/api/data?classroom=1',{headers:{cookie,origin:base}}); assert.equal(y.r.status,200,`${role} classroom failed`);
    const month=new Date().toISOString().slice(0,7);
    const checks=role==='ADMIN' ? [
      {action:'listChecklistTasks',scope:'all'},
      {action:'listChecklistViolations',mode:'production'},
      {action:'listChecklistPermissionGrants',includeInactive:false},
      {action:'getChecklistMonthlyReport',month},
      {action:'listChecklistNotificationRules'},
      {action:'listMyChecklistNotifications',limit:5}
    ] : role==='MANAGER' ? [
      {action:'getChecklistRoleWorkspace'},
      {action:'listChecklistTasks',scope:'mine'},
      {action:'listMyChecklistNotifications',limit:5}
    ] : [
      {action:'getChecklistRoleWorkspace'},
      {action:'listChecklistTasks',scope:'mine'},
      {action:'getMyChecklistMonthly',month},
      {action:'listMyChecklistNotifications',limit:5}
    ];
    for(const payload of checks){
      const z=await req('/api/data?smokeChecklist=1',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(payload)});
      assert.equal(z.r.status,200,`${role} checklist ${payload.action} failed ${z.r.status} ${JSON.stringify(z.j)}`);
      assert.equal(z.j.ok,true,`${role} checklist ${payload.action} returned not ok`);
    }
    console.log(`PASS ${role}`);
  }
  console.log('SMOKE PASS');
})().catch(e=>{console.error(e);process.exit(1)});
