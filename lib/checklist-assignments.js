'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const hasEnv = Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SECRET_KEY || '').trim());
const supabase = hasEnv ? createClient(String(process.env.SUPABASE_URL).trim(), String(process.env.SUPABASE_SECRET_KEY).trim(), {auth:{persistSession:false,autoRefreshToken:false}}) : null;
const CURRENT_TABLE = 'checklist_employee_assignments';
const HISTORY_TABLE = 'checklist_employee_assignment_history';

function text(v){ return String(v == null ? '' : v).trim(); }
function employeeKey(row){ return text(row.employeeKey || row.employee_key || row.employeeCode || row.employee_code || row.employeeId || row.employee_id).toLowerCase(); }
function cleanDate(v){ const s=text(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0,10); }
function normalize(row){
  const key=employeeKey(row);
  if(!key) { const e=new Error('Thiếu khóa nhân sự khi lưu phân công Checklist.'); e.statusCode=400; e.code='CHECKLIST_EMPLOYEE_KEY_REQUIRED'; throw e; }
  return {
    employee_key:key,
    employee_id:text(row.employeeId || row.employee_id),
    employee_code:text(row.employeeCode || row.employee_code),
    employee_name:text(row.employeeName || row.employee_name),
    department:text(row.department),
    title:text(row.title),
    branch:text(row.branch),
    manager_id:text(row.managerId || row.manager_id),
    manager_code:text(row.managerCode || row.manager_code),
    manager_name:text(row.managerName || row.manager_name),
    employee_status:text(row.employeeStatus || row.employee_status) || 'Đang làm việc',
    leave_until:text(row.leaveUntil || row.leave_until) || null,
    status_note:text(row.statusNote || row.status_note),
    template_id:text(row.templateId || row.template_id),
    template_version:text(row.templateVersion || row.template_version),
    effective_date:cleanDate(row.effectiveDate || row.effective_date),
    reason:text(row.reason) || 'Đồng bộ cấu hình Checklist',
    updated_at:new Date().toISOString()
  };
}
function publicRow(r){
  return {
    employeeKey:r.employee_key||'', employeeId:r.employee_id||'', employeeCode:r.employee_code||'', employeeName:r.employee_name||'',
    department:r.department||'', title:r.title||'', branch:r.branch||'', managerId:r.manager_id||'', managerCode:r.manager_code||'', managerName:r.manager_name||'',
    employeeStatus:r.employee_status||'Đang làm việc', leaveUntil:r.leave_until||'', statusNote:r.status_note||'', templateId:r.template_id||'', templateVersion:r.template_version||'', effectiveDate:r.effective_date||'', reason:r.reason||'', updatedAt:r.updated_at||''
  };
}
function comparable(r){ return JSON.stringify([r.employee_id,r.employee_code,r.employee_name,r.department,r.title,r.branch,r.manager_id,r.manager_code,r.manager_name,r.employee_status,r.leave_until,r.status_note,r.template_id,r.template_version,r.effective_date]); }
function schemaMissing(error){ return error && (error.code==='42P01' || /does not exist|schema cache/i.test(String(error.message||''))); }
async function listChecklistAssignments(){
  if(!supabase) return {assignments:[],ready:false,error:'SUPABASE_NOT_CONFIGURED'};
  const {data,error}=await supabase.from(CURRENT_TABLE).select('*').order('employee_name',{ascending:true});
  if(error){
    if(schemaMissing(error)) return {assignments:[],ready:false,error:'CHECKLIST_ASSIGNMENT_SCHEMA_MISSING'};
    throw error;
  }
  return {assignments:(data||[]).map(publicRow),ready:true,error:''};
}
async function saveChecklistAssignments(session, rows){
  if(!supabase){ const e=new Error('Supabase chưa được cấu hình.'); e.statusCode=503; e.code='SUPABASE_NOT_CONFIGURED'; throw e; }
  if(!session || session.role!=='admin'){ const e=new Error('Chỉ Admin được cập nhật phân công Checklist.'); e.statusCode=403; e.code='CHECKLIST_ASSIGNMENT_ADMIN_REQUIRED'; throw e; }
  const normalized=(Array.isArray(rows)?rows:[]).map(normalize);
  if(!normalized.length) return {saved:0,changed:0,assignments:[]};
  const actorId=text(session.account?.id || session.sub),actorName=text(session.account?.name || session.account?.email || session.email);
  const {data:result,error:saveError}=await supabase.rpc('phf_save_checklist_assignments',{p_rows:normalized,p_actor_id:actorId,p_actor_name:actorName});
  if(saveError){
    if(schemaMissing(saveError) || /phf_save_checklist_assignments/i.test(String(saveError.message||''))){ const e=new Error('Chưa cài cấu trúc database phân công Checklist 1.7.77.'); e.statusCode=503; e.code='CHECKLIST_ASSIGNMENT_SCHEMA_MISSING'; throw e; }
    throw saveError;
  }
  const keys=normalized.map(x=>x.employee_key);
  const {data:saved,error:readError}=await supabase.from(CURRENT_TABLE).select('*').in('employee_key',keys);
  if(readError) throw readError;
  return {saved:Number(result&&result.saved)||normalized.length,changed:Number(result&&result.changed)||0,assignments:(saved||[]).map(publicRow)};
}

module.exports={listChecklistAssignments,saveChecklistAssignments};
