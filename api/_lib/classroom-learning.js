'use strict';

require('dotenv').config();
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const DATA_FILE=path.join(__dirname,'..','..','data.json');
const hasSupabaseEnv=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SECRET_KEY);
const allowLocalData=String(process.env.PHF_ALLOW_LOCAL_DATA||'').trim().toLowerCase()==='true';
let supabase=null;
if(hasSupabaseEnv){const {createClient}=require('@supabase/supabase-js');supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY);}
function id(prefix){return `${prefix}-${typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now()+'-'+crypto.randomBytes(8).toString('hex')}`;}
function text(v){return String(v==null?'':v).trim();}
function now(){return new Date().toISOString();}
function bool(v,f=false){return v===undefined||v===null?f:Boolean(v);}
function assertStorage(){if(supabase||allowLocalData)return;const e=new Error('Classroom chưa được cấu hình kết nối dữ liệu.');e.statusCode=503;e.code='CLASSROOM_STORAGE_NOT_CONFIGURED';throw e;}
function schemaError(error){const raw=String(error?.message||error||'');if(/classroom_lessons|classroom_lesson_progress|relation .* does not exist|PGRST205|schema cache/i.test(raw)){const e=new Error('Database chưa có bảng bài học Classroom. Vui lòng chạy scripts/phf_supabase_classroom_1_17_learning.sql.');e.statusCode=503;e.code='CLASSROOM_LEARNING_SCHEMA_REQUIRED';return e;}return error;}
function readLocal(){const d=fs.existsSync(DATA_FILE)?JSON.parse(fs.readFileSync(DATA_FILE,'utf8')):{};d.classroomLessons=Array.isArray(d.classroomLessons)?d.classroomLessons:[];d.classroomLessonProgress=Array.isArray(d.classroomLessonProgress)?d.classroomLessonProgress:[];return d;}
function writeLocal(d){const tmp=`${DATA_FILE}.learning-${process.pid}-${Date.now()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(d,null,2),'utf8');fs.renameSync(tmp,DATA_FILE);}
function employeeId(session){return text(session?.employeeId||session?.account?.employeeId);}
function accountId(session){return text(session?.account?.id||session?.sub);}
function role(session){return text(session?.role).toLowerCase();}
function samePerson(session,row){const eid=employeeId(session),aid=accountId(session);return Boolean((eid&&text(row.employee_id||row.employeeId)===eid)||(aid&&text(row.account_id||row.accountId)===aid));}
function mapLesson(r){return {id:r.id,classId:r.class_id??r.classId,category:r.category||'Nội dung khóa học',title:r.title||'',summary:r.summary||'',contentType:r.content_type??r.contentType??'text',contentUrl:r.content_url??r.contentUrl??'',contentText:r.content_text??r.contentText??'',estimatedMinutes:Number(r.estimated_minutes??r.estimatedMinutes??0),sortOrder:Number(r.sort_order??r.sortOrder??0),required:bool(r.required,true),status:r.status||'draft',createdAt:r.created_at??r.createdAt??'',updatedAt:r.updated_at??r.updatedAt??''};}
function mapProgress(r){return {id:r.id,classId:r.class_id??r.classId,lessonId:r.lesson_id??r.lessonId,enrollmentId:r.enrollment_id??r.enrollmentId,employeeId:r.employee_id??r.employeeId??'',accountId:r.account_id??r.accountId??'',status:r.status||'not_started',firstOpenedAt:r.first_opened_at??r.firstOpenedAt??'',lastOpenedAt:r.last_opened_at??r.lastOpenedAt??'',completedAt:r.completed_at??r.completedAt??'',updatedAt:r.updated_at??r.updatedAt??''};}
async function classContext(session,classId){
  const {getClass}=require('./classroom-db');
  return getClass(session,classId);
}
function isExpired(cls){if(!cls?.endAt)return false;return Date.now()>new Date(cls.endAt).getTime();}
function enrollmentFor(session,cls){return (cls.enrollments||[]).find(x=>(employeeId(session)&&x.employeeId===employeeId(session))||(accountId(session)&&x.accountId===accountId(session)))||null;}
async function readRows(classId){
  if(supabase){
    const [a,b]=await Promise.all([supabase.from('classroom_lessons').select('*').eq('class_id',classId).order('sort_order',{ascending:true}),supabase.from('classroom_lesson_progress').select('*').eq('class_id',classId)]);
    if(a.error||b.error)throw schemaError(a.error||b.error);
    return {lessons:(a.data||[]).map(mapLesson),progress:(b.data||[]).map(mapProgress)};
  }
  const d=readLocal();return {lessons:d.classroomLessons.map(mapLesson).filter(x=>x.classId===classId).sort((a,b)=>a.sortOrder-b.sortOrder),progress:d.classroomLessonProgress.map(mapProgress).filter(x=>x.classId===classId)};
}
function learnerSummary(cls,lessons,progress,enrollment){
  const published=lessons.filter(x=>x.status==='published');
  const required=published.filter(x=>x.required);
  const mine=progress.filter(x=>x.enrollmentId===enrollment?.id);
  const completed=new Set(mine.filter(x=>x.status==='completed').map(x=>x.lessonId));
  const completedRequired=required.filter(x=>completed.has(x.id)).length;
  const percent=required.length?Math.round(completedRequired*100/required.length):0;
  return {totalLessons:published.length,requiredLessons:required.length,completedLessons:completed.size,completedRequired,percent,status:!mine.length?'not_started':(completedRequired>=required.length&&required.length?'completed':(isExpired(cls)?'overdue':'in_progress')),expired:isExpired(cls),endAt:cls.endAt||''};
}
async function getLearning(session,classId){
  assertStorage();const cls=await classContext(session,classId);const rows=await readRows(cls.id);const r=role(session);
  let lessons=rows.lessons;
  if(r==='learner')lessons=lessons.filter(x=>x.status==='published');
  if(r==='learner'){
    const en=enrollmentFor(session,cls);if(!en){const e=new Error('Bạn chưa được phân công vào khóa học này.');e.statusCode=403;e.code='CLASSROOM_NOT_ENROLLED';throw e;}
    const mine=rows.progress.filter(x=>x.enrollmentId===en.id);
    return {classroomClass:cls,lessons,progress:mine,summary:learnerSummary(cls,rows.lessons,rows.progress,en),canEdit:false};
  }
  const summaries=(cls.enrollments||[]).map(en=>({enrollment:en,...learnerSummary(cls,rows.lessons,rows.progress,en),lastOpenedAt:rows.progress.filter(x=>x.enrollmentId===en.id).map(x=>x.lastOpenedAt).filter(Boolean).sort().pop()||''}));
  return {classroomClass:cls,lessons,progress:rows.progress,learnerSummaries:summaries,canEdit:r==='admin'||r==='manager'};
}
function validateLessons(items){
  if(!Array.isArray(items))return [];
  return items.map((x,i)=>{const title=text(x.title);if(!title){const e=new Error(`Bài ${i+1} chưa có tên.`);e.statusCode=400;e.code='CLASSROOM_LESSON_TITLE_REQUIRED';throw e;}const type=['text','link','video','file'].includes(text(x.contentType))?text(x.contentType):'text';return {id:text(x.id)||id('lesson'),category:text(x.category)||'Nội dung khóa học',title,summary:text(x.summary),content_type:type,content_url:text(x.contentUrl),content_text:text(x.contentText),estimated_minutes:Math.max(0,Number(x.estimatedMinutes)||0),sort_order:i+1,required:bool(x.required,true),status:['draft','published','hidden'].includes(text(x.status))?text(x.status):'draft'};});
}
async function saveLessons(session,classId,items){
  assertStorage();if(!['admin','manager'].includes(role(session))){const e=new Error('Bạn không có quyền quản lý nội dung Classroom.');e.statusCode=403;e.code='CLASSROOM_OPERATION_PERMISSION_REQUIRED';throw e;}
  const cls=await classContext(session,classId);const rows=validateLessons(items),stamp=now();
  if(supabase){
    const {data:old,error:readErr}=await supabase.from('classroom_lessons').select('id').eq('class_id',cls.id);if(readErr)throw schemaError(readErr);
    const keep=new Set(rows.map(x=>x.id)),remove=(old||[]).map(x=>x.id).filter(x=>!keep.has(x));
    if(remove.length){const {error}=await supabase.from('classroom_lessons').delete().in('id',remove);if(error)throw schemaError(error);}
    if(rows.length){const payload=rows.map(x=>({...x,class_id:cls.id,created_by:text(session?.account?.id||session?.sub||session?.email),updated_at:stamp}));const {error}=await supabase.from('classroom_lessons').upsert(payload,{onConflict:'id'});if(error)throw schemaError(error);}
  }else{
    const d=readLocal();const oldMap=new Map(d.classroomLessons.map(mapLesson).filter(x=>x.classId===cls.id).map(x=>[x.id,x]));d.classroomLessons=d.classroomLessons.filter(x=>(x.classId||x.class_id)!==cls.id).concat(rows.map(x=>({...x,classId:cls.id,class_id:cls.id,contentType:x.content_type,contentUrl:x.content_url,contentText:x.content_text,estimatedMinutes:x.estimated_minutes,sortOrder:x.sort_order,createdAt:oldMap.get(x.id)?.createdAt||stamp,updatedAt:stamp})));writeLocal(d);
  }
  return getLearning(session,cls.id);
}
async function updateProgress(session,classId,lessonId,action){
  assertStorage();if(role(session)!=='learner'){const e=new Error('Chỉ học viên được ghi nhận tiến độ học.');e.statusCode=403;e.code='CLASSROOM_LEARNER_REQUIRED';throw e;}
  const cls=await classContext(session,classId),en=enrollmentFor(session,cls);if(!en){const e=new Error('Bạn chưa được phân công vào khóa học này.');e.statusCode=403;throw e;}
  if(isExpired(cls)){const e=new Error('Khóa học đã hết thời hạn. Vui lòng liên hệ Admin nếu cần gia hạn.');e.statusCode=403;e.code='CLASSROOM_COURSE_EXPIRED';throw e;}
  const rows=await readRows(cls.id),lesson=rows.lessons.find(x=>x.id===lessonId&&x.status==='published');if(!lesson){const e=new Error('Không tìm thấy bài học đã phát hành.');e.statusCode=404;e.code='CLASSROOM_LESSON_NOT_FOUND';throw e;}
  const old=rows.progress.find(x=>x.enrollmentId===en.id&&x.lessonId===lesson.id),stamp=now(),status=action==='complete'?'completed':'in_progress';
  const row={id:old?.id||id('lesson-progress'),class_id:cls.id,lesson_id:lesson.id,enrollment_id:en.id,employee_id:en.employeeId||null,account_id:en.accountId||null,status,first_opened_at:old?.firstOpenedAt||stamp,last_opened_at:stamp,completed_at:status==='completed'?(old?.completedAt||stamp):null,updated_at:stamp};
  if(supabase){const {error}=await supabase.from('classroom_lesson_progress').upsert(row,{onConflict:'lesson_id,enrollment_id'});if(error)throw schemaError(error);}else{const d=readLocal(),idx=d.classroomLessonProgress.findIndex(x=>(x.lessonId||x.lesson_id)===lesson.id&&(x.enrollmentId||x.enrollment_id)===en.id),local={...mapProgress(row),...row};if(idx>=0)d.classroomLessonProgress[idx]=local;else d.classroomLessonProgress.push(local);writeLocal(d);}
  return getLearning(session,cls.id);
}
module.exports={getLearning,saveLessons,updateProgress};
