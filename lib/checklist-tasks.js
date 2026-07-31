'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const okEnv=Boolean(String(process.env.SUPABASE_URL||'').trim()&&String(process.env.SUPABASE_SECRET_KEY||'').trim());
const supabase=okEnv?createClient(String(process.env.SUPABASE_URL).trim(),String(process.env.SUPABASE_SECRET_KEY).trim(),{auth:{persistSession:false,autoRefreshToken:false}}):null;
const TABLE='checklist_violation_tasks';
const OPERATION_SETTING_KEY='monthly_self_overdue_policy';
function t(v){return String(v==null?'':v).trim();}
function boundedDays(value,fallback=3){const n=Number(value);return Number.isFinite(n)?Math.max(1,Math.min(30,Math.round(n))):fallback;}
async function operationTimingPolicy(options={}){
  const required=options.required===true;
  const unavailable=(cause)=>{
    if(required)fail('Không đọc được cấu hình thời hạn xử lý. Hệ thống đã dừng thao tác để tránh áp dụng chính sách mặc định sai.',503,'CHECKLIST_OPERATION_POLICY_UNAVAILABLE');
    return {ready:false,error:t(cause&&cause.message||cause)||'CHECKLIST_OPERATION_POLICY_UNAVAILABLE'};
  };
  try{
    const {data,error}=await supabase.from('checklist_system_settings').select('setting_value').eq('setting_key',OPERATION_SETTING_KEY).maybeSingle();
    if(error||!data)return unavailable(error);
    const raw=JSON.parse(t(data.setting_value)||'{}');
    const employeeResponseDays=Number(raw.employeeResponseDays),reviewerResponseDays=Number(raw.reviewerResponseDays),monthlyCutoffDay=Number(raw.monthlyCutoffDay);
    if(!Number.isFinite(employeeResponseDays)||employeeResponseDays<1||employeeResponseDays>30||!Number.isFinite(reviewerResponseDays)||reviewerResponseDays<1||reviewerResponseDays>30||!Number.isFinite(monthlyCutoffDay)||monthlyCutoffDay<1||monthlyCutoffDay>28||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t(raw.monthlyCutoffTime))||!/^\d{4}-(0[1-9]|1[0-2])$/.test(t(raw.effectiveFromPeriod)))return unavailable('CHECKLIST_OPERATION_POLICY_INVALID');
    return {ready:true,error:'',employeeResponseDays:boundedDays(employeeResponseDays),reviewerResponseDays:boundedDays(reviewerResponseDays),monthlyCutoffDay:Math.round(monthlyCutoffDay),monthlyCutoffTime:t(raw.monthlyCutoffTime),adminAfterLock:raw.adminAfterLock==='disabled'?'disabled':'controlled',effectiveFromPeriod:t(raw.effectiveFromPeriod)};
  }catch(error){return unavailable(error);}
}
function actor(session){return {id:t(session?.account?.id||session?.sub),employeeId:t(session?.employeeId||session?.account?.employeeId),employeeCode:t(session?.employeeCode||session?.account?.employeeCode).toUpperCase(),role:t(session?.role).toLowerCase()};}
function fail(message,statusCode,code){const e=new Error(message);e.statusCode=statusCode;e.code=code;throw e;}
function taskSummary(rows){
  const now=Date.now(),soon=now+24*60*60*1000,summary={total:rows.length,waitingEmployee:0,waitingReviewer:0,waitingAdmin:0,due:0,overdue:0,completed:0};
  rows.forEach(row=>{if(row.status==='waiting_employee'||row.status==='waiting_employee_result')summary.waitingEmployee++;if(row.status==='waiting_reviewer')summary.waitingReviewer++;if(row.status==='waiting_admin')summary.waitingAdmin++;if(row.status==='completed'||row.status==='cancelled')summary.completed++;const due=Date.parse(row.due_at||'');if(!Number.isNaN(due)&&row.status!=='completed'&&row.status!=='cancelled'){if(due<now)summary.overdue++;else if(due<=soon)summary.due++;}});
  return summary;
}
function sameActor(row,a){
  const ids=[a.id,a.employeeId].filter(Boolean),code=t(a.employeeCode).toUpperCase();
  return ids.includes(t(row.current_assignee_id))||(code&&t(row.current_assignee_code).toUpperCase()===code);
}
function isSubject(row,a){return (a.employeeId&&t(row.employee_id)===a.employeeId)||(a.employeeCode&&t(row.employee_code).toUpperCase()===a.employeeCode);}
function isCreator(row,a){return Boolean(a.id&&t(row.created_by)===a.id);}
function publicTask(row){return row;}
function scopeSummary(rows,a){
  return {
    mine:rows.filter(row=>sameActor(row,a)).length,
    created:rows.filter(row=>t(row.created_by)===a.id).length,
    collaborating:rows.filter(row=>row.current_assignee_type==='collaborator').length,
    done:rows.filter(row=>row.status==='completed'||row.status==='cancelled').length,
    all:rows.length
  };
}
async function listChecklistTasks(session,input={}){
  if(!supabase)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
  const a=actor(session),scope=t(input.scope)||'mine',status=t(input.status)||'all';
  let q=supabase.from(TABLE).select('id,violation_id,employee_id,employee_code,employee_name,created_by,created_by_name,current_assignee_id,current_assignee_code,current_assignee_type,status,priority,due_at,completed_at,created_at,updated_at,violation:checklist_violation_records(id,criterion_code,criterion_name,criterion_group,points,occurred_date,occurred_time,location,note,record_status,is_test)').order('due_at',{ascending:true}).limit(500);
  if(a.role==='learner'){
    const filters=[];if(a.employeeId)filters.push('employee_id.eq.'+a.employeeId);if(a.employeeCode)filters.push('employee_code.eq.'+a.employeeCode);if(!filters.length)fail('Tài khoản chưa có mã nhân viên để đọc công việc.',403,'CHECKLIST_TASK_IDENTITY_REQUIRED');q=q.or(filters.join(','));
  }
  const {data,error}=await q;if(error)throw error;const rawRows=Array.isArray(data)?data:[],allRows=a.role==='admin'?rawRows:rawRows.filter(row=>isSubject(row,a)||isCreator(row,a)||sameActor(row,a));let rows=allRows.slice();
  if(scope==='mine')rows=rows.filter(row=>sameActor(row,a));
  if(scope==='created')rows=rows.filter(row=>t(row.created_by)===a.id);
  if(scope==='collaborating')rows=rows.filter(row=>row.current_assignee_type==='collaborator');
  if(scope==='done')rows=rows.filter(row=>row.status==='completed'||row.status==='cancelled');
  if(status==='employee')rows=rows.filter(row=>row.status==='waiting_employee'||row.status==='waiting_employee_result');
  if(status==='reviewer')rows=rows.filter(row=>row.status==='waiting_reviewer');
  if(status==='admin')rows=rows.filter(row=>row.status==='waiting_admin');
  const now=Date.now(),soon=now+24*60*60*1000;
  if(status==='due')rows=rows.filter(r=>{const d=Date.parse(r.due_at||'');return !Number.isNaN(d)&&d>=now&&d<=soon&&!['completed','cancelled'].includes(r.status);});
  if(status==='overdue')rows=rows.filter(r=>{const d=Date.parse(r.due_at||'');return !Number.isNaN(d)&&d<now&&!['completed','cancelled'].includes(r.status);});
  return {tasks:rows,summary:taskSummary(allRows),scopeSummary:scopeSummary(allRows,a),filteredSummary:taskSummary(rows),timingPolicy:await operationTimingPolicy()};
}
async function getTask(id){
  const {data,error}=await supabase.from(TABLE).select('*,violation:checklist_violation_records(*)').eq('id',t(id)).maybeSingle();
  if(error)throw error;if(!data)fail('Công việc không còn tồn tại.',404,'CHECKLIST_TASK_NOT_FOUND');return data;
}
async function taskHistory(taskId){
  const {data,error}=await supabase.from('checklist_violation_task_history').select('*').eq('task_id',taskId).order('created_at',{ascending:true}).limit(200);
  if(error)throw error;return data||[];
}
async function transitionChecklistTask(session,input={}){
  if(!supabase)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');
  const a=actor(session),id=t(input.id),action=t(input.taskAction),note=t(input.note);
  if(!id)fail('Thiếu công việc cần xử lý.',400,'CHECKLIST_TASK_ID_REQUIRED');
  const allowed=new Set(['employee_confirm','employee_explain','employee_accept_result','employee_escalate','reviewer_accept','reviewer_uphold','admin_uphold','admin_cancel']);
  if(!allowed.has(action))fail('Thao tác xử lý không hợp lệ.',400,'CHECKLIST_TASK_ACTION_INVALID');
  const before=await getTask(id),timing=await operationTimingPolicy({required:true});
  if(['completed','cancelled'].includes(before.status))fail('Công việc đã có kết luận cuối.',409,'CHECKLIST_TASK_ALREADY_CLOSED');
  if(action==='employee_confirm'&&(before.status!=='waiting_employee'||!isSubject(before,a)))fail('Chỉ nhân viên liên quan được xác nhận lỗi này.',403,'CHECKLIST_TASK_EMPLOYEE_ONLY');
  if(action==='employee_explain'){
    if(before.status!=='waiting_employee'||!isSubject(before,a))fail('Chỉ nhân viên liên quan được gửi giải trình.',403,'CHECKLIST_TASK_EMPLOYEE_ONLY');
    if(note.length<10)fail('Nội dung giải trình cần tối thiểu 10 ký tự.',400,'CHECKLIST_TASK_NOTE_REQUIRED');
  }
  if(action==='employee_accept_result'&&(before.status!=='waiting_employee_result'||!isSubject(before,a)))fail('Chỉ nhân viên liên quan được xác nhận kết luận.',403,'CHECKLIST_TASK_EMPLOYEE_ONLY');
  if(action==='employee_escalate'){
    const overdue=before.status==='waiting_reviewer'&&Date.parse(before.due_at||'')<Date.now();
    const afterResult=before.status==='waiting_employee_result';
    if(!isSubject(before,a)||(!overdue&&!afterResult))fail('Chỉ được báo Admin khi người ghi đã quá hạn phản hồi hoặc sau khi giữ nguyên lỗi.',403,'CHECKLIST_TASK_ESCALATE_NOT_ALLOWED');
  }
  if(['reviewer_accept','reviewer_uphold'].includes(action)){
    if(before.status!=='waiting_reviewer'||(!isCreator(before,a)&&a.role!=='admin'))fail('Chỉ người ghi lỗi hoặc Admin được phản hồi giải trình.',403,'CHECKLIST_TASK_REVIEWER_ONLY');
    if(note.length<5)fail('Vui lòng ghi rõ lý do phản hồi.',400,'CHECKLIST_TASK_NOTE_REQUIRED');
  }
  if(['admin_uphold','admin_cancel'].includes(action)){
    if(a.role!=='admin'||before.status!=='waiting_admin')fail('Chỉ Admin được kết luận trường hợp đã báo Admin.',403,'CHECKLIST_TASK_ADMIN_ONLY');
    if(note.length<10)fail('Lý do kết luận của Admin cần tối thiểu 10 ký tự.',400,'CHECKLIST_TASK_NOTE_REQUIRED');
  }
  const result=await supabase.rpc('phf_transition_checklist_task',{
    p_task_id:id,p_action:action,p_note:note,p_actor_id:a.id||'',p_actor_employee_id:a.employeeId||'',p_actor_code:a.employeeCode||'',p_actor_name:t(session?.account?.name||session?.account?.email||session?.email),p_actor_role:a.role||'',p_reviewer_days:timing.reviewerResponseDays,p_expected_updated_at:before.updated_at
  });
  if(result.error){
    const message=String(result.error.message||'');
    if(/CHECKLIST_PERIOD_FINALIZED/i.test(message))fail('Kỳ đánh giá của lỗi này đã thẩm định hoặc khóa. Hãy mở ngoại lệ trước khi thay đổi lỗi.',409,'CHECKLIST_PERIOD_FINALIZED');
    if(/CHECKLIST_TASK_STALE|CHECKLIST_TASK_STATUS_CHANGED/i.test(message))fail('Công việc đã được xử lý ở tab hoặc máy khác. Vui lòng tải lại.',409,'CHECKLIST_TASK_STALE');
    if(/phf_transition_checklist_task/i.test(message)){fail('Chưa chạy SQL ổn định Production cho luồng xử lý lỗi.',503,'CHECKLIST_TASK_STABILITY_SQL_MISSING');}
    throw result.error;
  }
  const outcome=result.data||{};if(outcome.ok!==true)fail(t(outcome.message)||'Không thể cập nhật công việc.',409,t(outcome.code)||'CHECKLIST_TASK_TRANSITION_BLOCKED');
  const after=await getTask(id);
  return {task:publicTask(after),history:await taskHistory(id)};
}
async function getChecklistTaskHistory(session,input={}){
  if(!supabase)fail('Supabase chưa được cấu hình.',503,'SUPABASE_NOT_CONFIGURED');const a=actor(session),task=await getTask(input.id);
  if(a.role!=='admin'&&!isSubject(task,a)&&!isCreator(task,a)&&!sameActor(task,a))fail('Bạn không có quyền xem lịch sử công việc này.',403,'CHECKLIST_TASK_HISTORY_FORBIDDEN');
  return {task:publicTask(task),history:await taskHistory(task.id)};
}
module.exports={listChecklistTasks,transitionChecklistTask,getChecklistTaskHistory};
