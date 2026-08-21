'use strict';
require('dotenv').config();
const crypto=require('crypto');
const {createClient}=require('@supabase/supabase-js');
const {createSystemNotification}=require('./classroom-notifications');
const supabase=(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY)?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY):null;
const text=v=>String(v==null?'':v).trim();
const role=s=>text(s?.role).toLowerCase();
const actor=s=>text(s?.account?.id||s?.sub||s?.employeeId||s?.email||s?.phone);
const employeeId=s=>text(s?.employeeId);
const id=p=>`${p}-${crypto.randomUUID()}`;
function err(message,status=400,code='CLASSROOM_PROPOSAL_ERROR'){const e=new Error(message);e.statusCode=status;e.code=code;return e;}
function db(){if(!supabase)throw err('Supabase chưa được cấu hình.',503,'CLASSROOM_PROPOSAL_STORAGE_NOT_CONFIGURED');return supabase;}
function schemaError(error){const raw=String(error?.message||error||'');if(/classroom_training_proposals|relation .* does not exist|PGRST205|schema cache/i.test(raw))return err('Database chưa có cấu trúc Đề xuất đào tạo. Vui lòng chạy scripts/phf_supabase_classroom_1_28_proposals.sql.',503,'CLASSROOM_PROPOSAL_SCHEMA_REQUIRED');return error;}
function map(r){return {id:r.id,title:r.title||'',reason:r.reason||'',targetAudience:r.target_audience||'',expectedOutcome:r.expected_outcome||'',priority:r.priority||'normal',targetScope:r.target_scope||'self',targetDetails:r.target_details&&typeof r.target_details==='object'?r.target_details:{},note:r.note||'',status:r.status||'draft',adminComment:r.admin_comment||'',createdBy:r.created_by||'',createdByEmployeeId:r.created_by_employee_id||'',createdAt:r.created_at||'',updatedAt:r.updated_at||'',submittedAt:r.submitted_at||'',reviewedBy:r.reviewed_by||'',reviewedAt:r.reviewed_at||'',classId:r.class_id||'',completedAt:r.completed_at||''};}
function validate(payload){
 const title=text(payload.title),reason=text(payload.reason),targetAudience=text(payload.targetAudience),expectedOutcome=text(payload.expectedOutcome),priority=text(payload.priority),targetScope=text(payload.targetScope);
 if(!title)throw err('Vui lòng nhập nội dung cần đào tạo.');
 if(!reason)throw err('Vui lòng nhập lý do đề xuất.');
 if(!targetAudience)throw err('Vui lòng nhập đối tượng cần đào tạo.');
 if(!expectedOutcome)throw err('Vui lòng nhập kết quả mong muốn.');
 if(!['low','normal','high','urgent'].includes(priority))throw err('Mức độ ưu tiên không hợp lệ.');
 if(!['self','department','people','company'].includes(targetScope))throw err('Phạm vi đề xuất không hợp lệ.');
 return {title,reason,targetAudience,expectedOutcome,priority,targetScope,note:text(payload.note),targetDetails:payload.targetDetails&&typeof payload.targetDetails==='object'?payload.targetDetails:{}};
}
async function listProposals(session){
 const q=await db().from('classroom_training_proposals').select('*').is('deleted_at',null).order('updated_at',{ascending:false});if(q.error)throw schemaError(q.error);
 let rows=(q.data||[]).map(map);const userRole=role(session);if(!['admin','manager'].includes(userRole)){const a=actor(session),e=employeeId(session);rows=rows.filter(x=>x.createdBy===a||(e&&x.createdByEmployeeId===e));}
 return {proposals:rows,canReview:userRole==='admin',canReport:['admin','manager'].includes(userRole)};
}
async function saveProposal(session,payload){
 const values=validate(payload),existingId=text(payload.id),action=text(payload.action)||'saveDraft',isAdmin=role(session)==='admin';
 let old=null;if(existingId){const q=await db().from('classroom_training_proposals').select('*').eq('id',existingId).single();if(q.error)throw schemaError(q.error);old=map(q.data);const own=old.createdBy===actor(session)||(employeeId(session)&&old.createdByEmployeeId===employeeId(session));if(!isAdmin&&!own)throw err('Bạn không có quyền chỉnh đề xuất này.',403);if(!['draft','needs_revision'].includes(old.status))throw err('Đề xuất đã gửi duyệt nên không thể chỉnh sửa.',409);}
 const stamp=new Date().toISOString(),status=action==='submit'?'pending':'draft';
 const row={id:existingId||id('proposal'),title:values.title,reason:values.reason,target_audience:values.targetAudience,expected_outcome:values.expectedOutcome,priority:values.priority,target_scope:values.targetScope,target_details:values.targetDetails,note:values.note,status,admin_comment:old?.adminComment||'',created_by:old?.createdBy||actor(session),created_by_employee_id:old?.createdByEmployeeId||employeeId(session)||null,created_at:old?.createdAt||stamp,updated_at:stamp,submitted_at:status==='pending'?stamp:(old?.submittedAt||null)};
 const q=await db().from('classroom_training_proposals').upsert(row,{onConflict:'id'}).select('*').single();if(q.error)throw schemaError(q.error);return {proposal:map(q.data)};
}
async function reviewProposal(session,payload){
 if(role(session)!=='admin')throw err('Chỉ Admin được phê duyệt đề xuất đào tạo.',403);
 const proposalId=text(payload.id),action=text(payload.action),comment=text(payload.comment),allowed={approve:'approved',requestRevision:'needs_revision',reject:'rejected',linkClass:'converted',complete:'completed'};
 if(!proposalId||!allowed[action])throw err('Thao tác phê duyệt không hợp lệ.');
 if(['requestRevision','reject'].includes(action)&&!comment)throw err('Vui lòng nhập nội dung phản hồi.');
 const stamp=new Date().toISOString(),update={status:allowed[action],admin_comment:comment,reviewed_by:actor(session),reviewed_at:stamp,updated_at:stamp};
 if(action==='linkClass'){if(!text(payload.classId))throw err('Thiếu lớp được tạo từ đề xuất.');update.class_id=text(payload.classId);}if(action==='complete')update.completed_at=stamp;
 const q=await db().from('classroom_training_proposals').update(update).eq('id',proposalId).select('*').single();if(q.error)throw schemaError(q.error);const saved=map(q.data);try{await createSystemNotification({title:action==='approve'?'Đề xuất đào tạo đã được duyệt':action==='requestRevision'?'Đề xuất cần bổ sung':action==='reject'?'Đề xuất đào tạo bị từ chối':'Đề xuất đào tạo đã cập nhật',content:comment||('Đề xuất “'+saved.title+'” đã được cập nhật trạng thái.'),level:action==='reject'?'important':'normal',link:'/hv/classroom/de-xuat',recipients:[{recipientKey:saved.createdBy,employeeId:saved.createdByEmployeeId,name:''}]});}catch(e){}return {proposal:saved};
}
module.exports={listProposals,saveProposal,reviewProposal};
