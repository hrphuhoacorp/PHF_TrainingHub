'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const sql=read('scripts/PHF_KNL_COMPETENCY_GRADE_COMPENSATION_FOUNDATION_1.50.0.sql');
const api=read('api/data.js'),ui=read('assets/js/knl/phf-knl-app.js'),router=read('assets/js/phf-url-router.js');
const manifest=require('./data/PHF_KNL_COMPENSATION_FOUNDATION_2026_07.json');
const {reconcile}=require('./phf-knl-foundation-reconciliation');
const {incomeScopeAllows,incomeTargetRows}=require('../lib/knl-foundation');

function has(source,value,label){assert(source.includes(value),label||('missing '+value));}
[
  'knl_grade_definitions','knl_grade_requirements','knl_compensation_ladders','knl_compensation_versions',
  'knl_compensation_grades','knl_employee_compensation_assignments','knl_employee_compensation_history',
  'knl_compensation_audit','knl_compensation_seed_runs'
].forEach(name=>{has(sql,'create table if not exists public.'+name,'table '+name);has(sql,'alter table public.'+name+' enable row level security','RLS '+name);});
[
  'knl_save_grade_matrix','knl_set_version_effectivity','knl_activate_due_versions','knl_activate_due_compensation_versions',
  'knl_save_employee_compensation','knl_seed_compensation_foundation'
].forEach(name=>{has(sql,'function public.'+name,'RPC '+name);has(sql,'grant execute on function','service role grant');});
has(sql,"KNL_GRADE_MATRIX_INCOMPLETE",'matrix completeness');
has(sql,"KNL_GRADES_MUST_BE_CONTIGUOUS",'dynamic contiguous grades');
has(sql,"required_level_number",'explicit required levels');
assert(!/avg\s*\(|average\s*\(/i.test(sql),'grade standard must not average');
has(sql,"grade_map",'clone grade id map');has(sql,"item_map",'clone item id map');has(sql,"column_map",'clone column id map');
has(sql,"old.lifecycle_status='ACTIVE' and new.lifecycle_status='INACTIVE'",'effective lifecycle guard');
has(sql,"unique(employee_code,payroll_period)",'one official structure per employee/period');
has(sql,"jsonb_array_length(coalesce(value,'[]'::jsonb))<=3",'max three extra allowances');
has(sql,"employment_type='PROBATION' and compensation_version_id is null",'probation separation');
has(sql,'v_compensation_version_id=g.version_id','official version resolved explicitly');
has(sql,'v_total=p_probation_amount;p_grade_id=null;v_compensation_version_id=null','probation never reads an unassigned record');
assert(!sql.includes("case when v_type='OFFICIAL' then g.version_id else null end"),'probation path must not reference unassigned record g');
has(sql,"KNL_SEED_ONLY_WILL_ASSIGN",'seed classification gate');
has(sql,"pg_advisory_xact_lock",'atomic/idempotent seed lock');
has(sql,"revoke all on public.knl_grade_definitions",'deny direct client access');

assert.strictEqual(manifest.ladders.length,8,'8 ladders');
assert.strictEqual(manifest.ladders.reduce((n,l)=>n+l.grades.length,0),88,'88 grades');
assert.strictEqual(manifest.employees.length,40,'40 source employees');
assert.strictEqual(manifest.effectivePeriod,null,'effective period must not be guessed');
assert.strictEqual(manifest.overrides.length,10,'10 reviewed mappings');
const probation=manifest.employees.filter(x=>x.employmentType==='PROBATION');
assert.deepStrictEqual(probation.map(x=>[x.employeeCode,x.probationAmount]),[['PHF091',6800000],['PHF092',6800000]]);
const org=manifest.employees.map(e=>({employee_code:e.employeeCode,employee_name:e.employeeName,employee_status:'Đang làm việc',department:'Test'}));
const result=reconcile(manifest,org);
assert.strictEqual(result.counts.WILL_ASSIGN,40);assert.strictEqual(result.counts.NEEDS_REVIEW,0);
assert(result.groups.WILL_ASSIGN.every(x=>x.classification==='WILL_ASSIGN'&&x.organizationSnapshot.employeeCode===x.employeeCode));

assert.strictEqual(incomeScopeAllows({source:'admin_recovery'},'PHF001'),true,'Admin full');
assert.strictEqual(incomeScopeAllows({source:'grant',capabilities:{income_view:true},row:{capabilities:{incomeScope:{type:'employees',values:['PHF001']}}}},'PHF001'),true,'scoped income');
assert.strictEqual(incomeScopeAllows({source:'grant',capabilities:{income_view:true},row:{capabilities:{incomeScope:{type:'employees',values:['PHF001']}}}},'PHF002'),false,'out of income scope');
assert.strictEqual(incomeScopeAllows({source:'grant',capabilities:{income_view:false},row:{capabilities:{incomeScope:{type:'all_company'}}}},'PHF001'),false,'income capability fail closed');
const targetFixture=[
  {employee_code:'PHF001',employee_name:'Own',employee_status:'Đang làm việc'},
  {employee_code:'PHF002',employee_name:'Allowed',employee_status:'Đang làm việc'},
  {employee_code:'PHF003',employee_name:'Denied',employee_status:'Đang làm việc'},
  {employee_code:'PHF004',employee_name:'Inactive',employee_status:'Đã nghỉ việc'}
];
const targetGrant={source:'grant',capabilities:{income_view:true},row:{capabilities:{incomeScope:{type:'employees',values:['PHF002','PHF004']}}}};
assert.deepStrictEqual(incomeTargetRows(targetFixture,targetGrant,'PHF001').map(x=>x.employeeCode),['PHF001','PHF002'],'income picker must be own + scoped active people only');
assert.deepStrictEqual(incomeTargetRows(targetFixture,{source:'admin_recovery'},'').map(x=>x.employeeCode),['PHF001','PHF002','PHF003'],'Admin picker sees all active people');

['getKnlGradeMatrix','saveKnlGradeMatrix','setKnlVersionEffectivity','listKnlCompensationStandards','previewKnlCompensationFoundation','applyKnlCompensationFoundation','listKnlIncomeTargets','getKnlEmployeeIncome','saveKnlEmployeeIncome'].forEach(action=>has(api,"payload.action==='"+action+"'",'API '+action));
['/admin/knl/tieu-chuan-bac','/admin/knl/phien-ban-lich-su','/admin/knl/ngach-bac-luong','/hv/knl/co-cau-thu-nhap','/ql/knl/co-cau-thu-nhap','/admin/knl/co-cau-thu-nhap'].forEach(route=>has(router,route,'route '+route));
has(ui,'Mỗi ô là yêu cầu độc lập; không tính trung bình','no-average UX');
has(ui,'Có bậc sau thấp hơn bậc trước','lower progression warning');
has(ui,'Promise.all([apiPost(\'listKnlCompensationStandards\')','parallel foundation reads');
has(ui,'ensureKnlShell(root,tab,capabilities,isAdmin','persistent shell retained');
has(ui,'KNL_READ_CACHE_TTL','in-memory cache retained');
has(ui,"searchParams.get('employee_code')",'canonical income deeplink');
has(ui,"searchParams.get('choose_employee')==='1'",'authorized picker back/F5 route state');
has(ui,"apiPost('listKnlIncomeTargets')",'Admin/scoped income picker');
has(ui,"apiPost('getKnlEmployeeIncome',queryCode?{employeeCode:queryCode}:undefined)",'own route omits override and explicit route passes employee code');
has(ui,'data-knl-person-income','people entry point');
has(ui,'data-knl-assignment-income','assignment entry point');
has(ui,"ensureKnlShell(root,tab,capabilities,isAdmin,'')",'income route retains persistent shell');

assert.strictEqual((sql.match(/\$\$/g)||[]).length%2,0,'balanced SQL dollar quotes');
console.log('PASS KNL Foundation 1.50.0 static/contracts: schema, guards, mappings, permissions, routes and performance invariants.');
