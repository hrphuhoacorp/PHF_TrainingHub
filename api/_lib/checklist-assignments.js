'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const hasEnv = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = hasEnv ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {auth:{persistSession:false,autoRefreshToken:false}}) : null;
const CURRENT_TABLE = 'checklist_employee_assignments';
const HISTORY_TABLE = 'checklist_employee_assignment_history';

function text(v){ return String(v == null ? '' : v).trim(); }
function employeeKey(row){ return text(row.employeeKey || row.employee_key || row.employeeCode || row.employee_code || row.employeeId || row.employee_id).toLowerCase(); }
function cleanDate(v){ const s=text(v); if(!/^\d{4}-\d{2}-\d{2}$/.test(s)){const e=new Error('Ngày hiệu lực phân công không hợp lệ.');e.statusCode=400;e.code='CHECKLIST_ASSIGNMENT_DATE_INVALID';throw e;} return s; }

// Organization Master Cutover — Checklist Write Lock: department/title/
// position/branch/manager are NEVER taken from client input anymore. They
// come from employee_profiles (Employee Master, canonical) when that row
// has organization data; otherwise they fall back to whatever is already
// stored on the row (never blanked, never guessed). employee_status stays
// client-controlled — traced (assets/js/checklist/phf-checklist-app.js
// employeeStatusModalHtml, "Trạng thái áp dụng ... không chỉnh lẫn trong
// thông tin tổ chức"): it is Checklist's own 3-state operational status
// (Đang làm việc/Nghỉ dài hạn/Đã nghỉ việc) gating template-assignment
// eligibility, distinct from Employee Master's binary employment_status.
// Toan bo employee_profiles (khong loc theo code) - tranh bai toan "ga va
// trung" khi manager cua mot dong dang luu khong nam trong chinh tap dong
// dang luu. Quy mo cong ty nho (~40 nguoi), chi phi khong dang ke.
async function loadOrgProjection(){
  if(!supabase) return new Map();
  const {data,error}=await supabase.from('employee_profiles').select('employee_code,full_name,department,title,position,branch,manager_employee_code').order('employee_code',{ascending:true});
  if(error) throw error;
  return new Map((data||[]).map(r=>[text(r.employee_code).toUpperCase(),r]));
}
function resolveOrgFields(employeeCode, orgMap, fallback){
  const code=text(employeeCode).toUpperCase();
  const master=code?orgMap.get(code):null;
  const hasOrgData=master&&(text(master.department)||text(master.title)||text(master.branch)||text(master.position)||text(master.manager_employee_code));
  if(!hasOrgData){
    return {department:text(fallback&&fallback.department),title:text(fallback&&fallback.title),position:text(fallback&&fallback.position),branch:text(fallback&&fallback.branch),manager_code:text(fallback&&fallback.manager_code),manager_name:text(fallback&&fallback.manager_name)};
  }
  const managerCode=text(master.manager_employee_code).toUpperCase();
  const managerMaster=managerCode?orgMap.get(managerCode):null;
  return {department:text(master.department),title:text(master.title),position:text(master.position),branch:text(master.branch),manager_code:managerCode,manager_name:managerMaster?text(managerMaster.full_name):''};
}
function normalize(row,orgMap,currentByKey){
  const key=employeeKey(row);
  if(!key) { const e=new Error('Thiếu khóa nhân sự khi lưu phân công Checklist.'); e.statusCode=400; e.code='CHECKLIST_EMPLOYEE_KEY_REQUIRED'; throw e; }
  const current=currentByKey?currentByKey.get(key):null;
  const org=resolveOrgFields(row.employeeCode||row.employee_code, orgMap||new Map(), current);
  return {
    employee_key:key,
    employee_id:text(row.employeeId || row.employee_id),
    employee_code:text(row.employeeCode || row.employee_code),
    employee_name:text(row.employeeName || row.employee_name),
    department:org.department,
    title:org.title,
    position:org.position,
    branch:org.branch,
    manager_id:text(row.managerId || row.manager_id),
    manager_code:org.manager_code,
    manager_name:org.manager_name,
    employee_status:text(row.employeeStatus || row.employee_status) || 'Đang làm việc',
    leave_until:text(row.leaveUntil || row.leave_until) || null,
    status_note:text(row.statusNote || row.status_note),
    template_id:text(row.templateId || row.template_id),
    template_version:text(row.templateVersion || row.template_version),
    effective_date:cleanDate(row.effectiveDate || row.effective_date),
    reason:text(row.reason) || 'Đồng bộ cấu hình Checklist',
    updated_at:new Date().toISOString(),
    expected_updated_at:text(row.expectedUpdatedAt || row.expected_updated_at) || null,
    expected_absent:row.expectedAbsent===true||row.expected_absent===true
  };
}
function publicRow(r){
  return {
    employeeKey:r.employee_key||'', employeeId:r.employee_id||'', employeeCode:r.employee_code||'', employeeName:r.employee_name||'',
    department:r.department||'', title:r.title||'', position:r.position||'', branch:r.branch||'', managerId:r.manager_id||'', managerCode:r.manager_code||'', managerName:r.manager_name||'',
    employeeStatus:r.employee_status||'Đang làm việc', leaveUntil:r.leave_until||'', statusNote:r.status_note||'', templateId:r.template_id||'', templateVersion:r.template_version||'', effectiveDate:r.effective_date||'', reason:r.reason||'', updatedAt:r.updated_at||''
  };
}
function comparable(r){ return JSON.stringify([r.employee_id,r.employee_code,r.employee_name,r.department,r.title,r.position,r.branch,r.manager_id,r.manager_code,r.manager_name,r.employee_status,r.leave_until,r.status_note,r.template_id,r.template_version,r.effective_date]); }
function schemaMissing(error){ return error && (error.code==='42P01' || /does not exist|schema cache/i.test(String(error.message||''))); }
async function listChecklistAssignments(){
  if(!supabase) return {assignments:[],ready:false,error:'SUPABASE_NOT_CONFIGURED'};
  const {data,error}=await supabase.from(CURRENT_TABLE).select('*').order('employee_name',{ascending:true});
  if(error){
    if(schemaMissing(error)) return {assignments:[],ready:false,error:'CHECKLIST_ASSIGNMENT_SCHEMA_MISSING'};
    throw error;
  }
  const rows=data||[];
  const orgMap=await loadOrgProjection();
  const projected=rows.map(r=>{
    const org=resolveOrgFields(r.employee_code, orgMap, r);
    return {...r,department:org.department,title:org.title,position:org.position,branch:org.branch,manager_code:org.manager_code,manager_name:org.manager_name};
  });
  return {assignments:projected.map(publicRow),ready:true,error:''};
}
async function saveChecklistAssignments(session, rows){
  if(!supabase){ const e=new Error('Supabase chưa được cấu hình.'); e.statusCode=503; e.code='SUPABASE_NOT_CONFIGURED'; throw e; }
  if(!session || session.role!=='admin'){ const e=new Error('Chỉ Admin được cập nhật phân công Checklist.'); e.statusCode=403; e.code='CHECKLIST_ASSIGNMENT_ADMIN_REQUIRED'; throw e; }
  const rowList=Array.isArray(rows)?rows:[];
  if(!rowList.length) return {saved:0,changed:0,assignments:[]};
  const keys=rowList.map(employeeKey).filter(Boolean);
  const orgMap=await loadOrgProjection();
  const currentByKey=new Map();
  if(keys.length){
    const {data:currentRows,error:currentError}=await supabase.from(CURRENT_TABLE).select('employee_key,department,title,position,branch,manager_code,manager_name').in('employee_key',keys);
    if(currentError) throw currentError;
    (currentRows||[]).forEach(r=>currentByKey.set(r.employee_key,r));
  }
  const normalized=rowList.map(row=>normalize(row,orgMap,currentByKey));
  const actorId=text(session.account?.id || session.sub),actorName=text(session.account?.name || session.account?.email || session.email);
  const {data:result,error:saveError}=await supabase.rpc('phf_save_checklist_assignments',{p_rows:normalized,p_actor_id:actorId,p_actor_name:actorName});
  if(saveError){
    console.error('[PHF Checklist] phf_save_checklist_assignments failed',{code:saveError.code||'',message:saveError.message||'',details:saveError.details||'',hint:saveError.hint||''});
    if(/CHECKLIST_ASSIGNMENT_STALE/i.test(String(saveError.message||''))){const e=new Error('Dữ liệu phân công đã được cập nhật ở tab hoặc máy khác. Vui lòng tải lại trước khi lưu tiếp.');e.statusCode=409;e.code='CHECKLIST_ASSIGNMENT_STALE';throw e;}
    if(schemaMissing(saveError) || /phf_save_checklist_assignments|column .* does not exist|record .* has no field|function .* does not exist/i.test([saveError.message,saveError.details,saveError.hint].filter(Boolean).join(' '))){ const e=new Error('Database phân công Checklist chưa đồng bộ cấu trúc Production 1.33.1. Vui lòng chạy SQL sửa cấu trúc đi kèm gói 1.34.38.'); e.statusCode=503; e.code='CHECKLIST_ASSIGNMENT_SCHEMA_MISSING'; throw e; }
    const e=new Error('Database từ chối lưu phân công Checklist. Mã lỗi: '+text(saveError.code||'UNKNOWN')+'.');e.statusCode=500;e.code='CHECKLIST_ASSIGNMENT_DATABASE_ERROR';throw e;
  }
  const savedKeys=normalized.map(x=>x.employee_key);
  const {data:saved,error:readError}=await supabase.from(CURRENT_TABLE).select('*').in('employee_key',savedKeys);
  if(readError) throw readError;
  return {saved:Number(result&&result.saved)||normalized.length,changed:Number(result&&result.changed)||0,assignments:(saved||[]).map(publicRow)};
}

module.exports={listChecklistAssignments,saveChecklistAssignments};
