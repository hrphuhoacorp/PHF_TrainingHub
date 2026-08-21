'use strict';
require('dotenv').config();
const crypto=require('crypto');
const {createClient}=require('@supabase/supabase-js');
const supabase=(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY)?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY):null;
const text=v=>String(v==null?'':v).trim();
const userRole=s=>text(s?.role).toLowerCase();
const actor=s=>text(s?.account?.id||s?.sub||s?.employeeId||s?.email||s?.phone);
const actorEmployee=s=>text(s?.employeeId);
const id=p=>`${p}-${crypto.randomUUID()}`;
function err(message,status=400,code='CLASSROOM_NOTIFICATION_ERROR'){const e=new Error(message);e.statusCode=status;e.code=code;return e;}
function db(){if(!supabase)throw err('Supabase chưa được cấu hình.',503,'CLASSROOM_NOTIFICATION_STORAGE_NOT_CONFIGURED');return supabase;}
function schemaError(error){const raw=String(error?.message||error||'');if(/classroom_notifications|classroom_notification_recipients|relation .* does not exist|PGRST205|schema cache/i.test(raw))return err('Database chưa có cấu trúc Thông báo Classroom. Vui lòng chạy scripts/phf_supabase_classroom_1_31_notifications.sql.',503,'CLASSROOM_NOTIFICATION_SCHEMA_REQUIRED');return error;}
function mapNotice(r){return {id:r.id,title:r.title||'',content:r.content||'',level:r.level||'normal',scopeType:r.scope_type||'selected',scopeValue:r.scope_value||'',link:r.link||'',status:r.status||'draft',startAt:r.start_at||'',endAt:r.end_at||'',createdBy:r.created_by||'',createdAt:r.created_at||'',updatedAt:r.updated_at||'',sentAt:r.sent_at||'',hiddenAt:r.hidden_at||'',recipientCount:Number(r.recipient_count||0),readCount:Number(r.read_count||0),isRead:Boolean(r.is_read),readAt:r.read_at||''};}
function personKeys(session){return [text(session?.account?.id),text(session?.sub),text(session?.employeeId),text(session?.email),text(session?.phone)].filter(Boolean);}
async function listNotifications(session){
 const keys=personKeys(session),now=new Date().toISOString();
 let mine=[];
 if(keys.length){
  const rec=await db().from('classroom_notification_recipients').select('notification_id,read_at,recipient_key').in('recipient_key',keys);
  if(rec.error)throw schemaError(rec.error);
  const ids=[...new Set((rec.data||[]).map(x=>x.notification_id).filter(Boolean))];
  if(ids.length){
   const q=await db().from('classroom_notifications').select('*').is('deleted_at',null).in('id',ids).eq('status','sent').order('sent_at',{ascending:false});if(q.error)throw schemaError(q.error);
   const readMap={};(rec.data||[]).forEach(x=>{if(x.read_at)readMap[x.notification_id]=x.read_at;});
   mine=(q.data||[]).filter(x=>(!x.start_at||x.start_at<=now)&&(!x.end_at||x.end_at>=now)&&!x.hidden_at).map(x=>mapNotice({...x,is_read:!!readMap[x.id],read_at:readMap[x.id]||''}));
  }
 }
 let managed=[];
 if(['admin','manager'].includes(userRole(session))){
  const q=await db().from('classroom_notifications').select('*').order('updated_at',{ascending:false}).limit(200);if(q.error)throw schemaError(q.error);
  managed=(q.data||[]).map(mapNotice);
 }
 return {notifications:mine,managedNotifications:managed,unreadCount:mine.filter(x=>!x.isRead).length,canManage:['admin','manager'].includes(userRole(session))};
}
function normalizeRecipients(rows){const out=[],seen=new Set();(Array.isArray(rows)?rows:[]).forEach(r=>{const accountId=text(r.accountId),employeeId=text(r.employeeId),email=text(r.email).toLowerCase(),phone=text(r.phone),fallback=text(r.recipientKey||r.id);const canonical=accountId?`account:${accountId}`:employeeId?`employee:${employeeId}`:email?`email:${email}`:phone?`phone:${phone}`:fallback?`key:${fallback}`:'';if(!canonical||seen.has(canonical))return;seen.add(canonical);const recipientKey=accountId||employeeId||email||phone||fallback;out.push({recipient_key:recipientKey,employee_id:employeeId||null,account_id:accountId||null,recipient_name:text(r.name)||'',recipient_code:text(r.code)||'',recipient_department:text(r.department)||'',recipient_position:text(r.position)||'',recipient_branch:text(r.branch)||''});});return out;}
async function saveNotification(session,payload){
 if(!['admin','manager'].includes(userRole(session)))throw err('Bạn không có quyền tạo thông báo Classroom.',403);
 const action=text(payload.action),title=text(payload.title),content=text(payload.content),level=text(payload.level)||'normal',scopeType=text(payload.scopeType)||'selected';
 if(!title)throw err('Vui lòng nhập tiêu đề thông báo.');if(!content)throw err('Vui lòng nhập nội dung thông báo.');if(!['normal','important','urgent'].includes(level))throw err('Mức độ thông báo không hợp lệ.');
 const status=action==='send'?'sent':'draft',noticeId=text(payload.id)||id('notice'),stamp=new Date().toISOString(),recipients=normalizeRecipients(payload.recipients);
 if(status==='sent'&&!recipients.length)throw err('Thông báo chưa có người nhận phù hợp.');
 const row={id:noticeId,title,content,level,scope_type:scopeType,scope_value:text(payload.scopeValue),link:text(payload.link),status,start_at:text(payload.startAt)||null,end_at:text(payload.endAt)||null,created_by:actor(session),updated_at:stamp,sent_at:status==='sent'?stamp:null,recipient_count:status==='sent'?recipients.length:0};
 const q=await db().from('classroom_notifications').upsert(row,{onConflict:'id'}).select('*').single();if(q.error)throw schemaError(q.error);
 if(status==='sent'){
  const del=await db().from('classroom_notification_recipients').delete().eq('notification_id',noticeId);if(del.error)throw schemaError(del.error);
  const ins=await db().from('classroom_notification_recipients').insert(recipients.map(r=>({...r,id:id('notice-rec'),notification_id:noticeId,created_at:stamp})));if(ins.error)throw schemaError(ins.error);
 }
 return {notification:mapNotice(q.data)};
}
async function markNotificationRead(session,payload){const noticeId=text(payload.id),keys=personKeys(session);if(!noticeId||!keys.length)throw err('Không xác định được thông báo hoặc tài khoản.');const stamp=new Date().toISOString();const q=await db().from('classroom_notification_recipients').update({read_at:stamp}).eq('notification_id',noticeId).in('recipient_key',keys).select('id');if(q.error)throw schemaError(q.error);return {read:true,readAt:stamp};}
async function markAllNotificationsRead(session){const keys=personKeys(session);if(!keys.length)return {readCount:0};const stamp=new Date().toISOString();const q=await db().from('classroom_notification_recipients').update({read_at:stamp}).in('recipient_key',keys).is('read_at',null).select('id');if(q.error)throw schemaError(q.error);return {readCount:(q.data||[]).length};}
async function hideNotification(session,payload){if(userRole(session)!=='admin')throw err('Chỉ Admin được ẩn thông báo.',403);const q=await db().from('classroom_notifications').update({status:'hidden',hidden_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',text(payload.id)).select('*').single();if(q.error)throw schemaError(q.error);return {notification:mapNotice(q.data)};}
async function createSystemNotification({title,content,level='normal',link='',recipients=[]}){if(!supabase)return null;const normalized=normalizeRecipients(recipients);if(!normalized.length)return null;const stamp=new Date().toISOString(),noticeId=id('notice');const q=await supabase.from('classroom_notifications').insert({id:noticeId,title:text(title),content:text(content),level,scope_type:'system',link:text(link),status:'sent',created_by:'system',created_at:stamp,updated_at:stamp,sent_at:stamp,recipient_count:normalized.length}).select('*').single();if(q.error)throw schemaError(q.error);const ins=await supabase.from('classroom_notification_recipients').insert(normalized.map(r=>({...r,id:id('notice-rec'),notification_id:noticeId,created_at:stamp})));if(ins.error)throw schemaError(ins.error);return mapNotice(q.data);}
module.exports={listNotifications,saveNotification,markNotificationRead,markAllNotificationsRead,hideNotification,createSystemNotification};
