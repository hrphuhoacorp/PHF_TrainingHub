'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const configured=Boolean(String(process.env.SUPABASE_URL||'').trim()&&String(process.env.SUPABASE_SECRET_KEY||'').trim());
const db=configured?createClient(String(process.env.SUPABASE_URL).trim(),String(process.env.SUPABASE_SECRET_KEY).trim(),{auth:{persistSession:false,autoRefreshToken:false}}):null;
const EMPLOYMENT_STATUSES=Object.freeze(['active','inactive']);

function text(value){return String(value==null?'':value).trim();}
function code(value){return text(value).toUpperCase();}
function date(value){const valueText=text(value);return /^\d{4}-\d{2}-\d{2}$/.test(valueText)?valueText:null;}
function money(value){const amount=Number(value);return Number.isFinite(amount)&&amount>=0?Math.round(amount*100)/100:0;}
function missingSchema(error){return error&&(error.code==='42P01'||error.code==='42703'||/does not exist|schema cache/i.test(text(error.message)));}
function fail(message,statusCode,errorCode){const error=new Error(message);error.statusCode=statusCode||400;error.code=errorCode||'EMPLOYEE_MASTER_INVALID';throw error;}
function requireAdmin(session){if(!session||String(session.role||'').toLowerCase()!=='admin')fail('Chỉ Admin được truy cập Hồ sơ nhân sự tập trung.',403,'EMPLOYEE_MASTER_ADMIN_REQUIRED');}
function requireDb(){if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');}
function actor(session){return{id:text(session?.account?.id||session?.sub),name:text(session?.account?.name||session?.account?.email||session?.email)||'Admin'};}
function normalizeKey(value){return text(value).toLowerCase();}
function normalizeEmploymentStatus(value){const normalized=text(value).toLowerCase();return EMPLOYMENT_STATUSES.includes(normalized)?normalized:null;}
function yearsSince(value){if(!value)return null;const start=new Date(value+'T00:00:00Z');if(Number.isNaN(start.getTime()))return null;const now=new Date();let years=now.getUTCFullYear()-start.getUTCFullYear(),months=now.getUTCMonth()-start.getUTCMonth();if(now.getUTCDate()<start.getUTCDate())months--;if(months<0){years--;months+=12;}years=Math.max(0,years);months=Math.max(0,months);return{years,months,label:(years?years+' năm ':'')+months+' tháng'};}

async function safeRows(table,select='*'){
  const result=await db.from(table).select(select);
  if(result.error){if(missingSchema(result.error))return{rows:[],ready:false};throw result.error;}
  return{rows:result.data||[],ready:true};
}

// Canonical People Master reader shared by Employee Master and PHF Task.
// Keeping the client and environment here prevents module-specific roster
// paths from silently drifting to another Supabase project or query contract.
async function loadCanonicalEmployeeProfiles(select='*'){
  requireDb();
  // FORENSIC V3 — People Master fetch time (env-gated, inert otherwise; no-op
  // when there is no active request timing context, e.g. non-Task callers).
  return require('./request-timing').span('people_master', () => safeRows('employee_profiles',select));
}

function invalidateTaskPeopleCache(){
  const taskScope=require('./task-employee-scope');
  if(taskScope&&typeof taskScope.invalidateOrgCache==='function')taskScope.invalidateOrgCache();
}

async function sources(){
  requireDb();
  const [employees,accounts,profiles]=await Promise.all([
    safeRows('employees','*'),
    safeRows('user_accounts','id,employee_id,employee_code,name,email,phone,role,status,branch,department,position,training_audience,default_program,hub_assignment_status,metadata,updated_at'),
    loadCanonicalEmployeeProfiles('*')
  ]);
  return{employees:employees.rows,accounts:accounts.rows,profiles:profiles.rows,schemaReady:profiles.ready,organizationReady:profiles.ready,organizationError:profiles.ready?'':'EMPLOYEE_MASTER_SCHEMA_MISSING'};
}

function mergeSources(source){
  const records=[],aliases=new Map();
  function locate(keys){for(const key of keys.map(normalizeKey).filter(Boolean)){if(aliases.has(key))return aliases.get(key);}const row={employeeId:'',employeeCode:'',fullName:'',employmentStatus:'',status:'',avatarUrl:'',phone:'',email:'',hireDate:'',department:'',title:'',position:'',branch:'',managerId:'',managerCode:'',managerName:'',profileId:'',account:null,hasEmployeeRecord:false,organizationSource:'',profileSource:''};records.push(row);return row;}
  function bind(row,keys){keys.map(normalizeKey).filter(Boolean).forEach(key=>aliases.set(key,row));}
  source.employees.forEach(item=>{const id=text(item.id),employeeCode=code(item.employee_code||item.code||(id&&!/^emp-/i.test(id)?id:'')),row=locate([id,employeeCode]);row.employeeId=row.employeeId||id;row.employeeCode=row.employeeCode||employeeCode;row.fullName=row.fullName||text(item.full_name||item.name);row.phone=row.phone||text(item.phone);row.avatarUrl=row.avatarUrl||text(item.avatar_url);row.hireDate=row.hireDate||text(item.hire_date||item.study_start_date);row.email=row.email||text(item.email);row.hasEmployeeRecord=true;row.profileSource='employees';bind(row,[id,employeeCode]);});
  source.accounts.forEach(item=>{const id=text(item.employee_id),employeeCode=code(item.employee_code),row=locate([id,employeeCode]);row.employeeId=row.employeeId||id;row.employeeCode=row.employeeCode||employeeCode;row.fullName=row.fullName||text(item.name);row.phone=row.phone||text(item.phone);row.email=row.email||text(item.email);row.account={id:item.id||'',email:item.email||'',role:item.role||'',status:item.status||'',hubAssignmentStatus:item.hub_assignment_status||'',defaultProgram:item.default_program||'',accountType:item.metadata?.accountType||'employee'};bind(row,[id,employeeCode]);});
  source.profiles.forEach(item=>{const id=text(item.employee_id),employeeCode=code(item.employee_code),row=locate([id,employeeCode,item.id]),employmentStatus=normalizeEmploymentStatus(item.employment_status)||'unsynced';row.profileId=text(item.id);row.employeeId=row.employeeId||id;row.employeeCode=employeeCode||row.employeeCode;row.fullName=text(item.full_name)||row.fullName;row.employmentStatus=employmentStatus;row.status=employmentStatus;row.avatarUrl=text(item.avatar_url)||row.avatarUrl;row.phone=text(item.phone)||row.phone;row.email=text(item.work_email)||text(item.personal_email)||row.email;row.hireDate=text(item.hire_date);row.department=text(item.department);row.title=text(item.title);row.position=text(item.position);row.branch=text(item.branch);row.managerCode=code(item.manager_employee_code);row.organizationSource='employee_profiles';row.profileSource='employee_profiles';bind(row,[id,employeeCode,item.id]);});
  const byCode=new Map(records.filter(r=>r.employeeCode).map(r=>[r.employeeCode,r]));
  records.forEach(row=>{if(row.managerCode&&!row.managerName){const manager=byCode.get(row.managerCode);if(manager)row.managerName=manager.fullName;}});
  return records.filter(row=>(row.employeeId||row.employeeCode||row.profileId)&&!(row.account&&row.account.accountType==='system_admin')&&!(!row.hasEmployeeRecord&&!row.profileId&&/^(ADMIN|SYSTEM)$/.test(row.employeeCode))).map(row=>({...row,employmentStatus:row.employmentStatus||'',status:row.employmentStatus||'unsynced',seniority:yearsSince(row.hireDate),hasAccount:!!row.account,hasProfile:!!row.profileId})).sort((a,b)=>a.fullName.localeCompare(b.fullName,'vi'));
}

// PHF Task MAIL CONTRACT V1 — canonical contact resolver for transactional
// mail. NO session/admin gate (server-to-server, called only by the mail
// drainer): given employee codes, return { CODE: { email, active, name } }
// using the SAME merge precedence as the People Master UI (work_email ->
// personal_email -> account email; employment_status 'active'; full_name from
// employee_profiles -> employees/user_accounts). `name` is the canonical
// display name for humane email rendering — the drainer falls back to the raw
// code when it is empty (account-only actor, unsynced profile). A code with no
// email or a non-'active' status is still returned so the drainer can log it
// as skipped.
async function resolveEmployeeContacts(codes){
  const want=new Set((Array.isArray(codes)?codes:[]).map(code).filter(Boolean));
  const out={};
  if(!want.size)return out;
  let records=[];
  try{records=mergeSources(await sources());}catch(e){records=[];}
  for(const r of records){
    const c=code(r.employeeCode);
    if(!c||!want.has(c))continue;
    out[c]={email:text(r.email).toLowerCase(),active:normalizeEmploymentStatus(r.employmentStatus)==='active',name:text(r.fullName)};
  }
  return out;
}

async function listEmployeeMaster(session){
  requireAdmin(session);const source=await sources();
  return{employees:mergeSources(source),schemaReady:source.schemaReady,organizationReady:source.organizationReady,organizationError:source.organizationError,fieldSources:{identity:'employees + user_accounts + employee_profiles',organization:'employee_profiles (People Master — department, title, position, branch, manager)',employmentStatus:'employee_profiles.employment_status',account:'user_accounts',personal:'employee_profiles / employee_private_profiles',contracts:'employee_contracts',compensation:'employee_compensation'},generatedAt:new Date().toISOString()};
}

async function findProfile(input){
  const employeeId=text(input.employeeId||input.employee_id),employeeCode=code(input.employeeCode||input.employee_code),profileId=text(input.profileId||input.profile_id);let query=db.from('employee_profiles').select('*');
  if(profileId)query=query.eq('id',profileId);else if(employeeId)query=query.eq('employee_id',employeeId);else if(employeeCode)query=query.ilike('employee_code',employeeCode);else fail('Thiếu định danh nhân viên.',400,'EMPLOYEE_IDENTITY_REQUIRED');
  const result=await query.limit(1).maybeSingle();if(result.error){if(missingSchema(result.error))fail('Schema Employee Master chưa được triển khai.',503,'EMPLOYEE_MASTER_SCHEMA_MISSING');throw result.error;}return result.data||null;
}

async function ensureProfile(input){
  let profile=await findProfile(input);if(profile)return profile;
  const row={employee_id:text(input.employeeId)||null,employee_code:code(input.employeeCode),full_name:text(input.fullName||input.full_name)};
  if(!row.employee_id&&!row.employee_code)fail('Cần employee_id hoặc employee_code để tạo hồ sơ.',400,'EMPLOYEE_IDENTITY_REQUIRED');
  const result=await db.from('employee_profiles').insert(row).select('*').single();if(result.error)throw result.error;return result.data;
}

async function history(session,profileId,domain,action,beforeData,afterData,reason){const a=actor(session),result=await db.from('employee_master_history').insert({employee_profile_id:profileId,domain,action,before_data:beforeData||null,after_data:afterData||null,reason:text(reason),changed_by:a.id,changed_by_name:a.name});if(result.error)throw result.error;}

async function getEmployeeMasterDetail(session,input){
  requireAdmin(session);requireDb();const master=await listEmployeeMaster(session),key=normalizeKey(input.key||input.employeeId||input.employeeCode||input.profileId),summary=master.employees.find(row=>[row.employeeId,row.employeeCode,row.profileId].map(normalizeKey).includes(key));if(!summary)fail('Không tìm thấy nhân viên.',404,'EMPLOYEE_MASTER_NOT_FOUND');
  const profile=summary.profileId?await findProfile({profileId:summary.profileId}):null;if(!profile)return{summary,profile:null,privateProfile:null,contracts:[],compensation:[],history:[],schemaReady:master.schemaReady};
  const [privateResult,contractResult,compResult,historyResult]=await Promise.all([db.from('employee_private_profiles').select('*').eq('employee_profile_id',profile.id).maybeSingle(),db.from('employee_contracts').select('*').eq('employee_profile_id',profile.id).order('effective_date',{ascending:false}).order('created_at',{ascending:false}),db.from('employee_compensation').select('*').eq('employee_profile_id',profile.id).order('effective_from',{ascending:false}).order('created_at',{ascending:false}),db.from('employee_master_history').select('*').eq('employee_profile_id',profile.id).order('changed_at',{ascending:false}).limit(100)]);
  for(const result of [privateResult,contractResult,compResult,historyResult])if(result.error)throw result.error;
  return{summary,profile,privateProfile:privateResult.data||null,contracts:contractResult.data||[],compensation:compResult.data||[],history:historyResult.data||[],schemaReady:true};
}

// PHF SYSTEM V1 — "nghỉ việc = mất quyền truy cập PHF HR".
// When an employee's People Master employment_status flips to 'inactive', the
// linked login account(s) are set to status 'inactive' so the person can no
// longer authenticate (auth.login rejects non-active accounts; auth.readSession
// voids any live session on the next server request). This NEVER deletes the
// account, the employee, history or the identity mapping. Reactivation is
// deliberately NOT automatic — an Admin must re-enable the account from
// Quản trị tài khoản. role='admin' / system_admin accounts are left untouched.
// Resilient per-account lock: ONE failing account must never stop attempts
// on the remaining linked accounts (multiple accounts can share an
// employee_code/employee_id in edge cases) — each account's UPDATE is
// isolated in its own try/catch, and the function returns a full
// locked/failed breakdown instead of throwing on the first error.
async function lockAccountsForDepartedEmployee(session,profileRow){
  const employeeId=text(profileRow&&profileRow.employee_id);
  const employeeCode=code(profileRow&&profileRow.employee_code);
  const empty={locked:0,failed:0,accounts:[],failures:[]};
  if(!employeeId&&!employeeCode)return empty;
  const filters=[];
  if(employeeId)filters.push('employee_id.eq.'+employeeId);
  if(employeeCode)filters.push('employee_code.eq.'+employeeCode);
  const found=await db.from('user_accounts').select('id,role,status,metadata').or(filters.join(','));
  if(found.error){if(missingSchema(found.error))return empty;throw found.error;}
  const targets=(found.data||[]).filter(row=>{
    if(String(row.status||'').toLowerCase()!=='active')return false;
    if(String(row.role||'').toLowerCase()==='admin')return false;
    if(String((row.metadata&&row.metadata.accountType)||'').toLowerCase()==='system_admin')return false;
    return true;
  });
  let locked=0;const accounts=[];const failures=[];
  for(const row of targets){
    try{
      const upd=await db.from('user_accounts').update({status:'inactive',updated_at:new Date().toISOString()}).eq('id',row.id);
      if(upd.error)throw upd.error;
      locked++;accounts.push({id:String(row.id||''),employee_code:employeeCode||'',previous_status:row.status||'active'});
      // Employee Master module-history trail (Supabase MAIN). The System V1
      // central audit row (EMPLOYEE_INACTIVE_AUTO_LOCK) is emitted by the
      // caller in api/data.js where the request context (ip/ua/request-id)
      // is available.
      try{await history(session,profileRow.id,'account','auto_lock',{status:row.status},{status:'inactive'},'Tự động khóa tài khoản do nhân sự chuyển sang Nghỉ việc');}catch(_e){}
    }catch(lockError){
      failures.push({id:String(row.id||''),message:(lockError&&lockError.message)||'Không khóa được tài khoản.'});
    }
  }
  return{locked,failed:failures.length,accounts,failures};
}

// PHF HR SYSTEM · Account -> People Master auto-link (LOCAL batch).
// Called right after an account is created/updated with a non-empty
// employeeCode. Idempotent + safe:
//   - employeeCode missing -> does NOT guess/create anything; caller must
//     surface 'employee_code_required' as an actionable next step.
//   - a employee_profiles row already exists for that employee_code -> NEVER
//     overwritten here (admin edits stay the only path to change it); returns
//     'linked_existing'.
//   - otherwise creates ONE new employee_profiles row from the account's own
//     already-collected fields (full_name/phone/branch/department/position).
//     employment_status is left to its schema default ('active') — this is
//     People Master's own identity/status field, not a QTTH classification;
//     QTTH unit/group/role/permission are never touched here.
async function ensureProfileFromAccount(session,account){
  requireDb();
  const employeeCode=code(account&&account.employeeCode);
  if(!employeeCode)return{status:'employee_code_required',profile:null};
  const existing=await findProfile({employeeCode});
  if(existing)return{status:'linked_existing',profile:existing};
  const fullName=text(account&&account.name);
  if(!fullName)return{status:'name_required',profile:null};
  const row={
    employee_code:employeeCode,
    full_name:fullName,
    phone:text(account&&account.phone),
    branch:text(account&&account.branch),
    department:text(account&&account.department),
    position:text(account&&account.position),
  };
  const result=await db.from('employee_profiles').insert(row).select('*').single();
  if(result.error){
    if(String(result.error.code||'')==='23505')return{status:'linked_existing',profile:(await findProfile({employeeCode}))||null};
    throw result.error;
  }
  invalidateTaskPeopleCache();
  try{await history(session,result.data.id,'profile','create',null,result.data,'Tự động tạo hồ sơ nhân sự khi tạo/cập nhật tài khoản');}catch(_e){}
  return{status:'created',profile:result.data};
}

async function saveProfile(session,input){
  requireAdmin(session);requireDb();const existing=await ensureProfile(input),has=key=>Object.prototype.hasOwnProperty.call(input,key);let employmentStatus=existing.employment_status;if(has('employmentStatus')){employmentStatus=normalizeEmploymentStatus(input.employmentStatus);if(!employmentStatus)fail('Trạng thái làm việc chỉ nhận active hoặc inactive.',400,'EMPLOYMENT_STATUS_INVALID');}const patch={employee_id:text(input.employeeId)||existing.employee_id||null,employee_code:code(input.employeeCode)||existing.employee_code||'',full_name:text(input.fullName)||existing.full_name||'',employment_status:employmentStatus,avatar_url:has('avatarUrl')?text(input.avatarUrl):existing.avatar_url,birth_date:has('birthDate')?date(input.birthDate):existing.birth_date,gender:has('gender')?text(input.gender):existing.gender,phone:has('phone')?text(input.phone):existing.phone,work_email:has('workEmail')?text(input.workEmail):existing.work_email,personal_email:has('personalEmail')?text(input.personalEmail):existing.personal_email,hire_date:has('hireDate')?date(input.hireDate):existing.hire_date,official_date:has('officialDate')?date(input.officialDate):existing.official_date,note:has('note')?text(input.note):existing.note,department:has('department')?text(input.department):existing.department,title:has('title')?text(input.title):existing.title,position:has('position')?(text(input.position)||null):existing.position,branch:has('branch')?text(input.branch):existing.branch,manager_employee_code:has('managerEmployeeCode')?code(input.managerEmployeeCode):existing.manager_employee_code};
  if(!patch.full_name)fail('Họ tên nhân viên là bắt buộc.',400,'EMPLOYEE_NAME_REQUIRED');const result=await db.from('employee_profiles').update(patch).eq('id',existing.id).select('*').single();if(result.error)throw result.error;await history(session,existing.id,'profile','update',existing,result.data,input.reason||'Cập nhật hồ sơ nhân sự');invalidateTaskPeopleCache();
  let accountLock=null;
  if(has('employmentStatus')&&employmentStatus==='inactive'&&normalizeEmploymentStatus(existing.employment_status)!=='inactive'){
    accountLock=await lockAccountsForDepartedEmployee(session,result.data);
  }
  return{profile:result.data,accountLock};
}

// PHF HR SYSTEM · "Đổi trạng thái nhân sự" — a dedicated, narrow action for
// the Account screen's status modal (and any future caller) that ONLY
// changes employment_status. Deliberately separate from saveProfile:
//   - requires an EXISTING People Master profile (employeeCode/employeeId/
//     profileId) — never creates one. A not-yet-linked account must link
//     identity first (see ensureProfileFromAccount in the Account flow); this
//     function never silently creates a "trạng thái rời" for nobody.
//   - writes ONE canonical column (employee_profiles.employment_status) —
//     the SAME column saveProfile's own employmentStatus branch writes, so
//     there is still only one status source of truth regardless of which UI
//     entry point is used.
//   - captures effectiveDate/reason into employee_master_history's after_data
//     JSON (no schema change — the history table already stores arbitrary
//     JSON) so "có hiệu lực từ ngày nào" is recorded without redesigning
//     People Master or its history contract.
//   - reuses the EXISTING "nghỉ việc = mất quyền truy cập PHF HR" auto-lock
//     rule (lockAccountsForDepartedEmployee) — this rule already fires from
//     saveProfile today; it is not a new behavior introduced here.
async function setEmploymentStatus(session,input){
  requireAdmin(session);requireDb();
  const employeeCode=code(input&&input.employeeCode);
  const employeeId=text(input&&input.employeeId);
  const profileId=text(input&&input.profileId);
  if(!employeeCode&&!employeeId&&!profileId)fail('Thiếu định danh nhân viên.',400,'EMPLOYEE_IDENTITY_REQUIRED');
  const existing=await findProfile({employeeCode,employeeId,profileId});
  if(!existing)fail('Nhân sự chưa liên kết People Master. Vui lòng liên kết nhân sự trước khi đổi trạng thái.',409,'EMPLOYEE_PROFILE_NOT_LINKED');
  const nextStatus=normalizeEmploymentStatus(input&&input.employmentStatus);
  if(!nextStatus)fail('Trạng thái làm việc chỉ nhận active hoặc inactive.',400,'EMPLOYMENT_STATUS_INVALID');
  const effectiveDate=date(input&&input.effectiveDate);
  if(input&&input.effectiveDate&&!effectiveDate)fail('Ngày hiệu lực không hợp lệ (định dạng YYYY-MM-DD).',400,'EFFECTIVE_DATE_INVALID');
  const reason=text(input&&input.reason);
  const beforeStatus=normalizeEmploymentStatus(existing.employment_status)||'active';
  if(beforeStatus===nextStatus){
    return{profile:existing,changed:false,historyLogged:false,accountLock:null};
  }
  const result=await db.from('employee_profiles').update({employment_status:nextStatus}).eq('id',existing.id).select('*').single();
  if(result.error)throw result.error;

  // employee_profiles.employment_status + employee_master_history are BOTH
  // mandatory — Supabase's REST layer has no cross-table transaction, so a
  // history-insert failure AFTER the status write already committed is
  // compensated by reverting the status write, then reported as a hard
  // error. Never return success with the status changed but no audit trail.
  try{
    await history(session,existing.id,'employment_status','status_change',
      {employment_status:beforeStatus},
      {employment_status:nextStatus,effective_date:effectiveDate,reason:reason||null},
      reason||'Đổi trạng thái nhân sự');
  }catch(historyError){
    const revert=await db.from('employee_profiles').update({employment_status:beforeStatus}).eq('id',existing.id);
    const revertOk=!revert.error;
    const err=new Error(revertOk
      ?'Không ghi được lịch sử đổi trạng thái — đã hoàn tác trạng thái nhân sự về giá trị cũ. Vui lòng thử lại.'
      :'Không ghi được lịch sử đổi trạng thái, và hoàn tác trạng thái cũng thất bại. Cần kiểm tra thủ công ngay: employee_profiles.id='+existing.id+'.');
    err.statusCode=revertOk?409:503;
    err.code=revertOk?'EMPLOYMENT_STATUS_HISTORY_FAILED_REVERTED':'EMPLOYMENT_STATUS_HISTORY_FAILED_REVERT_FAILED';
    err.cause=historyError;
    throw err;
  }
  invalidateTaskPeopleCache();

  // From this point, employment_status + history are BOTH already durably
  // committed. Account-lock is best-effort bookkeeping on top of that
  // canonical write — its failure is reported as a structured warning, NEVER
  // rolled back into the status/history that already succeeded.
  let accountLock=null;
  if(nextStatus==='inactive'&&beforeStatus!=='inactive'){
    try{
      accountLock=await lockAccountsForDepartedEmployee(session,result.data);
    }catch(lockError){
      accountLock={locked:0,failed:-1,accounts:[],failures:[{message:(lockError&&lockError.message)||'Không khóa được tài khoản liên quan.'}]};
    }
  }
  // §Không tự mở khóa: chuyển inactive -> active không có bất kỳ đường ghi
  // nào xuống user_accounts ở dưới đây — tái kích hoạt nhân sự KHÔNG tự mở
  // lại tài khoản đăng nhập đã bị khóa; đó vẫn là một hành động Admin riêng,
  // rõ ràng, cho tới khi có business rule khác chỉ định.
  return{profile:result.data,changed:true,historyLogged:true,accountLock};
}

async function savePrivateProfile(session,input){
  requireAdmin(session);requireDb();const profile=await ensureProfile(input),oldResult=await db.from('employee_private_profiles').select('*').eq('employee_profile_id',profile.id).maybeSingle();if(oldResult.error)throw oldResult.error;const old=oldResult.data||{},row={employee_profile_id:profile.id,citizen_id:text(input.citizenId),citizen_issued_date:date(input.citizenIssuedDate),citizen_issued_place:text(input.citizenIssuedPlace),citizen_expiry_date:old.citizen_expiry_date||null,permanent_address:old.permanent_address||'',current_address:old.current_address||'',nationality:text(input.nationality),ethnicity:text(input.ethnicity),personal_tax_code:text(input.personalTaxCode),social_insurance_code:text(input.socialInsuranceCode)};const result=await db.from('employee_private_profiles').upsert(row,{onConflict:'employee_profile_id'}).select('*').single();if(result.error)throw result.error;await history(session,profile.id,'private_profile',oldResult.data?'update':'create',oldResult.data,result.data,input.reason||'Cập nhật thông tin cá nhân nhạy cảm');return{privateProfile:result.data};
}

async function saveContract(session,input){
  requireAdmin(session);requireDb();const profile=await ensureProfile(input);let old=null;if(text(input.id)){const got=await db.from('employee_contracts').select('*').eq('id',text(input.id)).eq('employee_profile_id',profile.id).maybeSingle();if(got.error)throw got.error;old=got.data;}const row={employee_profile_id:profile.id,contract_type:text(input.contractType),contract_number:text(input.contractNumber),signed_date:date(input.signedDate),effective_date:date(input.effectiveDate),expiry_date:date(input.expiryDate),contract_status:text(input.contractStatus)||'active',note:old?old.note||'':''};if(!row.contract_type)fail('Loại hợp đồng là bắt buộc.',400,'CONTRACT_TYPE_REQUIRED');const query=old?db.from('employee_contracts').update(row).eq('id',old.id):db.from('employee_contracts').insert(row),result=await query.select('*').single();if(result.error)throw result.error;await history(session,profile.id,'contract',old?'update':'create',old,result.data,input.reason||'Cập nhật hợp đồng lao động');return{contract:result.data};
}

async function saveCompensation(session,input){
  requireAdmin(session);requireDb();const profile=await ensureProfile(input),currentResult=await db.from('employee_compensation').select('*').eq('employee_profile_id',profile.id).is('effective_to',null).order('effective_from',{ascending:false}).limit(1).maybeSingle();if(currentResult.error)throw currentResult.error;const current=currentResult.data||null;let result;if(current)result=await db.from('employee_compensation').update({base_salary:money(input.baseSalary)}).eq('id',current.id).select('*').single();else result=await db.from('employee_compensation').insert({employee_profile_id:profile.id,base_salary:money(input.baseSalary),allowances:0,currency:'VND',effective_from:new Date().toISOString().slice(0,10),effective_to:null,note:''}).select('*').single();if(result.error)throw result.error;await history(session,profile.id,'compensation',current?'update':'create',current,result.data,input.reason||'Cập nhật mức lương hiện tại');return{compensation:result.data};
}

module.exports={EMPLOYMENT_STATUSES,normalizeEmploymentStatus,mergeSources,loadCanonicalEmployeeProfiles,resolveEmployeeContacts,listEmployeeMaster,getEmployeeMasterDetail,ensureProfile,ensureProfileFromAccount,saveProfile,setEmploymentStatus,savePrivateProfile,saveContract,saveCompensation,lockAccountsForDepartedEmployee};
