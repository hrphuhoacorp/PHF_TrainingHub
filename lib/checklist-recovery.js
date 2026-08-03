'use strict';

require('dotenv').config();
const {createClient}=require('@supabase/supabase-js');
const {buildMonthlyCreationState}=require('./checklist-monthly');

const ready=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY);
const db=ready?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const MARKETING_TEMPLATES=new Set(['tbp-marketing','nv-marketing']);

function text(value){return String(value==null?'':value).trim();}
function fail(message,status=400,code='CHECKLIST_RECOVERY_INVALID'){const error=new Error(message);error.status=status;error.code=code;throw error;}
function requireAdmin(session){if(!session||session.role!=='admin')fail('Chỉ Admin hệ thống được sử dụng Trung tâm xử lý phiếu.',403,'CHECKLIST_RECOVERY_ADMIN_ONLY');}
function actor(session){return {id:text(session&&session.account&&session.account.id||session&&session.sub),code:text(session&&session.employeeCode||session&&session.account&&session.account.employeeCode).toUpperCase(),name:text(session&&session.account&&session.account.name||session&&session.account&&session.account.email)};}
function validMonth(value){const result=text(value);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(result))fail('Kỳ đánh giá không hợp lệ.',400,'CHECKLIST_RECOVERY_PERIOD_INVALID');return result;}
function assignmentKey(row){return text(row&&row.employee_code).toUpperCase()||text(row&&row.employee_id);}
function formKey(row){return text(row&&row.employee_code).toUpperCase()||text(row&&row.employee_id);}
function templateDefinition(snapshot){const definition=snapshot&&snapshot.version&&snapshot.version.definition;return definition&&typeof definition==='object'&&!Array.isArray(definition)?definition:{};}
function publicCandidate(row,category,details={}){
 return {
  category,
  employeeId:text(row.employee_id),employeeCode:text(row.employee_code).toUpperCase(),employeeName:text(row.employee_name),
  department:text(row.department),title:text(row.title),branch:text(row.branch),
  templateId:text(row.template_id),templateVersion:text(row.template_version),
  reviewerId:text(row.reviewer_id),reviewerCode:text(row.reviewer_code).toUpperCase(),reviewerName:text(row.reviewer_name),
  ...details
 };
}

async function inspectMonthlyRecovery(session,input={}){
 requireAdmin(session);if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
 const periodMonth=validMonth(input.month||input.period),prepared=await buildMonthlyCreationState(periodMonth);
 const [periodRead,formsRead]=await Promise.all([
  db.from('checklist_monthly_periods').select('*').eq('period_month',periodMonth).maybeSingle(),
  db.from('checklist_monthly_forms').select('id,period_id,period_month,employee_id,employee_code,employee_name,department,title,branch,reviewer_id,reviewer_code,reviewer_name,template_id,template_version,status,score_formula_version,created_at,updated_at').eq('period_month',periodMonth).limit(2000)
 ]);
 if(periodRead.error)throw periodRead.error;if(formsRead.error)throw formsRead.error;
 const period=periodRead.data||null,forms=formsRead.data||[],formsByKey=new Map(forms.map(row=>[formKey(row),row])),rowsByKey=new Map(prepared.rows.map(row=>[formKey(row),row]));
 const activeAssignments=(prepared.assignmentState.snapshots||[]).filter(row=>text(row.employee_status)==='Đang làm việc');
 const existing=forms.map(form=>{
  const assignment=activeAssignments.find(row=>assignmentKey(row)===formKey(form));
  return publicCandidate(form,'existing',{formId:form.id,status:form.status,updatedAt:form.updated_at||'',sourceIssue:assignment?'':'missing_assignment'});
 });
 const missingAssignment=[];
 activeAssignments.filter(row=>!text(row.template_id)).forEach(row=>missingAssignment.push(publicCandidate(row,'missing_assignment',{reasonCode:'ASSIGNMENT_TEMPLATE_REQUIRED'})));
 forms.filter(form=>!activeAssignments.some(row=>assignmentKey(row)===formKey(form))).forEach(form=>missingAssignment.push(publicCandidate(form,'missing_assignment',{formId:form.id,status:form.status,reasonCode:'ASSIGNMENT_AS_OF_PERIOD_NOT_FOUND'})));
 const missingTemplateVersion=[],missingReviewer=[],unknownSnapshot=[],readyToCreate=[];
 activeAssignments.filter(row=>text(row.template_id)&&!formsByKey.has(assignmentKey(row))).forEach(assignment=>{
  const key=assignmentKey(assignment),row=rowsByKey.get(key),missing=prepared.missing.find(item=>text(item.employeeCode).toUpperCase()===key);
  if(!row||missing){missingTemplateVersion.push(publicCandidate(row||assignment,'missing_template_version',{reasonCode:'TEMPLATE_VERSION_NOT_EFFECTIVE',requestedVersion:text(missing&&missing.templateVersion||assignment.template_version)}));return;}
  if(!text(row.reviewer_id)&&!text(row.reviewer_code)){missingReviewer.push(publicCandidate(row,'missing_reviewer',{reasonCode:'REVIEWER_REQUIRED'}));return;}
  if(MARKETING_TEMPLATES.has(text(row.template_id).toLowerCase())&&!Object.keys(templateDefinition(row.template_snapshot)).length){unknownSnapshot.push(publicCandidate(row,'snapshot_undetermined',{reasonCode:'MARKETING_MONTHLY_SNAPSHOT_UNDETERMINED'}));return;}
  readyToCreate.push(publicCandidate(row,'ready_to_create',{checklistScore:Number(row.checklist_score||0),formulaVersion:text(row.score_formula_version)}));
 });
 const locked=period&&period.status==='locked';
 return {
  period:{month:periodMonth,id:period&&period.id||'',status:period&&period.status||'not_created',locked:Boolean(locked)},
  counts:{existing:existing.length,readyToCreate:readyToCreate.length,missingAssignment:missingAssignment.length,missingTemplateVersion:missingTemplateVersion.length,missingReviewer:missingReviewer.length,unknownSnapshot:unknownSnapshot.length,blockedLocked:locked?readyToCreate.length:0},
  groups:{existing,readyToCreate,missingAssignment,missingTemplateVersion,missingReviewer,unknownSnapshot,blockedLocked:locked?readyToCreate:[]},
  canCreate:!locked&&readyToCreate.length>0,
  sourceRevision:prepared.sourceRevision,
  inspectedAt:new Date().toISOString()
 };
}

async function createMissingMonthlyForms(session,input={}){
 requireAdmin(session);if(!db)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
 const periodMonth=validMonth(input.month||input.period),reason=text(input.reason),idempotencyKey=text(input.idempotencyKey);
 if(reason.length<10)fail('Lý do đồng bộ cần tối thiểu 10 ký tự.',409,'CHECKLIST_RECOVERY_REASON_REQUIRED');
 if(idempotencyKey.length<8||idempotencyKey.length>120)fail('Mã chống gửi lặp không hợp lệ.',400,'CHECKLIST_RECOVERY_IDEMPOTENCY_REQUIRED');
 const prepared=await buildMonthlyCreationState(periodMonth),[periodRead,formsRead]=await Promise.all([
  db.from('checklist_monthly_periods').select('*').eq('period_month',periodMonth).maybeSingle(),
  db.from('checklist_monthly_forms').select('id,employee_id,employee_code,updated_at').eq('period_month',periodMonth).limit(2000)
 ]);
 if(periodRead.error)throw periodRead.error;if(formsRead.error)throw formsRead.error;
 const period=periodRead.data||null;if(period&&period.status==='locked')fail('Kỳ đã khóa; không được tạo bổ sung phiếu.',409,'CHECKLIST_RECOVERY_PERIOD_LOCKED');
 if(period&&!['draft','open'].includes(period.status))fail('Trạng thái kỳ không cho phép đồng bộ phiếu.',409,'CHECKLIST_RECOVERY_PERIOD_BLOCKED');
 const existing=formsRead.data||[],existingKeys=new Set(existing.map(formKey)),missingCodes=new Set(prepared.missing.map(item=>text(item.employeeCode).toUpperCase()));
 const rows=prepared.rows.filter(row=>{
  if(existingKeys.has(formKey(row))||missingCodes.has(formKey(row)))return false;
  if(!text(row.reviewer_id)&&!text(row.reviewer_code))return false;
  if(MARKETING_TEMPLATES.has(text(row.template_id).toLowerCase())&&!Object.keys(templateDefinition(row.template_snapshot)).length)return false;
  row.status=period&&period.status==='open'?'waiting_self':'draft';return true;
 });
 const revision={...prepared.sourceRevision,monthly_form_count:existing.length,monthly_form_max:existing.reduce((latest,row)=>text(row.updated_at)>latest?text(row.updated_at):latest,'')},a=actor(session);
 const rpc=await db.rpc('phf_recovery_create_missing_monthly_forms',{p_period_month:periodMonth,p_forms:rows,p_source_revision:revision,p_reason:reason,p_idempotency_key:idempotencyKey,p_actor_id:a.id,p_actor_code:a.code,p_actor_name:a.name});
 if(rpc.error){const message=String(rpc.error.message||'');if(/CHECKLIST_RECOVERY_SOURCE_STALE/i.test(message))fail('Nguồn phân công, mẫu, lỗi hoặc snapshot tháng vừa thay đổi. Vui lòng kiểm tra lại preview.',409,'CHECKLIST_RECOVERY_SOURCE_STALE');if(/phf_recovery_create_missing_monthly_forms|42P01|PGRST/i.test(message))fail('Chưa chạy SQL Recovery Center trên database.',503,'CHECKLIST_RECOVERY_SQL_MISSING');throw rpc.error;}
 const result=rpc.data||{};if(result.ok!==true)fail(text(result.message)||'Không thể tạo các phiếu còn thiếu.',409,text(result.code)||'CHECKLIST_RECOVERY_CREATE_BLOCKED');
 return {...result,period:periodMonth,requested:rows.length};
}

module.exports={inspectMonthlyRecovery,createMissingMonthlyForms};
