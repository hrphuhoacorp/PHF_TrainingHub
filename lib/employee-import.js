'use strict';

require('dotenv').config();
const crypto=require('crypto');
const {createClient}=require('@supabase/supabase-js');
const {listChecklistAssignments}=require('./checklist-assignments');

const configured=Boolean(String(process.env.SUPABASE_URL||'').trim()&&String(process.env.SUPABASE_SECRET_KEY||'').trim());
const db=configured?createClient(String(process.env.SUPABASE_URL).trim(),String(process.env.SUPABASE_SECRET_KEY).trim(),{auth:{persistSession:false,autoRefreshToken:false}}):null;
const PROFILE_FIELDS=['full_name','birth_date','gender','phone','work_email'];
const PRIVATE_FIELDS=['citizen_id','citizen_issued_date','citizen_issued_place','nationality','ethnicity','personal_tax_code','social_insurance_code'];
const PROFILE_SNAPSHOT_FIELDS=['employee_id','employee_code','full_name','employment_status','avatar_url','birth_date','gender','phone','work_email','personal_email','hire_date','official_date','note'];
const PRIVATE_SNAPSHOT_FIELDS=['citizen_id','citizen_issued_date','citizen_issued_place','citizen_expiry_date','permanent_address','current_address','nationality','ethnicity','personal_tax_code','social_insurance_code'];
const FIELD_MAP={
  fullName:['profile','full_name'],companyEmail:['profile','work_email'],gender:['profile','gender'],dateOfBirth:['profile','birth_date'],phone:['profile','phone'],
  identityNumber:['private','citizen_id'],identityIssuedDate:['private','citizen_issued_date'],identityIssuedPlace:['private','citizen_issued_place'],nationality:['private','nationality'],ethnicity:['private','ethnicity'],socialInsuranceNumber:['private','social_insurance_code'],personalTaxCode:['private','personal_tax_code']
};
const ORG_MAP={department:'department',title:'title',position:'position',workStatus:'employeeStatus'};

function text(v){return String(v==null?'':v).trim();}
function code(v){return text(v).toUpperCase();}
function comparable(v){return text(v).normalize('NFC').toLocaleLowerCase('vi-VN');}
function fail(message,statusCode,codeValue){const e=new Error(message);e.statusCode=statusCode||400;e.code=codeValue||'EMPLOYEE_IMPORT_INVALID';throw e;}
function requireAdmin(session){if(!session||String(session.role||'').toLowerCase()!=='admin')fail('Chỉ Admin được nhập hồ sơ nhân sự.',403,'EMPLOYEE_IMPORT_ADMIN_REQUIRED');}
function requireDb(){if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');}
function pick(row,fields){const out={};fields.forEach(k=>{if(Object.prototype.hasOwnProperty.call(row,k))out[k]=row[k];});return out;}
function excelSerial(value){const n=Number(value);if(!Number.isFinite(n)||n<1)return'';return new Date(Date.UTC(1899,11,30)+Math.round(n)*86400000).toISOString().slice(0,10);}
function strictDate(value){
  if(value==null||text(value)==='')return'';
  if(typeof value==='number')return excelSerial(value);
  const raw=text(value),iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/),vi=raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  const parts=iso?[+iso[1],+iso[2],+iso[3]]:vi?[+vi[3],+vi[2],+vi[1]]:null;if(!parts)return null;
  const [y,m,d]=parts,dt=new Date(Date.UTC(y,m-1,d));if(y<1900||y>2100||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)return null;
  return [String(y).padStart(4,'0'),String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
}
function normalizeGender(value){const v=comparable(value);if(!v)return'';if(v==='nam'||v==='male')return'Nam';if(v==='nữ'||v==='nu'||v==='female')return'Nữ';if(v==='khác'||v==='khac'||v==='other')return'Khác';return null;}
function normalizeInput(raw,index){
  const source=raw&&typeof raw==='object'?raw:{};
  const row={rowNumber:Number(source.rowNumber)||index+1,employeeCode:code(source.employeeCode)};
  ['fullName','companyEmail','gender','dateOfBirth','phone','identityNumber','identityIssuedDate','identityIssuedPlace','nationality','ethnicity','socialInsuranceNumber','personalTaxCode','department','title','position','workStatus'].forEach(k=>{row[k]=text(source[k]);});
  return row;
}
function validateRow(row){
  const errors=[];
  if(!row.employeeCode)errors.push('Mã nhân viên là bắt buộc.');else if(!/^[A-Z0-9][A-Z0-9._\/-]{0,63}$/.test(row.employeeCode))errors.push('Mã nhân viên chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới hoặc dấu /.');
  for(const key of ['dateOfBirth','identityIssuedDate'])if(row[key]){const parsed=strictDate(row[key]);if(!parsed)errors.push((key==='dateOfBirth'?'Ngày sinh':'Ngày cấp')+' không hợp lệ.');else row[key]=parsed;}
  if(row.gender){const gender=normalizeGender(row.gender);if(!gender)errors.push('Giới tính phải là Nam, Nữ hoặc Khác.');else row.gender=gender;}
  if(row.identityNumber&&!/^(?:\d{9}|\d{12})$/.test(row.identityNumber))errors.push('CMND/CCCD phải gồm 9 hoặc 12 chữ số.');
  if(row.socialInsuranceNumber&&!/^\d{10}$/.test(row.socialInsuranceNumber))errors.push('Mã số BHXH phải gồm 10 chữ số.');
  if(row.personalTaxCode&&!/^(?:\d{10}|\d{12})$/.test(row.personalTaxCode))errors.push('MST cá nhân phải gồm 10 hoặc 12 chữ số.');
  if(row.companyEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.companyEmail))errors.push('Email làm việc không hợp lệ.');
  return errors;
}
function previewHash(rows){return crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>({rowNumber:r.rowNumber,employeeCode:r.employeeCode,action:r.action,errors:r.errors,warnings:r.warnings,profilePatch:r.profilePatch,privatePatch:r.privatePatch})))).digest('hex');}
function buildPreview(inputRows,existingProfiles,privateProfiles,assignments){
  const raw=Array.isArray(inputRows)?inputRows:[];if(!raw.length)fail('File không có dòng dữ liệu.',400,'EMPLOYEE_IMPORT_EMPTY');if(raw.length>1000)fail('Mỗi lần chỉ nhập tối đa 1.000 dòng.',400,'EMPLOYEE_IMPORT_TOO_MANY_ROWS');
  const profileByCode=new Map((existingProfiles||[]).map(x=>[code(x.employee_code),x])),privateByProfile=new Map((privateProfiles||[]).map(x=>[text(x.employee_profile_id),x])),assignmentByCode=new Map((assignments||[]).map(x=>[code(x.employeeCode||x.employee_code),x])),codeByProfile=new Map((existingProfiles||[]).map(x=>[text(x.id),code(x.employee_code)])),owners={companyEmail:new Map(),identityNumber:new Map(),socialInsuranceNumber:new Map(),personalTaxCode:new Map()};
  (existingProfiles||[]).forEach(x=>{if(text(x.work_email))owners.companyEmail.set(comparable(x.work_email),code(x.employee_code));});
  (privateProfiles||[]).forEach(x=>{const owner=codeByProfile.get(text(x.employee_profile_id))||'';[['identityNumber','citizen_id'],['socialInsuranceNumber','social_insurance_code'],['personalTaxCode','personal_tax_code']].forEach(pair=>{if(text(x[pair[1]]))owners[pair[0]].set(comparable(x[pair[1]]),owner);});});
  const normalized=raw.map(normalizeInput),counts=new Map();normalized.forEach(x=>{if(x.employeeCode)counts.set(x.employeeCode,(counts.get(x.employeeCode)||0)+1);});
  const rows=normalized.map(row=>{
    const errors=validateRow(row),warnings=[],existing=profileByCode.get(row.employeeCode)||null,privateRow=existing?privateByProfile.get(text(existing.id))||null:null;
    if(row.employeeCode&&counts.get(row.employeeCode)>1)errors.push('Mã nhân viên bị trùng trong file.');
    if(!existing&&!row.fullName)errors.push('Họ và tên là bắt buộc khi tạo mới.');
    Object.keys(owners).forEach(field=>{const owner=row[field]&&owners[field].get(comparable(row[field]));if(owner&&owner!==row.employeeCode)errors.push(field==='companyEmail'?'Email làm việc đang thuộc mã nhân viên '+owner+'.':'Định danh nhạy cảm '+field+' đang thuộc mã nhân viên '+owner+'.');});
    const profilePatch={},privatePatch={},changes=[];
    Object.entries(FIELD_MAP).forEach(([source,[domain,target]])=>{const value=row[source];if(value==='')return;const current=domain==='profile'?(existing&&existing[target]):(privateRow&&privateRow[target]);if(comparable(current)!==comparable(value)){(domain==='profile'?profilePatch:privatePatch)[target]=value;changes.push({field:source,from:text(current),to:value});}});
    const org=assignmentByCode.get(row.employeeCode)||null,orgConflicts=[];
    Object.entries(ORG_MAP).forEach(([source,target])=>{if(!row[source])return;const current=org?text(org[target]||org[target.replace(/[A-Z]/g,m=>'_'+m.toLowerCase())]):'';if(comparable(current)!==comparable(row[source]))orgConflicts.push({field:source,fileValue:row[source],checklistValue:current});});
    if(orgConflicts.length)warnings.push(org?'Thông tin tổ chức khác nguồn Checklist; hệ thống không ghi đè Checklist.':'Chưa có phân công Checklist để đối chiếu; hệ thống chỉ nhập Employee Master.');
    const action=errors.length?'Lỗi':!existing?'Tạo mới':changes.length?'Cập nhật':'Không đổi';
    return{rowNumber:row.rowNumber,employeeCode:row.employeeCode,fullName:row.fullName||text(existing&&existing.full_name),action,errors,warnings,organizationConflicts:orgConflicts,changes,profilePatch,privatePatch,source:row,existingProfileId:text(existing&&existing.id)};
  });
  const summary={'Tạo mới':0,'Cập nhật':0,'Không đổi':0,'Lỗi':0};rows.forEach(x=>summary[x.action]++);
  return{rows,summary,hasErrors:summary['Lỗi']>0,previewHash:previewHash(rows),organizationPolicy:'read-only-checklist'};
}
async function loadCurrent(){
  const [profilesResult,privateResult,assignmentsResult]=await Promise.all([db.from('employee_profiles').select('*'),db.from('employee_private_profiles').select('*'),listChecklistAssignments()]);
  if(profilesResult.error)throw profilesResult.error;if(privateResult.error)throw privateResult.error;
  return{profiles:profilesResult.data||[],privateProfiles:privateResult.data||[],assignments:assignmentsResult.assignments||[]};
}
async function previewEmployeeImport(session,input){requireAdmin(session);requireDb();const current=await loadCurrent();return buildPreview(input&&input.rows,current.profiles,current.privateProfiles,current.assignments);}
async function deleteHistories(ids){if(ids.length){const r=await db.from('employee_master_history').delete().in('id',ids);if(r.error)throw r.error;}}
async function rollback(changes,historyIds){
  await deleteHistories(historyIds);
  for(const change of changes.slice().reverse()){
    if(change.created){const r=await db.from('employee_profiles').delete().eq('id',change.profileId);if(r.error)throw r.error;continue;}
    if(change.privateBefore){const r=await db.from('employee_private_profiles').upsert({employee_profile_id:change.profileId,...pick(change.privateBefore,PRIVATE_SNAPSHOT_FIELDS)},{onConflict:'employee_profile_id'});if(r.error)throw r.error;}
    else if(change.privateCreated){const r=await db.from('employee_private_profiles').delete().eq('employee_profile_id',change.profileId);if(r.error)throw r.error;}
    const r=await db.from('employee_profiles').update(pick(change.profileBefore,PROFILE_SNAPSHOT_FIELDS)).eq('id',change.profileId);if(r.error)throw r.error;
  }
}
async function commitEmployeeImport(session,input){
  requireAdmin(session);requireDb();const current=await loadCurrent(),preview=buildPreview(input&&input.rows,current.profiles,current.privateProfiles,current.assignments);
  if(preview.hasErrors)fail('File còn dòng lỗi; chưa có dữ liệu nào được ghi.',409,'EMPLOYEE_IMPORT_HAS_ERRORS');
  if(!text(input&&input.previewHash)||text(input.previewHash)!==preview.previewHash)fail('Dữ liệu đã thay đổi sau Preview. Vui lòng Preview lại.',409,'EMPLOYEE_IMPORT_STALE');
  const profileById=new Map(current.profiles.map(x=>[text(x.id),x])),privateByProfile=new Map(current.privateProfiles.map(x=>[text(x.employee_profile_id),x])),applied=[],historyRows=[];
  try{
    for(const item of preview.rows.filter(x=>x.action==='Tạo mới'||x.action==='Cập nhật')){
      let profile=profileById.get(item.existingProfileId)||null,created=false;
      if(!profile){const inserted=await db.from('employee_profiles').insert({employee_id:null,employee_code:item.employeeCode,full_name:item.source.fullName,...item.profilePatch}).select('*').single();if(inserted.error)throw inserted.error;profile=inserted.data;created=true;}
      else if(Object.keys(item.profilePatch).length){let query=db.from('employee_profiles').update(item.profilePatch).eq('id',profile.id);if(profile.updated_at)query=query.eq('updated_at',profile.updated_at);const updated=await query.select('*').maybeSingle();if(updated.error)throw updated.error;if(!updated.data)fail('Hồ sơ đã thay đổi trong lúc import. Vui lòng Preview lại.',409,'EMPLOYEE_IMPORT_STALE');profile=updated.data;}
      const privateBefore=privateByProfile.get(text(profile.id))||null,privateCreated=!privateBefore&&Object.keys(item.privatePatch).length>0,change={profileId:profile.id,created,profileBefore:profileById.get(item.existingProfileId)||null,privateBefore,privateCreated:false};
      applied.push(change);
      if(Object.keys(item.privatePatch).length){let saved;if(privateBefore){let query=db.from('employee_private_profiles').update(item.privatePatch).eq('employee_profile_id',profile.id);if(privateBefore.updated_at)query=query.eq('updated_at',privateBefore.updated_at);saved=await query.select('*').maybeSingle();if(!saved.error&&!saved.data)fail('Thông tin cá nhân đã thay đổi trong lúc import. Vui lòng Preview lại.',409,'EMPLOYEE_IMPORT_STALE');}else saved=await db.from('employee_private_profiles').insert({employee_profile_id:profile.id,...item.privatePatch}).select('*').single();if(saved.error)throw saved.error;}
      change.privateCreated=privateCreated;
      historyRows.push({employee_profile_id:profile.id,domain:'excel_import',action:created?'create':'update',before_data:created?null:{profile:profileById.get(item.existingProfileId)||null,privateProfile:privateBefore},after_data:{employeeCode:item.employeeCode,profilePatch:item.profilePatch,privatePatch:item.privatePatch},reason:'Employee Master Excel Import V1',changed_by:text(session.account?.id||session.sub),changed_by_name:text(session.account?.name||session.account?.email||session.email)||'Admin'});
    }
    let historyIds=[];if(historyRows.length){const saved=await db.from('employee_master_history').insert(historyRows).select('id');if(saved.error)throw saved.error;historyIds=(saved.data||[]).map(x=>x.id);}
    return{committed:true,summary:preview.summary,written:historyRows.length,organizationConflicts:preview.rows.reduce((n,x)=>n+x.organizationConflicts.length,0)};
  }catch(error){try{await rollback(applied,[]);}catch(rollbackError){const fatal=new Error('Import lỗi và hoàn tác không hoàn tất. Cần kiểm tra audit ngay.');fatal.statusCode=500;fatal.code='EMPLOYEE_IMPORT_ROLLBACK_FAILED';fatal.cause=rollbackError;throw fatal;}throw error;}
}

module.exports={previewEmployeeImport,commitEmployeeImport,buildPreview,strictDate,normalizeGender,PROFILE_FIELDS,PRIVATE_FIELDS};
