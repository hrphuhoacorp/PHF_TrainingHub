'use strict';
require('dotenv').config();
const crypto=require('crypto');
const {createClient}=require('@supabase/supabase-js');
const supabase=(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY)?createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY):null;
const BUCKET=String(process.env.PHF_CLASSROOM_STORAGE_BUCKET||'phf-classroom').trim();
const MAX_BYTES=25*1024*1024;
const ALLOWED=new Set(['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','image/jpeg','image/png','image/webp']);
const text=v=>String(v==null?'':v).trim();
const role=s=>text(s?.role).toLowerCase();
const canOperate=s=>['admin','manager'].includes(role(s));
const id=p=>`${p}-${crypto.randomUUID()}`;
const safeName=n=>text(n).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,120)||'file';
function err(message,status=400,code='CLASSROOM_MATERIAL_ERROR'){const e=new Error(message);e.statusCode=status;e.code=code;return e;}
function db(){if(!supabase)throw err('Supabase chưa được cấu hình.',503,'CLASSROOM_STORAGE_NOT_CONFIGURED');return supabase;}
async function ensureClass(session,classId){const {getClass}=require('./classroom-db');return getClass(session,text(classId));}
function mapGroup(r){return {id:r.id,classId:r.class_id,title:r.title||'',description:r.description||'',sortOrder:Number(r.sort_order||0),status:r.status||'draft',createdAt:r.created_at||'',updatedAt:r.updated_at||''};}
function mapMaterial(r){return {id:r.id,classId:r.class_id,groupId:r.group_id,title:r.title||r.original_name||'',originalName:r.original_name||'',mimeType:r.mime_type||'',sizeBytes:Number(r.size_bytes||0),storagePath:r.storage_path||'',required:r.required!==false,status:r.status||'draft',sortOrder:Number(r.sort_order||0),version:Number(r.version_no||1),createdAt:r.created_at||'',updatedAt:r.updated_at||''};}
function mapProgress(r){return {materialId:r.material_id,enrollmentId:r.enrollment_id,status:r.status||'not_started',firstOpenedAt:r.first_opened_at||'',lastOpenedAt:r.last_opened_at||'',confirmedAt:r.confirmed_at||''};}
async function getMaterials(session,classId){const cls=await ensureClass(session,classId);const client=db();const [g,m,p]=await Promise.all([
 client.from('classroom_content_groups').select('*').eq('class_id',cls.id).order('sort_order'),
 client.from('classroom_materials').select('*').eq('class_id',cls.id).is('deleted_at',null).order('sort_order'),
 client.from('classroom_material_progress').select('*').eq('class_id',cls.id)
]);
 if(g.error||m.error||p.error)throw err('Chưa có cấu trúc tài liệu Classroom. Hãy chạy SQL bản 1.18.',503,'CLASSROOM_MATERIAL_SCHEMA_REQUIRED');
 let groups=(g.data||[]).map(mapGroup),materials=(m.data||[]).map(mapMaterial),progress=(p.data||[]).map(mapProgress);
 if(role(session)==='learner'){
   groups=groups.filter(x=>x.status==='published');materials=materials.filter(x=>x.status==='published');
   const en=(cls.enrollments||[]).find(x=>(session.employeeId&&x.employeeId===session.employeeId)||(session.account?.id&&x.accountId===session.account.id));
   if(!en)throw err('Bạn chưa được phân công vào khóa học này.',403,'CLASSROOM_NOT_ENROLLED');
   progress=progress.filter(x=>x.enrollmentId===en.id);
 }
 let learnerSummaries=[];
 if(canOperate(session)){
   const requiredIds=new Set(materials.filter(x=>x.status==='published'&&x.required).map(x=>x.id));
   const publishedIds=new Set(materials.filter(x=>x.status==='published').map(x=>x.id));
   learnerSummaries=(cls.enrollments||[]).map(en=>{
     const rows=progress.filter(x=>x.enrollmentId===en.id&&publishedIds.has(x.materialId));
     const completed=new Set(rows.filter(x=>x.status==='completed').map(x=>x.materialId));
     const openedRows=rows.filter(x=>x.lastOpenedAt);
     const completedRequired=[...requiredIds].filter(x=>completed.has(x)).length;
     const requiredTotal=requiredIds.size;
     const percent=requiredTotal?Math.round(completedRequired*100/requiredTotal):0;
     const lastOpenedAt=openedRows.sort((a,b)=>String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))[0]?.lastOpenedAt||'';
     const expired=!!(cls.endAt&&Date.now()>new Date(cls.endAt).getTime());
     let status='not_started';
     if(requiredTotal>0&&completedRequired>=requiredTotal)status='completed';
     else if(expired)status='expired';
     else if(rows.length)status='in_progress';
     return {enrollment:en,completedRequired,requiredTotal,openedCount:new Set(rows.map(x=>x.materialId)).size,publishedTotal:publishedIds.size,percent,lastOpenedAt,status};
   });
 }
 return {classroomClass:cls,groups,materials,progress,learnerSummaries,canEdit:canOperate(session)};
}
async function saveGroups(session,classId,groups){if(!canOperate(session))throw err('Bạn không có quyền quản lý tài liệu.',403,'CLASSROOM_OPERATION_REQUIRED');const cls=await ensureClass(session,classId);if(!Array.isArray(groups)||!groups.length)throw err('Khóa học phải có ít nhất một nhóm nội dung.',400,'CLASSROOM_GROUP_REQUIRED');const rows=groups.map((x,i)=>({id:text(x.id)||id('content-group'),class_id:cls.id,title:text(x.title),description:text(x.description),sort_order:i+1,status:['draft','published','hidden'].includes(text(x.status))?text(x.status):'draft',updated_at:new Date().toISOString(),created_by:text(session.account?.id||session.sub||session.email)}));if(rows.some(x=>!x.title))throw err('Tên nhóm nội dung không được để trống.');const client=db();const old=await client.from('classroom_content_groups').select('id').eq('class_id',cls.id);if(old.error)throw old.error;const keep=new Set(rows.map(x=>x.id)),remove=(old.data||[]).map(x=>x.id).filter(x=>!keep.has(x));if(remove.length){const d=await client.from('classroom_content_groups').delete().in('id',remove);if(d.error)throw d.error;}const u=await client.from('classroom_content_groups').upsert(rows,{onConflict:'id'});if(u.error)throw u.error;return getMaterials(session,cls.id);}
async function createUpload(session,payload){if(!canOperate(session))throw err('Bạn không có quyền tải tài liệu.',403);const cls=await ensureClass(session,payload.classId);const groupId=text(payload.groupId),name=text(payload.fileName),mime=text(payload.mimeType),size=Number(payload.sizeBytes||0);if(!groupId||!name)throw err('Thiếu nhóm nội dung hoặc tên file.');if(size<=0||size>MAX_BYTES)throw err('Mỗi file phải có dung lượng từ 1 byte đến 25 MB.',400,'CLASSROOM_FILE_SIZE_INVALID');if(!ALLOWED.has(mime))throw err('Định dạng file chưa được hỗ trợ.',400,'CLASSROOM_FILE_TYPE_INVALID');const client=db();const g=await client.from('classroom_content_groups').select('id').eq('id',groupId).eq('class_id',cls.id).maybeSingle();if(g.error||!g.data)throw err('Không tìm thấy nhóm nội dung.');const materialId=id('material'),path=`classes/${cls.id}/${groupId}/${materialId}/${safeName(name)}`;const signed=await client.storage.from(BUCKET).createSignedUploadUrl(path);if(signed.error)throw signed.error;return {materialId,storagePath:path,token:signed.data.token,signedUrl:signed.data.signedUrl,bucket:BUCKET};}
async function finalizeUpload(session,payload){if(!canOperate(session))throw err('Bạn không có quyền lưu tài liệu.',403);const cls=await ensureClass(session,payload.classId);const row={id:text(payload.materialId)||id('material'),class_id:cls.id,group_id:text(payload.groupId),title:text(payload.title)||text(payload.fileName),original_name:text(payload.fileName),mime_type:text(payload.mimeType),size_bytes:Number(payload.sizeBytes||0),storage_path:text(payload.storagePath),required:payload.required!==false,status:['draft','published','hidden'].includes(text(payload.status))?text(payload.status):'draft',sort_order:Number(payload.sortOrder||999),version_no:1,created_by:text(session.account?.id||session.sub||session.email),updated_at:new Date().toISOString()};const client=db();const q=await client.from('classroom_materials').insert(row);if(q.error)throw q.error;await client.from('classroom_material_versions').insert({id:id('material-version'),material_id:row.id,version_no:1,storage_path:row.storage_path,original_name:row.original_name,mime_type:row.mime_type,size_bytes:row.size_bytes,changed_by:row.created_by});return getMaterials(session,cls.id);}
async function updateMaterial(session,payload){if(!canOperate(session))throw err('Bạn không có quyền sửa tài liệu.',403);const client=db();const patch={title:text(payload.title),required:payload.required!==false,status:['draft','published','hidden'].includes(text(payload.status))?text(payload.status):'draft',sort_order:Number(payload.sortOrder||0),updated_at:new Date().toISOString()};const q=await client.from('classroom_materials').update(patch).eq('id',text(payload.materialId)).eq('class_id',text(payload.classId));if(q.error)throw q.error;return getMaterials(session,payload.classId);}
async function materialUrl(session,classId,materialId){const data=await getMaterials(session,classId),mat=data.materials.find(x=>x.id===materialId);if(!mat)throw err('Không tìm thấy tài liệu.',404);const signed=await db().storage.from(BUCKET).createSignedUrl(mat.storagePath,60*10);if(signed.error)throw signed.error;if(role(session)==='learner')await markProgress(session,data.classroomClass,mat,'open');return {url:signed.data.signedUrl,material:mat};}
async function markProgress(session,cls,mat,action){if(role(session)!=='learner')throw err('Chỉ học viên được xác nhận tài liệu.',403);if(cls.endAt&&Date.now()>new Date(cls.endAt).getTime())throw err('Khóa học đã hết thời hạn.',403,'CLASSROOM_COURSE_EXPIRED');const en=(cls.enrollments||[]).find(x=>(session.employeeId&&x.employeeId===session.employeeId)||(session.account?.id&&x.accountId===session.account.id));if(!en)throw err('Bạn chưa được phân công vào khóa học.',403);const stamp=new Date().toISOString(),completed=action==='confirm';const row={id:id('material-progress'),class_id:cls.id,material_id:mat.id,enrollment_id:en.id,employee_id:en.employeeId||null,account_id:en.accountId||null,status:completed?'completed':'opened',first_opened_at:stamp,last_opened_at:stamp,confirmed_at:completed?stamp:null,updated_at:stamp};const client=db();const old=await client.from('classroom_material_progress').select('*').eq('material_id',mat.id).eq('enrollment_id',en.id).maybeSingle();if(old.data){row.id=old.data.id;row.first_opened_at=old.data.first_opened_at||stamp;if(!completed)row.confirmed_at=old.data.confirmed_at;row.status=completed?'completed':(old.data.status||'opened');}const q=await client.from('classroom_material_progress').upsert(row,{onConflict:'material_id,enrollment_id'});if(q.error)throw q.error;return getMaterials(session,cls.id);}
async function confirmMaterial(session,payload){const data=await getMaterials(session,payload.classId),mat=data.materials.find(x=>x.id===text(payload.materialId));if(!mat)throw err('Không tìm thấy tài liệu.',404);return markProgress(session,data.classroomClass,mat,'confirm');}
module.exports={getMaterials,saveGroups,createUpload,finalizeUpload,updateMaterial,materialUrl,confirmMaterial};
