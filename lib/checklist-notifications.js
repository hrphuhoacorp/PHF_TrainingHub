'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const configured=Boolean(String(process.env.SUPABASE_URL||'').trim()&&String(process.env.SUPABASE_SECRET_KEY||'').trim());
const supabase=configured?createClient(String(process.env.SUPABASE_URL).trim(),String(process.env.SUPABASE_SECRET_KEY).trim(),{auth:{persistSession:false,autoRefreshToken:false}}):null;
const RULES='checklist_notification_rules';
const NOTIFICATIONS='checklist_notifications';
const EVENTS=new Set(['VIOLATION_CREATED','EXPLANATION_SUBMITTED','VIOLATION_DUE_SOON','MONTHLY_OPENED','SELF_REVIEW_DUE','SELF_REVIEW_SUBMITTED','REVIEW_DUE','MONTHLY_LOCK_EXCEPTION','REPEAT_VIOLATION','PERMISSION_CHANGED']);
const RECIPIENTS=new Set(['Nhân viên liên quan','Người ghi nhận lỗi','Quản lý trực tiếp','Người được phân quyền thẩm định','Admin Checklist','Người có quyền được thay đổi']);
const PRIORITIES=new Set(['Trung bình','Cao','Khẩn']);
const MANDATORY=new Set(['MONTHLY_LOCK_EXCEPTION','PERMISSION_CHANGED']);

function text(value){return String(value==null?'':value).trim();}
function fail(message,statusCode=400,code='CHECKLIST_NOTIFICATION_INVALID'){const error=new Error(message);error.statusCode=statusCode;error.code=code;throw error;}
function ensureDb(){if(!supabase)fail('Supabase chưa được cấu hình cho thông báo Checklist.',503,'SUPABASE_NOT_CONFIGURED');}
function actor(session){return {id:text(session?.account?.id||session?.sub),employeeCode:text(session?.employeeCode||session?.account?.employeeCode).toUpperCase(),name:text(session?.account?.name||session?.account?.email||session?.email),role:text(session?.role).toLowerCase()};}
function requireAdmin(session){if(actor(session).role!=='admin')fail('Chỉ Admin Checklist được cấu hình thông báo.',403,'CHECKLIST_NOTIFICATION_ADMIN_ONLY');}
function normalizeRule(input={}){
  const eventCode=text(input.eventCode||input.event_code).toUpperCase();
  if(!EVENTS.has(eventCode))fail('Sự kiện thông báo không hợp lệ.',400,'CHECKLIST_NOTIFICATION_EVENT_INVALID');
  const recipient=text(input.recipient);
  if(!RECIPIENTS.has(recipient))fail('Người nhận thông báo không hợp lệ.',400,'CHECKLIST_NOTIFICATION_RECIPIENT_INVALID');
  const priority=text(input.priority)||'Trung bình';
  if(!PRIORITIES.has(priority))fail('Mức độ thông báo không hợp lệ.',400,'CHECKLIST_NOTIFICATION_PRIORITY_INVALID');
  const stopCondition=text(input.stopCondition||input.stop_condition);
  if(stopCondition.length<3)fail('Điều kiện ngừng nhắc chưa rõ.',400,'CHECKLIST_NOTIFICATION_STOP_REQUIRED');
  const template=text(input.template);
  if(template.length<5||template.length>1000)fail('Nội dung thông báo phải từ 5 đến 1.000 ký tự.',400,'CHECKLIST_NOTIFICATION_TEMPLATE_INVALID');
  return {
    event_code:eventCode,
    recipient,
    timing:text(input.timing)||'Gửi ngay',
    repeat_rule:text(input.repeatRule||input.repeat_rule)||'Không nhắc lại',
    stop_condition:stopCondition,
    priority,
    template,
    is_active:MANDATORY.has(eventCode)?true:input.isActive!==false&&input.is_active!==false,
    is_mandatory:MANDATORY.has(eventCode)
  };
}
function publicRule(row={}){return {id:row.id||'',eventCode:row.event_code||'',recipient:row.recipient||'',timing:row.timing||'',repeatRule:row.repeat_rule||'',stopCondition:row.stop_condition||'',priority:row.priority||'',template:row.template||'',isActive:row.is_active===true,isMandatory:row.is_mandatory===true,updatedAt:row.updated_at||'',updatedByName:row.updated_by_name||''};}
function publicNotification(row={}){return {id:row.id||'',eventCode:row.event_code||'',title:row.title||'',message:row.message||'',priority:row.priority||'Trung bình',targetPath:row.target_path||'',subjectType:row.subject_type||'',subjectId:row.subject_id||'',createdAt:row.created_at||'',readAt:row.read_at||'',status:row.read_at?'read':'new'};}

async function listChecklistNotificationRules(session){
  requireAdmin(session);ensureDb();
  const {data,error}=await supabase.from(RULES).select('*').order('is_mandatory',{ascending:false}).order('event_code',{ascending:true});
  if(error)throw error;
  return {rules:(data||[]).map(publicRule)};
}
async function saveChecklistNotificationRule(session,input={}){
  requireAdmin(session);ensureDb();
  const rule=normalizeRule(input.rule||input),a=actor(session),now=new Date().toISOString();
  const {data:before,error:readError}=await supabase.from(RULES).select('*').eq('event_code',rule.event_code).maybeSingle();
  if(readError)throw readError;
  if(before?.is_mandatory&&before.event_code!==rule.event_code)fail('Không được đổi loại sự kiện bắt buộc.',409,'CHECKLIST_NOTIFICATION_MANDATORY_EVENT_LOCKED');
  const payload={...rule,updated_at:now,updated_by:a.id||null,updated_by_name:a.name||null};
  const write=before?.id
    ? await supabase.from(RULES).update(payload).eq('id',before.id).select('*').single()
    : await supabase.from(RULES).insert({...payload,created_by:a.id||null,created_by_name:a.name||null}).select('*').single();
  if(write.error)throw write.error;
  return {rule:publicRule(write.data)};
}
async function listMyChecklistNotifications(session,{limit=50}={}){
  ensureDb();const a=actor(session);
  if(!a.id&&!a.employeeCode)fail('Tài khoản chưa liên kết định danh Checklist.',409,'CHECKLIST_IDENTITY_NOT_LINKED');
  const filters=[];if(a.id)filters.push('recipient_account_id.eq.'+a.id);if(a.employeeCode)filters.push('recipient_employee_code.eq.'+a.employeeCode);
  const {data,error}=await supabase.from(NOTIFICATIONS).select('*').or(filters.join(',')).order('created_at',{ascending:false}).limit(Math.min(100,Math.max(1,Number(limit)||50)));
  if(error)throw error;
  const rows=(data||[]).map(publicNotification);
  return {notifications:rows,unreadCount:rows.filter(row=>!row.readAt).length};
}
async function markChecklistNotificationRead(session,input={}){
  ensureDb();const a=actor(session),ids=[...new Set((Array.isArray(input.ids)?input.ids:[input.id]).map(text).filter(Boolean))].slice(0,100);
  if(!ids.length)fail('Chưa chọn thông báo cần đánh dấu.',400,'CHECKLIST_NOTIFICATION_ID_REQUIRED');
  let query=supabase.from(NOTIFICATIONS).update({read_at:new Date().toISOString()}).in('id',ids);
  if(a.id&&a.employeeCode)query=query.or('recipient_account_id.eq.'+a.id+',recipient_employee_code.eq.'+a.employeeCode);
  else if(a.id)query=query.eq('recipient_account_id',a.id);
  else query=query.eq('recipient_employee_code',a.employeeCode);
  const {error}=await query;if(error)throw error;
  return {marked:ids.length};
}
async function markAllChecklistNotificationsRead(session){
  ensureDb();const a=actor(session);let query=supabase.from(NOTIFICATIONS).update({read_at:new Date().toISOString()}).is('read_at',null);
  if(a.id&&a.employeeCode)query=query.or('recipient_account_id.eq.'+a.id+',recipient_employee_code.eq.'+a.employeeCode);
  else if(a.id)query=query.eq('recipient_account_id',a.id);
  else query=query.eq('recipient_employee_code',a.employeeCode);
  const {error}=await query;if(error)throw error;return {marked:true};
}
async function emitChecklistNotification(eventCode,input={}){
  ensureDb();eventCode=text(eventCode).toUpperCase();if(!EVENTS.has(eventCode))return {created:0,skipped:'event'};
  const {data:rule,error:ruleError}=await supabase.from(RULES).select('*').eq('event_code',eventCode).eq('is_active',true).maybeSingle();
  if(ruleError)throw ruleError;if(!rule)return {created:0,skipped:'inactive'};
  const recipients=Array.isArray(input.recipients)?input.recipients:[input.recipient||{}],now=new Date().toISOString(),rows=[];
  const replacements=input.variables&&typeof input.variables==='object'?input.variables:{};
  const render=value=>Object.entries(replacements).reduce((result,[key,replacement])=>result.split('{'+key+'}').join(text(replacement)),text(value));
  for(const recipient of recipients){
    const accountId=text(recipient.accountId||recipient.account_id),employeeCode=text(recipient.employeeCode||recipient.employee_code).toUpperCase();
    if(!accountId&&!employeeCode)continue;
    const dedupeKey=text(input.dedupeKey||input.dedupe_key)+'|'+eventCode+'|'+(accountId||employeeCode);
    rows.push({event_code:eventCode,recipient_account_id:accountId||null,recipient_employee_code:employeeCode||null,title:text(input.title)||eventCode,message:render(input.message||rule.template),priority:rule.priority,target_path:text(input.targetPath||input.target_path)||null,subject_type:text(input.subjectType||input.subject_type)||null,subject_id:text(input.subjectId||input.subject_id)||null,dedupe_key:dedupeKey.length>2?dedupeKey:null,created_at:now});
  }
  if(!rows.length)return {created:0,skipped:'recipient'};
  const {data,error}=await supabase.from(NOTIFICATIONS).upsert(rows,{onConflict:'dedupe_key',ignoreDuplicates:true}).select('id');
  if(error)throw error;return {created:(data||[]).length};
}

module.exports={listChecklistNotificationRules,saveChecklistNotificationRule,listMyChecklistNotifications,markChecklistNotificationRead,markAllChecklistNotificationsRead,emitChecklistNotification};
